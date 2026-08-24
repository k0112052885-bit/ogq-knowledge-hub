const fs = require("fs");

const { sendJson, readRequestBody } = require("../utils/http.js");
const { isSafeDocFilename, resolveDocPath } = require("../utils/fs-safety.js");

// 지원하는 export 포맷의 레지스트리. 새 포맷(html/docx 등)을 추가할 때는
// 이 맵에 렌더러 하나만 등록하면 되고, 라우팅/파일 로딩 로직은 그대로 재사용된다.
const EXPORTERS = {
  pdf: {
    contentType: "application/pdf",
    extension: "pdf",
    render: async (markdownContent, title, docsDir) => {
      const { renderDocToPdf } = require("../export/pdf.js");
      return renderDocToPdf(markdownContent, title, docsDir);
    },
  },
};

// POST /api/export/:format  { filename }
// 현재 열려 있는 문서 하나만 지정한 포맷으로 내보낸다. Build/Git Push/Preview와는
// 완전히 독립된 엔드포인트로, 문서 목록이나 dist/ 산출물에는 영향을 주지 않는다.
async function handleExport(req, res, format, docsDir) {
  const exporter = EXPORTERS[format];
  if (!exporter) {
    sendJson(res, 400, { error: `지원하지 않는 export 형식입니다: ${format}` });
    return;
  }

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

  const filename = typeof payload.filename === "string" ? payload.filename : "";
  if (!isSafeDocFilename(filename)) {
    sendJson(res, 400, { error: "유효하지 않은 파일명입니다." });
    return;
  }
  const filePath = resolveDocPath(docsDir, filename);
  if (!filePath) {
    sendJson(res, 400, { error: "허용되지 않은 경로입니다." });
    return;
  }

  let content;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    sendJson(res, 404, { error: "문서를 찾을 수 없습니다." });
    return;
  }

  try {
    const fileBuffer = await exporter.render(content, filename.replace(/\.md$/, ""), docsDir);
    const downloadName = filename.replace(/\.md$/, `.${exporter.extension}`);
    res.writeHead(200, {
      "Content-Type": exporter.contentType,
      "Content-Length": fileBuffer.length,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(downloadName)}"`,
    });
    res.end(fileBuffer);
  } catch (err) {
    sendJson(res, 500, { error: `내보내기 실패: ${err.message}` });
  }
}

module.exports = { handleExport };
