import { el, state } from "../../core/state.js";
import { api } from "../../core/api.js";
import { toast, setStatus } from "../../core/toast.js";
import { insertTextAtCursor, getSelectedEditorText } from "../editor/editor-core.js";
import { schedulePreview, renderMermaidBlock } from "../preview/preview.js";
import { openModal, closeModal } from "../../core/modal.js";

// 선택 영역을 Mermaid 코드 펜스로 감싼 텍스트로 치환한다.
// insertTextAtCursor는 현재 selection 범위를 그대로 덮어쓰므로,
// 선택했던 원본 문장은 사라지고 변환된 다이어그램으로 대체된다.
function replaceSelectionWithMermaid(code) {
  const block = `\`\`\`mermaid\n${code.trim()}\n\`\`\`\n`;
  insertTextAtCursor(block);
}

export async function generateAiDiagram() {
  if (!state.currentFilename) {
    toast("error", "다이어그램을 삽입할 문서가 없습니다", "먼저 문서를 열거나 새로 만들어주세요.");
    return;
  }
  const selectedText = getSelectedEditorText().trim();
  if (!selectedText) {
    toast("error", "변환할 텍스트를 선택해주세요", "다이어그램으로 만들 문장을 에디터에서 드래그해 선택한 뒤 다시 눌러주세요.");
    return;
  }

  el.btnAiDiagram.disabled = true;
  const originalLabel = el.btnAiDiagram.textContent;
  el.btnAiDiagram.textContent = "생성 중...";
  setStatus("AI 다이어그램 생성 중...", "busy");
  toast("info", "AI 다이어그램 생성 중...", "선택한 텍스트를 Mermaid 코드로 변환하고 있습니다.");

  try {
    const data = await api("/api/ai-diagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: selectedText }),
    });
    replaceSelectionWithMermaid(data.code);
    setStatus("AI 다이어그램 생성 완료", "ok");
    toast("success", "다이어그램 생성 완료", "Mermaid 코드가 삽입되었습니다.");
    schedulePreview();
  } catch (e) {
    setStatus("AI 다이어그램 생성 실패", "error");
    toast("error", "AI 다이어그램 생성 실패", e.message);
  } finally {
    el.btnAiDiagram.disabled = false;
    el.btnAiDiagram.textContent = originalLabel;
  }
}

// ============================================================
// AI Diagram v2: 유형/스타일/시안 개수를 선택해 여러 시안을 생성하는 모달.
// 생성된 시안은 카드 DOM(및 클로저)에만 보관되는 메모리 상태이며 별도로 저장되지
// 않는다 — 모달을 닫거나 다시 생성하면 이전 시안은 사라진다(생성 이력 기능은
// 이번 범위에 포함하지 않음).
// 기존 generateAiDiagram()/btnAiDiagram 클릭 흐름은 이 섹션과 완전히 분리되어 있어
// 전혀 영향을 받지 않는다.
// ============================================================
function openAiDiagramV2Modal() {
  if (!state.currentFilename) {
    toast("error", "다이어그램을 삽입할 문서가 없습니다", "먼저 문서를 열거나 새로 만들어주세요.");
    return;
  }
  const selectedText = getSelectedEditorText().trim();
  if (!selectedText) {
    toast("error", "변환할 텍스트를 선택해주세요", "다이어그램으로 만들 문장을 에디터에서 드래그해 선택한 뒤 다시 눌러주세요.");
    return;
  }

  el.aiDiagramV2Status.textContent = "";
  el.aiDiagramV2Results.innerHTML = '<p class="ai-diagram-v2-empty">유형과 스타일을 선택한 뒤 "시안 생성"을 눌러주세요.</p>';
  openModal("aiDiagramV2Modal");
}

// 선택된 시안의 code를 기존 replaceSelectionWithMermaid로 그대로 삽입한다.
// 삽입 이후 흐름(저장 상태 갱신, Preview 갱신)은 기존 단일 생성(generateAiDiagram)과
// 완전히 동일한 함수(replaceSelectionWithMermaid, schedulePreview)를 그대로 재사용한다.
function insertSelectedDiagramVariant(code) {
  replaceSelectionWithMermaid(code);
  closeModal("aiDiagramV2Modal");
  toast("success", "다이어그램이 삽입되었습니다", "선택한 시안의 Mermaid 코드가 문서에 삽입되었습니다.");
  schedulePreview();
}

// 시안 카드 하나를 만들어 컨테이너에 추가하고, 그 안에 Mermaid 미리보기를 렌더링한다.
// 카드를 클릭하면 이 카드의 code가 그대로 삽입된다. code는 카드 클릭 핸들러의
// 클로저 안에만 보관되며(메모리 한정), 별도 저장소에 기록하지 않는다.
async function renderDiagramVariantCard(container, code) {
  const card = document.createElement("div");
  card.className = "ai-diagram-v2-card";
  card.title = "클릭하면 이 시안을 문서에 삽입합니다";

  const previewEl = document.createElement("div");
  previewEl.className = "ai-diagram-v2-card-preview mermaid";
  card.appendChild(previewEl);
  container.appendChild(card);

  card.addEventListener("click", () => insertSelectedDiagramVariant(code));

  await renderMermaidBlock(previewEl, code);
}

async function generateAiDiagramV2() {
  const selectedText = getSelectedEditorText().trim();
  if (!selectedText) {
    toast("error", "변환할 텍스트를 선택해주세요", "다이어그램으로 만들 문장을 에디터에서 드래그해 선택한 뒤 다시 눌러주세요.");
    return;
  }

  const diagramType = el.aiDiagramType.value;
  const style = el.aiDiagramStyle.value;
  const variantCount = Number(el.aiDiagramVariantCount.value) || 1;

  el.btnGenerateAiDiagramV2.disabled = true;
  const originalLabel = el.btnGenerateAiDiagramV2.textContent;
  el.btnGenerateAiDiagramV2.textContent = "생성 중...";
  el.aiDiagramV2Status.textContent = "시안 생성 중...";
  el.aiDiagramV2Results.innerHTML = "";

  try {
    const data = await api("/api/ai-diagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: selectedText, diagramType, style, variantCount }),
    });

    // variantCount가 1이면 서버 응답에 results가 없으므로(하위 호환), code 하나로 카드 하나만 만든다.
    const codes = Array.isArray(data.results) ? data.results.map((r) => r.code) : [data.code];

    el.aiDiagramV2Results.innerHTML = "";
    for (const code of codes) {
      await renderDiagramVariantCard(el.aiDiagramV2Results, code);
    }
    el.aiDiagramV2Status.textContent = `${codes.length}개 시안 생성 완료`;
  } catch (e) {
    el.aiDiagramV2Status.textContent = "";
    el.aiDiagramV2Results.innerHTML = `<p class="ai-diagram-v2-empty">시안 생성 실패: ${e.message}</p>`;
    toast("error", "AI 다이어그램 생성 실패", e.message);
  } finally {
    el.btnGenerateAiDiagramV2.disabled = false;
    el.btnGenerateAiDiagramV2.textContent = originalLabel;
  }
}

export function initAiDiagram() {
  el.btnAiDiagram.addEventListener("click", generateAiDiagram);
  el.btnAiDiagramV2.addEventListener("click", openAiDiagramV2Modal);
  el.btnGenerateAiDiagramV2.addEventListener("click", generateAiDiagramV2);
}
