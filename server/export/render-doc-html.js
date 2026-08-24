const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const GENERATE_JS_PATH = path.join(PROJECT_ROOT, "generate.js");
const ADMIN_STYLES_PATH = path.join(PROJECT_ROOT, "admin", "styles.css");
// 사이트 전역 정적 자산 디렉터리(admin/styles.css, generate.js와 마찬가지로 이
// 모듈 파일 기준 상대경로로 프로젝트 루트를 찾아 참조한다 — server.js의 config
// 객체에 새 필드를 추가하지 않고, 이미 존재하는 __dirname 기반 경로 계산 패턴을
// 그대로 따른다).
//
// 배경: docs/03_decision_gate.md처럼 "assets/images/..."를 참조하는 문서가 이미
// 존재한다. 이 경로는 문서별 업로드 이미지(docs/images/, Image Library의 표준
// 경로)가 아니라 사이트 전역 정적 자산(assets/)을 가리키는 것으로, generate.js의
// build()가 assets/ 전체를 dist/assets/로 복사하기 때문에 "빌드된 사이트"에서는
// 정상적으로 열린다. 라이브 Preview에서도 우연히 열리는데, #previewBody에 주입된
// <img src="assets/images/...">가 브라우저에 의해 페이지 URL(/admin) 기준 상대경로로
// 해석되어 사이트 루트(/assets/images/...)로 요청되기 때문이다(dist/assets가 이미
// 빌드되어 있어야 성공). 반면 PDF/HTML export는 docsDir만 기준으로 이미지를 찾으므로
// 이 문서에서는 실패해왔다. 마크다운을 고치는 대신, export 쪽 이미지 탐색 범위를
// "docs/images 우선, 없으면 assets/images도 확인"으로 넓혀 기존 문서를 그대로 둔 채
// 이 레거시 경로도 안정적으로 렌더링되게 한다.
const ASSETS_IMAGES_DIR = path.join(PROJECT_ROOT, "assets", "images");

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

// 문서 안 상대경로 이미지 참조(예: "images/foo.png", "assets/images/foo.svg")를
// 실제 파일 절대경로로 해석한다. 표준 위치(docsDir/images, 즉 Image Library·업로드
// API가 쓰는 바로 그 디렉터리)를 우선 확인하고, 거기 없으면 사이트 전역 정적 자산
// 위치(assets/images)도 확인한다 — 03_decision_gate.md처럼 이미 존재하는, 표준
// 위치가 아닌 정당한 참조를 마크다운 수정 없이 지원하기 위함이다. 두 곳 다 경로
// 탈출(../ 등으로 허용 디렉터리 밖을 가리키는 것)은 차단한다.
function resolveDocImagePath(src, docsDir) {
  const decodedSrc = decodeURIComponent(src);

  const underDocs = path.resolve(docsDir, decodedSrc);
  if (underDocs.startsWith(docsDir + path.sep) && fs.existsSync(underDocs)) {
    return underDocs;
  }

  // "assets/images/xxx" 형태로 참조된 경우에만 자산 디렉터리에서 다시 찾는다.
  // 임의 상대경로를 전부 assets/ 기준으로도 시도하면 의도치 않게 다른 파일을
  // 집어올 위험이 있으므로, 실제로 관찰된 레거시 패턴(assets/images/...)만 다룬다.
  const assetsMatch = decodedSrc.match(/^assets[\\/]images[\\/](.+)$/);
  if (assetsMatch) {
    const underAssets = path.resolve(ASSETS_IMAGES_DIR, assetsMatch[1]);
    if (underAssets.startsWith(ASSETS_IMAGES_DIR + path.sep) && fs.existsSync(underAssets)) {
      return underAssets;
    }
  }

  return null;
}

// 렌더된 HTML 안의 <img src="images/foo.png">(문서 파일 기준 상대경로, docsDir/images를
// 가리킴)를 실제 파일 내용을 읽어 data: URL로 바꿔치기한다. HTML Download 결과물은
// 로컬 서버나 파일시스템 경로에 의존하지 않고 어디서나(다른 PC, 이메일 첨부 등) 열려야
// 하므로, "file:// 상대경로로 연결"이 아니라 "이미지 바이트 자체를 문서에 내장"해야 한다.
// 원격 URL(http/https)이나 이미 data: URL인 이미지는 그대로 둔다(이미 포터블함).
function inlineImagesAsDataUrls(html, docsDir) {
  return html.replace(/(<img\b[^>]*\bsrc=")([^"]+)("[^>]*>)/g, (full, prefix, src, suffix) => {
    if (/^(https?:|data:)/i.test(src)) return full;

    const resolved = resolveDocImagePath(src, docsDir);
    if (!resolved) return full;

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

// PDF Export 전용: <base href="file://docsDir/">만으로는 해석되지 않는 레거시 경로
// (assets/images/...)를 실제 파일의 file:// 절대경로로 직접 바꿔치기한다. docsDir
// 기준 표준 경로(images/...)는 <base>가 이미 올바르게 처리하므로 건드리지 않는다.
function rewriteLegacyAssetImagePaths(html, docsDir) {
  return html.replace(/(<img\b[^>]*\bsrc=")([^"]+)("[^>]*>)/g, (full, prefix, src, suffix) => {
    if (/^(https?:|data:|file:)/i.test(src)) return full;
    if (!/^assets[\\/]images[\\/]/.test(decodeURIComponent(src))) return full;

    const resolved = resolveDocImagePath(src, docsDir);
    if (!resolved) return full;

    return `${prefix}${pathToFileURL(resolved).href}${suffix}`;
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
  const rawBodyHtml = renderMarkdownToHtml(markdownContent);
  const bodyHtml = rewriteLegacyAssetImagePaths(rawBodyHtml, docsDir);
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
    padding: 16mm 18mm;
    margin: 0 auto;
  }

  /* ============================================================
     PDF 품질 개선 (admin/styles.css를 덮어쓰지 않고 export-page 범위에만 적용).
     라이브 Preview/HTML Download는 그대로 두고, "실행 문서(executive document)"에
     맞는 타이포그래피/여백/표/콜아웃/코드블록/이미지/Mermaid 마감만 PDF에 추가한다.
     ============================================================ */

  /* ---- 타이포그래피: 본문 가독성 + 계층 강화 ---- */
  .export-page.markdown-body {
    font-size: 13.5px;
    line-height: 1.85;
    /* 한글/영문이 섞인 본문에서 자간을 살짝 좁혀 라틴 알파벳 사이 여백과
       한글 사이 여백의 리듬 차이를 줄인다 — 너무 좁히면 한글 가독성이 떨어지므로
       미세 조정 수준으로 제한. */
    letter-spacing: -0.1px;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }

  /* H1은 문서 안에 실제로 등장하는 경우(예: 여러 절이 담긴 문서)를 위해 명시적으로
     정의한다 — 기존 admin/styles.css에는 h1 규칙이 없어 브라우저 기본값(2em, 굵게)에
     기대고 있었고, 그 결과 H2/H3와의 크기 차이가 인쇄물에서는 지나치게 크거나
     불명확하게 보였다. H1 > H2 > H3 > 본문 순으로 명확한 단계를 만든다. */
  .export-page h1 {
    font-size: 25px;
    font-weight: 800;
    line-height: 1.3;
    letter-spacing: -0.2px;
    margin: 0 0 14px;
    padding-bottom: 12px;
    border-bottom: 2px solid var(--border-strong);
  }

  .export-page h2:first-child,
  .export-page h1:first-child {
    margin-top: 0;
  }

  .export-page h2 {
    font-size: 18px;
    font-weight: 700;
    /* section → section 리듬: 새 절이 시작되기 전 여백을 절 내부 여백보다 넉넉히
       주어 "이전 절이 끝났다"는 시각적 구분을 분명히 한다. */
    margin-top: 34px;
    margin-bottom: 12px;
    padding-bottom: 8px;
  }

  .export-page h3 {
    font-size: 14.5px;
    font-weight: 700;
    margin-top: 24px;
    margin-bottom: 8px;
  }

  /* heading → content: 제목 바로 다음 요소는 여백을 좁혀 "이 내용이 이 제목에
     속한다"는 시각적 소속감을 준다(section 사이 여백보다 확연히 작게). */
  .export-page h1 + *,
  .export-page h2 + *,
  .export-page h3 + * {
    margin-top: 0;
  }

  /* paragraph → paragraph: 본문 문단 사이 간격을 살짝 넓혀 문단 하나하나가
     또렷이 구분되면서도, 문서 전체 길이가 과도하게 늘어나지 않는 균형점을 잡는다. */
  .export-page p {
    margin: 10px 0 14px;
  }

  /* bold 강조: 기존엔 브라우저 기본 font-weight만으로 강조되어 본문과 명도 차이가
     작았다. 굵기를 한 단계 더 올리고 색을 살짝 밝혀 스캔 시(훑어볼 때) 눈에 띄게 한다. */
  .export-page strong,
  .export-page b {
    font-weight: 700;
    color: #ffffff;
  }

  /* ---- 표: 이 문서 유형에서 가장 자주 쓰이는 구성요소이므로 가장 공들여 다듬는다 ---- */
  .export-page table {
    font-size: 12.5px;
    margin: 6px 0 20px;
    /* heading → table 리듬: 바로 위가 heading이면 여백을 좁혀 표가 그 절에
       속한다는 소속감을 주고, table → following text는 아래 여백(margin-bottom)을
       충분히 주어 다음 문단과 명확히 분리한다. */
    table-layout: fixed;
    width: 100%;
  }

  .export-page h1 + table,
  .export-page h2 + table,
  .export-page h3 + table,
  .export-page h1 + p + table,
  .export-page h2 + p + table,
  .export-page h3 + p + table {
    margin-top: 4px;
  }

  .export-page th,
  .export-page td {
    padding: 9px 12px;
    line-height: 1.55;
    /* 표 안 긴 한글/영문 텍스트가 셀 폭을 넘길 때 줄바꿈되도록 강제해
       가로 스크롤/잘림 없이 A4 폭 안에서 항상 소화되게 한다. */
    overflow-wrap: break-word;
    word-break: keep-all;
  }

  .export-page th {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--text-primary);
    background: var(--bg-active);
    border-bottom: 2px solid var(--border-strong);
  }

  .export-page td {
    border-color: var(--border-subtle);
  }

  .export-page tbody tr:nth-child(even) td {
    background: rgba(255, 255, 255, 0.025);
  }

  /* ---- 블록인용/콜아웃: 절제된 강조 ---- */
  .export-page blockquote {
    padding: 12px 18px;
    margin: 14px 0 20px;
    line-height: 1.75;
  }

  .export-page blockquote.callout {
    padding: 13px 18px 15px;
  }

  .export-page .callout-title {
    font-size: 11.5px;
  }

  /* ---- 코드블록 ---- */
  .export-page pre {
    padding: 14px 18px;
    font-size: 12px;
    line-height: 1.7;
    margin: 8px 0 20px;
    /* 코드가 표 폭을 넘기지 않도록 하되, 긴 한 줄(URL 등)은 줄바꿈해 PDF에서
       가로로 잘리는 대신 다음 줄로 흘러가게 한다 — 화면 Preview는 스크롤이
       가능하지만 PDF는 그럴 수 없으므로 export 전용으로 줄바꿈을 켠다. */
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* ---- 이미지: 폭 초과 방지, 비율 유지, 중앙 정렬, 과도한 여백 방지 ---- */
  .export-page figure.doc-image {
    margin: 16px auto 20px;
  }

  .export-page figure.doc-image img {
    display: block;
    margin: 0 auto;
    max-width: 100%;
    max-height: 260mm;
    width: auto;
    height: auto;
    box-shadow: none;
  }

  .export-page figure.doc-image figcaption {
    margin-top: 10px;
    text-align: center;
  }

  /* ---- Mermaid: 중앙 정렬, 잘림/가로 오버플로우 방지, 큰 다이어그램은 폭에 맞춰 축소 ---- */
  .export-page .mermaid {
    margin: 16px 0 22px;
    padding: 16px;
    overflow: visible;
  }

  .export-page .mermaid svg {
    max-width: 100%;
    height: auto;
    /* 라벨이 많은 큰 다이어그램이 SVG 자체 intrinsic 크기를 유지하려 하면서
       A4 폭을 넘기는 경우가 있어, PDF에서는 항상 컨테이너 폭에 맞춰 축소되도록
       block 표시 + 폭 100%를 강제한다(라이브 Preview는 스크롤로 대응 가능하므로
       admin/styles.css의 기존 규칙은 건드리지 않는다). */
    display: block;
    width: 100%;
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
