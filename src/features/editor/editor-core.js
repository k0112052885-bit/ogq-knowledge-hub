import { el, state } from "../../core/state.js";
import { on, emit } from "../../core/events.js";

// ============================================================
// Monaco editor (CDN, falls back to <textarea> offline)
// ============================================================
// initEditor()가 반환하는 Promise는 Monaco든 fallback textarea든 에디터가
// 실제로 값을 받아들일 준비가 된 시점에 resolve된다. 딥링크로 열자마자
// setEditorValue를 호출하는 흐름(openInitialLinkedDoc 등)이 이 시점보다
// 먼저 실행되면 setEditorValue가 조용히 무시되므로(에디터 인스턴스가 아직
// 없어서), 초기화 시점에는 반드시 이 Promise를 기다린 뒤 문서를 열어야 한다.
export function initEditor() {
  if (typeof window.require === "undefined") {
    initFallbackEditor();
    return Promise.resolve();
  }

  window.require.config({
    paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs" },
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      initFallbackEditor();
      resolve();
    }, 4000);

    try {
      window.require(["vs/editor/editor.main"], () => {
        clearTimeout(timeout);
        if (state.monacoEditor || state.fallbackEditor) {
          resolve();
          return;
        }

        state.monacoEditor = window.monaco.editor.create(el.monacoContainer, {
          value: "",
          language: "markdown",
          theme: state.settings.theme === "dark" ? "vs-dark" : "vs",
          fontSize: state.settings.fontSize,
          fontFamily:
            "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
          wordWrap: "on",
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: false,
          padding: { top: 16, bottom: 16 },
        });
        state.monacoReady = true;

        state.monacoEditor.onDidChangeModelContent(onEditorContentChanged);
        state.monacoEditor.addCommand(
          window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS,
          () => emit("editor:save-shortcut")
        );
        resolve();
      });
    } catch (e) {
      clearTimeout(timeout);
      initFallbackEditor();
      resolve();
    }
  });
}

function initFallbackEditor() {
  if (state.fallbackEditor || state.monacoReady) return;
  const textarea = document.createElement("textarea");
  textarea.className = "editor-fallback";
  textarea.spellcheck = false;
  textarea.placeholder =
    "왼쪽에서 문서를 선택하거나 '새 문서'를 눌러 작성을 시작하세요. " +
    "(Monaco 에디터를 CDN에서 불러오지 못해 기본 편집기로 대체되었습니다.)";
  el.monacoContainer.appendChild(textarea);
  state.fallbackEditor = textarea;

  textarea.addEventListener("input", onEditorContentChanged);
  textarea.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      emit("editor:save-shortcut");
    }
  });
}

export function getEditorValue() {
  if (state.monacoReady) return state.monacoEditor.getValue();
  if (state.fallbackEditor) return state.fallbackEditor.value;
  return "";
}

export function setEditorValue(value) {
  if (state.monacoReady) {
    state.monacoEditor.setValue(value);
  } else if (state.fallbackEditor) {
    state.fallbackEditor.value = value;
  }
}

export function setEditorTheme(theme) {
  if (state.monacoReady) {
    window.monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
  }
}

export function setEditorFontSize(size) {
  if (state.monacoReady) {
    state.monacoEditor.updateOptions({ fontSize: size });
  } else if (state.fallbackEditor) {
    state.fallbackEditor.style.fontSize = `${size}px`;
  }
}

export function focusEditor() {
  if (state.monacoReady) state.monacoEditor.focus();
  else if (state.fallbackEditor) state.fallbackEditor.focus();
}

export function insertTextAtCursor(text) {
  if (state.monacoReady) {
    const editor = state.monacoEditor;
    const selection = editor.getSelection();
    editor.executeEdits("image-insert", [{ range: selection, text }]);
    editor.focus();
    return;
  }
  if (state.fallbackEditor) {
    const textarea = state.fallbackEditor;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    textarea.value = value.slice(0, start) + text + value.slice(end);
    const pos = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(pos, pos);
    onEditorContentChanged();
  }
}

export function getSelectedEditorText() {
  if (state.monacoReady) {
    const editor = state.monacoEditor;
    return editor.getModel().getValueInRange(editor.getSelection());
  }
  if (state.fallbackEditor) {
    const textarea = state.fallbackEditor;
    return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  }
  return "";
}

// ============================================================
// Editor change handling: dirty flag, preview, autosave
// ============================================================
let autoSaveTimer = null;

export function onEditorContentChanged() {
  emit("editor:dirty", true);
  emit("editor:content-changed");
  if (state.settings.autoSave) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (state.currentFilename && state.isDirty) {
        emit("editor:autosave-trigger");
      }
    }, 2000);
  }
}

on("theme:editor-sync", (theme) => setEditorTheme(theme));
