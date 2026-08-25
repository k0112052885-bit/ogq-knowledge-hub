const fs = require("fs");
const path = require("path");

const { sendJson, readRequestBody } = require("../utils/http.js");
const { isSafeDocFilename, resolveDocPath: resolveDocPathIn } = require("../utils/fs-safety.js");
const { replaceFrontMatterField } = require("../utils/yaml.js");
const projectRegistry = require("../utils/project-registry.js");

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
    // 파일 하나의 front matter가 깨져 있어도 그 문서만 건너뛰고 나머지 파일은
    // 계속 검사한다 — handleListDocs와 동일한 이유(손상된 문서 하나가 관련 없는
    // 다른 프로젝트의 rename/delete까지 막아서는 안 됨).
    let data;
    try {
      const raw = fs.readFileSync(path.join(docsDir, filename), "utf-8");
      data = matter(raw).data;
    } catch (e) {
      continue;
    }
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

  // 페이지가 아직 없는 프로젝트(레지스트리에만 존재)도 이름 변경이 가능해야 한다.
  // 문서가 하나라도 있으면 그 문서들의 projectTitle을 갱신하고, 레지스트리에도
  // 같은 id로 등록되어 있다면(문서 생성 후에도 정리하지 않았을 수 있으므로) 함께 갱신한다.
  const registryEntry = projectRegistry.renameProject(docsDir, projectId, projectTitle);

  if (!filenames.length && !registryEntry) {
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

  // 레지스트리에만 존재하는(페이지가 아직 없는) 빈 프로젝트도 삭제할 수 있어야 한다.
  const registryProjectsBefore = projectRegistry.readRegistry(docsDir);
  const existedInRegistry = registryProjectsBefore.some((p) => p.id === projectId);

  if (!filenames.length && !existedInRegistry) {
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

  projectRegistry.removeProject(docsDir, projectId);

  sendJson(res, 200, { ok: true, projectId, deletedFiles: deleted });
}

// POST /api/projects — 문서 없이 프로젝트(빈 폴더 개념)만 만든다.
// front matter가 존재할 문서가 아직 없으므로, 레지스트리(docs/.projects.json)에만 기록한다.
async function handleCreateProject(req, res, docsDir) {
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
  const projectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
  if (!projectId) {
    sendJson(res, 400, { error: "projectId는 필수입니다." });
    return;
  }

  try {
    projectRegistry.addProject(docsDir, {
      id: projectId,
      title: projectTitle,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    sendJson(res, 500, { error: "프로젝트 생성에 실패했습니다." });
    return;
  }

  sendJson(res, 201, { ok: true, projectId, projectTitle });
}

// GET /api/projects — 아직 페이지가 없는(레지스트리에만 존재하는) 프로젝트 목록.
// 페이지가 있는 프로젝트는 이미 GET /api/docs의 project/projectTitle 필드로
// 파생되므로 여기서 중복 반환하지 않는다 — 클라이언트가 두 출처를 project id 기준으로
// 병합한다.
function handleListEmptyProjects(req, res, docsDir) {
  try {
    const projects = projectRegistry.readRegistry(docsDir);
    sendJson(res, 200, projects);
  } catch (e) {
    sendJson(res, 500, { error: "프로젝트 목록을 불러올 수 없습니다." });
  }
}

module.exports = {
  handleRenamePage,
  handleDeletePage,
  findProjectPageFiles,
  handleRenameProject,
  handleDeleteProject,
  handleCreateProject,
  handleListEmptyProjects,
};
