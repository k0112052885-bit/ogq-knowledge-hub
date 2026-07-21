import { el, state } from "../../core/state.js";
import { api } from "../../core/api.js";
import { toast, setStatus } from "../../core/toast.js";
import { insertTextAtCursor, getSelectedEditorText } from "../editor/editor-core.js";
import { schedulePreview } from "../preview/preview.js";

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

export function initAiDiagram() {
  el.btnAiDiagram.addEventListener("click", generateAiDiagram);
}
