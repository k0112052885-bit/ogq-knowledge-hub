const path = require("path");
const { sendJson, readRequestBody } = require("../utils/http.js");

const GENERATE_JS_PATH = path.join(__dirname, "..", "..", "generate.js");

// scope: "project"(현재 선택된 프로젝트만) 또는 "full"(전체 프로젝트 + 단일 문서).
// scope가 없거나 알 수 없는 값이면 명시적으로 요청되지 않은 것으로 보고 400을 반환한다 —
// 과거처럼 "값이 없으면 전역 빌드"로 조용히 대체하지 않는다(정상 Build가 의도치 않게
// Knowledge Hub 전체를 다시 빌드하는 문제를 막기 위함). 클라이언트(src/features/export/export.js)는
// 항상 scope를 명시적으로 보낸다.
async function handleBuild(req, res) {
  let payload = {};
  try {
    const body = await readRequestBody(req);
    if (body) payload = JSON.parse(body);
  } catch (e) {
    sendJson(res, 400, { ok: false, message: "요청 본문이 올바른 JSON이 아닙니다." });
    return;
  }

  const scope = payload.scope === "full" ? "full" : payload.scope === "project" ? "project" : null;
  if (!scope) {
    sendJson(res, 400, { ok: false, message: "빌드 범위(scope)가 지정되지 않았습니다." });
    return;
  }

  const projectId =
    scope === "project" && typeof payload.projectId === "string" && payload.projectId.trim()
      ? payload.projectId.trim()
      : null;

  // require 캐시를 지워 매 빌드마다 docs 최신 상태를 반영
  delete require.cache[require.resolve(GENERATE_JS_PATH)];
  try {
    const { build } = require(GENERATE_JS_PATH);
    build(scope, projectId);
    const message = scope === "project" ? "선택된 프로젝트로 빌드가 완료되었습니다." : "전체 Build가 완료되었습니다.";
    sendJson(res, 200, { ok: true, message, scope, projectId });
  } catch (err) {
    sendJson(res, 500, { ok: false, message: `빌드 실패: ${err.message}` });
  }
}

module.exports = { handleBuild };
