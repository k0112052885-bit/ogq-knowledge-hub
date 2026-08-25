import { el, state } from "../../core/state.js";
import { api } from "../../core/api.js";
import { toast, setStatus } from "../../core/toast.js";
import { openModal, closeModal } from "../../core/modal.js";
import { getCurrentProjectContext } from "../../core/project-context.js";

// ============================================================
// Build / Git push / Shutdown
// ============================================================
// 정상 Build는 항상 "현재 선택된 프로젝트"만 대상으로 한다 — 열려 있는 문서가 단일
// 문서이거나 아무 문서도 열려 있지 않으면(=프로젝트 컨텍스트가 없으면) 예전처럼 조용히
// Knowledge Hub 전체를 다시 빌드하지 않고, 사용자에게 프로젝트 문서를 먼저 선택하라고
// 안내한다. Knowledge Hub 전체를 빌드하려면 별도의 "전체 Build" 버튼(runFullBuild)을
// 명시적으로 눌러야 한다 — 두 동작을 하나의 버튼에 모호하게 겹쳐두지 않는다.
export async function runBuild(silent) {
  const projectContext = getCurrentProjectContext();
  if (!projectContext) {
    // 자동 Build(저장 시 autoBuild 옵션)로 호출된 경우엔 토스트를 띄우지 않는다 —
    // 단일 문서를 저장할 때마다 "Build 대상이 없습니다" 에러가 반복해서 뜨면 오히려
    // 방해가 된다. 사용자가 버튼을 직접 눌렀을 때(silent가 아닐 때)만 명확히 안내한다.
    if (!silent) {
      toast(
        "error",
        "Build 대상이 없습니다",
        "프로젝트에 속한 페이지를 선택한 후 Build 해주세요. 전체 문서를 빌드하려면 \"전체 Build\"를 사용하세요."
      );
    }
    return;
  }

  setStatus("빌드 중...", "busy");
  try {
    await api("/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "project", projectId: projectContext.projectId }),
    });
    setStatus("빌드 완료", "ok");
    const scopeLabel = `프로젝트 "${projectContext.projectTitle}"`;
    if (!silent) toast("success", "Build 성공", `${scopeLabel} 빌드 완료`);
    else toast("success", "자동 Build 완료", scopeLabel);
  } catch (e) {
    setStatus("빌드 실패", "error");
    toast("error", "Build 실패", e.message);
  }
}

// 전체 Build: 프로젝트 컨텍스트와 무관하게 항상 모든 프로젝트 + 단일 문서를 빌드한다.
// runBuild와 달리 "지금 무엇이 선택되어 있는지"를 전혀 참조하지 않는다 — 사용자가
// 명시적으로 "전체 Build"를 눌렀다는 의도 자체가 유일한 조건이다.
export async function runFullBuild() {
  setStatus("전체 Build 중...", "busy");
  try {
    await api("/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "full" }),
    });
    setStatus("전체 Build 완료", "ok");
    toast("success", "전체 Build 성공", "모든 프로젝트 + 단일 문서가 빌드되었습니다.");
  } catch (e) {
    setStatus("전체 Build 실패", "error");
    toast("error", "전체 Build 실패", e.message);
  }
}

// ============================================================
// Site Preview: dist/에 실제로 빌드되어 있는 프로젝트와 지금 에디터에서 선택된
// (열려 있는 문서 기준) 프로젝트가 다르면, 다른 프로젝트의 이전 빌드 결과를 조용히
// 열어버리지 않고 먼저 확인을 구한다. dist/build-meta.json은 build()가 매 빌드마다
// 새로 쓰는 "이번에 실제로 빌드된 대상" 기록이다.
// ============================================================
async function fetchBuildMeta() {
  try {
    const res = await fetch("/build-meta.json", { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function openSitePreview() {
  const projectContext = getCurrentProjectContext();
  const buildMeta = await fetchBuildMeta();

  // build-meta.json이 아직 없으면(한 번도 빌드된 적 없는 최초 상태) 빌드를 먼저 안내한다.
  // 프로젝트 컨텍스트가 없으면(단일 문서 열람 중/아무 문서도 안 열림) 자동으로 무엇을
  // 빌드할지 정할 수 없으므로, 여기서도 runBuild()를 그냥 부르지 않고 안내만 한다.
  if (!buildMeta) {
    if (!projectContext) {
      toast(
        "error",
        "아직 빌드된 사이트가 없습니다",
        "프로젝트 페이지를 선택해 Build 하거나, \"전체 Build\"로 전체 사이트를 먼저 만들어주세요."
      );
      return;
    }
    const shouldBuild = window.confirm(
      `아직 빌드된 사이트가 없습니다. 지금 프로젝트 "${projectContext.projectTitle}"를 빌드한 뒤 사이트를 열까요?`
    );
    if (!shouldBuild) return;
    await runBuild(true);
    window.open("/", "_blank", "noopener");
    return;
  }

  // scope까지 포함해 비교한다 — 전체 Build 직후 프로젝트를 선택하고 사이트 보기를
  // 누르는 경우(Test E)와, 프로젝트를 선택했지만 그 프로젝트로 빌드된 적은 없는
  // 경우(builtProjectId만 다른 경우)를 모두 "일치하지 않음"으로 취급해야 한다.
  const builtScope = buildMeta.scope || (buildMeta.projectId ? "project" : "full");
  const builtProjectId = buildMeta.projectId || null;
  const currentScope = projectContext ? "project" : null;
  const currentProjectId = projectContext ? projectContext.projectId : null;

  const isMatch = currentScope === "project" && builtScope === "project" && builtProjectId === currentProjectId;
  if (isMatch) {
    window.open("/", "_blank", "noopener");
    return;
  }

  const builtLabel = builtScope === "full" ? "전체 Build(Knowledge Hub 전체)" : `프로젝트 "${buildMeta.projectTitle}"`;

  if (!projectContext) {
    // 지금은 프로젝트 컨텍스트가 없다(단일 문서 열람 중/문서 미선택) — runBuild()가
    // 이 상태에서는 빌드를 거부하므로, 재빌드를 제안하는 대신 무엇이 열려 있는지와
    // 다르다는 사실만 알리고 이전 빌드를 그대로 연다.
    toast(
      "info",
      "다른 범위로 빌드된 사이트를 엽니다",
      `현재 빌드된 사이트는 ${builtLabel} 기준입니다. 프로젝트를 새로 빌드하려면 프로젝트 페이지를 먼저 선택하세요.`
    );
    window.open("/", "_blank", "noopener");
    return;
  }

  const currentLabel = `프로젝트 "${projectContext.projectTitle}"`;
  const shouldBuild = window.confirm(
    `현재 빌드된 사이트는 ${builtLabel} 기준입니다.\n` +
      `지금 선택된 ${currentLabel}로 다시 빌드한 뒤 사이트를 열까요?\n\n` +
      `취소를 누르면 이전 빌드(${builtLabel})를 그대로 엽니다.`
  );
  if (shouldBuild) {
    await runBuild(true);
  }
  window.open("/", "_blank", "noopener");
}

async function confirmGitPush() {
  const message = el.gitPushMessage.value.trim();
  el.btnConfirmGitPush.disabled = true;
  el.btnConfirmGitPush.textContent = "실행 중...";
  setStatus("Git push 진행 중...", "busy");
  try {
    const data = await api("/api/git-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    closeModal("gitPushModal");
    if (data.pushed) {
      setStatus("Git push 완료", "ok");
      toast("success", "Git Push 완료", data.detail || data.message);
    } else {
      setStatus("변경사항 없음", "ok");
      toast("info", data.message);
    }
  } catch (e) {
    setStatus("Git push 실패", "error");
    toast("error", "Git Push 실패", e.message);
  } finally {
    el.btnConfirmGitPush.disabled = false;
    el.btnConfirmGitPush.textContent = "Push 실행";
  }
}

async function confirmShutdown() {
  el.btnConfirmShutdown.disabled = true;
  el.btnConfirmShutdown.textContent = "종료 중...";
  try {
    await api("/api/shutdown", { method: "POST" });
  } catch (e) {
    // 서버가 응답 직후 종료되며 연결이 끊길 수 있으므로 에러 무시
  }
  document.body.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:100vh;' +
    'font-family:sans-serif;color:#8b909c;background:#0d0f13;font-size:14px;">' +
    "서버가 종료되었습니다. 창을 닫아도 됩니다.</div>";
}

export function initExport() {
  el.btnBuild.addEventListener("click", () => runBuild());
  el.btnFullBuild.addEventListener("click", () => runFullBuild());

  // 기본 앵커 탐색(href="/")을 막고, 먼저 빌드된 프로젝트와 지금 선택된 프로젝트가
  // 일치하는지 확인한 뒤 연다 — target="_blank"/href="/"는 JS 로드 실패 시를 위한
  // 순수 폴백으로 마크업에 그대로 남겨둔다.
  el.btnSitePreview.addEventListener("click", (e) => {
    e.preventDefault();
    openSitePreview();
  });

  el.btnGitPush.addEventListener("click", () => {
    el.gitPushMessage.value = "";
    openModal("gitPushModal");
  });
  el.btnConfirmGitPush.addEventListener("click", confirmGitPush);

  el.btnShutdown.addEventListener("click", () => openModal("shutdownModal"));
  el.btnConfirmShutdown.addEventListener("click", confirmShutdown);
}
