import { el, state } from "../../core/state.js";
import { toast, setStatus } from "../../core/toast.js";

// Save/Build/Git Push와 동일한 UX(버튼 클릭 → 상태표시 → 토스트 → 결과)를 따른다.
// 이 요청은 PDF 바이너리를 응답으로 받으므로 core/api.js의 api() 헬퍼(항상 JSON 파싱)를
// 쓰지 않고, 여기서만 blob 응답을 직접 처리한다.
async function downloadCurrentDocAsPdf() {
  if (!state.currentFilename) {
    toast("error", "내보낼 문서가 없습니다", "먼저 문서를 열어주세요.");
    return;
  }

  const filename = state.currentFilename;
  el.btnExportPdf.disabled = true;
  setStatus("PDF 생성 중...", "busy");

  try {
    const res = await fetch("/api/export/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });

    if (!res.ok) {
      let message = `PDF 생성 실패 (HTTP ${res.status})`;
      try {
        const data = await res.json();
        if (data && (data.error || data.message)) message = data.error || data.message;
      } catch (e) {
        // 본문이 JSON이 아니면 기본 메시지 사용
      }
      throw new Error(message);
    }

    const blob = await res.blob();
    const downloadName = filename.replace(/\.md$/, ".pdf");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus("PDF 다운로드 완료", "ok");
    toast("success", "PDF 다운로드 완료", downloadName);
  } catch (e) {
    setStatus("PDF 생성 실패", "error");
    toast("error", "PDF 생성 실패", e.message);
  } finally {
    el.btnExportPdf.disabled = false;
  }
}

export function initExportDoc() {
  el.btnExportPdf.addEventListener("click", () => downloadCurrentDocAsPdf());
}
