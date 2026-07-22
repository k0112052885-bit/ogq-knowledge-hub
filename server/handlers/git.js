const { execFile } = require("child_process");
const { sendJson, readRequestBody } = require("../utils/http.js");

function runGit(rootDir, args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: rootDir, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || stdout.trim() || err.message));
        return;
      }
      // git push 등은 진행 메시지를 stdout이 아닌 stderr로 출력하는 경우가 많아 함께 반환
      resolve([stdout.trim(), stderr.trim()].filter(Boolean).join("\n"));
    });
  });
}

async function handleGitPush(req, res, rootDir) {
  let body = "";
  try {
    body = await readRequestBody(req);
  } catch (e) {
    sendJson(res, 413, { error: e.message });
    return;
  }

  let payload = {};
  if (body) {
    try {
      payload = JSON.parse(body);
    } catch (e) {
      sendJson(res, 400, { error: "요청 본문이 올바른 JSON이 아닙니다." });
      return;
    }
  }

  const message =
    typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : `docs: update via admin (${new Date().toISOString().slice(0, 19).replace("T", " ")})`;

  try {
    const status = await runGit(rootDir, ["status", "--porcelain"]);
    if (!status) {
      sendJson(res, 200, { ok: true, message: "변경사항이 없어 커밋 없이 종료했습니다.", pushed: false });
      return;
    }

    await runGit(rootDir, ["add", "-A"]);
    await runGit(rootDir, ["commit", "-m", message]);
    const pushOutput = await runGit(rootDir, ["push"]);
    sendJson(res, 200, {
      ok: true,
      message: "커밋 후 push가 완료되었습니다.",
      detail: pushOutput,
      pushed: true,
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, message: `Git push 실패: ${err.message}` });
  }
}

module.exports = { runGit, handleGitPush };
