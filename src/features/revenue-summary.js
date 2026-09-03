import { api } from "../core/api.js";

export async function initRevenueSummary() {
  const box = document.getElementById("revenueSummary");
  if (!box) return;
  try {
    const s = await api("/api/revenue-summary");
    const cum = box.querySelector('[data-field="cumulative"]');
    const att = box.querySelector('[data-field="attainment"]');
    if (cum) cum.textContent = `누적 매출: ${Math.round(s.cumulativeRevenue).toLocaleString("ko-KR")}원`;
    if (att) att.textContent = `달성률: ${s.attainmentPercent.toFixed(2)}%`;
  } catch (e) {
    /* leave placeholders */
  }
}
