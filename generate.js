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

// ```mermaid 코드블록을 <div class="mermaid">로 변환 (mermaid.js가 클라이언트에서 렌더링)
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = token.info.trim().toLowerCase();
  if (info === "mermaid") {
    return `<div class="mermaid">\n${token.content}</div>\n`;
  }
  return defaultFence
    ? defaultFence(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
};

// 이미지 단독 문단(<p>이미지만</p>)은 감싸는 <p>를 제거해
// <figure>(block 요소)가 <p> 안에 중첩되지 않도록 함
md.core.ruler.push("image-figure-unwrap", (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "paragraph_open") continue;
    const inline = tokens[i + 1];
    const close = tokens[i + 2];
    if (
      inline &&
      inline.type === "inline" &&
      close &&
      close.type === "paragraph_close" &&
      inline.children.length === 1 &&
      inline.children[0].type === "image"
    ) {
      tokens[i].hidden = true;
      close.hidden = true;
    }
  }
});

// 이미지를 <figure>로 감싸고 alt 텍스트를 캡션으로 표시
const defaultImageRender =
  md.renderer.rules.image ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const altIdx = token.attrIndex("alt");
  const alt = altIdx >= 0 ? token.attrs[altIdx][1] : "";
  const imgHtml = defaultImageRender(tokens, idx, options, env, self);
  const caption = alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : "";
  return `<figure class="doc-image">${imgHtml}${caption}</figure>`;
};

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

// > [!NOTE] / [!TIP] / [!WARNING] / [!DANGER] blockquote를 callout 박스로 변환
const CALLOUT_TYPES = {
  note: { label: "Note", icon: "&#8505;" },
  tip: { label: "Tip", icon: "&#128161;" },
  warning: { label: "Warning", icon: "&#9888;" },
  danger: { label: "Danger", icon: "&#128680;" },
};

md.core.ruler.push("callout", (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "blockquote_open") continue;

    // blockquote 내부의 첫 inline 토큰 찾기 (blockquote_open -> paragraph_open -> inline)
    let inlineIdx = -1;
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].type === "blockquote_close") break;
      if (tokens[j].type === "inline") {
        inlineIdx = j;
        break;
      }
    }
    if (inlineIdx === -1) continue;

    const inlineToken = tokens[inlineIdx];
    const firstChild = inlineToken.children && inlineToken.children[0];
    if (!firstChild || firstChild.type !== "text") continue;

    const match = firstChild.content.match(/^\[!(NOTE|TIP|WARNING|DANGER)\]\s*/i);
    if (!match) continue;

    const type = match[1].toLowerCase();
    const meta = CALLOUT_TYPES[type];
    if (!meta) continue;

    // 매칭된 마커 텍스트 제거 (뒤에 남는 공백/줄바꿈용 softbreak도 정리)
    firstChild.content = firstChild.content.slice(match[0].length);
    if (firstChild.content === "" && inlineToken.children[1] && inlineToken.children[1].type === "softbreak") {
      inlineToken.children.splice(0, 2);
    } else if (firstChild.content === "") {
      inlineToken.children.splice(0, 1);
    }

    tokens[i].attrJoin("class", `callout callout-${type}`);
    tokens[i].meta = { ...(tokens[i].meta || {}), calloutType: type, calloutMeta: meta };
  }
});

md.renderer.rules.blockquote_open = (tokens, idx) => {
  const token = tokens[idx];
  const classAttr = token.attrGet("class");
  if (token.meta && token.meta.calloutType) {
    const { label, icon } = token.meta.calloutMeta;
    return `<blockquote class="${classAttr}">\n<div class="callout-title"><span class="callout-icon">${icon}</span>${label}</div>\n`;
  }
  return classAttr ? `<blockquote class="${classAttr}">\n` : "<blockquote>\n";
};

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

const DEFAULT_CATEGORY = "기타";

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeDate(value) {
  if (!value) return "";
  // gray-matter가 YAML 날짜를 Date 객체로 파싱하는 경우가 있어 문자열로 통일
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
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
      description: data.description || "",
      category: data.category ? String(data.category).trim() : DEFAULT_CATEGORY,
      tags: normalizeTags(data.tags),
      status: data.status || "",
      order: typeof data.order === "number" ? data.order : 999,
      updated: normalizeDate(data.updated),
      content,
    };
  });

  docs.sort((a, b) => a.order - b.order);
  return docs;
}

function groupByCategory(docs) {
  const groups = new Map();
  docs.forEach((doc) => {
    if (!groups.has(doc.category)) groups.set(doc.category, []);
    groups.get(doc.category).push(doc);
  });
  return Array.from(groups.entries()).map(([category, items]) => ({
    category,
    items,
  }));
}

function renderSidebar(docs, currentSlug) {
  const groups = groupByCategory(docs);

  const groupsHtml = groups
    .map((group) => {
      const items = group.items
        .map((doc) => {
          const isActive = doc.slug === currentSlug;
          const badge = statusBadge(doc.status);
          return `<li><a href="${doc.outputName}"${
            isActive ? ' class="active" aria-current="page"' : ""
          }>${escapeHtml(doc.title)}${badge}</a></li>`;
        })
        .join("\n            ");

      const hasActive = group.items.some((doc) => doc.slug === currentSlug);

      return `<li class="sidebar-group${hasActive ? " open" : ""}">
          <button type="button" class="sidebar-group-toggle" aria-expanded="${
            hasActive ? "true" : "false"
          }">
            <span class="sidebar-group-arrow">&#9656;</span>
            <span class="sidebar-group-label">${escapeHtml(group.category)}</span>
          </button>
          <ul class="sidebar-group-items">
            ${items}
          </ul>
        </li>`;
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
        <ul class="sidebar-groups">
        ${groupsHtml}
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

function renderTags(tags) {
  if (!tags.length) return "";
  const items = tags
    .map((tag) => `<span class="tag-pill">#${escapeHtml(tag)}</span>`)
    .join("\n          ");
  return `<div class="doc-tags">\n          ${items}\n        </div>`;
}

function renderUpdated(updated) {
  if (!updated) return "";
  return `<div class="doc-updated">
          <span class="doc-updated-label">마지막 수정:</span>
          <span class="doc-updated-date">${escapeHtml(updated)}</span>
        </div>`;
}

const MERMAID_CDN_URL =
  "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";

function renderPage(doc, docs) {
  headingSlugCounts.clear();
  const bodyHtml = md.render(stripLeadingH1(doc.content));
  const toc = collectToc(doc.content);
  const sidebar = renderSidebar(docs, doc.slug);
  const tocHtml = renderToc(toc);
  const pagerHtml = renderPager(docs, doc.slug);
  const badge = statusBadge(doc.status);
  const tagsHtml = renderTags(doc.tags);
  const updatedHtml = renderUpdated(doc.updated);
  const hasMermaid = /```mermaid/.test(doc.content);
  const mermaidScript = hasMermaid
    ? `<script src="${MERMAID_CDN_URL}"></script>\n  `
    : "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(doc.title)} · OGQ Knowledge Hub</title>
  <link rel="stylesheet" href="assets/style.css" />
  ${mermaidScript}</head>
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
        ${updatedHtml}
        ${tagsHtml}
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
      description: doc.description,
      category: doc.category,
      tags: doc.tags,
      url: doc.outputName,
      status: doc.status,
      updated: doc.updated,
      text: plainText,
    };
  });
}

function buildSidebarData(docs) {
  return groupByCategory(docs).map((group) => ({
    category: group.category,
    items: group.items.map((doc) => ({
      title: doc.title,
      url: doc.outputName,
      status: doc.status,
      tags: doc.tags,
      order: doc.order,
    })),
  }));
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

  fs.writeFileSync(
    path.join(DIST_DIR, "search-index.json"),
    JSON.stringify(searchIndex, null, 2),
    "utf-8"
  );
  console.log("생성됨: dist/search-index.json");

  const sidebarData = buildSidebarData(docs);
  fs.writeFileSync(
    path.join(DIST_DIR, "sidebar.json"),
    JSON.stringify(sidebarData, null, 2),
    "utf-8"
  );
  console.log("생성됨: dist/sidebar.json");

  console.log(`\n빌드 완료: 총 ${docs.length}개 문서 생성됨 → dist/`);
}

build();
