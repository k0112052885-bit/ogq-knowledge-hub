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

function renderNav(docs, currentSlug) {
  const links = docs
    .map((doc) => {
      const isActive = doc.slug === currentSlug;
      const badge = statusBadge(doc.status);
      return `<a href="${doc.outputName}"${
        isActive ? ' class="active"' : ""
      }>${escapeHtml(doc.title)}${badge}</a>`;
    })
    .join("\n      ");

  return `<nav class="tab-nav">\n      ${links}\n    </nav>`;
}

function stripLeadingH1(content) {
  return content.replace(/^\s*#\s+.+\r?\n/, "");
}

function renderPage(doc, docs) {
  const bodyHtml = md.render(stripLeadingH1(doc.content));
  const nav = renderNav(docs, doc.slug);
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
  <div class="page">
    ${nav}
    <main class="content">
      <div class="content-header">
        <h1>${escapeHtml(doc.title)}</h1>
        ${badge}
      </div>
      ${bodyHtml}
    </main>
    <footer class="page-footer">OGQ Knowledge Hub · 정적 문서 생성기로 생성됨</footer>
  </div>
</body>
</html>
`;
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

  console.log(`\n빌드 완료: 총 ${docs.length}개 문서 생성됨 → dist/`);
}

build();
