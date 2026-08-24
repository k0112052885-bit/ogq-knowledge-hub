import { el, state } from "../../core/state.js";
import { toast, setStatus } from "../../core/toast.js";

// Save/Build/Git Push와 동일한 UX(버튼 클릭 → 상태표시 → 토스트 → 결과)를 따른다.
// 이 요청은 바이너리(PDF)/텍스트(HTML) 파일을 응답으로 받으므로 core/api.js의 api()
// 헬퍼(항상 JSON 파싱)를 쓰지 않고, 여기서만 blob 응답을 직접 처리한다.
// PDF/HTML 모두 "현재 열려 있는 문서 → /api/export/:format → blob 다운로드"라는 동일한
// 흐름을 공유하므로, 포맷별 차이(버튼/라벨/확장자)만 파라미터로 받는 공통 함수로 둔다.
// 새 export 포맷(예: docx)이 추가되면 이 함수를 그대로 재사용하고 config만 늘리면 된다.
const EXPORT_FORMATS = {
  pdf: {
    button: () => el.btnExportPdf,
    extension: "pdf",
    busyLabel: "PDF 생성 중...",
    doneLabel: "PDF 다운로드 완료",
    failLabel: "PDF 생성 실패",
  },
  html: {
    button: () => el.btnExportHtml,
    extension: "html",
    busyLabel: "HTML 생성 중...",
    doneLabel: "HTML 다운로드 완료",
    failLabel: "HTML 생성 실패",
  },
};

async function downloadCurrentDocAs(format) {
  const config = EXPORT_FORMATS[format];
  const button = config.button();

  if (!state.currentFilename) {
    toast("error", "내보낼 문서가 없습니다", "먼저 문서를 열어주세요.");
    return;
  }

  const filename = state.currentFilename;
  button.disabled = true;
  setStatus(config.busyLabel, "busy");

  try {
    const res = await fetch(`/api/export/${format}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });

    if (!res.ok) {
      let message = `${config.failLabel} (HTTP ${res.status})`;
      try {
        const data = await res.json();
        if (data && (data.error || data.message)) message = data.error || data.message;
      } catch (e) {
        // 본문이 JSON이 아니면 기본 메시지 사용
      }
      throw new Error(message);
    }

    const blob = await res.blob();
    const downloadName = filename.replace(/\.md$/, `.${config.extension}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus(config.doneLabel, "ok");
    toast("success", config.doneLabel, downloadName);
  } catch (e) {
    setStatus(config.failLabel, "error");
    toast("error", config.failLabel, e.message);
  } finally {
    button.disabled = false;
  }
}

export function initExportDoc() {
  el.btnExportPdf.addEventListener("click", () => downloadCurrentDocAs("pdf"));
  el.btnExportHtml.addEventListener("click", () => downloadCurrentDocAs("html"));
}
