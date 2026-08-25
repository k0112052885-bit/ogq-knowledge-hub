const fs = require("fs");
const path = require("path");

// docs/*.md의 project/projectTitle front matter는 지금까지 "프로젝트가 존재한다"는
// 사실 자체를 표현할 유일한 수단이었다 — 문서가 0개인 프로젝트는 front matter를 스캔하는
// 어디에서도 나타날 방법이 없었다(handleListDocs, findProjectPageFiles 모두 문서 파일을
// 순회하며 project 값을 모으는 방식). 그 결과 "프로젝트만 생성"이 불가능했고, UI는 항상
// 첫 페이지 문서를 함께 만들어야만 프로젝트를 표현할 수 있었다.
//
// 이 파일은 그 간극만 메우는 최소한의 durable 저장소다: docs/.projects.json에 "아직
// 페이지가 하나도 없는 프로젝트"만 기록한다. 페이지가 생기는 순간부터는 기존 방식(문서
// front matter 스캔)만으로 그 프로젝트가 정상적으로 나타나므로, 레지스트리에 남아있어도
// 무해하다(단순 중복 소스일 뿐 렌더링에 영향 없음 — 클라이언트는 항상 문서 기반 프로젝트와
// 레지스트리 기반 빈 프로젝트를 project id로 합쳐 하나의 프로젝트로 취급한다).
//
// 파일명이 ".json"이 아니라 ".md"만 스캔하는 기존 코드(handleListDocs, generate.js의
// loadDocs, findProjectPageFiles) 전부와 자동으로 격리되므로 기존 문서 목록/빌드 로직은
// 전혀 수정할 필요가 없다.
const REGISTRY_FILENAME = ".projects.json";

function registryPath(docsDir) {
  return path.join(docsDir, REGISTRY_FILENAME);
}

// 레지스트리가 없거나(아직 빈 프로젝트를 한 번도 만든 적 없음) 손상되었으면 빈 배열로
// 취급한다 — 이 파일은 보조 인덱스일 뿐이므로 읽기 실패가 앱 전체를 막아서는 안 된다.
function readRegistry(docsDir) {
  try {
    const raw = fs.readFileSync(registryPath(docsDir), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeRegistry(docsDir, projects) {
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(registryPath(docsDir), JSON.stringify(projects, null, 2) + "\n", "utf-8");
}

// 레지스트리에 프로젝트 하나를 추가한다. 같은 id가 이미 있으면 아무것도 하지 않는다
// (멱등 — 중복 생성 방지).
function addProject(docsDir, project) {
  const projects = readRegistry(docsDir);
  if (projects.some((p) => p.id === project.id)) return projects;
  projects.push(project);
  writeRegistry(docsDir, projects);
  return projects;
}

function removeProject(docsDir, projectId) {
  const projects = readRegistry(docsDir);
  const next = projects.filter((p) => p.id !== projectId);
  if (next.length !== projects.length) writeRegistry(docsDir, next);
  return next;
}

function renameProject(docsDir, projectId, projectTitle) {
  const projects = readRegistry(docsDir);
  const entry = projects.find((p) => p.id === projectId);
  if (!entry) return null;
  entry.title = projectTitle;
  writeRegistry(docsDir, projects);
  return entry;
}

module.exports = { readRegistry, addProject, removeProject, renameProject };
