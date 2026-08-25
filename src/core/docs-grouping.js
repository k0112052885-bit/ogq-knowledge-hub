// GET /api/docs가 반환하는 평평한 문서 목록을
// "프로젝트(다중 페이지)"와 "단일 페이지 문서"로 분리하는 순수 함수.
//
// server/utils/docs-grouping.js와 동일한 로직의 브라우저(ESM)용 사본이다.
// server.js는 CommonJS(require)를 쓰고 admin/app.js는 브라우저 ES 모듈이라
// 번들러 없이는 파일 하나를 공유할 수 없어, 그로우핑 규칙만 그대로 복제했다.
// 두 파일 중 하나를 수정하면 다른 쪽도 함께 맞춰야 한다.
//
// project 필드가 없는(=null) 문서는 전부 standalonePages로 들어간다.
// project 필드가 있는 문서는 같은 project 값끼리 projects[].pages로 묶인다.
//
// emptyProjects(선택): GET /api/projects가 반환하는, 아직 페이지가 하나도 없는
// 프로젝트 목록({ id, title })이다. "+ 새 프로젝트"가 문서를 만들지 않고 프로젝트만
// 등록할 수 있게 되면서, docs만 스캔해서는 그런 프로젝트가 사이드바에 전혀 나타나지
// 않는다 — 여기서 먼저 pages: []로 projectMap에 심어두고, docs 순회 결과가 있으면
// 그 위에 페이지가 채워지는 방식으로 두 출처를 하나의 프로젝트 목록으로 합친다.
export function groupIntoProjectsAndPages(docs, emptyProjects = []) {
  const projectMap = new Map();
  const standalonePages = [];

  emptyProjects.forEach((project) => {
    if (!project || !project.id) return;
    projectMap.set(project.id, {
      id: project.id,
      title: project.title || project.id,
      pages: [],
    });
  });

  docs.forEach((doc) => {
    if (!doc.project) {
      standalonePages.push(doc);
      return;
    }

    if (!projectMap.has(doc.project)) {
      projectMap.set(doc.project, {
        id: doc.project,
        title: doc.projectTitle || doc.project,
        pages: [],
      });
    }

    const project = projectMap.get(doc.project);
    if (!doc.projectTitle) {
      // no-op: 이 문서엔 명시적 제목이 없음
    } else if (project.title === project.id) {
      project.title = doc.projectTitle;
    }

    project.pages.push(doc);
  });

  const projects = Array.from(projectMap.values()).map((project) => ({
    ...project,
    pages: sortPages(project.pages),
  }));

  return {
    projects,
    standalonePages: sortPages(standalonePages),
  };
}

// pageOrder가 있으면 그 값을, 없으면 전역 order를 기준으로 정렬한다.
function sortPages(pages) {
  return [...pages].sort((a, b) => {
    const aKey = typeof a.pageOrder === "number" ? a.pageOrder : a.order;
    const bKey = typeof b.pageOrder === "number" ? b.pageOrder : b.order;
    return aKey - bKey;
  });
}
