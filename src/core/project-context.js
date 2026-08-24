import { state } from "./state.js";

// "지금 선택된 프로젝트"를 별도의 UI 상태로 새로 만들지 않고, 현재 에디터에 열려 있는
// 문서(state.currentFilename)가 속한 프로젝트를 durable metadata(문서 front matter의
// project/projectTitle 필드, state.docs에 이미 로드되어 있음)에서 그대로 읽어 판별한다.
// 열려 있는 문서가 단일 문서(project 없음)이거나 아무 문서도 열려 있지 않으면 null을
// 반환하고, 이 경우 Build/사이트 보기는 기존 전역 빌드 동작으로 그대로 동작한다.
export function getCurrentProjectContext() {
  if (!state.currentFilename) return null;
  const doc = state.docs.find((d) => d.filename === state.currentFilename);
  if (!doc || !doc.project) return null;
  return { projectId: doc.project, projectTitle: doc.projectTitle || doc.project };
}
