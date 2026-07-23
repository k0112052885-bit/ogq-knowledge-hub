const path = require("path");
const { sendJson, readRequestBody } = require("../utils/http.js");

const GENERATE_JS_PATH = path.join(__dirname, "..", "..", "generate.js");

async function handlePreview(req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (e) {
    sendJson(res, 413, { error: e.message });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    sendJson(res, 400, { error: "요청 본문이 올바른 JSON이 아닙니다." });
    return;
  }

  if (typeof payload.content !== "string") {
    sendJson(res, 400, { error: "content 필드가 필요합니다." });
    return;
  }

  delete require.cache[require.resolve(GENERATE_JS_PATH)];
  try {
    const { renderMarkdownPreview } = require(GENERATE_JS_PATH);
    const html = renderMarkdownPreview(payload.content);
    sendJson(res, 200, { html });
  } catch (err) {
    sendJson(res, 500, { error: `미리보기 렌더링 실패: ${err.message}` });
  }
}

module.exports = { handlePreview };
