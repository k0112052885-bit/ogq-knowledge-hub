import { state } from "../../core/state.js";
import { getSelectedEditorText, onEditorContentChanged } from "./editor-core.js";

// ============================================================
// Markdown toolbar: 현재 커서/선택 영역에 Markdown 문법을 삽입
// ============================================================
const MARKDOWN_TOOLBAR_ACTIONS = {
  h1: { type: "line-prefix", prefix: "# " },
  h2: { type: "line-prefix", prefix: "## " },
  bold: { type: "wrap", before: "**", after: "**", placeholder: "굵은 텍스트" },
  quote: { type: "line-prefix", prefix: "> " },
  checklist: { type: "line-prefix", prefix: "- [ ] " },
  table: {
    type: "block",
    placeholder:
      "| 열1 | 열2 |\n| --- | --- |\n| 값1 | 값2 |",
  },
  codeblock: { type: "wrap-block", before: "```\n", after: "\n```", placeholder: "코드" },
  mermaid: {
    type: "block",
    placeholder:
      "```mermaid\nflowchart LR\n  A[시작] --> B[처리]\n  B --> C[완료]\n```",
  },
};

// Monaco 에디터에 서식 삽입 (선택 영역 유무에 따라 감싸기/치환)
function applyMarkdownActionMonaco(action) {
  const editor = state.monacoEditor;
  const model = editor.getModel();
  const selection = editor.getSelection();
  const selectedText = model.getValueInRange(selection);

  if (action.type === "line-prefix") {
    const startLine = selection.startLineNumber;
    const endLine = selection.endLineNumber;
    const edits = [];
    for (let line = startLine; line <= endLine; line++) {
      edits.push({
        range: new window.monaco.Range(line, 1, line, 1),
        text: action.prefix,
      });
    }
    editor.executeEdits("markdown-toolbar", edits);
    editor.focus();
    return;
  }

  if (action.type === "wrap") {
    const text = selectedText || action.placeholder;
    const insertText = `${action.before}${text}${action.after}`;
    editor.executeEdits("markdown-toolbar", [{ range: selection, text: insertText }]);
    if (!selectedText) {
      // 플레이스홀더를 선택 상태로 남겨 바로 타이핑해 덮어쓸 수 있게 함
      const startPos = selection.getStartPosition();
      const from = startPos.column + action.before.length;
      const to = from + action.placeholder.length;
      editor.setSelection(
        new window.monaco.Selection(startPos.lineNumber, from, startPos.lineNumber, to)
      );
    }
    editor.focus();
    return;
  }

  if (action.type === "wrap-block" || action.type === "block") {
    const text = action.type === "block" ? action.placeholder : selectedText || action.placeholder;
    const insertText =
      action.type === "wrap-block" ? `${action.before}${text}${action.after}` : text;
    const needsNewlineBefore = selection.startColumn > 1;
    const finalText = (needsNewlineBefore ? "\n" : "") + insertText + "\n";
    editor.executeEdits("markdown-toolbar", [{ range: selection, text: finalText }]);
    editor.focus();
    return;
  }
}

// 폴백 textarea에 서식 삽입 (selectionStart/End 기반)
function applyMarkdownActionFallback(action) {
  const textarea = state.fallbackEditor;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selectedText = value.slice(start, end);

  function replaceSelection(newText, selectStart, selectEnd) {
    textarea.value = value.slice(0, start) + newText + value.slice(end);
    textarea.focus();
    const s = selectStart !== undefined ? selectStart : start + newText.length;
    const e = selectEnd !== undefined ? selectEnd : s;
    textarea.setSelectionRange(s, e);
    onEditorContentChanged();
  }

  if (action.type === "line-prefix") {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const affected = value.slice(lineStart, end);
    const withPrefix = affected
      .split("\n")
      .map((line) => action.prefix + line)
      .join("\n");
    textarea.value = value.slice(0, lineStart) + withPrefix + value.slice(end);
    textarea.focus();
    const newPos = end + action.prefix.length * (affected.split("\n").length);
    textarea.setSelectionRange(newPos, newPos);
    onEditorContentChanged();
    return;
  }

  if (action.type === "wrap") {
    const text = selectedText || action.placeholder;
    const newText = `${action.before}${text}${action.after}`;
    if (!selectedText) {
      replaceSelection(newText, start + action.before.length, start + action.before.length + text.length);
    } else {
      replaceSelection(newText);
    }
    return;
  }

  if (action.type === "wrap-block" || action.type === "block") {
    const text = action.type === "block" ? action.placeholder : selectedText || action.placeholder;
    const insertText = action.type === "wrap-block" ? `${action.before}${text}${action.after}` : text;
    const needsNewlineBefore = start > 0 && value[start - 1] !== "\n";
    const finalText = (needsNewlineBefore ? "\n" : "") + insertText + "\n";
    replaceSelection(finalText);
    return;
  }
}

export function applyMarkdownAction(actionName) {
  const action = MARKDOWN_TOOLBAR_ACTIONS[actionName];
  if (!action) return;

  if (state.monacoReady) {
    // Monaco는 onDidChangeModelContent 리스너가 executeEdits 후 자동으로 트리거됨
    applyMarkdownActionMonaco(action);
  } else if (state.fallbackEditor) {
    // 폴백 textarea는 리스너가 input 이벤트 기반이라 값을 직접 바꾸면 트리거되지 않으므로
    // applyMarkdownActionFallback 내부에서 onEditorContentChanged()를 명시적으로 호출한다.
    applyMarkdownActionFallback(action);
  }
}

export function initMarkdownToolbar(el) {
  el.editorToolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".toolbar-btn[data-md-action]");
    if (!btn) return;
    if (!state.monacoReady && !state.fallbackEditor) return;
    applyMarkdownAction(btn.dataset.mdAction);
  });
}

// getSelectedEditorText는 diagram feature 등 외부에서도 쓰이므로 재노출
export { getSelectedEditorText };
