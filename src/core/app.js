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
    return docs;
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
    groupLi.dataset.projectId = project.id;

    // tree-group-header는 <button>이라 그 안에 또 다른 버튼(+페이지)을 넣을 수 없으므로,
    // 헤더와 액션 버튼을 나란히 두는 row로 감싼다. 기존 카테고리 트리(renderTree)의
    // 마크업/동작은 그대로이며 이 변경은 프로젝트 트리에만 적용된다.
    const headerRow = document.createElement("div");
    headerRow.className = "tree-group-header-row";

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
    headerRow.appendChild(header);

    const addPageBtn = document.createElement("button");
    addPageBtn.type = "button";
    addPageBtn.className = "tree-group-action";
    addPageBtn.title = "새 페이지 추가";
    addPageBtn.textContent = "+ 페이지";
    addPageBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // 아코디언 토글(header 클릭)로 이벤트가 번지지 않게 함
      openNewProjectPageModal(project);
    });
    headerRow.appendChild(addPageBtn);

    const renameProjectBtn = document.createElement("button");
    renameProjectBtn.type = "button";
    renameProjectBtn.className = "tree-group-action tree-group-action-icon";
    renameProjectBtn.title = "프로젝트 이름 변경";
    renameProjectBtn.textContent = "✎";
    renameProjectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openRenameProjectModal(project);
    });
    headerRow.appendChild(renameProjectBtn);

    const deleteProjectBtn = document.createElement("button");
    deleteProjectBtn.type = "button";
    deleteProjectBtn.className = "tree-group-action tree-group-action-icon tree-group-action-danger";
    deleteProjectBtn.title = "프로젝트 삭제";
    deleteProjectBtn.textContent = "🗑";
    deleteProjectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDeleteProjectConfirmModal(project);
    });
    headerRow.appendChild(deleteProjectBtn);

    groupLi.appendChild(headerRow);

    const itemsUl = document.createElement("ul");
    itemsUl.className = "tree-group-items";

    project.pages.forEach((doc) => {
      const li = document.createElement("li");
      li.className = "tree-item tree-item-with-actions" + (doc.filename === state.currentFilename ? " active" : "");
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

      const renamePageBtn = document.createElement("button");
      renamePageBtn.type = "button";
      renamePageBtn.className = "tree-item-action";
      renamePageBtn.title = "페이지 이름 변경";
      renamePageBtn.textContent = "✎";
      renamePageBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openRenamePageModal(doc);
      });
      li.appendChild(renamePageBtn);

      const deletePageBtn = document.createElement("button");
      deletePageBtn.type = "button";
      deletePageBtn.className = "tree-item-action tree-item-action-danger";
      deletePageBtn.title = "페이지 삭제";
      deletePageBtn.textContent = "🗑";
      deletePageBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openDeletePageConfirmModal(doc);
      });
      li.appendChild(deletePageBtn);

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

function findDocByFilename(filename) {
  return state.docs.find((doc) => doc.filename === filename) || null;
}

function expandGroupForFilename(filename) {
  const escaped = window.CSS?.escape ? window.CSS.escape(filename) : filename.replace(/"/g, '\\"');
  const item = document.querySelector('.tree-item[data-filename="' + escaped + '"]');
  const group = item?.closest(".tree-group");
  if (group) group.classList.add("open");
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
// Deep links / Telegram-compatible links
// ============================================================
function normalizeFilenameCandidate(value) {
  const decoded = String(value || "").trim();
  if (!decoded) return "";
  return decoded.endsWith(".md") ? decoded : decoded + ".md";
}

function sameLooseName(doc, value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const withExt = normalizeFilenameCandidate(raw);
  const withoutExt = raw.replace(/\.md$/i, "");
  return doc.filename === raw
    || doc.filename === withExt
    || doc.filename.replace(/\.md$/i, "") === withoutExt
    || doc.title === raw;
}

function resolveLinkedDoc(docs, params = new URLSearchParams(window.location.search)) {
  const legacyDoc = params.get("doc");
  if (legacyDoc) {
    return docs.find((doc) => sameLooseName(doc, legacyDoc)) || null;
  }

  const projectParam = params.get("project");
  const pageParam = params.get("page");
  if (!pageParam) return null;

  const projectDocs = projectParam
    ? docs.filter((doc) => doc.project === projectParam || doc.projectTitle === projectParam)
    : docs;
  return projectDocs.find((doc) => sameLooseName(doc, pageParam)) || null;
}

async function openInitialLinkedDoc() {
  const doc = resolveLinkedDoc(state.docs);
  if (!doc) return;
  await openDoc(doc.filename, { force: true });
  expandGroupForFilename(doc.filename);
}

// 현재 문서를 가리키는 딥링크 URL을 만든다.
// 프로젝트 소속 문서는 project(id)를 항상 함께 포함해 page만으로 검색할 때
// 발생할 수 있는 동명 페이지 간 모호성을 피한다.
function buildDocLinkUrl(doc) {
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/\/admin\/?$/, "/admin");
  url.search = "";

  const params = new URLSearchParams();
  if (doc.project) {
    params.set("project", doc.project);
    params.set("page", doc.title);
  } else {
    params.set("doc", doc.filename);
  }
  url.search = params.toString();
  return url.toString();
}

function fallbackCopyText(text) {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch (e) {
    return false;
  }
}

function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => fallbackCopyText(text)
    );
  }
  return Promise.resolve(fallbackCopyText(text));
}

async function copyCurrentDocLink() {
  if (!state.currentFilename) {
    toast("error", "복사할 문서가 없습니다", "먼저 문서를 열어주세요.");
    return;
  }
  const doc = findDocByFilename(state.currentFilename);
  if (!doc) {
    toast("error", "문서 정보를 찾을 수 없습니다", "문서 목록을 새로고침한 뒤 다시 시도해주세요.");
    return;
  }

  const link = buildDocLinkUrl(doc);
  const ok = await copyTextToClipboard(link);
  if (ok) {
    toast("success", "링크가 복사되었습니다", link);
  } else {
    toast("error", "링크 복사 실패", "브라우저 클립보드 권한을 확인해주세요.");
  }
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

async function openDoc(filename, options = {}) {
  const force = options.force === true;
  if (!force && filename === state.currentFilename) return;
  const proceed = await confirmDiscardIfDirty();
  if (!proceed) return;

  try {
    const data = await api(`/api/docs/${encodeURIComponent(filename)}`);
    state.currentFilename = filename;
    el.editorFilename.textContent = filename;
    setEditorValue(data.content);
    markDirty(false);
    updateActiveTreeItem();
    expandGroupForFilename(filename);
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

// 새 문서/AI 가져오기 공통: 생성된 문서를 목록 갱신 후 즉시 에디터에 열고 미리보기 갱신.
// state.currentFilename을 loadDocList() 호출 "전"에 먼저 새 파일로 갱신해야
// renderTree/renderProjects가 트리를 그리는 시점부터 새 페이지를 active/열림 상태로
// 정확히 인식한다(반대로 하면 트리가 옛 currentFilename 기준으로 그려진다).
async function loadCreatedDocIntoEditor(data) {
  state.currentFilename = data.filename;
  el.editorFilename.textContent = data.filename;
  setEditorValue(data.content);
  markDirty(false);
  await loadDocList();
  updateActiveTreeItem();
  expandGroupForFilename(data.filename);
  schedulePreview();
  focusEditor();
}

// ============================================================
// New project (Phase 2): 프로젝트 식별자(project)는 사람이 읽는 값이 아니라
// 같은 프로젝트의 페이지들을 묶는 내부 키이므로, 파일명 slug 규칙과
// 완전히 동일할 필요는 없다. 여기서는 충돌을 줄이기 위해 타임스탬프를 덧붙인다.
// ============================================================
function openNewProjectModal() {
  el.newProjectTitle.value = "";
  el.newProjectFirstPageTitle.value = "";
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

  // 첫 페이지명을 비워두면 "개요" 같은 고정 기본값이 아니라 프로젝트명을 그대로 사용한다.
  const firstPageTitle = el.newProjectFirstPageTitle.value.trim() || projectTitle;
  const projectId = makeProjectId(projectTitle);

  try {
    const data = await api("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: firstPageTitle,
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
    expandProjectGroup(projectId);
  } catch (e) {
    toast("error", "프로젝트 생성 실패", e.message);
  }
}

// ============================================================
// New project page: 기존 프로젝트에 페이지를 추가한다.
// ============================================================
let pendingNewPageProject = null;

function openNewProjectPageModal(project) {
  pendingNewPageProject = project;
  el.newProjectPageTitle.value = "";
  el.newProjectPageTarget.textContent = `"${project.title}" 프로젝트에 새 페이지를 추가합니다.`;
  openModal("newProjectPageModal");
  el.newProjectPageTitle.focus();
}

// loadCreatedDocIntoEditor가 state.currentFilename을 먼저 갱신한 뒤 트리를 다시 그리므로
// renderProjects가 이미 해당 그룹을 열림 상태로 렌더링하지만, 혹시 모를 타이밍 이슈에
// 대비해 렌더링 후 한 번 더 명시적으로 펼쳐 확실히 보장한다.
function expandProjectGroup(projectId) {
  const groupEl = el.projectTree.querySelector(`.tree-group[data-project-id="${projectId}"]`);
  if (groupEl) groupEl.classList.add("open");
}

async function createNewProjectPage() {
  const project = pendingNewPageProject;
  if (!project) return;

  const pageTitle = el.newProjectPageTitle.value.trim();
  if (!pageTitle) {
    el.newProjectPageTitle.focus();
    return;
  }

  // 프로젝트 내 마지막 페이지의 pageOrder(없으면 페이지 수) 기준 다음 순번을 계산한다.
  const maxPageOrder = project.pages.reduce((max, doc) => {
    const order = typeof doc.pageOrder === "number" ? doc.pageOrder : 0;
    return Math.max(max, order);
  }, 0);
  const nextPageOrder = Math.max(maxPageOrder, project.pages.length) + 1;

  try {
    const data = await api("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: pageTitle,
        category: "기타",
        tags: [],
        status: "draft",
        description: "",
        project: project.id,
        projectTitle: project.title,
        pageOrder: nextPageOrder,
      }),
    });
    closeModal("newProjectPageModal");
    toast("success", "새 페이지가 추가되었습니다", data.filename);
    await loadCreatedDocIntoEditor(data);
    expandProjectGroup(project.id);
  } catch (e) {
    toast("error", "페이지 생성 실패", e.message);
  } finally {
    pendingNewPageProject = null;
  }
}

// ============================================================
// Rename / delete: 페이지 이름 변경 · 삭제, 프로젝트 이름 변경 · 삭제.
// 이름 변경은 front matter의 title/projectTitle 값만 바꾸고 파일명은 그대로 유지한다.
// ============================================================
let pendingRenamePageDoc = null;
let pendingRenameProject = null;
let pendingDeletePageDoc = null;
let pendingDeleteProject = null;

function openRenamePageModal(doc) {
  pendingRenamePageDoc = doc;
  el.renamePageTitle.value = doc.title;
  openModal("renamePageModal");
  el.renamePageTitle.focus();
  el.renamePageTitle.select();
}

async function confirmRenamePage() {
  const doc = pendingRenamePageDoc;
  if (!doc) return;

  const title = el.renamePageTitle.value.trim();
  if (!title) {
    el.renamePageTitle.focus();
    return;
  }

  try {
    await api(`/api/docs/${encodeURIComponent(doc.filename)}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    closeModal("renamePageModal");
    toast("success", "페이지 이름이 변경되었습니다", title);
    if (state.currentFilename === doc.filename) {
      el.editorFilename.textContent = doc.filename;
    }
    await loadDocList();
  } catch (e) {
    toast("error", "페이지 이름 변경 실패", e.message);
  } finally {
    pendingRenamePageDoc = null;
  }
}

function openRenameProjectModal(project) {
  pendingRenameProject = project;
  el.renameProjectTitle.value = project.title;
  openModal("renameProjectModal");
  el.renameProjectTitle.focus();
  el.renameProjectTitle.select();
}

async function confirmRenameProject() {
  const project = pendingRenameProject;
  if (!project) return;

  const projectTitle = el.renameProjectTitle.value.trim();
  if (!projectTitle) {
    el.renameProjectTitle.focus();
    return;
  }

  try {
    await api(`/api/projects/${encodeURIComponent(project.id)}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectTitle }),
    });
    closeModal("renameProjectModal");
    toast("success", "프로젝트 이름이 변경되었습니다", projectTitle);
    await loadDocList();
    expandProjectGroup(project.id);
  } catch (e) {
    toast("error", "프로젝트 이름 변경 실패", e.message);
  } finally {
    pendingRenameProject = null;
  }
}

// 현재 에디터에 열려 있던 문서가 삭제되었을 때, 에디터를 초기 상태로 되돌린다.
function resetEditorIfCurrentlyOpen(filename) {
  if (state.currentFilename !== filename) return;
  state.currentFilename = null;
  el.editorFilename.textContent = "문서를 선택하세요";
  setEditorValue("");
  markDirty(false);
  schedulePreview();
}

function openDeletePageConfirmModal(doc) {
  pendingDeletePageDoc = doc;
  el.deletePageConfirmMessage.textContent = `"${doc.title}" 페이지를 삭제합니다. 이 작업은 되돌릴 수 없습니다.`;
  openModal("deletePageConfirmModal");
}

async function confirmDeletePage() {
  const doc = pendingDeletePageDoc;
  if (!doc) return;

  try {
    await api(`/api/docs/${encodeURIComponent(doc.filename)}`, { method: "DELETE" });
    closeModal("deletePageConfirmModal");
    toast("success", "페이지가 삭제되었습니다", doc.title);
    resetEditorIfCurrentlyOpen(doc.filename);
    await loadDocList();
  } catch (e) {
    toast("error", "페이지 삭제 실패", e.message);
  } finally {
    pendingDeletePageDoc = null;
  }
}

function openDeleteProjectConfirmModal(project) {
  pendingDeleteProject = project;
  el.deleteProjectConfirmMessage.textContent =
    `"${project.title}" 프로젝트에는 ${project.pages.length}개의 페이지가 있습니다. ` +
    "프로젝트를 삭제하면 아래 페이지가 모두 함께 삭제됩니다.";
  el.deleteProjectConfirmPageList.innerHTML = "";
  project.pages.forEach((doc) => {
    const li = document.createElement("li");
    li.textContent = doc.title;
    el.deleteProjectConfirmPageList.appendChild(li);
  });
  openModal("deleteProjectConfirmModal");
}

async function confirmDeleteProject() {
  const project = pendingDeleteProject;
  if (!project) return;

  try {
    await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
    closeModal("deleteProjectConfirmModal");
    toast("success", "프로젝트가 삭제되었습니다", project.title);
    // 삭제된 프로젝트의 페이지 중 하나가 현재 열려 있었다면 에디터를 초기화한다.
    const openedPage = project.pages.find((doc) => doc.filename === state.currentFilename);
    if (openedPage) resetEditorIfCurrentlyOpen(openedPage.filename);
    await loadDocList();
  } catch (e) {
    toast("error", "프로젝트 삭제 실패", e.message);
  } finally {
    pendingDeleteProject = null;
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
  el.btnCreateNewProjectPage.addEventListener("click", createNewProjectPage);

  // 프로젝트명 입력 후 Enter → 첫 페이지명 입력란으로 이동 (Tab은 DOM 순서상 기본 동작으로 이미 이동됨)
  el.newProjectTitle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.newProjectFirstPageTitle.focus();
    }
  });
  // 첫 페이지명 입력란에서 Enter → 바로 생성
  el.newProjectFirstPageTitle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      createNewProject();
    }
  });

  el.btnConfirmRenamePage.addEventListener("click", confirmRenamePage);
  el.renamePageTitle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmRenamePage();
    }
  });

  el.btnConfirmRenameProject.addEventListener("click", confirmRenameProject);
  el.renameProjectTitle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmRenameProject();
    }
  });

  el.btnConfirmDeletePage.addEventListener("click", confirmDeletePage);
  el.btnConfirmDeleteProject.addEventListener("click", confirmDeleteProject);

  el.btnImportAi.addEventListener("click", openImportAiModal);
  el.btnCreateImport.addEventListener("click", createImportedDoc);
  el.importMarkdown.addEventListener("input", autofillFromPastedMarkdown);
  el.importMarkdown.addEventListener("paste", () => {
    // paste 이벤트 시점엔 textarea.value가 아직 갱신 전이므로 다음 tick에 처리
    setTimeout(autofillFromPastedMarkdown, 0);
  });

  el.btnSave.addEventListener("click", () => saveCurrentDoc());
  el.btnCopyDocLink.addEventListener("click", () => copyCurrentDocLink());

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

  const editorReady = initEditor();
  initMarkdownToolbar(el);
  setupImagePasteAndDrop();
  setupImageLightbox();
  initAiDiagram();
  initExport();
  initSettingsWiring();
  initGlobalShortcuts();
  initEventBindings();

  // 딥링크로 문서를 자동으로 열 때 setEditorValue가 값을 실제로 반영하려면
  // 에디터(Monaco/fallback)가 생성된 이후여야 한다. 문서 목록 로딩과 에디터
  // 초기화는 병렬로 진행하되, 초기 문서를 여는 시점은 두 작업이 모두 끝난 뒤로 맞춘다.
  Promise.all([loadDocList(), editorReady]).then(() => openInitialLinkedDoc());
  renderPreview();
}
