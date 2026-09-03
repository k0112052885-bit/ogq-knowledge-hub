// 총매출(50억 목표) 달성률 요약을 계산·응답하는 핸들러.
// 현재 매출 수치는 이 파일 어디에도 리터럴로 두지 않고, 항상 revenue-target.json에서 읽는다.

function computeRevenueSummary(data) {
  return {
    cumulativeRevenue: data.cumulativeRevenue,
    targetRevenue: data.targetRevenue,
    attainmentPercent: (data.cumulativeRevenue / data.targetRevenue) * 100,
  };
}

function computeWeeklyProgress(cumulativeRevenue, targetRevenue, now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const dayOfYear =
    Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86400000) + 1;
  const weekNumber = Math.ceil(dayOfYear / 7);
  const year = now.getUTCFullYear();
  const totalDays = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
  const elapsedDays = dayOfYear;
  const revenueProgressPercent = (cumulativeRevenue / targetRevenue) * 100;
  const timeProgressPercent = (elapsedDays / totalDays) * 100;
  const differencePoints = revenueProgressPercent - timeProgressPercent;
  return { weekNumber, revenueProgressPercent, timeProgressPercent, differencePoints };
}

function handleRevenueSummary(req, res, rootDir) {
  const data = JSON.parse(require("fs").readFileSync(require("path").join(rootDir, "revenue-target.json"), "utf8"));
  const summary = computeRevenueSummary(data);
  const weekly = computeWeeklyProgress(data.cumulativeRevenue, data.targetRevenue, new Date());
  require("./../utils/http.js").sendJson(res, 200, Object.assign({}, summary, weekly));
}

module.exports = { computeRevenueSummary, computeWeeklyProgress, handleRevenueSummary };
