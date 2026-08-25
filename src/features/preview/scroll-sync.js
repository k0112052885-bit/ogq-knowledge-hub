import { el } from "../../core/state.js";
import { onEditorScroll, getEditorScrollRatio } from "../editor/editor-core.js";

// 에디터(Markdown 원문) 스크롤 위치를 Preview(렌더된 HTML)로 단방향 동기화한다.
// 원문 줄 수와 렌더된 HTML 높이가 서로 다르므로 scrollTop을 그대로 맞추지 않고,
// "에디터를 얼마나 스크롤했는지" 비율(0~1)을 구해 Preview의 스크롤 가능 범위에
// 그대로 적용한다 — 문서 길이/섹션 밀도가 다른 문서에서도 상단/중간/하단이
// 대략적으로 대응되도록 하는 가장 단순하고 안정적인 방법이다.
//
// 단방향인 이유: Preview는 렌더링마다 innerHTML이 통째로 교체되는 데다(preview.js),
// 사용자가 Preview를 직접 스크롤하는 경우(예: 렌더된 다이어그램/표를 살펴보는 중)까지
// 에디터를 따라 움직이면 오히려 방해가 된다("Preview를 수동으로 스크롤해도 흔들리면
// 안 된다" 요구사항). Preview → Editor 동기화는 만들지 않는다.
let isSyncingFromEditor = false;

function applyPreviewScrollRatio(ratio) {
  const body = el.previewBody;
  const maxScroll = Math.max(body.scrollHeight - body.clientHeight, 0);
  if (maxScroll <= 0) return;

  isSyncingFromEditor = true;
  body.scrollTop = ratio * maxScroll;
  // 다음 프레임에 플래그를 내려, 이 스크롤이 만든 자체 'scroll' 이벤트(있다면)가
  // 혹시라도 다른 리스너에 의해 되먹임되지 않도록 짧게 보호한다. Preview 쪽에는
  // 현재 별도 scroll 리스너가 없어 실질적인 루프 위험은 없지만, 이후 누군가
  // Preview→Editor 동기화를 추가하더라도 안전하도록 방어적으로 남겨둔다.
  requestAnimationFrame(() => {
    isSyncingFromEditor = false;
  });
}

let pendingFrame = null;

function scheduleSync() {
  // rAF로 묶어 스크롤 이벤트가 프레임당 여러 번 와도 계산/DOM 쓰기를 한 번만 한다
  // (빠르게 스크롤할 때 버벅임/지터를 방지).
  if (pendingFrame !== null) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null;
    applyPreviewScrollRatio(getEditorScrollRatio());
  });
}

export function initPreviewScrollSync() {
  onEditorScroll(scheduleSync);
}

// 문서를 새로 열었을 때(에디터 내용이 통째로 바뀌었을 때) 이전 문서의 스크롤 위치가
// 남아있지 않도록 Preview를 맨 위로 되돌린다. 새 Preview가 비동기로 렌더링되기
// 때문에(preview.js의 300ms 디바운스 + fetch), 실제 DOM 교체가 끝난 뒤 호출되어야
// 하는 함수이며 openDoc 쪽에서 문서 로드 직후 호출한다.
export function resetPreviewScroll() {
  el.previewBody.scrollTop = 0;
}

// (참고용) 다른 모듈이 "지금 에디터가 유발한 동기화 중인지" 확인할 수 있게 export한다.
// 현재는 사용처가 없지만, Preview 쪽에 향후 스크롤 리스너가 생길 경우를 위해 남겨둔다.
export function isPreviewSyncingFromEditor() {
  return isSyncingFromEditor;
}
