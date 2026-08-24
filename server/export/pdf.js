const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer");

const { buildExportHtmlDocument } = require("./render-doc-html.js");

// A4 폭(210mm)을 CSS px로 환산한 값(96dpi 기준: 210mm / 25.4 * 96).
// 뷰포트 폭을 이 값으로 맞춰야, 렌더링 시점의 줄바꿈/레이아웃이 실제 PDF 폭(page.pdf의
// width: "210mm")과 정확히 일치한다 — 둘이 다르면 측정한 높이가 실제 출력 폭 기준
// 높이와 어긋나 PDF 하단에 빈 여백이 남거나 내용이 잘릴 수 있다.
const A4_WIDTH_MM = 210;
const A4_WIDTH_PX = Math.round((A4_WIDTH_MM / 25.4) * 96);

// 현재 열려 있는 문서 하나만 PDF로 내보낸다. Puppeteer는 요청마다 새로 launch하고
// 끝나면 반드시 close한다(상시 실행되는 백그라운드 프로세스로 두지 않음) — 이 서버는
// 로컬 개발 전용 툴이므로 Export를 쓰지 않는 동안은 리소스 사용이 0에 가까워야 한다.
async function renderDocToPdf(markdownContent, title, docsDir) {
  const html = buildExportHtmlDocument(markdownContent, title, docsDir);

  // page.setContent(html)은 문서를 about:blank 출처로 로드하므로, Chromium의 보안 정책상
  // <base href="file://..."> 로 지정한 상대경로 이미지(src="images/foo.png")를 불러오지
  // 못한다(원격 origin에서 file:// 리소스를 참조하는 것으로 취급되어 차단됨). 실제
  // file:// 출처를 갖도록 임시 HTML 파일에 써서 page.goto("file://...")로 열어야
  // 문서에 삽입된 이미지가 라이브 Preview와 동일하게 로드된다.
  const tmpFile = path.join(os.tmpdir(), `docs-builder-export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmpFile, html, "utf-8");

  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: A4_WIDTH_PX, height: 1080 });
    await page.goto(`file://${tmpFile}`, { waitUntil: "networkidle0" });

    // Mermaid 렌더링은 비동기이며(render-doc-html.js의 인라인 스크립트),
    // window.__mermaidRenderDone Promise가 끝날 때까지 기다린 뒤에 PDF를 찍어야
    // 다이어그램이 코드 텍스트가 아니라 실제 도형으로 출력된다.
    await page.evaluate(() => window.__mermaidRenderDone || Promise.resolve());

    // 페이지 매김 없는 "연속 스크롤" 한 장짜리 PDF를 만들기 위해, Mermaid 렌더링까지
    // 끝난 뒤의 실제 문서 높이(px)를 측정해 page.pdf()의 height로 그대로 넘긴다.
    // document.documentElement.scrollHeight를 쓰면 body의 margin 접힘 등과 무관하게
    // 실제로 보이는 콘텐츠 전체 높이를 안정적으로 얻을 수 있다.
    const contentHeightPx = await page.evaluate(() => document.documentElement.scrollHeight);

    const pdfBuffer = await page.pdf({
      width: `${A4_WIDTH_MM}mm`,
      height: `${contentHeightPx}px`,
      printBackground: true,
      pageRanges: "1",
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return pdfBuffer;
  } finally {
    await browser.close();
    fs.unlink(tmpFile, () => {});
  }
}

module.exports = { renderDocToPdf };
