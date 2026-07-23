const fs = require("fs");
const path = require("path");

const { sendJson, readRequestBody } = require("../utils/http.js");
const { isSafeDocFilename, resolveDocPath: resolveDocPathIn } = require("../utils/fs-safety.js");
const { replaceFrontMatterField } = require("../utils/yaml.js");

async function handleRenamePage(req, res, filename, docsDir) {
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

  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) {
    sendJson(res, 400, { error: "title은 필수입니다." });
    return;
  }

  fs.readFile(filePath, "utf-8", (readErr, content) => {
    if (readErr) {
      sendJson(res, 404, { error: "문서를 찾을 수 없습니다." });
      return;
    }

    const updated = replaceFrontMatterField(content, "title", title);
    if (updated === null) {
      sendJson(res, 500, { error: "문서의 title 필드를 찾을 수 없습니다." });
      return;
    }

    fs.writeFile(filePath, updated, "utf-8", (writeErr) => {
      if (writeErr) {
        sendJson(res, 500, { error: "제목 변경에 실패했습니다." });
        return;
      }
      sendJson(res, 200, { ok: true, filename, title });
    });
  });
}

async function handleDeletePage(req, res, filename, docsDir) {
  if (!isSafeDocFilename(filename)) {
    sendJson(res, 400, { error: "유효하지 않은 파일명입니다." });
    return;
  }
  const filePath = resolveDocPathIn(docsDir, filename);
  if (!filePath) {
    sendJson(res, 400, { error: "허용되지 않은 경로입니다." });
    return;
  }

  fs.unlink(filePath, (err) => {
    if (err) {
      if (err.code === "ENOENT") {
        sendJson(res, 404, { error: "문서를 찾을 수 없습니다." });
        return;
      }
      sendJson(res, 500, { error: "문서 삭제에 실패했습니다." });
      return;
    }
    sendJson(res, 200, { ok: true, filename });
  });
}

// project id를 가진 모든 문서 파일명을 찾는다 (handleListDocs와 동일한 방식으로 docs/ 전체를 스캔).
function findProjectPageFiles(matter, docsDir, projectId) {
  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"));
  const matches = [];
  for (const filename of files) {
    const raw = fs.readFileSync(path.join(docsDir, filename), "utf-8");
    const { data } = matter(raw);
    if (typeof data.project === "string" && data.project.trim() === projectId) {
      matches.push(filename);
    }
  }
  return matches;
}

async function handleRenameProject(req, res, projectId, docsDir) {
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

  const projectTitle = typeof payload.projectTitle === "string" ? payload.projectTitle.trim() : "";
  if (!projectTitle) {
    sendJson(res, 400, { error: "projectTitle은 필수입니다." });
    return;
  }

  let filenames;
  try {
    filenames = findProjectPageFiles(matter, docsDir, projectId);
  } catch (e) {
    sendJson(res, 500, { error: "docs 폴더를 읽을 수 없습니다." });
    return;
  }

  if (!filenames.length) {
    sendJson(res, 404, { error: "해당 프로젝트를 찾을 수 없습니다." });
    return;
  }

  try {
    for (const filename of filenames) {
      const filePath = resolveDocPathIn(docsDir, filename);
      if (!filePath) continue;
      const content = fs.readFileSync(filePath, "utf-8");
      const updated = replaceFrontMatterField(content, "projectTitle", projectTitle);
      if (updated !== null) {
        fs.writeFileSync(filePath, updated, "utf-8");
      }
    }
  } catch (e) {
    sendJson(res, 500, { error: "프로젝트 이름 변경에 실패했습니다." });
    return;
  }

  sendJson(res, 200, { ok: true, projectId, projectTitle, updatedFiles: filenames });
}

async function handleDeleteProject(req, res, projectId, docsDir) {
  let matter;
  try {
    matter = require("gray-matter");
  } catch (e) {
    sendJson(res, 500, { error: "gray-matter 모듈을 불러올 수 없습니다." });
    return;
  }

  let filenames;
  try {
    filenames = findProjectPageFiles(matter, docsDir, projectId);
  } catch (e) {
    sendJson(res, 500, { error: "docs 폴더를 읽을 수 없습니다." });
    return;
  }

  if (!filenames.length) {
    sendJson(res, 404, { error: "해당 프로젝트를 찾을 수 없습니다." });
    return;
  }

  const deleted = [];
  try {
    for (const filename of filenames) {
      const filePath = resolveDocPathIn(docsDir, filename);
      if (!filePath) continue;
      fs.unlinkSync(filePath);
      deleted.push(filename);
    }
  } catch (e) {
    sendJson(res, 500, { error: `프로젝트 삭제 중 일부 파일 삭제에 실패했습니다. (삭제됨: ${deleted.join(", ")})` });
    return;
  }

  sendJson(res, 200, { ok: true, projectId, deletedFiles: deleted });
}

module.exports = {
  handleRenamePage,
  handleDeletePage,
  findProjectPageFiles,
  handleRenameProject,
  handleDeleteProject,
};
