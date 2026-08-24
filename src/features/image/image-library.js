import { el, state } from "../../core/state.js";
import { api } from "../../core/api.js";
import { toast } from "../../core/toast.js";
import { openModal } from "../../core/modal.js";
import { escapeHtml } from "../../core/dom-utils.js";
import { insertTextAtCursor } from "../editor/editor-core.js";
import { schedulePreview } from "../preview/preview.js";

// 문서별 상태를 따로 들고 있지 않고, 모달을 열 때마다 서버에서 다시 목록을 받아온다.
// 방금 업로드/붙여넣기한 이미지가 재시작 없이 바로 보이려면 이 방식이 가장 단순하고
// 안전하다(업로드 성공 이벤트를 별도로 구독해 캐시를 갱신하는 동기화 로직이 필요 없음).
async function loadAndRenderLibrary() {
  el.imageLibraryGrid.innerHTML = '<p class="image-library-empty">불러오는 중...</p>';

  let data;
  try {
    data = await api("/api/images");
  } catch (e) {
    el.imageLibraryGrid.innerHTML = "";
    const errorEl = document.createElement("p");
    errorEl.className = "image-library-error";
    errorEl.textContent = `이미지 목록을 불러오지 못했습니다: ${e.message}`;
    el.imageLibraryGrid.appendChild(errorEl);
    toast("error", "이미지 목록을 불러오지 못했습니다", e.message);
    return;
  }

  const images = Array.isArray(data.images) ? data.images : [];
  if (!images.length) {
    el.imageLibraryGrid.innerHTML =
      '<p class="image-library-empty">아직 업로드된 이미지가 없습니다.<br />에디터에 이미지를 붙여넣거나 드래그하면 여기에 표시됩니다.</p>';
    return;
  }

  el.imageLibraryGrid.innerHTML = "";
  images.forEach((image) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "image-library-card";
    card.title = image.filename;
    card.innerHTML = `
      <span class="image-library-card-thumb">
        <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.filename)}" loading="lazy" />
      </span>
      <span class="image-library-card-name"></span>
    `;
    card.querySelector(".image-library-card-name").textContent = image.filename;

    // 개별 썸네일 로드 실패가 라이브러리 전체를 깨뜨리지 않도록, 실패한 카드만
    // 깨진 이미지 자리에 간단한 표시로 대체한다.
    const img = card.querySelector("img");
    img.addEventListener("error", () => {
      img.replaceWith(document.createTextNode("🖼️"));
    });

    card.addEventListener("click", () => insertLibraryImage(image));
    el.imageLibraryGrid.appendChild(card);
  });
}

function insertLibraryImage(image) {
  if (!state.currentFilename) {
    toast("error", "이미지를 삽입할 문서가 없습니다", "먼저 문서를 열거나 새로 만들어주세요.");
    return;
  }
  insertTextAtCursor(`![${image.filename}](${image.markdownPath})\n`);
  schedulePreview();
  toast("success", "이미지가 삽입되었습니다", image.filename);
}

function openImageLibrary() {
  openModal("imageLibraryModal");
  loadAndRenderLibrary();
}

export function initImageLibrary() {
  el.btnImageLibrary.addEventListener("click", openImageLibrary);
}
