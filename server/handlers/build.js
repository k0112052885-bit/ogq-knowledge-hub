const path = require("path");
const { sendJson } = require("../utils/http.js");

const GENERATE_JS_PATH = path.join(__dirname, "..", "..", "generate.js");

function handleBuild(req, res) {
  // require 캐시를 지워 매 빌드마다 docs 최신 상태를 반영
  delete require.cache[require.resolve(GENERATE_JS_PATH)];
  try {
    const { build } = require(GENERATE_JS_PATH);
    build();
    sendJson(res, 200, { ok: true, message: "빌드가 완료되었습니다." });
  } catch (err) {
    sendJson(res, 500, { ok: false, message: `빌드 실패: ${err.message}` });
  }
}

module.exports = { handleBuild };
