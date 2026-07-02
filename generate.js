const path = require("path");
const fs = require("fs-extra");
const matter = require("gray-matter");
const MarkdownIt = require("markdown-it");

const DOCS_DIR = path.join(__dirname, "docs");
const ASSETS_DIR = path.join(__dirname, "assets");
const DIST_DIR = path.join(__dirname, "dist");

const STATUS_LABELS = {
  draft: "초안",
  review: "검토중",
  locked: "확정",
};

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

// 체크박스([ ] / [x])를 실제 checkbox input으로 렌더링
md.core.ruler.after("inline", "task-checkbox", (state) => {
  state.tokens.forEach((token) => {
    if (token.type !== "inline" || !token.children) return;
    token.children.forEach((child) => {
      if (child.type !== "text") return;
      const match = child.content.match(/^\[( |x|X)\]\s+(.*)$/);
      if (!match) return;
      const checked = match[1].toLowerCase() === "x";
      child.type = "html_inline";
      child.content = `<input type="checkbox" disabled ${
        checked ? "checked" : ""
      }/> ${escapeHtml(match[2])}`;
    });
  });
});

// h2/h3에 id(slug) 부여 + TOC 수집용 heading-anchor 규칙
const headingSlugCounts = new Map();

function slugify(text) {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
  const count = headingSlugCounts.get(base) || 0;
  headingSlugCounts.set(base, count + 1);
  return count === 0 ? base || "section" : `${base}-${count}`;
}

md.core.ruler.push("heading-anchor", (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open") continue;
    if (!["h2", "h3"].includes(token.tag)) continue;
    const inline = tokens[i + 1];
    const text = inline ? inline.content : "";
    const slug = slugify(text);
    token.attrSet("id", slug);
    token.meta = { ...(token.meta || {}), slug, level: token.tag, text };
  }
});

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function statusBadge(status) {
  if (!status || !STATUS_LABELS[status]) return "";
  return `<span class="badge badge-${status}">${STATUS_LABELS[status]}</span>`;
}

function loadDocs() {
  const files = fs
    .readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const docs = files.map((file) => {
    const raw = fs.readFileSync(path.join(DOCS_DIR, file), "utf-8");
    const { data, content } = matter(raw);
    const slug = path.basename(file, ".md");
    const outputName = slug === "index" ? "index.html" : `${slug}.html`;

    return {
      slug,
      file,
      outputName,
      title: data.title || slug,
      status: data.status || "",
      order: typeof data.order === "number" ? data.order : 999,
      content,
    };
  });

  docs.sort((a, b) => a.order - b.order);
  return docs;
}

function renderSidebar(docs, currentSlug) {
  const items = docs
    .map((doc) => {
      const isActive = doc.slug === currentSlug;
      const badge = statusBadge(doc.status);
      return `<li><a href="${doc.outputName}"${
        isActive ? ' class="active" aria-current="page"' : ""
      }>${escapeHtml(doc.title)}${badge}</a></li>`;
    })
    .join("\n        ");

  return `<aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">OGQ Knowledge Hub</span>
        <button type="button" class="sidebar-close" id="sidebarClose" aria-label="사이드바 닫기">&times;</button>
      </div>
      <div class="sidebar-search">
        <input type="search" id="searchInput" placeholder="문서 검색..." autocomplete="off" />
        <ul id="searchResults" class="search-results hidden"></ul>
      </div>
      <nav class="sidebar-nav" aria-label="문서 목록">
        <ul>
        ${items}
        </ul>
      </nav>
    </aside>`;
}

function stripLeadingH1(content) {
  return content.replace(/^\s*#\s+.+\r?\n/, "");
}

function collectToc(content) {
  headingSlugCounts.clear();
  const tokens = md.parse(stripLeadingH1(content), {});
  const toc = [];
  tokens.forEach((token) => {
    if (token.type === "heading_open" && token.meta) {
      toc.push({
        level: token.meta.level,
        slug: token.meta.slug,
        text: token.meta.text,
      });
    }
  });
  return toc;
}

function renderToc(toc) {
  if (!toc.length) {
    return `<aside class="toc" id="toc"><p class="toc-empty">목차 없음</p></aside>`;
  }
  const items = toc
    .map(
      (item) =>
        `<li class="toc-item toc-${item.level}"><a href="#${item.slug}">${escapeHtml(
          item.text
        )}</a></li>`
    )
    .join("\n        ");

  return `<aside class="toc" id="toc">
      <div class="toc-title">이 문서에서</div>
      <ul class="toc-list">
        ${items}
      </ul>
    </aside>`;
}

function renderPager(docs, currentSlug) {
  const index = docs.findIndex((d) => d.slug === currentSlug);
  const prev = index > 0 ? docs[index - 1] : null;
  const next = index >= 0 && index < docs.length - 1 ? docs[index + 1] : null;

  if (!prev && !next) return "";

  const prevHtml = prev
    ? `<a class="doc-pager-link prev" href="${prev.outputName}">
        <span class="doc-pager-label">&larr; 이전 문서</span>
        <span class="doc-pager-title">${escapeHtml(prev.title)}</span>
      </a>`
    : "";

  const nextHtml = next
    ? `<a class="doc-pager-link next" href="${next.outputName}">
        <span class="doc-pager-label">다음 문서 &rarr;</span>
        <span class="doc-pager-title">${escapeHtml(next.title)}</span>
      </a>`
    : "";

  return `<nav class="doc-pager" aria-label="문서 이동">\n      ${prevHtml}\n      ${nextHtml}\n    </nav>`;
}

function renderPage(doc, docs) {
  headingSlugCounts.clear();
  const bodyHtml = md.render(stripLeadingH1(doc.content));
  const toc = collectToc(doc.content);
  const sidebar = renderSidebar(docs, doc.slug);
  const tocHtml = renderToc(toc);
  const pagerHtml = renderPager(docs, doc.slug);
  const badge = statusBadge(doc.status);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(doc.title)} · OGQ Knowledge Hub</title>
  <link rel="stylesheet" href="assets/style.css" />
</head>
<body>
  <div class="app-shell">
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    ${sidebar}
    <div class="main-column">
      <header class="mobile-topbar">
        <button type="button" class="icon-button" id="sidebarToggle" aria-label="문서 목록 열기">&#9776;</button>
        <span class="mobile-topbar-title">${escapeHtml(doc.title)}</span>
        <button type="button" class="icon-button" id="tocToggle" aria-label="목차 열기">&#9776;&#65039;</button>
      </header>
      <main class="content">
        <div class="content-header">
          <h1>${escapeHtml(doc.title)}</h1>
          ${badge}
        </div>
        <div class="markdown-body">
          ${bodyHtml}
        </div>
        ${pagerHtml}
      </main>
      <footer class="page-footer">OGQ Knowledge Hub · 정적 문서 생성기로 생성됨</footer>
    </div>
    ${tocHtml}
  </div>
  <script src="assets/search-index.js"></script>
  <script src="assets/main.js"></script>
</body>
</html>
`;
}

function buildSearchIndex(docs) {
  return docs.map((doc) => {
    const plainText = stripLeadingH1(doc.content)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#>*_`|~-]/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);

    return {
      title: doc.title,
      url: doc.outputName,
      status: doc.status,
      text: plainText,
    };
  });
}

function build() {
  fs.emptyDirSync(DIST_DIR);
  fs.copySync(ASSETS_DIR, path.join(DIST_DIR, "assets"));

  const docs = loadDocs();

  if (!docs.some((d) => d.slug === "index")) {
    throw new Error("docs/index.md 파일이 필요합니다.");
  }

  docs.forEach((doc) => {
    const html = renderPage(doc, docs);
    fs.writeFileSync(path.join(DIST_DIR, doc.outputName), html, "utf-8");
    console.log(`생성됨: dist/${doc.outputName}`);
  });

  const searchIndex = buildSearchIndex(docs);
  const searchIndexJs = `window.__SEARCH_INDEX__ = ${JSON.stringify(
    searchIndex
  )};\n`;
  fs.writeFileSync(
    path.join(DIST_DIR, "assets", "search-index.js"),
    searchIndexJs,
    "utf-8"
  );
  console.log("생성됨: dist/assets/search-index.js");

  console.log(`\n빌드 완료: 총 ${docs.length}개 문서 생성됨 → dist/`);
}

build();
