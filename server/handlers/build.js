const path = require("path");
const { sendJson, readRequestBody } = require("../utils/http.js");

const GENERATE_JS_PATH = path.join(__dirname, "..", "..", "generate.js");

async function handleBuild(req, res) {
  // body가 없는 기존 클라이언트(빈 POST)와도 호환되도록, 파싱 실패/빈 본문이면
  // projectId 없이(=전역 빌드) 진행한다.
  let projectId = null;
  try {
    const body = await readRequestBody(req);
    if (body) {
      const payload = JSON.parse(body);
      if (typeof payload.projectId === "string" && payload.projectId.trim()) {
        projectId = payload.projectId.trim();
      }
    }
  } catch (e) {
    // 본문이 JSON이 아니거나 비어있으면 전역 빌드로 취급
  }

  // require 캐시를 지워 매 빌드마다 docs 최신 상태를 반영
  delete require.cache[require.resolve(GENERATE_JS_PATH)];
  try {
    const { build } = require(GENERATE_JS_PATH);
    build(projectId);
    const message = projectId
      ? "선택된 프로젝트로 빌드가 완료되었습니다."
      : "빌드가 완료되었습니다.";
    sendJson(res, 200, { ok: true, message, projectId });
  } catch (err) {
    sendJson(res, 500, { ok: false, message: `빌드 실패: ${err.message}` });
  }
}

module.exports = { handleBuild };
