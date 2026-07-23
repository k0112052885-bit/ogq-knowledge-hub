import { el } from "./state.js";

// ============================================================
// Toast
// ============================================================
const TOAST_ICONS = { success: "✓", error: "✕", info: "ℹ" };

export function toast(type, title, desc) {
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

export function setStatus(text, kind) {
  el.statusText.textContent = text;
  el.statusText.className = "status-text" + (kind ? ` status-${kind}` : "");
}
