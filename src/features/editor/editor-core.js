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

// 문서를 열면 Monaco/textarea 모두 커서가 기본적으로 1번째 줄 1번째 열에 놓이는데,
// Front Matter가 있는 문서는 그 위치가 바로 "---" 여는 줄이다. AI Diagram/Mermaid
// 삽입/이미지 삽입 등 커서 위치에 텍스트를 끼워 넣는 모든 툴바 동작(insertTextAtCursor)이
// 이 위치를 그대로 쓰므로, 문서를 열자마자(본문을 한 번도 클릭하지 않고) 바로 그런
// 동작을 실행하면 Front Matter 블록 한가운데에 내용이 삽입되어 title/project 등 YAML이
// 깨진다. 문서를 여는 시점에 커서를 Front Matter 다음(실제 본문 시작 위치)으로 미리
// 옮겨 두어, 별도 조작 없이 이 사고 자체가 발생하지 않게 한다.
export function moveCursorPastFrontMatter(content) {
  const withoutBom = content.replace(/^﻿/, "");
  const leading = withoutBom.match(/^\s*/)[0];
  const body = withoutBom.slice(leading.length);
  if (!body.startsWith("---")) return; // Front Matter가 없으면 기본 위치(1,1) 그대로 둔다.

  const match = body.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/);
  if (!match) return;

  const frontMatterBlock = leading + match[0];
  const line = frontMatterBlock.split(/\r?\n/).length; // 다음 줄(본문 시작 줄) 번호

  if (state.monacoReady) {
    const editor = state.monacoEditor;
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.revealPosition({ lineNumber: line, column: 1 });
  } else if (state.fallbackEditor) {
    const pos = frontMatterBlock.length;
    state.fallbackEditor.setSelectionRange(pos, pos);
  }
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

// 현재 선택 영역의 시작 지점이 그 줄의 맨 앞(컬럼 1 / 문서 시작이거나 직전 문자가
// 줄바꿈)인지 확인한다. ```mermaid 같은 코드펜스는 반드시 줄 맨 앞에서 시작해야
// 마크다운 파서가 코드블록으로 인식하므로, 이 값이 false이면 호출부가 삽입 전에
// 줄바꿈을 보정해야 한다(예: "## 제목" 중 "제목"만 선택된 상태로 삽입하는 경우).
// 에디터의 현재 스크롤 위치를 0~1 비율로 반환한다. Monaco는 라인 단위 가상 스크롤을
// 쓰므로 scrollTop을 그대로 쓰지 않고 scrollTop/scrollHeight 비율로 계산해 fallback
// textarea(순수 DOM 스크롤)와 같은 형태의 값을 돌려준다 — 두 에디터 백엔드가 다른
// 스크롤 모델을 쓰더라도 호출부(scroll-sync)는 이 비율 하나만 알면 된다.
export function getEditorScrollRatio() {
  if (state.monacoReady) {
    const editor = state.monacoEditor;
    const scrollHeight = editor.getScrollHeight();
    const layoutHeight = editor.getLayoutInfo().height;
    const maxScroll = Math.max(scrollHeight - layoutHeight, 1);
    return Math.min(1, Math.max(0, editor.getScrollTop() / maxScroll));
  }
  if (state.fallbackEditor) {
    const el = state.fallbackEditor;
    const maxScroll = Math.max(el.scrollHeight - el.clientHeight, 1);
    return Math.min(1, Math.max(0, el.scrollTop / maxScroll));
  }
  return 0;
}

// 에디터 스크롤 변화를 구독한다. Monaco는 onDidScrollChange 이벤트로, fallback
// textarea는 DOM scroll 이벤트로 알려주는데 구조가 서로 달라 호출부가 매번 분기하지
// 않도록 여기서 하나의 콜백 등록 창구로 통일한다. 에디터가 아직 준비되지 않은
// 시점(문서를 열기 전)에 호출될 수 있으므로, 준비될 때까지 폴링 후 등록한다.
export function onEditorScroll(callback) {
  const tryRegister = () => {
    if (state.monacoReady) {
      state.monacoEditor.onDidScrollChange(callback);
      return true;
    }
    if (state.fallbackEditor) {
      state.fallbackEditor.addEventListener("scroll", callback, { passive: true });
      return true;
    }
    return false;
  };
  if (tryRegister()) return;
  const timer = setInterval(() => {
    if (tryRegister()) clearInterval(timer);
  }, 100);
}

export function isSelectionAtLineStart() {
  if (state.monacoReady) {
    const editor = state.monacoEditor;
    return editor.getSelection().startColumn === 1;
  }
  if (state.fallbackEditor) {
    const textarea = state.fallbackEditor;
    const start = textarea.selectionStart;
    return start === 0 || textarea.value[start - 1] === "\n";
  }
  return true;
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
