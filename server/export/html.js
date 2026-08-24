const { buildStandaloneHtmlDocument } = require("./render-doc-html.js");

// HTML Download는 PDF Export와 달리 Puppeteer/헤드리스 브라우저가 필요 없다 — 결과물은
// 순수 HTML 문자열이고, Mermaid는 파일을 여는 브라우저에서 그때 렌더링된다(오프라인에서도
// 동작하도록 CDN 스크립트 + 초기화 코드를 파일 안에 그대로 담아 보낸다). 서버는 문자열을
// 만들어 반환하기만 하면 되므로 이 함수는 동기적이며 브라우저 프로세스를 띄우지 않는다.
async function renderDocToHtml(markdownContent, title, docsDir) {
  const html = buildStandaloneHtmlDocument(markdownContent, title, docsDir);
  return Buffer.from(html, "utf-8");
}

module.exports = { renderDocToHtml };
