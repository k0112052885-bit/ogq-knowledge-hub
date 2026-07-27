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

// Mermaid 기본(dark) 테마의 노드 배경은 밝은 연보라 계열이라 Docs Builder의
// 다크 차콜 UI와 어울리지 않는다. Docs Builder 다크모드에서는 themeVariables로
// 노드/텍스트/테두리/연결선 색을 앱의 다크 톤(차콜 배경 + 블루 accent)에 맞게
// 덮어써서, AI Diagram(문서 Preview·시안 카드 모두)이 앱과 이질감 없이 보이게 한다.
// 라이트 모드는 Mermaid 기본(default) 테마를 그대로 사용해 이번 변경의 영향을 받지 않는다.
//
// 문서에 삽입된 Mermaid 코드는 순수 코드블록이라 어떤 AI Diagram Style로 생성됐는지
// 메타데이터가 없다. 따라서 문서 Preview(runMermaid)는 저장 후 다시 열기/Build 결과와
// 항상 동일하게 보이도록 이 Docs Builder 팔레트로 고정 렌더링한다 — 이 값 자체가
// server/ai-diagram/styles.js의 STYLES.default.palette와 동일한 값이다.
const DOCS_BUILDER_DARK_MERMAID_THEME_VARIABLES = {
  primaryColor: "#171c26",
  primaryTextColor: "#f4f7fb",
  primaryBorderColor: "#4f7cff",
  // Mermaid dark 테마는 .node rect의 실제 stroke 색으로 nodeBorder 변수를 우선 사용한다.
  nodeBorder: "#4f7cff",
  lineColor: "#536074",
  secondaryColor: "#202a3a",
  tertiaryColor: "#202a3a",
  background: "#0b0e14",
  mainBkg: "#171c26",
  nodeTextColor: "#f4f7fb",
  edgeLabelBackground: "#171c26",
  clusterBkg: "#141924",
  clusterBorder: "#4f7cff",
};

// AI Diagram 스타일별 palette(server/ai-diagram/styles.js의 palette와 동일한 색상 값)를
// Mermaid의 themeVariables 키로 변환한다. palette가 없으면(선택 정보를 알 수 없는 경우)
// Docs Builder 기본 팔레트로 fallback한다.
function paletteToThemeVariables(palette) {
  if (!palette) return DOCS_BUILDER_DARK_MERMAID_THEME_VARIABLES;
  return {
    primaryColor: palette.nodeBg,
    primaryTextColor: palette.text,
    primaryBorderColor: palette.border,
    // Mermaid의 "dark" 테마는 .node rect의 실제 stroke 색으로 primaryBorderColor가 아니라
    // nodeBorder 변수를 우선 사용한다. 이걸 빼먹으면 테두리가 palette와 무관하게 항상
    // dark 테마 기본 하늘색(#81B1DB)으로 남아 스타일 간 차이가 눈에 보이지 않는다.
    nodeBorder: palette.border,
    lineColor: palette.line,
    secondaryColor: palette.nodeAccentBg,
    tertiaryColor: palette.nodeAccentBg,
    background: palette.background,
    mainBkg: palette.nodeBg,
    nodeTextColor: palette.text,
    edgeLabelBackground: palette.nodeBg,
    clusterBkg: palette.background,
    clusterBorder: palette.accent,
  };
}

// Mermaid 기본 간격(nodeSpacing/rankSpacing 50 안팎, diagramPadding 8)은 라운드/stadium
// 노드처럼 폭이 넓어진 노드와 결합하면 화살표가 노드에 바짝 붙거나 겹쳐 보이기 쉽다.
// 렌더링 시점엔 이 코드가 어떤 diagramType으로 생성됐는지 알 수 없으므로(순수 코드블록이라
// 메타데이터 없음) 모든 flowchart에 공통으로 여유 있는 간격을 적용한다 — 값 자체는 다른
// 구조(조직도/순환/비교/로드맵)에도 해가 되지 않는 "더 넉넉한 여백"이라 안전하다.
const FLOWCHART_LAYOUT_OPTIONS = {
  nodeSpacing: 60,
  rankSpacing: 75,
  diagramPadding: 20,
  useMaxWidth: true,
  htmlLabels: true,
  // 노드 내부 좌우 padding을 늘려, 라벨이 짧아도(예: 한 글자) 노드가 지나치게
  // 작아지지 않고 텍스트 주변에 여유 공간이 생기도록 한다.
  padding: 20,
};

// palette를 넘기면(AI Diagram 카드 Preview) 해당 스타일의 색상으로, 넘기지 않으면
// (문서 Preview) Docs Builder 고정 팔레트로 Mermaid 테마를 초기화한다.
export function initializeMermaidTheme(palette) {
  try {
    const isDark = state.settings.theme === "dark";
    window.mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? "dark" : "default",
      themeVariables: isDark ? paletteToThemeVariables(palette) : undefined,
      flowchart: FLOWCHART_LAYOUT_OPTIONS,
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
