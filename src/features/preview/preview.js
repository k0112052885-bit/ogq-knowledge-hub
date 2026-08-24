import { el } from "../../core/state.js";
import { api } from "../../core/api.js";
import { escapeHtml } from "../../core/dom-utils.js";
import { getEditorValue } from "../editor/editor-core.js";
import { runMermaid } from "./mermaid-render.js";

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
    await runMermaid(el.previewBody);
  } catch (e) {
    el.previewBody.innerHTML = `<p style="color:var(--danger);">미리보기 렌더링 실패: ${escapeHtml(e.message)}</p>`;
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
