import { api } from "../core/api.js";

export async function initRevenueSummary() {
  const box = document.getElementById("revenueSummary");
  if (!box) return;
  try {
    const s = await api("/api/revenue-summary");
    const cum = box.querySelector('[data-field="cumulative"]');
    const target = box.querySelector('[data-field="target"]');
    const att = box.querySelector('[data-field="attainment"]');
    const latestWeekly = box.querySelector('[data-field="weeklyRevenue"]');
    if (cum) cum.textContent = `${(s.cumulativeRevenue / 100000000).toFixed(2)}억`;
    if (target) target.textContent = `${(s.targetRevenue / 100000000).toLocaleString("ko-KR")}억`;
    if (att) att.textContent = `${s.attainmentPercent.toFixed(2)}%`;
    if (latestWeekly) latestWeekly.textContent = `${Math.round(s.weeklyRevenue / 10000).toLocaleString("ko-KR")}만원`;

    const weekly = document.getElementById("revenueWeeklyProgress");
    if (!weekly) return;
    const operatingWeek = weekly.querySelector('[data-field="operatingWeek"]');
    const reportWeek = weekly.querySelector('[data-field="reportWeek"]');
    const reportPeriod = weekly.querySelector('[data-field="reportPeriod"]');
    const rp = weekly.querySelector('[data-field="revProgress"]');
    const tp = weekly.querySelector('[data-field="timeProgress"]');
    const df = weekly.querySelector('[data-field="diff"]');
    if (operatingWeek) operatingWeek.textContent = `${s.weekNumber}주차`;
    if (reportWeek) reportWeek.textContent = `${s.reportWeek}주차`;
    if (reportPeriod) reportPeriod.textContent = `${s.weekStart} ~ ${s.weekEnd}`;
    if (rp) rp.textContent = `${s.revenueProgressPercent.toFixed(2)}%`;
    if (tp) tp.textContent = `${s.timeProgressPercent.toFixed(1)}%`;
    if (df) df.textContent = `${s.differencePoints >= 0 ? "+" : ""}${s.differencePoints.toFixed(1)}%p`;

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
