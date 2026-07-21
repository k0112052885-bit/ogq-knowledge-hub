import { el, state } from "../../core/state.js";
import { api } from "../../core/api.js";
import { toast, setStatus } from "../../core/toast.js";
import { openModal, closeModal } from "../../core/modal.js";

// ============================================================
// Build / Git push / Shutdown
// ============================================================
export async function runBuild(silent) {
  setStatus("빌드 중...", "busy");
  try {
    const data = await api("/api/build", { method: "POST" });
    setStatus("빌드 완료", "ok");
    if (!silent) toast("success", "Build 성공", data.message);
    else toast("success", "자동 Build 완료");
  } catch (e) {
    setStatus("빌드 실패", "error");
    toast("error", "Build 실패", e.message);
  }
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

  el.btnGitPush.addEventListener("click", () => {
    el.gitPushMessage.value = "";
    openModal("gitPushModal");
  });
  el.btnConfirmGitPush.addEventListener("click", confirmGitPush);

  el.btnShutdown.addEventListener("click", () => openModal("shutdownModal"));
  el.btnConfirmShutdown.addEventListener("click", confirmShutdown);
}
