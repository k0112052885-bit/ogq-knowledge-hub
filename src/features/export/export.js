import { el, state } from "../../core/state.js";
import { api } from "../../core/api.js";
import { toast, setStatus } from "../../core/toast.js";
import { openModal, closeModal } from "../../core/modal.js";
import { getCurrentProjectContext } from "../../core/project-context.js";

// ============================================================
// Build / Git push / Shutdown
// ============================================================
// 현재 열려 있는 문서가 속한 프로젝트가 있으면 그 프로젝트로 범위를 한정해 빌드한다
// (dist/에는 그 프로젝트 문서만 남는다). 열려 있는 문서가 단일 문서이거나 아무 문서도
// 열려 있지 않으면 projectId 없이 기존과 동일한 전역 빌드로 동작한다.
export async function runBuild(silent) {
  const projectContext = getCurrentProjectContext();
  setStatus("빌드 중...", "busy");
  try {
    const data = await api("/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: projectContext ? projectContext.projectId : null }),
    });
    setStatus("빌드 완료", "ok");
    const scopeLabel = projectContext ? `프로젝트 "${projectContext.projectTitle}"` : "전체 문서";
    if (!silent) toast("success", "Build 성공", `${scopeLabel} 빌드 완료`);
    else toast("success", "자동 Build 완료", scopeLabel);
  } catch (e) {
    setStatus("빌드 실패", "error");
    toast("error", "Build 실패", e.message);
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
  if (!buildMeta) {
    const shouldBuild = window.confirm(
      "아직 빌드된 사이트가 없습니다. 지금 Build를 실행한 뒤 사이트를 열까요?"
    );
    if (!shouldBuild) return;
    await runBuild(true);
    window.open("/", "_blank", "noopener");
    return;
  }

  const builtProjectId = buildMeta.projectId || null;
  const currentProjectId = projectContext ? projectContext.projectId : null;

  if (builtProjectId === currentProjectId) {
    window.open("/", "_blank", "noopener");
    return;
  }

  // 선택된 프로젝트(또는 전역)와 dist/에 실제 빌드된 프로젝트(또는 전역)가 서로 다른 경우.
  const builtLabel = buildMeta.projectTitle ? `프로젝트 "${buildMeta.projectTitle}"` : "전체 문서";
  const currentLabel = projectContext ? `프로젝트 "${projectContext.projectTitle}"` : "전체 문서";
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
