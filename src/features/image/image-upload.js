import { el, state } from "../../core/state.js";
import { api } from "../../core/api.js";
import { toast, setStatus } from "../../core/toast.js";
import { insertTextAtCursor } from "../editor/editor-core.js";
import { schedulePreview } from "../preview/preview.js";

// ============================================================
// Image paste / drag & drop upload
// ============================================================
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("파일을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

// 현재 열려있는 문서 파일명(예: "07_goal.md")에서 확장자를 뗀 slug를 반환.
// 서버가 이 slug를 기준으로 이미지 파일명을 생성한다(예: "07_goal-1.png").
function currentDocSlug() {
  return state.currentFilename ? state.currentFilename.replace(/\.md$/i, "") : "";
}

// 이미지 하나를 업로드하고 성공 시 { path, filename }을 반환한다.
// 실패하면 에러 토스트만 띄우고 null을 반환한다(호출부에서 나머지 파일 처리를 계속할 수 있게).
async function uploadImageFile(file) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    toast("error", "지원하지 않는 이미지 형식입니다", `${file.name}: PNG, JPEG, WebP만 업로드할 수 있습니다.`);
    return null;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const data = await api("/api/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: file.type, data: dataUrl, docSlug: currentDocSlug() }),
    });
    return data;
  } catch (e) {
    toast("error", "업로드 실패", `${file.name}: ${e.message}`);
    return null;
  }
}

// 여러 이미지를 순서대로(하나씩 순차) 업로드하고, 성공한 것부터 순서대로
// 커서 위치에 이어서 삽입한다. 병렬 처리하면 완료 순서가 뒤섞여
// Markdown 삽입 순서가 드롭한 순서와 달라질 수 있어 순차 처리한다.
// 실패한 파일이 있어도 문서는 실패 이전까지 성공한 삽입만 반영되고,
// 나머지 파일 업로드는 계속 진행한다(한 파일 실패가 전체를 막지 않음).
async function uploadAndInsertImages(files) {
  if (!files.length) return;
  if (!state.currentFilename) {
    toast("error", "이미지를 삽입할 문서가 없습니다", "먼저 문서를 열거나 새로 만들어주세요.");
    return;
  }

  setStatus(`이미지 업로드 중... (0/${files.length})`, "busy");
  if (files.length > 1) {
    toast("info", "업로드 중...", `이미지 ${files.length}개를 순서대로 업로드합니다.`);
  } else {
    toast("info", "업로드 중...", files[0].name);
  }

  let successCount = 0;
  for (let i = 0; i < files.length; i++) {
    const data = await uploadImageFile(files[i]);
    if (data) {
      insertTextAtCursor(`![image](${data.path})\n`);
      successCount++;
      setStatus(`이미지 업로드 중... (${i + 1}/${files.length})`, "busy");
    }
  }

  if (successCount > 0) {
    setStatus("이미지 업로드 완료", "ok");
    toast(
      "success",
      "업로드 완료",
      successCount === files.length ? `이미지 ${successCount}개 삽입됨` : `이미지 ${successCount}/${files.length}개 삽입됨`
    );
    schedulePreview();
  } else {
    setStatus("이미지 업로드 실패", "error");
  }
}

function extractImageFilesFromClipboard(clipboardData) {
  if (!clipboardData || !clipboardData.items) return [];
  const files = [];
  for (const item of clipboardData.items) {
    if (item.kind === "file" && ACCEPTED_IMAGE_TYPES.includes(item.type)) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

// 드롭된 파일 중 이미지가 아닌 파일은 걸러내고, 걸러진 개수를 함께 반환해
// 호출부에서 "이미지가 아닌 파일은 제외됨"을 사용자에게 알릴 수 있게 한다.
function extractImageFilesFromDrop(dataTransfer) {
  if (!dataTransfer || !dataTransfer.files) return { files: [], skipped: 0 };
  const all = Array.from(dataTransfer.files);
  const files = all.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
  return { files, skipped: all.length - files.length };
}

export function setupImagePasteAndDrop() {
  // Monaco는 내부 hidden textarea가 paste 이벤트를 먼저 소비하므로,
  // capture 단계에서 monacoContainer 상위(document)로 붙여 항상 먼저 가로챈다.
  document.addEventListener(
    "paste",
    (e) => {
      if (!el.monacoContainer.contains(e.target)) return;
      const files = extractImageFilesFromClipboard(e.clipboardData);
      if (!files.length) return; // 텍스트 붙여넣기는 에디터 기본 동작에 맡김
      e.preventDefault();
      e.stopPropagation();
      uploadAndInsertImages(files);
    },
    true
  );

  let dragDepth = 0;
  el.monacoContainer.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
    dragDepth++;
    el.imageDropOverlay.classList.remove("hidden");
  });
  el.monacoContainer.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
  });
  el.monacoContainer.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) el.imageDropOverlay.classList.add("hidden");
  });
  el.monacoContainer.addEventListener("drop", (e) => {
    dragDepth = 0;
    el.imageDropOverlay.classList.add("hidden");
    const { files, skipped } = extractImageFilesFromDrop(e.dataTransfer);
    if (!files.length && !skipped) return;
    e.preventDefault();
    if (skipped > 0) {
      toast("error", "이미지가 아닌 파일은 제외되었습니다", `${skipped}개 파일을 건너뛰었습니다. (PNG/JPEG/WebP만 지원)`);
    }
    uploadAndInsertImages(files);
  });
}
