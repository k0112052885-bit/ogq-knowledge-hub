const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { execFile } = require("child_process");

const ROOT_DIR = __dirname;
const DOCS_DIR = path.join(ROOT_DIR, "docs");
const IMAGES_DIR = path.join(DOCS_DIR, "images");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const ADMIN_DIR = path.join(ROOT_DIR, "admin");

// .env 파일이 있으면 KEY=VALUE 형식만 최소 지원해 process.env에 주입한다.
// (외부 dotenv 의존성 없이, 이미 설정된 환경변수는 덮어쓰지 않음)
function loadDotEnv() {
  const envPath = path.join(ROOT_DIR, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const PORT = process.env.PORT || 7778;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

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

// 자주 쓰는 한글 카테고리를 의미 있는 영문 slug로 매핑.
// 제목/카테고리가 전부 한글이라 ASCII 필터링 후 빈 문자열이 될 때의 fallback으로 사용된다.
const CATEGORY_SLUG_MAP = {
  목표: "goal",
  전략: "strategy",
  기획: "plan",
  설계: "design",
  개발: "dev",
  운영: "ops",
  마케팅: "marketing",
  영업: "sales",
  회의록: "meeting",
  정책: "policy",
  가이드: "guide",
  기타: "doc",
};

function asciiSlug(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function categoryToSlug(category) {
  if (!category) return "";
  const trimmed = String(category).trim();
  if (CATEGORY_SLUG_MAP[trimmed]) return CATEGORY_SLUG_MAP[trimmed];
  return asciiSlug(trimmed);
}

// 제목 → 카테고리 → 생성 날짜 순으로 시도해 의미 있는 영문 slug를 만든다.
// 예: 제목 "마켓본부 운영"(한글만) + 카테고리 "목표" → "goal"
//     제목/카테고리 모두 매핑 실패 → "doc-0707"(월일) 같은 날짜 기반 fallback
function slugifyTitle(title, category) {
  const fromTitle = asciiSlug(title);
  if (fromTitle) return fromTitle;

  const fromCategory = categoryToSlug(category);
  if (fromCategory) return fromCategory;

  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `doc-${mm}${dd}`;
}

// "tags:" 뒤에 바로 붙일 수 있는 완전한 YAML 조각을 반환한다.
// 빈 배열이면 "tags: []"(콜론 뒤 공백 필수 - 없으면 YAML 파싱 에러 발생),
// 값이 있으면 "tags:\n  - ..." 형태의 블록 리스트를 반환한다.
function formatYamlList(items) {
  if (!items.length) return " []";
  return "\n" + items.map((t) => `  - ${formatYamlString(t)}`).join("\n");
}

// YAML 큰따옴표 문자열 값으로 안전하게 이스케이프 (colon, quote 등 특수문자 방어)
function formatYamlString(value) {
  return JSON.stringify(String(value));
}

// 붙여넣은 Front Matter의 tags 값(배열 또는 쉼표 구분 문자열)을 배열로 정규화
function normalizeImportedTags(tags) {
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

  // 붙여넣은 Markdown(payload.body)이 자체 Front Matter(---로 시작)를 포함하면
  // 미리 걷어내고, 그 안의 값을 폼에서 비워둔 필드의 보완값으로 사용한다.
  // 이렇게 하지 않으면 서버가 생성하는 Front Matter 뒤에 사용자가 붙여넣은
  // Front Matter가 그대로 본문으로 남아 이중 생성된다.
  let pastedData = {};
  let pastedBody = typeof payload.body === "string" ? payload.body : "";
  if (pastedBody.trim().startsWith("---")) {
    try {
      const parsed = matter(pastedBody);
      pastedData = parsed.data || {};
      pastedBody = parsed.content;
    } catch (e) {
      // Front Matter처럼 보이지만 파싱 실패 시 원문을 그대로 본문으로 사용
    }
  }

  const category =
    typeof payload.category === "string" && payload.category.trim()
      ? payload.category.trim()
      : typeof pastedData.category === "string" && pastedData.category.trim()
        ? pastedData.category.trim()
        : "기타";

  const description =
    typeof payload.description === "string" && payload.description.trim()
      ? payload.description.trim()
      : typeof pastedData.description === "string"
        ? pastedData.description.trim()
        : "";

  const status = ["draft", "review", "locked"].includes(payload.status)
    ? payload.status
    : ["draft", "review", "locked"].includes(pastedData.status)
      ? pastedData.status
      : "draft";

  const tags =
    Array.isArray(payload.tags) && payload.tags.length
      ? payload.tags.map((t) => String(t).trim()).filter(Boolean)
      : normalizeImportedTags(pastedData.tags);

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
  // slug를 직접 입력했다면 그 값을 그대로 사용(카테고리 fallback 없이),
  // 비워뒀다면 제목 → 카테고리 → 날짜 순으로 의미 있는 slug를 찾는다.
  const slug = slugHint ? asciiSlug(slugHint) || slugifyTitle(title, category) : slugifyTitle(title, category);
  let filename = `${paddedOrder}_${slug}.md`;

  // 동일 파일명이 이미 있으면 뒤에 번호를 붙여 충돌 방지
  let suffix = 2;
  const existingNames = new Set(existing.map((d) => d.filename));
  while (existingNames.has(filename)) {
    filename = `${paddedOrder}_${slug}_${suffix}.md`;
    suffix++;
  }

  // AI 문서 가져오기 등에서 본문(body)을 함께 보내면 그대로 사용하고,
  // 없으면 기존 "새 문서" 동작대로 제목만 있는 빈 본문을 생성한다.
  // pastedBody는 위에서 Front Matter가 이미 제거된 상태이므로 이중 생성되지 않는다.
  const hasCustomBody = pastedBody.trim() !== "";
  const bodyContent = hasCustomBody
    ? pastedBody.replace(/\r\n/g, "\n").trim() + "\n"
    : `# ${title}\n\n`;

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
    bodyContent,
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

// ---------- 이미지 업로드 ----------

let sharp = null;
try {
  sharp = require("sharp");
} catch (e) {
  // sharp 모듈이 없으면 리사이즈/재인코딩 없이 원본을 그대로 저장한다.
}

const IMAGE_MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// 원본이 이보다 크면 가로/세로 중 긴 변을 기준으로 축소한다 (비율 유지, 확대는 안 함).
const IMAGE_MAX_DIMENSION = 1920;
const IMAGE_JPEG_QUALITY = 85;
const IMAGE_WEBP_QUALITY = 85;
const IMAGE_PNG_QUALITY = 85;

// "YYYYMMDD-HHMMSS" 형태의 타임스탬프 (로컬 시간 기준)
function timestampSlug(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

// 큰 이미지는 긴 변 기준으로 축소하고 포맷별 품질로 재인코딩해 용량을 줄인다.
// sharp가 없거나 처리에 실패하면 원본 버퍼를 그대로 반환한다(업로드 자체는 계속 진행).
async function optimizeImageBuffer(buffer, mimeType) {
  if (!sharp) return buffer;
  try {
    const image = sharp(buffer);
    const meta = await image.metadata();
    const needsResize =
      meta.width && meta.height && Math.max(meta.width, meta.height) > IMAGE_MAX_DIMENSION;

    let pipeline = image;
    if (needsResize) {
      pipeline = pipeline.resize({
        width: meta.width >= meta.height ? IMAGE_MAX_DIMENSION : null,
        height: meta.height > meta.width ? IMAGE_MAX_DIMENSION : null,
        withoutEnlargement: true,
      });
    }

    if (mimeType === "image/jpeg") {
      pipeline = pipeline.jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true });
    } else if (mimeType === "image/webp") {
      pipeline = pipeline.webp({ quality: IMAGE_WEBP_QUALITY });
    } else if (mimeType === "image/png") {
      pipeline = pipeline.png({ quality: IMAGE_PNG_QUALITY, compressionLevel: 9 });
    }

    const optimized = await pipeline.toBuffer();
    // 재인코딩 결과가 원본보다 오히려 크면(이미 최적화된 작은 이미지 등) 원본을 유지한다.
    return optimized.length < buffer.length ? optimized : buffer;
  } catch (e) {
    return buffer;
  }
}

// 문서명(slug) 기반으로 안전한 이미지 파일명을 만든다.
// 예: docSlug="07_goal" → "07_goal-1.png", 중복 시 "07_goal-2.png"...
// docSlug가 없거나 slug화 후 빈 문자열이면 기존 타임스탬프 방식으로 fallback한다.
function buildImageFilename(docSlug, ext) {
  const base = docSlug ? asciiSlug(docSlug) : "";
  if (!base) {
    return `image-${timestampSlug(new Date())}.${ext}`;
  }

  let n = 1;
  let filename = `${base}-${n}.${ext}`;
  while (fs.existsSync(path.join(IMAGES_DIR, filename))) {
    n++;
    filename = `${base}-${n}.${ext}`;
  }
  return filename;
}

async function handleUploadImage(req, res) {
  let body;
  try {
    body = await readRequestBody(req, 20 * 1024 * 1024);
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

  const mimeType = typeof payload.mimeType === "string" ? payload.mimeType.toLowerCase() : "";
  const ext = IMAGE_MIME_EXT[mimeType];
  if (!ext) {
    sendJson(res, 400, { error: "지원하지 않는 이미지 형식입니다. (PNG/JPEG/WebP만 가능)" });
    return;
  }

  const dataUrlPrefix = /^data:[^;]+;base64,/;
  const rawData = typeof payload.data === "string" ? payload.data.replace(dataUrlPrefix, "") : "";
  if (!rawData) {
    sendJson(res, 400, { error: "이미지 데이터가 비어 있습니다." });
    return;
  }

  let buffer;
  try {
    buffer = Buffer.from(rawData, "base64");
  } catch (e) {
    sendJson(res, 400, { error: "이미지 데이터를 디코딩할 수 없습니다." });
    return;
  }
  if (!buffer.length) {
    sendJson(res, 400, { error: "이미지 데이터가 비어 있습니다." });
    return;
  }

  const docSlug =
    typeof payload.docSlug === "string" ? payload.docSlug.replace(/\.md$/i, "") : "";

  let optimized;
  try {
    optimized = await optimizeImageBuffer(buffer, mimeType);
  } catch (e) {
    optimized = buffer;
  }

  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const filename = buildImageFilename(docSlug, ext);
  const filePath = path.resolve(IMAGES_DIR, filename);
  if (!filePath.startsWith(IMAGES_DIR + path.sep)) {
    sendJson(res, 400, { error: "생성된 파일명이 허용되지 않은 경로입니다." });
    return;
  }

  fs.writeFile(filePath, optimized, (err) => {
    if (err) {
      sendJson(res, 500, { error: "이미지 저장에 실패했습니다." });
      return;
    }
    sendJson(res, 201, { ok: true, filename, path: `images/${filename}` });
  });
}

// ---------- AI 다이어그램 생성 ----------

const AI_DIAGRAM_MAX_INPUT_LENGTH = 4000;

const AI_DIAGRAM_SYSTEM_PROMPT = [
  "너는 텍스트를 Mermaid 다이어그램 코드로 변환하는 도구다.",
  "사용자가 준 문장/구조 설명을 가장 적절한 Mermaid 다이어그램 종류(flowchart, sequenceDiagram, classDiagram 등)로 표현하라.",
  "flowchart를 쓸 경우 방향은 LR을 기본으로 하되, 내용상 TD가 더 적합하면 TD를 써도 된다.",
  "노드 라벨과 텍스트는 입력 언어(주로 한국어)를 그대로 유지하라.",
  "응답은 오직 Mermaid 코드만 반환하라. 코드 펜스(```)나 설명 문장, 인사말을 절대 포함하지 마라.",
  "첫 줄은 반드시 다이어그램 타입 키워드(flowchart, sequenceDiagram 등)로 시작해야 한다.",
].join(" ");

// 모델이 코드펜스나 설명을 덧붙여 응답하는 경우를 방어적으로 정리해
// 순수 Mermaid 코드만 남긴다.
function extractMermaidCode(raw) {
  let text = String(raw || "").trim();

  const fenceMatch = text.match(/```(?:mermaid)?\r?\n([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  return text;
}

async function callOpenAiForDiagram(text) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: AI_DIAGRAM_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = (data && data.error && data.error.message) || `OpenAI API 오류 (HTTP ${response.status})`;
    throw new Error(message);
  }

  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error("OpenAI 응답에서 다이어그램 코드를 찾을 수 없습니다.");
  }
  return content;
}

async function handleAiDiagram(req, res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 500, {
      error: "OPENAI_API_KEY가 설정되지 않았습니다. 프로젝트 루트에 .env 파일을 만들고 OPENAI_API_KEY=sk-... 를 추가한 뒤 서버를 재시작하세요.",
    });
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

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) {
    sendJson(res, 400, { error: "변환할 텍스트가 비어 있습니다." });
    return;
  }
  if (text.length > AI_DIAGRAM_MAX_INPUT_LENGTH) {
    sendJson(res, 400, { error: `선택한 텍스트가 너무 깁니다. (최대 ${AI_DIAGRAM_MAX_INPUT_LENGTH}자)` });
    return;
  }

  try {
    const raw = await callOpenAiForDiagram(text);
    const code = extractMermaidCode(raw);
    if (!code) {
      sendJson(res, 502, { error: "AI가 빈 응답을 반환했습니다. 다시 시도해주세요." });
      return;
    }
    sendJson(res, 200, { ok: true, code });
  } catch (err) {
    sendJson(res, 502, { error: `AI 다이어그램 생성 실패: ${err.message}` });
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

    if (pathname === "/api/images" && req.method === "POST") {
      await handleUploadImage(req, res);
      return;
    }

    if (pathname === "/api/ai-diagram" && req.method === "POST") {
      await handleAiDiagram(req, res);
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

    // admin/app.js가 ES 모듈로 분리되어 /src 아래 파일들을 상대 경로로 import하므로
    // 브라우저가 직접 요청할 수 있도록 정적 서빙 경로를 추가한다 (ADMIN_DIR과 동일한 패턴).
    if (pathname.startsWith("/src/")) {
      serveStatic(req, res, ROOT_DIR, pathname);
      return;
    }

    // /admin 미리보기에서 방금 업로드한 이미지를 바로 볼 수 있도록
    // docs/images를 /images/ 경로로 직접 서빙 (dist/images는 build 후에만 최신 상태가 됨)
    if (pathname.startsWith("/images/")) {
      serveStatic(req, res, IMAGES_DIR, pathname.replace(/^\/images/, ""));
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
