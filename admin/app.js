(function () {
  "use strict";

  // ============================================================
  // DOM refs
  // ============================================================
  const el = {
    docTree: document.getElementById("docTree"),
    recentList: document.getElementById("recentList"),
    globalSearch: document.getElementById("globalSearch"),
    themeToggle: document.getElementById("btnThemeToggle"),
    themeIcon: document.getElementById("themeIcon"),
    settingsBtn: document.getElementById("btnSettings"),
    collapseAllBtn: document.getElementById("btnCollapseAll"),

    editorFilename: document.getElementById("editorFilename"),
    saveStatus: document.getElementById("saveStatus"),
    saveStatusText: document.getElementById("saveStatusText"),
    monacoContainer: document.getElementById("monacoContainer"),
    editorToolbar: document.getElementById("editorToolbar"),
    toggleAutoSave: document.getElementById("toggleAutoSave"),
    toggleAutoBuild: document.getElementById("toggleAutoBuild"),

    previewBody: document.getElementById("previewBody"),
    previewMeta: document.getElementById("previewMeta"),

    statusText: document.getElementById("statusText"),

    btnNew: document.getElementById("btnNew"),
    btnImportAi: document.getElementById("btnImportAi"),
    btnSave: document.getElementById("btnSave"),
    btnBuild: document.getElementById("btnBuild"),
    btnGitPush: document.getElementById("btnGitPush"),
    btnShutdown: document.getElementById("btnShutdown"),

    toastContainer: document.getElementById("toastContainer"),

    newDocModal: document.getElementById("newDocModal"),
    newTitle: document.getElementById("newTitle"),
    newSlug: document.getElementById("newSlug"),
    newCategory: document.getElementById("newCategory"),
    newTags: document.getElementById("newTags"),
    newStatus: document.getElementById("newStatus"),
    newDescription: document.getElementById("newDescription"),
    btnCreateNew: document.getElementById("btnCreateNew"),

    importAiModal: document.getElementById("importAiModal"),
    importTitle: document.getElementById("importTitle"),
    importCategory: document.getElementById("importCategory"),
    importTags: document.getElementById("importTags"),
    importStatus: document.getElementById("importStatus"),
    importDescription: document.getElementById("importDescription"),
    importMarkdown: document.getElementById("importMarkdown"),
    btnCreateImport: document.getElementById("btnCreateImport"),

    settingsModal: document.getElementById("settingsModal"),
    settingTheme: document.getElementById("settingTheme"),
    settingAutoSave: document.getElementById("settingAutoSave"),
    settingAutoBuild: document.getElementById("settingAutoBuild"),
    settingFontSize: document.getElementById("settingFontSize"),

    shutdownModal: document.getElementById("shutdownModal"),
    btnConfirmShutdown: document.getElementById("btnConfirmShutdown"),

    gitPushModal: document.getElementById("gitPushModal"),
    gitPushMessage: document.getElementById("gitPushMessage"),
    btnConfirmGitPush: document.getElementById("btnConfirmGitPush"),
  };

  // ============================================================
  // State
  // ============================================================
  const STORAGE_KEY = "ogq-docs-builder-settings";

  const state = {
    docs: [],
    currentFilename: null,
    isDirty: false,
    monacoEditor: null,
    monacoReady: false,
    settings: loadSettings(),
  };

  function loadSettings() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
      saved = {};
    }
    return Object.assign(
      { theme: "dark", autoSave: false, autoBuild: false, fontSize: 14 },
      saved
    );
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  }

  // ============================================================
  // Toast
  // ============================================================
  const TOAST_ICONS = { success: "✓", error: "✕", info: "ℹ" };

  function toast(type, title, desc) {
    const node = document.createElement("div");
    node.className = `toast toast-${type}`;
    node.innerHTML = `
      <span class="toast-icon">${TOAST_ICONS[type] || "ℹ"}</span>
      <div class="toast-body">
        <div class="toast-title"></div>
        <div class="toast-desc"></div>
      </div>
      <button type="button" class="toast-close" aria-label="닫기">✕</button>
    `;
    node.querySelector(".toast-title").textContent = title;
    const descEl = node.querySelector(".toast-desc");
    if (desc) {
      descEl.textContent = desc;
    } else {
      descEl.remove();
    }

    const remove = () => {
      node.classList.add("toast-leaving");
      setTimeout(() => node.remove(), 180);
    };
    node.querySelector(".toast-close").addEventListener("click", remove);
    el.toastContainer.appendChild(node);
    setTimeout(remove, 4200);
  }

  function setStatus(text, kind) {
    el.statusText.textContent = text;
    el.statusText.className = "status-text" + (kind ? ` status-${kind}` : "");
  }

  // ============================================================
  // API helper
  // ============================================================
  async function api(path, options) {
    const res = await fetch(path, options);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // 본문 없는 응답 허용
    }
    if (!res.ok) {
      const message = (data && (data.error || data.message)) || `요청 실패 (HTTP ${res.status})`;
      throw new Error(message);
    }
    return data;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function statusLabel(status) {
    if (status === "draft") return "초안";
    if (status === "review") return "검토중";
    if (status === "locked") return "확정";
    return "";
  }

  // ============================================================
  // Theme
  // ============================================================
  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    el.themeIcon.textContent = theme === "dark" ? "🌙" : "☀️";
    el.settingTheme.value = theme;
    state.settings.theme = theme;
    saveSettings();
  }

  function toggleTheme() {
    applyTheme(state.settings.theme === "dark" ? "light" : "dark");
  }

  // ============================================================
  // Monaco editor (CDN, falls back to <textarea> offline)
  // ============================================================
  function initEditor() {
    if (typeof window.require === "undefined") {
      initFallbackEditor();
      return;
    }

    window.require.config({
      paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs" },
    });

    const timeout = setTimeout(initFallbackEditor, 4000);

    try {
      window.require(["vs/editor/editor.main"], () => {
        clearTimeout(timeout);
        if (state.monacoEditor || state.fallbackEditor) return;

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
          saveCurrentDoc
        );
      });
    } catch (e) {
      clearTimeout(timeout);
      initFallbackEditor();
    }
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
        saveCurrentDoc();
      }
    });
  }

  function getEditorValue() {
    if (state.monacoReady) return state.monacoEditor.getValue();
    if (state.fallbackEditor) return state.fallbackEditor.value;
    return "";
  }

  function setEditorValue(value) {
    if (state.monacoReady) {
      state.monacoEditor.setValue(value);
    } else if (state.fallbackEditor) {
      state.fallbackEditor.value = value;
    }
  }

  function setEditorTheme(theme) {
    if (state.monacoReady) {
      window.monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
    }
  }

  function setEditorFontSize(size) {
    if (state.monacoReady) {
      state.monacoEditor.updateOptions({ fontSize: size });
    } else if (state.fallbackEditor) {
      state.fallbackEditor.style.fontSize = `${size}px`;
    }
  }

  function focusEditor() {
    if (state.monacoReady) state.monacoEditor.focus();
    else if (state.fallbackEditor) state.fallbackEditor.focus();
  }

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

  function applyMarkdownAction(actionName) {
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

  // ============================================================
  // Editor change handling: dirty flag, preview, autosave
  // ============================================================
  let previewTimer = null;
  let autoSaveTimer = null;

  function onEditorContentChanged() {
    markDirty(true);
    schedulePreview();
    if (state.settings.autoSave) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        if (state.currentFilename && state.isDirty) saveCurrentDoc(true);
      }, 2000);
    }
  }

  // 저장 상태 4단계: saved(저장됨) / unsaved(저장 안 됨) / saving(저장 중) / error(저장 실패)
  const SAVE_STATUS_LABELS = {
    saved: "저장됨",
    unsaved: "저장 안 됨",
    saving: "저장 중...",
    error: "저장 실패",
  };

  function updateSaveStatus(status) {
    if (!state.currentFilename) {
      el.saveStatus.classList.add("hidden");
      return;
    }
    el.saveStatus.classList.remove("hidden");
    el.saveStatus.className = `save-status save-status-${status}`;
    el.saveStatusText.textContent = SAVE_STATUS_LABELS[status] || status;
  }

  function markDirty(dirty) {
    state.isDirty = dirty;
    updateSaveStatus(dirty ? "unsaved" : "saved");
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 300);
  }

  // 에디터에는 Front Matter가 포함된 전체 파일 내용이 들어있으므로,
  // markdown-it이 "---"를 <hr>로 오인해 깨지지 않도록 미리보기 전에 제거한다.
  function stripFrontMatterForPreview(content) {
    if (!content.startsWith("---")) return content;
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return match ? content.slice(match[0].length) : content;
  }

  async function renderPreview() {
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
      runMermaid();
    } catch (e) {
      el.previewBody.innerHTML = `<p style="color:var(--danger);">미리보기 렌더링 실패: ${escapeHtml(e.message)}</p>`;
    }
  }

  function runMermaid() {
    const blocks = el.previewBody.querySelectorAll(".mermaid");
    if (!blocks.length || typeof window.mermaid === "undefined") return;
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: state.settings.theme === "dark" ? "dark" : "default",
        securityLevel: "strict",
      });
      window.mermaid.run({ nodes: blocks });
    } catch (e) {
      // Mermaid 문법 오류는 미리보기 단계에서 무시
    }
  }

  // ============================================================
  // Document list / tree / recent / search
  // ============================================================
  async function loadDocList() {
    try {
      const docs = await api("/api/docs");
      state.docs = docs;
      renderTree(docs);
      renderRecent(docs);
    } catch (e) {
      toast("error", "문서 목록을 불러오지 못했습니다", e.message);
    }
  }

  function renderRecent(docs) {
    const sorted = [...docs]
      .filter((d) => d.updated)
      .sort((a, b) => (a.updated < b.updated ? 1 : -1))
      .slice(0, 5);

    if (!sorted.length) {
      el.recentList.innerHTML = '<li class="tree-empty">최근 수정 이력 없음</li>';
      return;
    }

    el.recentList.innerHTML = "";
    sorted.forEach((doc) => {
      const li = document.createElement("li");
      li.className = "recent-item";
      li.innerHTML = `
        <span class="recent-item-dot"></span>
        <span class="recent-item-title"></span>
        <span class="recent-item-date"></span>
      `;
      li.querySelector(".recent-item-title").textContent = doc.title;
      li.querySelector(".recent-item-date").textContent = doc.updated;
      li.addEventListener("click", () => openDoc(doc.filename));
      el.recentList.appendChild(li);
    });
  }

  function renderTree(docs) {
    const groups = new Map();
    docs.forEach((doc) => {
      if (!groups.has(doc.category)) groups.set(doc.category, []);
      groups.get(doc.category).push(doc);
    });

    el.docTree.innerHTML = "";

    if (!docs.length) {
      el.docTree.innerHTML = '<li class="tree-empty">docs/ 폴더에 문서가 없습니다.</li>';
      return;
    }

    groups.forEach((items, category) => {
      const hasActive = items.some((d) => d.filename === state.currentFilename);
      const groupLi = document.createElement("li");
      groupLi.className = "tree-group" + (hasActive ? " open" : "");

      const header = document.createElement("button");
      header.type = "button";
      header.className = "tree-group-header";
      header.innerHTML = `
        <span class="tree-group-arrow">▶</span>
        <span class="tree-group-name"></span>
        <span class="tree-group-count"></span>
      `;
      header.querySelector(".tree-group-name").textContent = category;
      header.querySelector(".tree-group-count").textContent = items.length;
      header.addEventListener("click", () => groupLi.classList.toggle("open"));
      groupLi.appendChild(header);

      const itemsUl = document.createElement("ul");
      itemsUl.className = "tree-group-items";

      items.forEach((doc) => {
        const li = document.createElement("li");
        li.className = "tree-item" + (doc.filename === state.currentFilename ? " active" : "");
        li.dataset.filename = doc.filename;
        li.innerHTML = `
          <span class="tree-item-icon">📄</span>
          <span class="tree-item-title"></span>
        `;
        li.querySelector(".tree-item-title").textContent = doc.title;

        const label = statusLabel(doc.status);
        if (label) {
          const badge = document.createElement("span");
          badge.className = `badge badge-${doc.status}`;
          badge.textContent = label;
          li.appendChild(badge);
        }

        li.addEventListener("click", () => openDoc(doc.filename));
        itemsUl.appendChild(li);
      });

      groupLi.appendChild(itemsUl);
      el.docTree.appendChild(groupLi);
    });
  }

  function updateActiveTreeItem() {
    document.querySelectorAll(".tree-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.filename === state.currentFilename);
    });
  }

  function collapseAllGroups() {
    document.querySelectorAll(".tree-group").forEach((g) => g.classList.remove("open"));
  }

  function filterTree(query) {
    const q = query.trim().toLowerCase();
    const groupEls = document.querySelectorAll(".tree-group");

    if (!q) {
      groupEls.forEach((g) => {
        g.style.display = "";
        g.querySelectorAll(".tree-item").forEach((item) => (item.style.display = ""));
      });
      return;
    }

    groupEls.forEach((groupEl) => {
      let anyVisible = false;
      groupEl.querySelectorAll(".tree-item").forEach((item) => {
        const title = item.querySelector(".tree-item-title").textContent.toLowerCase();
        const match = title.includes(q);
        item.style.display = match ? "" : "none";
        if (match) anyVisible = true;
      });
      groupEl.style.display = anyVisible ? "" : "none";
      if (anyVisible) groupEl.classList.add("open");
    });
  }

  // ============================================================
  // Open / Save / Create doc
  // ============================================================
  async function confirmDiscardIfDirty() {
    if (!state.isDirty) return true;
    return window.confirm("저장하지 않은 변경사항이 있습니다. 계속 진행하면 변경사항을 잃습니다. 계속할까요?");
  }

  async function openDoc(filename) {
    if (filename === state.currentFilename) return;
    const proceed = await confirmDiscardIfDirty();
    if (!proceed) return;

    try {
      const data = await api(`/api/docs/${encodeURIComponent(filename)}`);
      state.currentFilename = filename;
      el.editorFilename.textContent = filename;
      setEditorValue(data.content);
      markDirty(false);
      updateActiveTreeItem();
      schedulePreview();
      setStatus(`열림: ${filename}`);
    } catch (e) {
      toast("error", "문서를 불러오지 못했습니다", e.message);
    }
  }

  async function saveCurrentDoc(silent) {
    if (!state.currentFilename) {
      if (!silent) toast("error", "저장할 문서가 없습니다", "먼저 문서를 열거나 새로 만들어주세요.");
      return;
    }
    setStatus("저장 중...", "busy");
    updateSaveStatus("saving");
    try {
      await api(`/api/docs/${encodeURIComponent(state.currentFilename)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: getEditorValue() }),
      });
      state.isDirty = false;
      updateSaveStatus("saved");
      setStatus(`저장됨: ${state.currentFilename}`, "ok");
      toast("success", "저장 완료", state.currentFilename);
      loadDocList();

      if (state.settings.autoBuild) {
        runBuild(true);
      }
    } catch (e) {
      updateSaveStatus("error");
      setStatus("저장 실패", "error");
      toast("error", "저장 실패", e.message);
    }
  }

  function openNewDocModal() {
    el.newTitle.value = "";
    el.newSlug.value = "";
    el.newCategory.value = "";
    el.newTags.value = "";
    el.newStatus.value = "draft";
    el.newDescription.value = "";
    openModal("newDocModal");
    el.newTitle.focus();
  }

  async function createNewDoc() {
    const title = el.newTitle.value.trim();
    if (!title) {
      el.newTitle.focus();
      return;
    }
    const tags = el.newTags.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const data = await api("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          slug: el.newSlug.value.trim(),
          category: el.newCategory.value.trim() || "기타",
          tags,
          status: el.newStatus.value,
          description: el.newDescription.value.trim(),
        }),
      });
      closeModal("newDocModal");
      toast("success", "새 문서가 생성되었습니다", data.filename);
      await loadCreatedDocIntoEditor(data);
    } catch (e) {
      toast("error", "문서 생성 실패", e.message);
    }
  }

  // 새 문서/AI 가져오기 공통: 생성된 문서를 목록 갱신 후 즉시 에디터에 열고 미리보기 갱신
  async function loadCreatedDocIntoEditor(data) {
    await loadDocList();
    state.currentFilename = data.filename;
    el.editorFilename.textContent = data.filename;
    setEditorValue(data.content);
    markDirty(false);
    updateActiveTreeItem();
    schedulePreview();
  }

  function openImportAiModal() {
    el.importTitle.value = "";
    el.importCategory.value = "";
    el.importTags.value = "";
    el.importStatus.value = "draft";
    el.importDescription.value = "";
    el.importMarkdown.value = "";
    state.importFrontMatterApplied = false;
    openModal("importAiModal");
    el.importTitle.focus();
  }

  const IMPORT_STATUS_VALUES = ["draft", "review", "locked"];

  // 브라우저에는 gray-matter가 없으므로, title/description/category/status/tags
  // 정도의 단순한 key: value / 리스트 형태만 다루는 최소 YAML Front Matter 파서.
  // 복잡한 YAML(중첩 객체, 여러 줄 문자열 등)은 지원하지 않지만
  // AI가 생성하는 Front Matter는 대부분 이 단순한 형태를 따른다.
  function parseFrontMatterPreview(markdown) {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return null;

    const yamlBlock = match[1];
    const lines = yamlBlock.split(/\r?\n/);
    const data = {};
    let currentListKey = null;

    function unquote(value) {
      const trimmed = value.trim();
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ) {
        return trimmed.slice(1, -1);
      }
      return trimmed;
    }

    lines.forEach((line) => {
      const listItemMatch = line.match(/^\s*-\s*(.+)$/);
      if (listItemMatch && currentListKey) {
        if (!Array.isArray(data[currentListKey])) data[currentListKey] = [];
        data[currentListKey].push(unquote(listItemMatch[1]));
        return;
      }

      const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
      if (!kvMatch) return;

      const key = kvMatch[1];
      const rawValue = kvMatch[2].trim();
      currentListKey = null;

      if (rawValue === "" || rawValue === "[]") {
        // 다음 줄부터 "- 항목" 리스트가 이어질 수 있음
        currentListKey = key;
        if (rawValue === "[]") data[key] = [];
        return;
      }

      if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
        data[key] = rawValue
          .slice(1, -1)
          .split(",")
          .map((v) => unquote(v))
          .filter(Boolean);
        return;
      }

      data[key] = unquote(rawValue);
    });

    return { data, body: markdown.slice(match[0].length) };
  }

  // Markdown 붙여넣기 즉시 Front Matter를 감지해 title/description/category/tags/status
  // 필드를 자동으로 채운다. 사용자가 이미 직접 입력한 필드는 덮어쓰지 않는다.
  function autofillFromPastedMarkdown() {
    const markdown = el.importMarkdown.value;
    const parsed = parseFrontMatterPreview(markdown);
    if (!parsed) return;

    const { data } = parsed;

    if (!el.importTitle.value.trim() && typeof data.title === "string" && data.title.trim()) {
      el.importTitle.value = data.title.trim();
    }
    if (!el.importCategory.value.trim() && typeof data.category === "string" && data.category.trim()) {
      el.importCategory.value = data.category.trim();
    }
    if (!el.importTags.value.trim() && Array.isArray(data.tags) && data.tags.length) {
      el.importTags.value = data.tags.join(", ");
    }
    if (IMPORT_STATUS_VALUES.includes(data.status)) {
      el.importStatus.value = data.status;
    }
    if (!el.importDescription.value.trim() && typeof data.description === "string" && data.description.trim()) {
      el.importDescription.value = data.description.trim();
    }

    if (!state.importFrontMatterApplied) {
      state.importFrontMatterApplied = true;
      toast("info", "Front Matter를 감지했습니다", "제목/카테고리/태그/상태를 자동으로 채웠습니다.");
    }
  }

  async function createImportedDoc() {
    const title = el.importTitle.value.trim();
    if (!title) {
      el.importTitle.focus();
      return;
    }
    const markdown = el.importMarkdown.value;
    if (!markdown.trim()) {
      toast("error", "Markdown 내용이 비어 있습니다", "붙여넣을 본문을 입력해주세요.");
      el.importMarkdown.focus();
      return;
    }
    const tags = el.importTags.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    el.btnCreateImport.disabled = true;
    el.btnCreateImport.textContent = "생성 중...";
    try {
      // 카테고리/태그를 입력하지 않았다면 빈 값 그대로 보내
      // 붙여넣은 Markdown 안의 Front Matter 값(있다면)으로 서버가 보완하도록 한다.
      const data = await api("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          category: el.importCategory.value.trim(),
          tags,
          status: el.importStatus.value,
          description: el.importDescription.value.trim(),
          body: markdown,
        }),
      });
      closeModal("importAiModal");
      toast("success", "AI 문서를 가져왔습니다", data.filename);
      await loadCreatedDocIntoEditor(data);
    } catch (e) {
      toast("error", "문서 가져오기 실패", e.message);
    } finally {
      el.btnCreateImport.disabled = false;
      el.btnCreateImport.textContent = "문서 생성";
    }
  }

  // ============================================================
  // Build / Git push / Shutdown
  // ============================================================
  async function runBuild(silent) {
    setStatus("빌드 중...", "busy");
    try {
      const data = await api("/api/build", { method: "POST" });
      setStatus("빌드 완료", "ok");
      if (!silent) toast("success", "Build 성공", data.message);
      else toast("success", "자동 Build 완료");
    } catch (e) {
      setStatus("빌드 실패", "error");
      toast("error", "Build 실패", e.message);
    }
  }

  async function confirmGitPush() {
    const message = el.gitPushMessage.value.trim();
    el.btnConfirmGitPush.disabled = true;
    el.btnConfirmGitPush.textContent = "실행 중...";
    setStatus("Git push 진행 중...", "busy");
    try {
      const data = await api("/api/git-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      closeModal("gitPushModal");
      if (data.pushed) {
        setStatus("Git push 완료", "ok");
        toast("success", "Git Push 완료", data.detail || data.message);
      } else {
        setStatus("변경사항 없음", "ok");
        toast("info", data.message);
      }
    } catch (e) {
      setStatus("Git push 실패", "error");
      toast("error", "Git Push 실패", e.message);
    } finally {
      el.btnConfirmGitPush.disabled = false;
      el.btnConfirmGitPush.textContent = "Push 실행";
    }
  }

  async function confirmShutdown() {
    el.btnConfirmShutdown.disabled = true;
    el.btnConfirmShutdown.textContent = "종료 중...";
    try {
      await api("/api/shutdown", { method: "POST" });
    } catch (e) {
      // 서버가 응답 직후 종료되며 연결이 끊길 수 있으므로 에러 무시
    }
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;' +
      'font-family:sans-serif;color:#8b909c;background:#0d0f13;font-size:14px;">' +
      "서버가 종료되었습니다. 창을 닫아도 됩니다.</div>";
  }

  // ============================================================
  // Modal helpers
  // ============================================================
  function openModal(id) {
    document.getElementById(id).classList.remove("hidden");
  }

  function closeModal(id) {
    document.getElementById(id).classList.add("hidden");
  }

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay:not(.hidden)").forEach((overlay) => {
        overlay.classList.add("hidden");
      });
    }
  });

  // ============================================================
  // Settings modal wiring
  // ============================================================
  function openSettingsModal() {
    el.settingTheme.value = state.settings.theme;
    el.settingAutoSave.checked = state.settings.autoSave;
    el.settingAutoBuild.checked = state.settings.autoBuild;
    el.settingFontSize.value = state.settings.fontSize;
    openModal("settingsModal");
  }

  el.settingTheme.addEventListener("change", () => {
    applyTheme(el.settingTheme.value);
    setEditorTheme(el.settingTheme.value);
  });

  el.settingAutoSave.addEventListener("change", () => {
    state.settings.autoSave = el.settingAutoSave.checked;
    el.toggleAutoSave.checked = state.settings.autoSave;
    saveSettings();
  });

  el.settingAutoBuild.addEventListener("change", () => {
    state.settings.autoBuild = el.settingAutoBuild.checked;
    el.toggleAutoBuild.checked = state.settings.autoBuild;
    saveSettings();
  });

  el.settingFontSize.addEventListener("input", () => {
    state.settings.fontSize = Number(el.settingFontSize.value);
    setEditorFontSize(state.settings.fontSize);
    saveSettings();
  });

  el.toggleAutoSave.addEventListener("change", () => {
    state.settings.autoSave = el.toggleAutoSave.checked;
    saveSettings();
  });

  el.toggleAutoBuild.addEventListener("change", () => {
    state.settings.autoBuild = el.toggleAutoBuild.checked;
    saveSettings();
  });

  // ============================================================
  // Global keyboard shortcuts
  // ============================================================
  document.addEventListener("keydown", (e) => {
    const isSaveShortcut = (e.metaKey || e.ctrlKey) && e.key === "s";
    if (isSaveShortcut) {
      e.preventDefault();
      saveCurrentDoc();
      return;
    }
    if (e.key === "/" && document.activeElement !== el.globalSearch) {
      const isTyping = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);
      if (!isTyping) {
        e.preventDefault();
        el.globalSearch.focus();
      }
    }
  });

  // ============================================================
  // Event bindings
  // ============================================================
  el.themeToggle.addEventListener("click", () => {
    toggleTheme();
    setEditorTheme(state.settings.theme);
  });
  el.settingsBtn.addEventListener("click", openSettingsModal);
  el.collapseAllBtn.addEventListener("click", collapseAllGroups);
  el.globalSearch.addEventListener("input", () => filterTree(el.globalSearch.value));

  el.btnNew.addEventListener("click", openNewDocModal);
  el.btnCreateNew.addEventListener("click", createNewDoc);

  el.btnImportAi.addEventListener("click", openImportAiModal);
  el.btnCreateImport.addEventListener("click", createImportedDoc);
  el.importMarkdown.addEventListener("input", autofillFromPastedMarkdown);
  el.importMarkdown.addEventListener("paste", () => {
    // paste 이벤트 시점엔 textarea.value가 아직 갱신 전이므로 다음 tick에 처리
    setTimeout(autofillFromPastedMarkdown, 0);
  });

  el.btnSave.addEventListener("click", () => saveCurrentDoc());
  el.btnBuild.addEventListener("click", () => runBuild());

  el.editorToolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".toolbar-btn");
    if (!btn) return;
    if (!state.monacoReady && !state.fallbackEditor) return;
    applyMarkdownAction(btn.dataset.mdAction);
  });

  el.btnGitPush.addEventListener("click", () => {
    el.gitPushMessage.value = "";
    openModal("gitPushModal");
  });
  el.btnConfirmGitPush.addEventListener("click", confirmGitPush);

  el.btnShutdown.addEventListener("click", () => openModal("shutdownModal"));
  el.btnConfirmShutdown.addEventListener("click", confirmShutdown);

  window.addEventListener("beforeunload", (e) => {
    if (state.isDirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ============================================================
  // Init
  // ============================================================
  applyTheme(state.settings.theme);
  el.toggleAutoSave.checked = state.settings.autoSave;
  el.toggleAutoBuild.checked = state.settings.autoBuild;
  initEditor();
  loadDocList();
  renderPreview();
})();
