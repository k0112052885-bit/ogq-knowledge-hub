// 총매출(50억 목표) 달성률 요약을 계산·응답하는 핸들러.
// 현재 매출·연간 목표 수치는 이 파일 어디에도 리터럴로 두지 않고,
// 항상 저장소 루트의 revenue-workbook.json 스냅샷에서 읽는다.

const fs = require("fs");
const path = require("path");

function computeRevenueSummary(data) {
  return {
    cumulativeRevenue: data.cumulativeRevenue,
    targetRevenue: data.targetRevenue,
    attainmentPercent: (data.cumulativeRevenue / data.targetRevenue) * 100,
  };
}

// 유일한 공유 비즈니스 주차 계산 (금요일->목요일, 기준 주차 29 = 2026-07-17).
function businessWeek(now, anchor) {
  const parts = String(anchor.anchorStartDate).split("-");
  const anchorYear = Number(parts[0]);
  const anchorMonth0 = Number(parts[1]) - 1;
  const anchorDay = Number(parts[2]);
  return (
    Math.floor(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
        Date.UTC(anchorYear, anchorMonth0, anchorDay)) /
        (7 * 86400000)
    ) + anchor.anchorWeek
  );
}

function computeWeeklyProgress(cumulativeRevenue, targetRevenue, now, weekAnchor) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const dayOfYear =
    Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86400000) + 1;
  const weekNumber = businessWeek(now, weekAnchor);
  const year = now.getUTCFullYear();
  const totalDays = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
  const elapsedDays = dayOfYear;
  const revenueProgressPercent = (cumulativeRevenue / targetRevenue) * 100;
  const timeProgressPercent = (elapsedDays / totalDays) * 100;
  const differencePoints = revenueProgressPercent - timeProgressPercent;
  return { weekNumber, revenueProgressPercent, timeProgressPercent, differencePoints };
}

function selectWeeklyActions(records, weekNumber) {
  if (!Array.isArray(records)) return null;
  for (const rec of records) {
    if (rec && rec.week === weekNumber) return rec;
  }
  return null;
}

function handleRevenueSummary(req, res, rootDir) {
  const workbook = JSON.parse(fs.readFileSync(path.join(rootDir, "revenue-workbook.json"), "utf8"));
  const summary = computeRevenueSummary({
    cumulativeRevenue: workbook.cumulativeRevenue,
    targetRevenue: workbook.annualTarget,
  });
  const weekly = computeWeeklyProgress(
    workbook.cumulativeRevenue,
    workbook.annualTarget,
    new Date(),
    workbook.weekAnchor
  );
  const actionRecords = JSON.parse(fs.readFileSync(path.join(rootDir, "weekly-actions.json"), "utf8"));
  const weeklyActions = selectWeeklyActions(actionRecords, weekly.weekNumber);
  require("./../utils/http.js").sendJson(
    res,
    200,
    Object.assign({}, summary, weekly, { weeklyActions }, {
      weeklyRevenue: workbook.weeklyRevenue,
      reportWeek: workbook.reportWeek,
      weekStart: workbook.weekStart,
      weekEnd: workbook.weekEnd,
    })
  );
}

module.exports = {
  computeRevenueSummary,
  computeWeeklyProgress,
  selectWeeklyActions,
  handleRevenueSummary,
  businessWeek,
};
