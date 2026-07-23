export function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function statusLabel(status) {
  if (status === "draft") return "초안";
  if (status === "review") return "검토중";
  if (status === "locked") return "확정";
  return "";
}
