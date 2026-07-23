import { el, state } from "../../core/state.js";
import { api } from "../../core/api.js";
import { escapeHtml } from "../../core/dom-utils.js";
import { getEditorValue } from "../editor/editor-core.js";

// 에디터에는 Front Matter가 포함된 전체 파일 내용이 들어있으므로,
// markdown-it이 "---"를 <hr>로 오인해 깨지지 않도록 미리보기 전에 제거한다.
// BOM/선행 공백이 섞여 있어도 안전하게 감지하도록 trim 후 검사한다.
function stripFrontMatterForPreview(content) {
  const withoutBom = content.replace(/^﻿/, "");
  const leading = withoutBom.match(/^\s*/)[0];
  const body = withoutBom.slice(leading.length);
  if (!body.startsWith("---")) return content;
  const match = body.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/);
  return match ? body.slice(match[0].length) : content;
}

let previewTimer = null;

export function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 300);
}

export async function renderPreview() {
  const rawContent = getEditorValue();
  const content = stripFrontMatterForPreview(rawContent);
  if (!content.trim()) {
    el.previewBody.innerHTML = '<p class="preview-empty">편집기에 내용을 입력하면 미리보기가 표시됩니다.</p>';
    return;
  }
  try {
    const data = await api("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    el.previewBody.innerHTML = data.html;
    await runMermaid();
  } catch (e) {
    el.previewBody.innerHTML = `<p style="color:var(--danger);">미리보기 렌더링 실패: ${escapeHtml(e.message)}</p>`;
  }
}

let mermaidRenderSeq = 0;

// container(DOM 엘리먼트) 안에 Mermaid 코드 하나를 렌더링한다.
// 실패해도 에러를 던지지 않고 container 안에 에러 UI를 표시하는 것으로 마무리한다
// (호출부가 여러 블록/카드를 순회 중이어도 하나의 실패가 나머지에 영향을 주지 않도록).
// AI Diagram v2의 다중 시안 카드 미리보기에서도 이 함수를 그대로 재사용할 수 있도록
// el.previewBody 같은 특정 DOM에 의존하지 않고 container를 인자로 받는다.
export async function renderMermaidBlock(container, code) {
  if (typeof window.mermaid === "undefined") return;

  const id = `mermaid-preview-${++mermaidRenderSeq}`;
  try {
    const { svg } = await window.mermaid.render(id, code);
    container.innerHTML = svg;
    container.classList.remove("mermaid-error");
  } catch (e) {
    container.classList.add("mermaid-error");
    container.innerHTML = `<div class="mermaid-error-box">
          <div class="mermaid-error-title">Mermaid 렌더링 실패</div>
          <div class="mermaid-error-message">${escapeHtml(e.message || String(e))}</div>
        </div>`;
  }
}

function initializeMermaidTheme() {
  try {
    window.mermaid.initialize({
      startOnLoad: false,
      theme: state.settings.theme === "dark" ? "dark" : "default",
      securityLevel: "strict",
    });
  } catch (e) {
    // initialize 자체가 실패하는 경우는 드물지만, 실패해도 블록별 렌더링은 계속 시도한다.
  }
}

// 문서 미리보기(el.previewBody) 안의 모든 .mermaid 블록을 순회하며 렌더링한다.
// 블록 단위로 개별 렌더링해서, 문서에 여러 다이어그램이 있을 때
// 하나가 문법 오류여도 나머지는 정상 렌더링되고 실패한 블록에만 에러가 표시되게 한다.
async function runMermaid() {
  const blocks = Array.from(el.previewBody.querySelectorAll(".mermaid"));
  if (!blocks.length || typeof window.mermaid === "undefined") return;

  initializeMermaidTheme();

  for (const block of blocks) {
    await renderMermaidBlock(block, block.textContent);
  }
}

// ============================================================
// Image lightbox: Preview 이미지 클릭 시 원본 크기로 확대
// ============================================================
function openImageLightbox(img) {
  el.imageLightboxImg.src = img.currentSrc || img.src;
  el.imageLightboxImg.alt = img.alt || "";
  el.imageLightboxCaption.textContent = img.alt || "";
  el.imageLightboxCaption.classList.toggle("hidden", !img.alt);
  el.imageLightbox.classList.remove("hidden");
}

function closeImageLightbox() {
  el.imageLightbox.classList.add("hidden");
  el.imageLightboxImg.src = "";
}

export function setupImageLightbox() {
  // Preview는 렌더링마다 innerHTML이 통째로 교체되므로 위임 리스너로 처리
  el.previewBody.addEventListener("click", (e) => {
    const img = e.target.closest("figure.doc-image img");
    if (!img) return;
    openImageLightbox(img);
  });

  el.imageLightboxClose.addEventListener("click", closeImageLightbox);
  el.imageLightbox.addEventListener("click", (e) => {
    if (e.target === el.imageLightbox) closeImageLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.imageLightbox.classList.contains("hidden")) {
      closeImageLightbox();
    }
  });
}
