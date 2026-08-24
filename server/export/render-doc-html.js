const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const GENERATE_JS_PATH = path.join(__dirname, "..", "..", "generate.js");
const ADMIN_STYLES_PATH = path.join(__dirname, "..", "..", "admin", "styles.css");

// src/features/preview/preview.js의 stripFrontMatterForPreview()와 반드시 동일한 동작을
// 유지해야 한다. 에디터/문서 파일에는 Front Matter가 포함된 전체 내용이 들어있고,
// 라이브 Preview는 /api/preview로 보내기 "전에" 클라이언트에서 이를 제거한다. Export(PDF/HTML)는
// 파일을 직접 읽어 서버에서 렌더링하므로, 동일한 결과를 내려면 여기서도 같은 로직으로
// Front Matter를 제거해야 한다 — 그렇지 않으면 라이브 Preview에는 없는 "title: ..." 같은
// YAML 텍스트가 결과물 상단에 그대로 노출된다.
function stripFrontMatter(content) {
  const withoutBom = content.replace(/^﻿/, "");
  const leading = withoutBom.match(/^\s*/)[0];
  const body = withoutBom.slice(leading.length);
  if (!body.startsWith("---")) return content;
  const match = body.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/);
  return match ? body.slice(match[0].length) : content;
}

// server/handlers/preview.js가 이미 하는 것과 동일하게, 항상 최신 docs 상태를
// 반영하도록 require 캐시를 지우고 generate.js를 다시 불러온다.
// PDF/HTML Export 양쪽이 공유하는 단 하나의 markdown → HTML 변환 지점 — 여기서 마크다운을
// 다시 구현하지 않고 generate.js의 renderMarkdownPreview()(라이브 Preview와 동일 함수)를 그대로 쓴다.
function renderMarkdownToHtml(content) {
  delete require.cache[require.resolve(GENERATE_JS_PATH)];
  const { renderMarkdownPreview } = require(GENERATE_JS_PATH);
  return renderMarkdownPreview(stripFrontMatter(content));
}

// src/features/preview/mermaid-render.js의 DOCS_BUILDER_DARK_MERMAID_THEME_VARIABLES /
// FLOWCHART_LAYOUT_OPTIONS와 반드시 동일한 값을 유지해야 한다. 그 파일은 브라우저 전용
// ES 모듈(core/state.js의 DOM 조회에 의존)이라 헤드리스/오프라인 export 페이지에 그대로
// import할 수 없으므로, 여기서는 같은 상수를 인라인 <script>로 문자열 삽입한다. 값 자체가
// 두 곳에서 물리적으로 분리된 코드이므로, 문서 Preview의 Mermaid 팔레트를 바꿀 때는 이 값도
// 함께 갱신해야 한다는 점에 주의. PDF Export와 HTML Download가 이 스크립트를 공유한다.
const MERMAID_INIT_SCRIPT = `
  window.mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
      primaryColor: "#171c26",
      primaryTextColor: "#f4f7fb",
      primaryBorderColor: "#4f7cff",
      nodeBorder: "#4f7cff",
      lineColor: "#536074",
      secondaryColor: "#202a3a",
      tertiaryColor: "#202a3a",
      background: "#0b0e14",
      mainBkg: "#171c26",
      nodeTextColor: "#f4f7fb",
      edgeLabelBackground: "#171c26",
      clusterBkg: "#141924",
      clusterBorder: "#4f7cff",
    },
    flowchart: {
      nodeSpacing: 60,
      rankSpacing: 75,
      diagramPadding: 20,
      useMaxWidth: true,
      htmlLabels: true,
      padding: 20,
    },
    securityLevel: "strict",
  });

  window.__mermaidRenderDone = (async function renderAllMermaidBlocks() {
    const blocks = Array.from(document.querySelectorAll(".mermaid"));
    for (const block of blocks) {
      const code = block.textContent;
      try {
        const { svg } = await window.mermaid.render("mermaid-export-" + Math.random().toString(36).slice(2), code);
        block.innerHTML = svg;
      } catch (e) {
        block.innerHTML = '<div class="mermaid-error-box">Mermaid 렌더링 실패: ' + String(e.message || e) + '</div>';
      }
    }
  })();
`;

const IMAGE_MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

// 렌더된 HTML 안의 <img src="images/foo.png">(문서 파일 기준 상대경로, docsDir/images를
// 가리킴)를 실제 파일 내용을 읽어 data: URL로 바꿔치기한다. HTML Download 결과물은
// 로컬 서버나 파일시스템 경로에 의존하지 않고 어디서나(다른 PC, 이메일 첨부 등) 열려야
// 하므로, "file:// 상대경로로 연결"이 아니라 "이미지 바이트 자체를 문서에 내장"해야 한다.
// 원격 URL(http/https)이나 이미 data: URL인 이미지는 그대로 둔다(이미 포터블함).
function inlineImagesAsDataUrls(html, docsDir) {
  return html.replace(/(<img\b[^>]*\bsrc=")([^"]+)("[^>]*>)/g, (full, prefix, src, suffix) => {
    if (/^(https?:|data:)/i.test(src)) return full;

    const decodedSrc = decodeURIComponent(src);
    const resolved = path.resolve(docsDir, decodedSrc);
    // docsDir 밖을 가리키는 경로는 내장하지 않고 원본 그대로 남긴다(경로 조작 방지).
    if (!resolved.startsWith(docsDir + path.sep)) return full;

    let fileBuffer;
    try {
      fileBuffer = fs.readFileSync(resolved);
    } catch (e) {
      // 파일을 찾을 수 없으면 원본 src를 그대로 남겨(깨진 이미지로 보이더라도) 조용히 실패시킨다.
      return full;
    }

    const ext = path.extname(resolved).toLowerCase();
    const mime = IMAGE_MIME_BY_EXT[ext] || "application/octet-stream";
    const dataUrl = `data:${mime};base64,${fileBuffer.toString("base64")}`;
    return `${prefix}${dataUrl}${suffix}`;
  });
}

// PDF Export용 standalone HTML 문서를 만든다.
// - markdown → HTML 변환은 generate.js의 renderMarkdownPreview()를 그대로 재사용한다
//   (server/handlers/preview.js가 라이브 Preview에 쓰는 것과 동일한 함수 — 여기서
//   마크다운을 다시 구현하지 않는다).
// - CSS는 admin/styles.css 파일 내용을 그대로 읽어 <style>로 인라인한다. 링크 태그로
//   불러오면 file:// 컨텍스트나 네트워크 지연에 좌우될 수 있어, 인라인이 더 안정적이다.
// - Mermaid는 라이브 Preview와 동일한 CDN(mermaid@10)에서 로드하고, 동일한 다크 팔레트로
//   초기화한 뒤 렌더링한다.
// - 이미지는 <base href="file://docsDir/">로 해석되는 상대경로를 그대로 쓴다(PDF는 이
//   서버 로컬 머신에서만 Puppeteer가 즉시 소비하고 버리는 임시 산출물이라 이식성이 필요 없다).
function buildExportHtmlDocument(markdownContent, title, docsDir) {
  const bodyHtml = renderMarkdownToHtml(markdownContent);
  const css = fs.readFileSync(ADMIN_STYLES_PATH, "utf-8");
  const safeTitle = String(title || "Document").replace(/</g, "&lt;");

  // 렌더된 HTML의 <img src="images/foo.png">는 문서 파일 기준 상대경로다(라이브 Preview에서는
  // /admin이 /images/*를 docsDir/images로 서빙해 해석됨). 이 페이지는 서버의 HTTP 컨텍스트
  // 없이 file://로 직접 로드되므로, docsDir을 기준 URL로 지정해 같은 상대경로가 로컬 파일로
  // 해석되게 한다. path.sep로 끝나야 <base>가 디렉터리로 취급된다.
  const baseHref = pathToFileURL(docsDir + path.sep).href;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<base href="${baseHref}" />
<title>${safeTitle}</title>
<style>${css}</style>
<style>
  /* Export 전용: 화면 미리보기 프레임(사이드바/툴바 등) 없이 문서 본문만 출력한다.
     페이지 매김 없이 A4 "폭"만 유지한 하나의 연속된 문서로 렌더링한다 — 실제 PDF의
     "높이"는 서버(pdf.js)가 이 문서의 렌더링된 실제 높이를 측정해 page.pdf()의 height로
     그대로 넘기므로, 여기서는 페이지 분할(@page, break-*) 관련 규칙을 두지 않는다.
     섹션 사이에 흰 여백(페이지 경계로 인한 gap)이 생기는 원인 자체가 다중 페이지
     레이아웃이므로, 단일 연속 페이지에서는 이 규칙들이 필요 없다. */
  html, body {
    background: var(--bg-surface-2, #191c22);
    margin: 0;
  }
  body[data-theme="dark"] {
    background: var(--bg-surface-2);
  }
  .export-page {
    /* A4 폭(210mm)에서 좌우 patting을 뺀 만큼만 본문이 차지하도록 폭을 고정한다.
       page.pdf()에 width: "210mm"를 그대로 넘기므로, 뷰포트 폭도 이와 일치해야
       실제 PDF 폭과 렌더링 시점 레이아웃(줄바꿈 등)이 어긋나지 않는다. */
    width: 210mm;
    box-sizing: border-box;
    padding: 14mm;
    margin: 0 auto;
  }
</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
<body data-theme="dark">
  <div class="export-page markdown-body">
    ${bodyHtml}
  </div>
  <script>${MERMAID_INIT_SCRIPT}</script>
</body>
</html>`;
}

// HTML Download용 완전 독립(portable) standalone 문서를 만든다.
// PDF Export(buildExportHtmlDocument)와의 차이:
//   1) 레이아웃 폭이 A4(210mm) 고정이 아니라 라이브 Preview pane과 동일한 가변 폭
//      (.preview-body의 실제 레이아웃, 최대 폭 제한)을 사용해 "현재 Preview와 최대한
//      비슷하게" 보이도록 한다 — PDF는 인쇄물 규격을 맞춰야 하므로 별도로 유지.
//   2) 이미지가 <base href="file://...">가 아니라 data: URL로 완전히 파일 내부에
//      내장된다 — 이 파일은 생성한 머신을 벗어나 다른 PC/이메일 첨부로 옮겨져도
//      깨지지 않아야 하기 때문이다(PDF는 생성 즉시 Puppeteer가 소비하고 버려지는
//      로컬 임시 파일이라 이식성이 필요 없어 file://로 충분했다).
// 나머지(마크다운 렌더링 재사용, CSS 인라인, Mermaid CDN + 동일 다크 팔레트로 오프라인
// 렌더링)는 PDF Export와 완전히 동일한 원칙을 따른다 — 두 번째 렌더러를 만들지 않는다.
function buildStandaloneHtmlDocument(markdownContent, title, docsDir) {
  const rawBodyHtml = renderMarkdownToHtml(markdownContent);
  const bodyHtml = inlineImagesAsDataUrls(rawBodyHtml, docsDir);
  const css = fs.readFileSync(ADMIN_STYLES_PATH, "utf-8");
  const safeTitle = String(title || "Document").replace(/</g, "&lt;");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle}</title>
<style>${css}</style>
<style>
  /* HTML Download 전용: 관리자 UI 프레임(사이드바/툴바/에디터) 없이 문서 본문만,
     라이브 Preview pane(.preview-body)과 동일한 여백/최대폭으로 출력한다. */
  html, body {
    background: var(--bg-surface-2, #191c22);
    margin: 0;
  }
  body[data-theme="dark"] {
    background: var(--bg-surface-2);
  }
  .standalone-page {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--space-6, 24px);
  }
</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
<body data-theme="dark">
  <div class="standalone-page markdown-body">
    ${bodyHtml}
  </div>
  <script>${MERMAID_INIT_SCRIPT}</script>
</body>
</html>`;
}

module.exports = { buildExportHtmlDocument, buildStandaloneHtmlDocument };
