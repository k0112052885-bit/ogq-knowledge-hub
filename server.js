const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { execFile } = require("child_process");

const ROOT_DIR = __dirname;
const DOCS_DIR = path.join(ROOT_DIR, "docs");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const ADMIN_DIR = path.join(ROOT_DIR, "admin");

const PORT = process.env.PORT || 7777;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

// 파일명이 docs 폴더를 벗어나지 못하도록 검증.
// 알파벳/숫자/하이픈/언더스코어만 허용하고 .md 확장자를 강제한다.
const SAFE_FILENAME_RE = /^[a-zA-Z0-9_-]+\.md$/;

function isSafeDocFilename(filename) {
  if (typeof filename !== "string") return false;
  if (!SAFE_FILENAME_RE.test(filename)) return false;
  // path.basename으로 정규화한 결과가 원본과 같아야 함 (../ 등 경로 조작 방지)
  return path.basename(filename) === filename;
}

function resolveDocPath(filename) {
  const resolved = path.resolve(DOCS_DIR, filename);
  if (!resolved.startsWith(DOCS_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(text);
}

function readRequestBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("요청 본문이 너무 큽니다."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// 정적 파일 서빙: baseDir 밖으로 나가는 경로 요청은 차단
function serveStatic(req, res, baseDir, urlPath) {
  const decodedPath = decodeURIComponent(urlPath);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const resolved = path.resolve(baseDir, relativePath);

  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.stat(resolved, (err, stats) => {
    if (err) {
      sendText(res, 404, "Not Found");
      return;
    }

    const filePath = stats.isDirectory() ? path.join(resolved, "index.html") : resolved;

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        sendText(res, 404, "Not Found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    });
  });
}

// ---------- API 핸들러 ----------

function getFrontMatterField(data, key, fallback) {
  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
}

function handleListDocs(req, res) {
  let matter, normalizeDate;
  try {
    matter = require("gray-matter");
    delete require.cache[require.resolve("./generate.js")];
    normalizeDate = require("./generate.js").normalizeDate;
  } catch (e) {
    sendJson(res, 500, { error: "필요한 모듈을 불러올 수 없습니다." });
    return;
  }

  fs.readdir(DOCS_DIR, (err, files) => {
    if (err) {
      sendJson(res, 500, { error: "docs 폴더를 읽을 수 없습니다." });
      return;
    }

    const docs = files
      .filter((f) => f.endsWith(".md"))
      .map((filename) => {
        const raw = fs.readFileSync(path.join(DOCS_DIR, filename), "utf-8");
        const { data } = matter(raw);
        return {
          filename,
          title: data.title || filename.replace(/\.md$/, ""),
          category: data.category || "기타",
          status: data.status || "",
          updated: normalizeDate(data.updated),
          order: typeof data.order === "number" ? data.order : 999,
        };
      })
      .sort((a, b) => a.order - b.order);

    sendJson(res, 200, docs);
  });
}

function slugifyTitle(title) {
  const ascii = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || "doc";
}

function formatYamlList(items) {
  if (!items.length) return "[]";
  return "\n" + items.map((t) => `  - ${formatYamlString(t)}`).join("\n");
}

// YAML 큰따옴표 문자열 값으로 안전하게 이스케이프 (colon, quote 등 특수문자 방어)
function formatYamlString(value) {
  return JSON.stringify(String(value));
}

async function handleCreateDoc(req, res) {
  let matter;
  try {
    matter = require("gray-matter");
  } catch (e) {
    sendJson(res, 500, { error: "gray-matter 모듈을 불러올 수 없습니다." });
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

  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) {
    sendJson(res, 400, { error: "title은 필수입니다." });
    return;
  }

  const category = typeof payload.category === "string" ? payload.category.trim() : "기타";
  const description = typeof payload.description === "string" ? payload.description.trim() : "";
  const status = ["draft", "review", "locked"].includes(payload.status)
    ? payload.status
    : "draft";
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  let existing = [];
  try {
    existing = fs
      .readdirSync(DOCS_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((filename) => {
        const raw = fs.readFileSync(path.join(DOCS_DIR, filename), "utf-8");
        const { data } = matter(raw);
        return { filename, order: typeof data.order === "number" ? data.order : 0 };
      });
  } catch (e) {
    sendJson(res, 500, { error: "docs 폴더를 읽을 수 없습니다." });
    return;
  }

  const maxOrder = existing.reduce((max, d) => Math.max(max, d.order), 0);
  const nextOrder = maxOrder + 1;
  const paddedOrder = String(nextOrder).padStart(2, "0");
  const slugHint = typeof payload.slug === "string" ? payload.slug.trim() : "";
  const slug = slugifyTitle(slugHint || title);
  let filename = `${paddedOrder}_${slug}.md`;

  // 동일 파일명이 이미 있으면 뒤에 번호를 붙여 충돌 방지
  let suffix = 2;
  const existingNames = new Set(existing.map((d) => d.filename));
  while (existingNames.has(filename)) {
    filename = `${paddedOrder}_${slug}_${suffix}.md`;
    suffix++;
  }

  const today = new Date().toISOString().slice(0, 10);
  const frontMatter = [
    "---",
    `title: ${formatYamlString(title)}`,
    `description: ${formatYamlString(description)}`,
    `category: ${formatYamlString(category)}`,
    `tags:${formatYamlList(tags)}`,
    `status: ${status}`,
    `order: ${nextOrder}`,
    `updated: ${today}`,
    "---",
    "",
    `# ${title}`,
    "",
    "",
  ].join("\n");

  const filePath = resolveDocPath(filename);
  if (!filePath) {
    sendJson(res, 400, { error: "생성된 파일명이 허용되지 않은 경로입니다." });
    return;
  }

  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFile(filePath, frontMatter, "utf-8", (err) => {
    if (err) {
      sendJson(res, 500, { error: "파일 생성에 실패했습니다." });
      return;
    }
    sendJson(res, 201, { ok: true, filename, content: frontMatter });
  });
}

function handleGetDoc(req, res, filename) {
  if (!isSafeDocFilename(filename)) {
    sendJson(res, 400, { error: "유효하지 않은 파일명입니다." });
    return;
  }
  const filePath = resolveDocPath(filename);
  if (!filePath) {
    sendJson(res, 400, { error: "허용되지 않은 경로입니다." });
    return;
  }

  fs.readFile(filePath, "utf-8", (err, content) => {
    if (err) {
      sendJson(res, 404, { error: "문서를 찾을 수 없습니다." });
      return;
    }
    sendJson(res, 200, { filename, content });
  });
}

async function handleSaveDoc(req, res, filename) {
  if (!isSafeDocFilename(filename)) {
    sendJson(res, 400, { error: "유효하지 않은 파일명입니다." });
    return;
  }
  const filePath = resolveDocPath(filename);
  if (!filePath) {
    sendJson(res, 400, { error: "허용되지 않은 경로입니다." });
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

  if (typeof payload.content !== "string") {
    sendJson(res, 400, { error: "content 필드가 필요합니다." });
    return;
  }

  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFile(filePath, payload.content, "utf-8", (err) => {
    if (err) {
      sendJson(res, 500, { error: "파일 저장에 실패했습니다." });
      return;
    }
    sendJson(res, 200, { ok: true, filename });
  });
}

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

  delete require.cache[require.resolve("./generate.js")];
  try {
    const { renderMarkdownPreview } = require("./generate.js");
    const html = renderMarkdownPreview(payload.content);
    sendJson(res, 200, { html });
  } catch (err) {
    sendJson(res, 500, { error: `미리보기 렌더링 실패: ${err.message}` });
  }
}

function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: ROOT_DIR, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || stdout.trim() || err.message));
        return;
      }
      // git push 등은 진행 메시지를 stdout이 아닌 stderr로 출력하는 경우가 많아 함께 반환
      resolve([stdout.trim(), stderr.trim()].filter(Boolean).join("\n"));
    });
  });
}

async function handleGitPush(req, res) {
  let body = "";
  try {
    body = await readRequestBody(req);
  } catch (e) {
    sendJson(res, 413, { error: e.message });
    return;
  }

  let payload = {};
  if (body) {
    try {
      payload = JSON.parse(body);
    } catch (e) {
      sendJson(res, 400, { error: "요청 본문이 올바른 JSON이 아닙니다." });
      return;
    }
  }

  const message =
    typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : `docs: update via admin (${new Date().toISOString().slice(0, 19).replace("T", " ")})`;

  try {
    const status = await runGit(["status", "--porcelain"]);
    if (!status) {
      sendJson(res, 200, { ok: true, message: "변경사항이 없어 커밋 없이 종료했습니다.", pushed: false });
      return;
    }

    await runGit(["add", "-A"]);
    await runGit(["commit", "-m", message]);
    const pushOutput = await runGit(["push"]);
    sendJson(res, 200, {
      ok: true,
      message: "커밋 후 push가 완료되었습니다.",
      detail: pushOutput,
      pushed: true,
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, message: `Git push 실패: ${err.message}` });
  }
}

function handleBuild(req, res) {
  // require 캐시를 지워 매 빌드마다 docs 최신 상태를 반영
  delete require.cache[require.resolve("./generate.js")];
  try {
    const { build } = require("./generate.js");
    build();
    sendJson(res, 200, { ok: true, message: "빌드가 완료되었습니다." });
  } catch (err) {
    sendJson(res, 500, { ok: false, message: `빌드 실패: ${err.message}` });
  }
}

// ---------- 라우팅 ----------

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  try {
    if (pathname === "/api/docs" && req.method === "GET") {
      handleListDocs(req, res);
      return;
    }
    if (pathname === "/api/docs" && req.method === "POST") {
      await handleCreateDoc(req, res);
      return;
    }

    const docMatch = pathname.match(/^\/api\/docs\/([^/]+)$/);
    if (docMatch && req.method === "GET") {
      handleGetDoc(req, res, decodeURIComponent(docMatch[1]));
      return;
    }
    if (docMatch && req.method === "POST") {
      await handleSaveDoc(req, res, decodeURIComponent(docMatch[1]));
      return;
    }

    if (pathname === "/api/build" && req.method === "POST") {
      handleBuild(req, res);
      return;
    }

    if (pathname === "/api/git-push" && req.method === "POST") {
      await handleGitPush(req, res);
      return;
    }

    if (pathname === "/api/preview" && req.method === "POST") {
      await handlePreview(req, res);
      return;
    }

    if (pathname === "/api/shutdown" && req.method === "POST") {
      sendJson(res, 200, { ok: true, message: "서버를 종료합니다." });
      // 응답을 먼저 내려보낸 뒤 서버를 종료
      res.on("finish", () => {
        server.close(() => process.exit(0));
        // 열려있는 연결이 있어도 일정 시간 뒤 강제 종료
        setTimeout(() => process.exit(0), 500).unref();
      });
      return;
    }

    if (pathname === "/admin" || pathname === "/admin/") {
      serveStatic(req, res, ADMIN_DIR, "/index.html");
      return;
    }
    if (pathname.startsWith("/admin/")) {
      serveStatic(req, res, ADMIN_DIR, pathname.replace(/^\/admin/, ""));
      return;
    }

    // 나머지는 dist/ 정적 사이트 서빙
    serveStatic(req, res, DIST_DIR, pathname);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`OGQ Knowledge Hub 로컬 서버가 실행 중입니다.`);
  console.log(`  사이트 보기: http://localhost:${PORT}/`);
  console.log(`  문서 편집:   http://localhost:${PORT}/admin`);
  console.log(`\n이 서버는 로컬 개발 전용입니다. 외부에 노출하지 마세요.`);
});
