import { el, state } from "../../core/state.js";
import { api } from "../../core/api.js";
import { toast, setStatus } from "../../core/toast.js";
import { insertTextAtCursor, getSelectedEditorText, isSelectionAtLineStart } from "../editor/editor-core.js";
import { schedulePreview, renderMermaidBlock } from "../preview/preview.js";
import { openModal, closeModal } from "../../core/modal.js";

// 선택 영역을 Mermaid 코드 펜스로 감싼 텍스트로 치환한다.
// insertTextAtCursor는 현재 selection 범위를 그대로 덮어쓰므로,
// 선택했던 원본 문장은 사라지고 변환된 다이어그램으로 대체된다.
// ```mermaid 코드펜스는 반드시 줄 맨 앞에서 시작해야 마크다운 파서가 코드블록으로
// 인식한다. 선택 영역이 줄 중간(예: "## 제목"에서 "제목"만 선택)에서 시작하면 그 줄의
// 앞부분("## ")이 코드펜스 앞에 그대로 남아 "## ```mermaid"처럼 깨지므로, 이 경우
// 코드펜스 앞에 줄바꿈을 하나 추가해 항상 새 줄에서 시작하도록 보정한다.
function replaceSelectionWithMermaid(code) {
  const needsLeadingNewline = !isSelectionAtLineStart();
  const block = `${needsLeadingNewline ? "\n" : ""}\`\`\`mermaid\n${code.trim()}\n\`\`\`\n`;
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

// 서버 server/ai-diagram/styles.js의 라벨/설명과 짝을 맞춘 UI 표시용 설명 문구.
// 스타일 선택 로직(요청 payload) 자체와는 무관한 순수 표시 텍스트다.
const STYLE_DESCRIPTIONS = {
  default: "기본 다크 문서 스타일",
  mckinsey: "기업 전략 문서 스타일",
  bcg: "컨설팅 보고서 스타일",
  deloitte: "비즈니스 프로세스 스타일",
  microsoft: "Flowchart 중심",
  apple: "미니멀 프레젠테이션 스타일",
};

function updateStyleDescription() {
  const style = el.aiDiagramStyle.value;
  el.aiDiagramStyleDesc.textContent = STYLE_DESCRIPTIONS[style] || "";
  // "Docs Builder"(default) 스타일을 선택했을 때만 추천 배지를 보여준다.
  // 다른 스타일 선택 시에도 배지가 남아있으면 해당 스타일이 추천인 것처럼
  // 오인될 수 있으므로 선택값에 맞춰 토글한다.
  el.aiDiagramStyleRecommendedBadge.classList.toggle("hidden", style !== "default");
}

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
  updateStyleDescription();
  openModal("aiDiagramV2Modal");
}

// 선택된 시안의 code를 기존 replaceSelectionWithMermaid로 그대로 삽입한다.
// 삽입 이후 흐름(저장 상태 갱신, Preview 갱신)은 기존 단일 생성(generateAiDiagram)과
// 완전히 동일한 함수(replaceSelectionWithMermaid, schedulePreview)를 그대로 재사용한다.
async function insertSelectedDiagramVariant(code, insertBtn) {
  const labelEl = insertBtn.querySelector(".ai-diagram-v2-card-insert-label");
  const spinnerEl = insertBtn.querySelector(".ai-diagram-v2-card-insert-spinner");
  const originalLabel = labelEl.textContent;
  insertBtn.disabled = true;
  insertBtn.classList.add("is-loading");
  spinnerEl.classList.remove("hidden");
  labelEl.textContent = "삽입 중...";

  try {
    replaceSelectionWithMermaid(code);
    // 삽입 자체는 동기 작업이라 즉시 끝나지만, 그대로 모달을 닫으면 로딩
    // 스피너가 화면에 그려질 틈도 없이 사라진다. 사용자가 삽입 중 상태를
    // 실제로 인지할 수 있도록 최소한의 표시 시간을 확보한다.
    await new Promise((resolve) => setTimeout(resolve, 350));
    closeModal("aiDiagramV2Modal");
    toast("success", "다이어그램이 삽입되었습니다", "선택한 시안의 Mermaid 코드가 문서에 삽입되었습니다.");
    schedulePreview();
  } finally {
    insertBtn.classList.remove("is-loading");
    spinnerEl.classList.add("hidden");
    labelEl.textContent = originalLabel;
  }
}

// 시안 카드 하나를 만들어 컨테이너에 추가하고, 그 안에 Mermaid 미리보기를 렌더링한다.
// 카드를 클릭하면 "선택" 상태만 표시되고(Primary 버튼 활성화), 실제 삽입은
// 카드 안의 "선택한 시안 삽입" 버튼을 눌러야 확정되는 2단계 흐름이다.
// code는 카드 클릭 핸들러의 클로저 안에만 보관되며(메모리 한정), 별도 저장소에 기록하지 않는다.
async function renderDiagramVariantCard(container, code, index) {
  const card = document.createElement("div");
  card.className = "ai-diagram-v2-card";
  card.title = "클릭하면 이 시안을 선택합니다";

  const titleEl = document.createElement("div");
  titleEl.className = "ai-diagram-v2-card-title";
  titleEl.textContent = `시안 ${index + 1}`;
  card.appendChild(titleEl);

  const previewEl = document.createElement("div");
  previewEl.className = "ai-diagram-v2-card-preview mermaid";
  card.appendChild(previewEl);

  const insertBtn = document.createElement("button");
  insertBtn.type = "button";
  insertBtn.className = "ai-diagram-v2-card-insert-btn bbtn-primary";
  insertBtn.disabled = true;
  insertBtn.innerHTML =
    '<span class="ai-diagram-v2-card-insert-spinner hidden" aria-hidden="true"></span>' +
    '<span class="ai-diagram-v2-card-insert-label">✨ 선택한 시안 삽입</span>';
  card.appendChild(insertBtn);

  container.appendChild(card);

  function selectCard(e) {
    e.stopPropagation();
    // 다른 카드에 남아있을 수 있는 선택 표시를 정리하고 이 카드만 선택 상태로 표시한다.
    container.querySelectorAll(".ai-diagram-v2-card.is-selected").forEach((otherCard) => {
      otherCard.classList.remove("is-selected");
      const otherBtn = otherCard.querySelector(".ai-diagram-v2-card-insert-btn");
      if (otherBtn) otherBtn.disabled = true;
    });
    card.classList.add("is-selected");
    insertBtn.disabled = false;
  }

  card.addEventListener("click", selectCard);
  insertBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (insertBtn.disabled) return;
    insertSelectedDiagramVariant(code, insertBtn);
  });

  await renderMermaidBlock(previewEl, code);

  // Mermaid 렌더링이 끝난 뒤 카드를 부드럽게 표시한다(과도한 연출 없이 fade-in만).
  requestAnimationFrame(() => card.classList.add("is-visible"));
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
  el.btnGenerateAiDiagramV2.classList.add("is-loading");
  const generateLabelEl = el.btnGenerateAiDiagramV2.querySelector(".ai-diagram-v2-generate-label");
  const spinnerEl = el.btnGenerateAiDiagramV2.querySelector(".ai-diagram-v2-spinner");
  const originalLabel = generateLabelEl.textContent;
  generateLabelEl.textContent = "Generating Diagram...";
  spinnerEl.classList.remove("hidden");
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
    for (let i = 0; i < codes.length; i++) {
      await renderDiagramVariantCard(el.aiDiagramV2Results, codes[i], i);
    }

    // 서버가 요청한 개수(data.requestedCount)보다 적은 시안만 성공시킨 경우
    // (일부 OpenAI 호출이 rate limit 등으로 실패), 그 사실을 상태 문구로 알려준다.
    if (data.requestedCount && data.requestedCount > codes.length) {
      el.aiDiagramV2Status.textContent = `${data.requestedCount}개 중 ${codes.length}개의 시안만 생성되었습니다. 일부 요청이 실패했습니다.`;
    } else {
      el.aiDiagramV2Status.textContent = `${codes.length}개의 시안을 생성했습니다. 마음에 드는 시안을 선택해주세요.`;
    }
  } catch (e) {
    el.aiDiagramV2Status.textContent = "";
    el.aiDiagramV2Results.innerHTML = `<p class="ai-diagram-v2-empty">시안 생성 실패: ${e.message}</p>`;
    toast("error", "AI 다이어그램 생성 실패", e.message);
  } finally {
    el.btnGenerateAiDiagramV2.disabled = false;
    el.btnGenerateAiDiagramV2.classList.remove("is-loading");
    generateLabelEl.textContent = originalLabel;
    spinnerEl.classList.add("hidden");
  }
}

export function initAiDiagram() {
  el.btnAiDiagramV2.addEventListener("click", openAiDiagramV2Modal);
  el.btnGenerateAiDiagramV2.addEventListener("click", generateAiDiagramV2);
  el.aiDiagramStyle.addEventListener("change", updateStyleDescription);
}
