// DOM refs
export const el = {
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
  btnImportAi: document.getElementById("btnImportAi"),
  btnAiDiagram: document.getElementById("btnAiDiagram"),
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
  currentFilename: null,
  isDirty: false,
  monacoEditor: null,
  monacoReady: false,
  settings: loadSettings(),
};
