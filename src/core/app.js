import { el, state, saveSettings } from "./state.js";
import { api } from "./api.js";
import { toast, setStatus } from "./toast.js";
import { escapeHtml, statusLabel } from "./dom-utils.js";
import { openModal, closeModal, initModalWiring } from "./modal.js";
import { on, emit } from "./events.js";

import { initTheme } from "../features/theme/theme.js";
import {
  initEditor,
  getEditorValue,
  setEditorValue,
  setEditorFontSize,
  focusEditor,
} from "../features/editor/editor-core.js";
import { initMarkdownToolbar } from "../features/editor/markdown-toolbar.js";
import { schedulePreview, renderPreview, setupImageLightbox } from "../features/preview/preview.js";
import { setupImagePasteAndDrop } from "../features/image/image-upload.js";
import { initAiDiagram } from "../features/diagram/ai-diagram.js";
import { initExport, runBuild } from "../features/export/export.js";
import { groupIntoProjectsAndPages } from "./docs-grouping.js";

// ============================================================
// Document list / tree / recent / search
// ============================================================
async function loadDocList() {
  try {
    const docs = await api("/api/docs");
    state.docs = docs;

    // Phase 2: 문서 목록을 프로젝트(다중 페이지) / 단일 문서로 분리해 사이드바에 각각 렌더링한다.
    const { projects, standalonePages } = groupIntoProjectsAndPages(docs);
    state.projects = projects;
    state.standaloneDocs = standalonePages;

    renderProjects(projects);
    // "단일 문서" 영역은 기존 카테고리(개요/설계/운영/목표/기타) 그룹핑을 그대로 유지한다.
    renderTree(state.standaloneDocs);
    renderRecent(docs);
  } catch (e) {
    toast("error", "문서 목록을 불러오지 못했습니다", e.message);
  }
}

// 프로젝트(다중 페이지 문서 묶음) 목록 렌더링.
// 카테고리 트리(renderTree)와 동일한 아코디언 패턴(tree-group/tree-group-items)을
// 사용해, 프로젝트를 펼치면 그 안의 페이지들이 나열되고 클릭하면 openDoc으로 열린다.
function renderProjects(projects) {
  el.projectTree.innerHTML = "";

  if (!projects.length) {
    el.projectTree.innerHTML = '<li class="tree-empty">프로젝트 없음</li>';
    return;
  }

  projects.forEach((project) => {
    const hasActive = project.pages.some((d) => d.filename === state.currentFilename);
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
    header.querySelector(".tree-group-name").textContent = project.title;
    header.querySelector(".tree-group-count").textContent = project.pages.length;
    header.addEventListener("click", () => groupLi.classList.toggle("open"));
    groupLi.appendChild(header);

    const itemsUl = document.createElement("ul");
    itemsUl.className = "tree-group-items";

    project.pages.forEach((doc) => {
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
    el.projectTree.appendChild(groupLi);
  });
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
// Save status
// ============================================================
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

// ============================================================
// New project (Phase 2): 프로젝트 식별자(project)는 사람이 읽는 값이 아니라
// 같은 프로젝트의 페이지들을 묶는 내부 키이므로, 파일명 slug 규칙과
// 완전히 동일할 필요는 없다. 여기서는 충돌을 줄이기 위해 타임스탬프를 덧붙인다.
// ============================================================
function openNewProjectModal() {
  el.newProjectTitle.value = "";
  openModal("newProjectModal");
  el.newProjectTitle.focus();
}

function makeProjectId(title) {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Date.now().toString(36);
  return base ? `${base}-${suffix}` : `project-${suffix}`;
}

async function createNewProject() {
  const projectTitle = el.newProjectTitle.value.trim();
  if (!projectTitle) {
    el.newProjectTitle.focus();
    return;
  }

  const projectId = makeProjectId(projectTitle);

  try {
    const data = await api("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "개요",
        category: "기타",
        tags: [],
        status: "draft",
        description: "",
        project: projectId,
        projectTitle,
        pageOrder: 1,
      }),
    });
    closeModal("newProjectModal");
    toast("success", "새 프로젝트가 생성되었습니다", projectTitle);
    await loadCreatedDocIntoEditor(data);
  } catch (e) {
    toast("error", "프로젝트 생성 실패", e.message);
  }
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
// Settings modal wiring
// ============================================================
function openSettingsModal() {
  el.settingTheme.value = state.settings.theme;
  el.settingAutoSave.checked = state.settings.autoSave;
  el.settingAutoBuild.checked = state.settings.autoBuild;
  el.settingFontSize.value = state.settings.fontSize;
  openModal("settingsModal");
}

function initSettingsWiring() {
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
}

// ============================================================
// Global keyboard shortcuts
// ============================================================
function initGlobalShortcuts() {
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
}

// ============================================================
// Event bindings
// ============================================================
function initEventBindings() {
  el.settingsBtn.addEventListener("click", openSettingsModal);
  el.collapseAllBtn.addEventListener("click", collapseAllGroups);
  el.globalSearch.addEventListener("input", () => filterTree(el.globalSearch.value));

  el.btnNew.addEventListener("click", openNewDocModal);
  el.btnCreateNew.addEventListener("click", createNewDoc);

  el.btnNewProject.addEventListener("click", openNewProjectModal);
  el.btnCreateNewProject.addEventListener("click", createNewProject);

  el.btnImportAi.addEventListener("click", openImportAiModal);
  el.btnCreateImport.addEventListener("click", createImportedDoc);
  el.importMarkdown.addEventListener("input", autofillFromPastedMarkdown);
  el.importMarkdown.addEventListener("paste", () => {
    // paste 이벤트 시점엔 textarea.value가 아직 갱신 전이므로 다음 tick에 처리
    setTimeout(autofillFromPastedMarkdown, 0);
  });

  el.btnSave.addEventListener("click", () => saveCurrentDoc());

  window.addEventListener("beforeunload", (e) => {
    if (state.isDirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

// editor-core에서 발생하는 이벤트를 문서 관리/프리뷰/저장 흐름과 연결
function wireEditorEvents() {
  on("editor:dirty", (dirty) => markDirty(dirty));
  on("editor:content-changed", () => schedulePreview());
  on("editor:save-shortcut", () => saveCurrentDoc());
  on("editor:autosave-trigger", () => saveCurrentDoc(true));
}

// ============================================================
// Init
// ============================================================
export function initApp() {
  wireEditorEvents();
  initModalWiring();
  initTheme();

  el.toggleAutoSave.checked = state.settings.autoSave;
  el.toggleAutoBuild.checked = state.settings.autoBuild;

  initEditor();
  initMarkdownToolbar(el);
  setupImagePasteAndDrop();
  setupImageLightbox();
  initAiDiagram();
  initExport();
  initSettingsWiring();
  initGlobalShortcuts();
  initEventBindings();

  loadDocList();
  renderPreview();
}
