// GET /api/docs가 반환하는 평평한 문서 목록을
// "프로젝트(다중 페이지)"와 "단일 페이지 문서"로 분리하는 순수 함수.
//
// 입력 docs 항목은 handleListDocs가 만드는 형태를 기대한다:
//   { filename, title, category, status, updated, order, project, projectTitle, pageOrder }
//
// project 필드가 없는(=null) 문서는 전부 standalonePages로 들어간다.
// project 필드가 있는 문서는 같은 project 값끼리 projects[].pages로 묶인다.
//
// 이 함수는 어떤 API 핸들러에서도 아직 호출되지 않는다 (Phase 2 구현 순서 2번).
// 데이터 모델과 그룹핑 로직만 미리 준비해두는 단계이며, 기존 GET /api/docs
// 응답이나 admin UI 동작에는 영향을 주지 않는다.
function groupIntoProjectsAndPages(docs) {
  const projectMap = new Map();
  const standalonePages = [];

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
    // 여러 페이지 중 하나라도 projectTitle을 지정했다면 그 값을 프로젝트 대표 제목으로 채택.
    // (아직 채택된 적 없고, 이 문서에 값이 있을 때만 갱신)
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

module.exports = { groupIntoProjectsAndPages };
