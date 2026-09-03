// 총매출(50억 목표) 달성률 요약을 계산·응답하는 핸들러.
// 현재 매출 수치는 이 파일 어디에도 리터럴로 두지 않고, 항상 revenue-target.json에서 읽는다.

function computeRevenueSummary(data) {
  return {
    cumulativeRevenue: data.cumulativeRevenue,
    targetRevenue: data.targetRevenue,
    attainmentPercent: (data.cumulativeRevenue / data.targetRevenue) * 100,
  };
}

function handleRevenueSummary(req, res, rootDir) {
  const data = JSON.parse(require("fs").readFileSync(require("path").join(rootDir, "revenue-target.json"), "utf8"));
  require("./../utils/http.js").sendJson(res, 200, computeRevenueSummary(data));
}

module.exports = { computeRevenueSummary, handleRevenueSummary };
