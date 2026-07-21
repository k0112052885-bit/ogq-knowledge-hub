import { el, state, saveSettings } from "../../core/state.js";
import { emit } from "../../core/events.js";

// ============================================================
// Theme
// ============================================================
export function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  el.themeIcon.textContent = theme === "dark" ? "🌙" : "☀️";
  el.settingTheme.value = theme;
  state.settings.theme = theme;
  saveSettings();
  emit("theme:changed", theme);
}

export function toggleTheme() {
  applyTheme(state.settings.theme === "dark" ? "light" : "dark");
}

export function initTheme() {
  el.themeToggle.addEventListener("click", () => {
    toggleTheme();
    emit("theme:editor-sync", state.settings.theme);
  });

  el.settingTheme.addEventListener("change", () => {
    applyTheme(el.settingTheme.value);
    emit("theme:editor-sync", el.settingTheme.value);
  });

  applyTheme(state.settings.theme);
}
