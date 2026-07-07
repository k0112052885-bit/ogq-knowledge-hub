(function () {
  "use strict";

  const docListEl = document.getElementById("docList");
  const editorEl = document.getElementById("editor");
  const previewEl = document.getElementById("previewBody");
  const filenameEl = document.getElementById("currentFilename");
  const statusEl = document.getElementById("statusBar");

  const btnNew = document.getElementById("btnNew");
  const btnSave = document.getElementById("btnSave");
  const btnBuild = document.getElementById("btnBuild");
  const btnShutdown = document.getElementById("btnShutdown");

  const shutdownModal = document.getElementById("shutdownModal");
  const btnCancelShutdown = document.getElementById("btnCancelShutdown");
  const btnConfirmShutdown = document.getElementById("btnConfirmShutdown");

  const newDocModal = document.getElementById("newDocModal");
  const newTitle = document.getElementById("newTitle");
  const newSlug = document.getElementById("newSlug");
  const newCategory = document.getElementById("newCategory");
  const newTags = document.getElementById("newTags");
  const newStatus = document.getElementById("newStatus");
  const btnCancelNew = document.getElementById("btnCancelNew");
  const btnCreateNew = document.getElementById("btnCreateNew");

  let currentFilename = null;
  let previewTimer = null;
  let statusTimer = null;

  function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = "admin-status visible" + (type ? ` status-${type}` : "");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.classList.remove("visible");
    }, 4000);
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // 본문이 없는 응답일 수 있음
    }
    if (!res.ok) {
      const message = (data && data.error) || `요청 실패 (HTTP ${res.status})`;
      throw new Error(message);
    }
    return data;
  }

  function statusLabel(status) {
    if (status === "draft") return "초안";
    if (status === "review") return "검토중";
    if (status === "locked") return "확정";
    return "";
  }

  async function loadDocList() {
    try {
      const docs = await api("/api/docs");
      renderDocList(docs);
    } catch (e) {
      showStatus(`문서 목록을 불러오지 못했습니다: ${e.message}`, "error");
    }
  }

  function renderDocList(docs) {
    docListEl.innerHTML = "";
    const groups = new Map();
    docs.forEach((doc) => {
      if (!groups.has(doc.category)) groups.set(doc.category, []);
      groups.get(doc.category).push(doc);
    });

    groups.forEach((items, category) => {
      const categoryEl = document.createElement("li");
      categoryEl.className = "doc-list-category";
      categoryEl.textContent = category;
      docListEl.appendChild(categoryEl);

      items.forEach((doc) => {
        const li = document.createElement("li");
        li.className = "doc-list-item" + (doc.filename === currentFilename ? " active" : "");
        li.dataset.filename = doc.filename;

        const titleSpan = document.createElement("span");
        titleSpan.textContent = doc.title;
        li.appendChild(titleSpan);

        const label = statusLabel(doc.status);
        if (label) {
          const badge = document.createElement("span");
          badge.className = `badge badge-${doc.status}`;
          badge.textContent = label;
          li.appendChild(badge);
        }

        li.addEventListener("click", () => openDoc(doc.filename));
        docListEl.appendChild(li);
      });
    });
  }

  async function openDoc(filename) {
    try {
      const data = await api(`/api/docs/${encodeURIComponent(filename)}`);
      currentFilename = filename;
      filenameEl.value = filename;
      editorEl.value = data.content;
      updateActiveListItem();
      schedulePreview(true);
    } catch (e) {
      showStatus(`문서를 불러오지 못했습니다: ${e.message}`, "error");
    }
  }

  function updateActiveListItem() {
    Array.from(docListEl.querySelectorAll(".doc-list-item")).forEach((el) => {
      el.classList.toggle("active", el.dataset.filename === currentFilename);
    });
  }

  function schedulePreview(immediate) {
    clearTimeout(previewTimer);
    const delay = immediate ? 0 : 300;
    previewTimer = setTimeout(renderPreview, delay);
  }

  async function renderPreview() {
    const content = editorEl.value;
    try {
      const data = await api("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      previewEl.innerHTML = data.html;
      runMermaid();
    } catch (e) {
      previewEl.innerHTML = `<p style="color:#dc2626;">미리보기 렌더링 실패: ${escapeHtml(e.message)}</p>`;
    }
  }

  function runMermaid() {
    const blocks = previewEl.querySelectorAll(".mermaid");
    if (!blocks.length || typeof window.mermaid === "undefined") return;
    try {
      // 편집 화면은 항상 다크 테마이므로 미리보기 Mermaid도 dark로 고정
      window.mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
      });
      window.mermaid.run({ nodes: blocks });
    } catch (e) {
      // mermaid 문법 오류는 미리보기 단계에서 무시 (저장/빌드에는 영향 없음)
    }
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function saveCurrentDoc() {
    if (!currentFilename) {
      showStatus("저장할 문서를 먼저 선택하거나 새로 만들어주세요.", "error");
      return;
    }
    try {
      await api(`/api/docs/${encodeURIComponent(currentFilename)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editorEl.value }),
      });
      showStatus(`저장되었습니다: ${currentFilename}`, "ok");
      loadDocList();
    } catch (e) {
      showStatus(`저장 실패: ${e.message}`, "error");
    }
  }

  async function runBuild() {
    showStatus("빌드 중...", null);
    try {
      const data = await api("/api/build", { method: "POST" });
      showStatus(data.message || "빌드가 완료되었습니다.", "ok");
    } catch (e) {
      showStatus(`빌드 실패: ${e.message}`, "error");
    }
  }

  function openNewDocModal() {
    newTitle.value = "";
    newSlug.value = "";
    newCategory.value = "";
    newTags.value = "";
    newStatus.value = "draft";
    newDocModal.classList.remove("hidden");
    newTitle.focus();
  }

  function closeNewDocModal() {
    newDocModal.classList.add("hidden");
  }

  async function createNewDoc() {
    const title = newTitle.value.trim();
    if (!title) {
      newTitle.focus();
      return;
    }
    const tags = newTags.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const data = await api("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          slug: newSlug.value.trim(),
          category: newCategory.value.trim() || "기타",
          tags,
          status: newStatus.value,
        }),
      });
      closeNewDocModal();
      showStatus(`새 문서가 생성되었습니다: ${data.filename}`, "ok");
      await loadDocList();
      currentFilename = data.filename;
      filenameEl.value = data.filename;
      editorEl.value = data.content;
      updateActiveListItem();
      schedulePreview(true);
    } catch (e) {
      showStatus(`문서 생성 실패: ${e.message}`, "error");
    }
  }

  function openShutdownModal() {
    shutdownModal.classList.remove("hidden");
  }

  function closeShutdownModal() {
    shutdownModal.classList.add("hidden");
  }

  async function confirmShutdown() {
    btnConfirmShutdown.disabled = true;
    btnConfirmShutdown.textContent = "종료 중...";
    try {
      await api("/api/shutdown", { method: "POST" });
    } catch (e) {
      // 서버가 응답 직후 바로 종료되면서 연결이 끊길 수 있으므로 에러는 무시
    }
    closeShutdownModal();
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;' +
      'font-family:sans-serif;color:#8b909c;background:#0f1115;font-size:14px;">' +
      "서버가 종료되었습니다. 이 탭을 닫아도 됩니다.</div>";
  }

  editorEl.addEventListener("input", () => schedulePreview(false));

  btnNew.addEventListener("click", openNewDocModal);
  btnSave.addEventListener("click", saveCurrentDoc);
  btnBuild.addEventListener("click", runBuild);
  btnShutdown.addEventListener("click", openShutdownModal);
  btnCancelNew.addEventListener("click", closeNewDocModal);
  btnCreateNew.addEventListener("click", createNewDoc);
  btnCancelShutdown.addEventListener("click", closeShutdownModal);
  btnConfirmShutdown.addEventListener("click", confirmShutdown);
  newDocModal.addEventListener("click", (e) => {
    if (e.target === newDocModal) closeNewDocModal();
  });
  shutdownModal.addEventListener("click", (e) => {
    if (e.target === shutdownModal) closeShutdownModal();
  });

  document.addEventListener("keydown", (e) => {
    const isSaveShortcut = (e.metaKey || e.ctrlKey) && e.key === "s";
    if (isSaveShortcut) {
      e.preventDefault();
      saveCurrentDoc();
    }
  });

  loadDocList();
})();
