const fs = require("fs");
const path = require("path");

const { sendJson, readRequestBody } = require("../utils/http.js");
const { isSafeDocFilename, resolveDocPath: resolveDocPathIn } = require("../utils/fs-safety.js");
const { asciiSlug, slugifyTitle } = require("../utils/slug.js");
const { formatYamlString, formatYamlList, normalizeImportedTags } = require("../utils/yaml.js");

const GENERATE_JS_PATH = path.join(__dirname, "..", "..", "generate.js");

function handleListDocs(req, res, docsDir) {
  let matter, normalizeDate;
  try {
    matter = require("gray-matter");
    delete require.cache[require.resolve(GENERATE_JS_PATH)];
    normalizeDate = require(GENERATE_JS_PATH).normalizeDate;
  } catch (e) {
    sendJson(res, 500, { error: "필요한 모듈을 불러올 수 없습니다." });
    return;
  }

  fs.readdir(docsDir, (err, files) => {
    if (err) {
      sendJson(res, 500, { error: "docs 폴더를 읽을 수 없습니다." });
      return;
    }

    const docs = files
      .filter((f) => f.endsWith(".md"))
      .map((filename) => {
        const raw = fs.readFileSync(path.join(docsDir, filename), "utf-8");
        const { data } = matter(raw);
        return {
          filename,
          title: data.title || filename.replace(/\.md$/, ""),
          category: data.category || "기타",
          status: data.status || "",
          updated: normalizeDate(data.updated),
          order: typeof data.order === "number" ? data.order : 999,
          // 다중 페이지 프로젝트 지원을 위한 선택 필드.
          // 기존 문서에는 없으므로 null로 반환되어 "단일 페이지 문서"로 취급된다.
          project: typeof data.project === "string" && data.project.trim() ? data.project.trim() : null,
          projectTitle:
            typeof data.projectTitle === "string" && data.projectTitle.trim()
              ? data.projectTitle.trim()
              : null,
          pageOrder: typeof data.pageOrder === "number" ? data.pageOrder : null,
        };
      })
      .sort((a, b) => a.order - b.order);

    sendJson(res, 200, docs);
  });
}

async function handleCreateDoc(req, res, docsDir) {
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
      .readdirSync(docsDir)
      .filter((f) => f.endsWith(".md"))
      .map((filename) => {
        const raw = fs.readFileSync(path.join(docsDir, filename), "utf-8");
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

  // 다중 페이지 프로젝트 지원을 위한 선택 필드. 값이 없으면 front matter에
  // 아예 쓰지 않아 기존 "단일 문서 생성"과 결과물이 동일하게 유지된다.
  const project = typeof payload.project === "string" && payload.project.trim() ? payload.project.trim() : "";
  const projectTitle =
    typeof payload.projectTitle === "string" && payload.projectTitle.trim()
      ? payload.projectTitle.trim()
      : "";
  const pageOrder = typeof payload.pageOrder === "number" ? payload.pageOrder : null;

  const today = new Date().toISOString().slice(0, 10);
  const frontMatterLines = [
    "---",
    `title: ${formatYamlString(title)}`,
    `description: ${formatYamlString(description)}`,
    `category: ${formatYamlString(category)}`,
    `tags:${formatYamlList(tags)}`,
    `status: ${status}`,
    `order: ${nextOrder}`,
    `updated: ${today}`,
  ];
  if (project) frontMatterLines.push(`project: ${formatYamlString(project)}`);
  if (projectTitle) frontMatterLines.push(`projectTitle: ${formatYamlString(projectTitle)}`);
  if (pageOrder !== null) frontMatterLines.push(`pageOrder: ${pageOrder}`);
  frontMatterLines.push("---", "", bodyContent);

  const frontMatter = frontMatterLines.join("\n");

  const filePath = resolveDocPathIn(docsDir, filename);
  if (!filePath) {
    sendJson(res, 400, { error: "생성된 파일명이 허용되지 않은 경로입니다." });
    return;
  }

  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFile(filePath, frontMatter, "utf-8", (err) => {
    if (err) {
      sendJson(res, 500, { error: "파일 생성에 실패했습니다." });
      return;
    }
    sendJson(res, 201, { ok: true, filename, content: frontMatter });
  });
}

function handleGetDoc(req, res, filename, docsDir) {
  if (!isSafeDocFilename(filename)) {
    sendJson(res, 400, { error: "유효하지 않은 파일명입니다." });
    return;
  }
  const filePath = resolveDocPathIn(docsDir, filename);
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

async function handleSaveDoc(req, res, filename, docsDir) {
  if (!isSafeDocFilename(filename)) {
    sendJson(res, 400, { error: "유효하지 않은 파일명입니다." });
    return;
  }
  const filePath = resolveDocPathIn(docsDir, filename);
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

  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFile(filePath, payload.content, "utf-8", (err) => {
    if (err) {
      sendJson(res, 500, { error: "파일 저장에 실패했습니다." });
      return;
    }
    sendJson(res, 200, { ok: true, filename });
  });
}

module.exports = { handleListDocs, handleCreateDoc, handleGetDoc, handleSaveDoc };
