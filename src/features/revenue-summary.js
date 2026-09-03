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

    const weekly = document.getElementById("revenueWeeklyProgress");
    if (!weekly) return;
    const wk = weekly.querySelector('[data-field="week"]');
    const cw = weekly.querySelector('[data-field="cumWeekly"]');
    const rp = weekly.querySelector('[data-field="revProgress"]');
    const tp = weekly.querySelector('[data-field="timeProgress"]');
    const df = weekly.querySelector('[data-field="diff"]');
    if (wk) wk.textContent = `현재 ${s.weekNumber}주차`;
    if (cw) cw.textContent = `누적 매출: ${(s.cumulativeRevenue / 100000000).toFixed(1)}억`;
    if (rp) rp.textContent = `매출 진행률: ${s.revenueProgressPercent.toFixed(1)}%`;
    if (tp) tp.textContent = `시간 진행률: ${s.timeProgressPercent.toFixed(1)}%`;
    if (df) df.textContent = `대비: ${s.differencePoints >= 0 ? "+" : ""}${s.differencePoints.toFixed(1)}%p`;

    const wa = document.getElementById("weeklyActions");
    if (!wa) return;
    const currentList = wa.querySelector('[data-list="current"]');
    const previousList = wa.querySelector('[data-list="previous"]');
    const rec = s.weeklyActions;
    const currentActions = rec && Array.isArray(rec.currentActions) ? rec.currentActions : [];
    const previousEffects = rec && Array.isArray(rec.previousActionEffects) ? rec.previousActionEffects : [];

    if (!rec || (currentActions.length === 0 && previousEffects.length === 0)) {
      if (currentList) currentList.textContent = "이번 주 등록된 액션이 없습니다.";
      if (previousList) previousList.textContent = "지난 액션 효과가 없습니다.";
    } else {
      if (currentList) {
        currentList.textContent = "";
        for (const a of currentActions) {
          const li = document.createElement("li");
          li.textContent = `${a.title} — ${a.status}`;
          currentList.appendChild(li);
        }
      }
      if (previousList) {
        previousList.textContent = "";
        for (const p of previousEffects) {
          const li = document.createElement("li");
          li.textContent = `${p.actionTitle} — ${p.effectSummary}`;
          previousList.appendChild(li);
        }
      }
    }
  } catch (e) {
    /* leave placeholders */
  }
}
