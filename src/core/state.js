// DOM refs
export const el = {
  docTree: document.getElementById("docTree"),
  projectTree: document.getElementById("projectTree"),
  recentList: document.getElementById("recentList"),
  globalSearch: document.getElementById("globalSearch"),
  themeToggle: document.getElementById("btnThemeToggle"),
  themeIcon: document.getElementById("themeIcon"),
  settingsBtn: document.getElementById("btnSettings"),
  collapseAllBtn: document.getElementById("btnCollapseAll"),

  editorFilename: document.getElementById("editorFilename"),
  btnCopyDocLink: document.getElementById("btnCopyDocLink"),
  saveStatus: document.getElementById("saveStatus"),
  saveStatusText: document.getElementById("saveStatusText"),
  monacoContainer: document.getElementById("monacoContainer"),
  imageDropOverlay: document.getElementById("imageDropOverlay"),
  editorToolbar: document.getElementById("editorToolbar"),
  toggleAutoSave: document.getElementById("toggleAutoSave"),
  toggleAutoBuild: document.getElementById("toggleAutoBuild"),

  previewBody: document.getElementById("previewBody"),
  previewMeta: document.getElementById("previewMeta"),

  imageLightbox: document.getElementById("imageLightbox"),
  imageLightboxImg: document.getElementById("imageLightboxImg"),
  imageLightboxCaption: document.getElementById("imageLightboxCaption"),
  imageLightboxClose: document.getElementById("imageLightboxClose"),

  statusText: document.getElementById("statusText"),

  btnNew: document.getElementById("btnNew"),
  btnNewProject: document.getElementById("btnNewProject"),
  btnImportAi: document.getElementById("btnImportAi"),
  btnAiDiagramV2: document.getElementById("btnAiDiagramV2"),
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

  newProjectModal: document.getElementById("newProjectModal"),
  newProjectTitle: document.getElementById("newProjectTitle"),
  newProjectFirstPageTitle: document.getElementById("newProjectFirstPageTitle"),
  btnCreateNewProject: document.getElementById("btnCreateNewProject"),

  newProjectPageModal: document.getElementById("newProjectPageModal"),
  newProjectPageTarget: document.getElementById("newProjectPageTarget"),
  newProjectPageTitle: document.getElementById("newProjectPageTitle"),
  btnCreateNewProjectPage: document.getElementById("btnCreateNewProjectPage"),

  renamePageModal: document.getElementById("renamePageModal"),
  renamePageTitle: document.getElementById("renamePageTitle"),
  btnConfirmRenamePage: document.getElementById("btnConfirmRenamePage"),

  renameProjectModal: document.getElementById("renameProjectModal"),
  renameProjectTitle: document.getElementById("renameProjectTitle"),
  btnConfirmRenameProject: document.getElementById("btnConfirmRenameProject"),

  deletePageConfirmModal: document.getElementById("deletePageConfirmModal"),
  deletePageConfirmMessage: document.getElementById("deletePageConfirmMessage"),
  btnConfirmDeletePage: document.getElementById("btnConfirmDeletePage"),

  deleteProjectConfirmModal: document.getElementById("deleteProjectConfirmModal"),
  deleteProjectConfirmMessage: document.getElementById("deleteProjectConfirmMessage"),
  deleteProjectConfirmPageList: document.getElementById("deleteProjectConfirmPageList"),
  btnConfirmDeleteProject: document.getElementById("btnConfirmDeleteProject"),

  importAiModal: document.getElementById("importAiModal"),
  importTitle: document.getElementById("importTitle"),
  importCategory: document.getElementById("importCategory"),
  importTags: document.getElementById("importTags"),
  importStatus: document.getElementById("importStatus"),
  importDescription: document.getElementById("importDescription"),
  importMarkdown: document.getElementById("importMarkdown"),
  btnCreateImport: document.getElementById("btnCreateImport"),

  aiDiagramV2Modal: document.getElementById("aiDiagramV2Modal"),
  aiDiagramType: document.getElementById("aiDiagramType"),
  aiDiagramStyle: document.getElementById("aiDiagramStyle"),
  aiDiagramStyleDesc: document.getElementById("aiDiagramStyleDesc"),
  aiDiagramStyleRecommendedBadge: document.getElementById("aiDiagramStyleRecommendedBadge"),
  aiDiagramVariantCount: document.getElementById("aiDiagramVariantCount"),
  aiDiagramV2Status: document.getElementById("aiDiagramV2Status"),
  aiDiagramV2Results: document.getElementById("aiDiagramV2Results"),
  btnGenerateAiDiagramV2: document.getElementById("btnGenerateAiDiagramV2"),

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

export function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}

export const state = {
  docs: [],
  // docs로부터 파생되는 프로젝트/단일 페이지 구조. loadDocList()에서
  // groupIntoProjectsAndPages(docs) 결과로 채워지며, 사이드바의
  // "프로젝트" / "단일 문서" 두 영역이 각각 이 값을 렌더링한다.
  projects: [],
  standaloneDocs: [],
  currentFilename: null,
  isDirty: false,
  monacoEditor: null,
  monacoReady: false,
  settings: loadSettings(),
};
