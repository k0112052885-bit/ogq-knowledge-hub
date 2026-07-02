(function () {
  "use strict";

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /* ---------- Mobile sidebar toggle ---------- */
  function setupSidebar() {
    var sidebar = document.getElementById("sidebar");
    var overlay = document.getElementById("sidebarOverlay");
    var openBtn = document.getElementById("sidebarToggle");
    var closeBtn = document.getElementById("sidebarClose");

    if (!sidebar || !openBtn) return;

    function open() {
      sidebar.classList.add("open");
      overlay.classList.add("open");
    }

    function close() {
      sidebar.classList.remove("open");
      overlay.classList.remove("open");
    }

    openBtn.addEventListener("click", open);
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (overlay) overlay.addEventListener("click", close);
  }

  /* ---------- Mobile TOC toggle ---------- */
  function setupToc() {
    var toc = document.getElementById("toc");
    var tocBtn = document.getElementById("tocToggle");
    if (!toc || !tocBtn) return;

    toc.classList.add("collapsed");
    tocBtn.addEventListener("click", function () {
      toc.classList.toggle("collapsed");
    });
  }

  /* ---------- TOC scroll spy (desktop) ---------- */
  function setupScrollSpy() {
    var tocLinks = Array.prototype.slice.call(
      document.querySelectorAll(".toc-item a")
    );
    if (!tocLinks.length) return;

    var headings = tocLinks
      .map(function (link) {
        var id = decodeURIComponent(link.getAttribute("href").slice(1));
        return document.getElementById(id);
      })
      .filter(Boolean);

    if (!headings.length) return;

    function onScroll() {
      var scrollPos = window.scrollY + 80;
      var currentId = headings[0].id;
      for (var i = 0; i < headings.length; i++) {
        if (headings[i].offsetTop <= scrollPos) {
          currentId = headings[i].id;
        }
      }
      tocLinks.forEach(function (link) {
        var id = decodeURIComponent(link.getAttribute("href").slice(1));
        link.classList.toggle("active", id === currentId);
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Code block copy buttons ---------- */
  function setupCopyButtons() {
    var blocks = document.querySelectorAll(".markdown-body pre");
    blocks.forEach(function (pre) {
      var codeEl = pre.querySelector("code");
      if (!codeEl) return;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-btn";
      btn.textContent = "Copy";
      btn.addEventListener("click", function () {
        var text = codeEl.textContent;
        copyText(text).then(function (ok) {
          btn.textContent = ok ? "Copied!" : "실패";
          btn.classList.toggle("copied", ok);
          setTimeout(function () {
            btn.textContent = "Copy";
            btn.classList.remove("copied");
          }, 1500);
        });
      });
      pre.appendChild(btn);
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return fallbackCopy(text);
        }
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Search ---------- */
  function setupSearch() {
    var input = document.getElementById("searchInput");
    var resultsEl = document.getElementById("searchResults");
    var index = window.__SEARCH_INDEX__ || [];

    if (!input || !resultsEl) return;

    function snippetFor(text, query) {
      var lowerText = text.toLowerCase();
      var pos = lowerText.indexOf(query.toLowerCase());
      if (pos === -1) return text.slice(0, 80);
      var start = Math.max(0, pos - 30);
      var end = Math.min(text.length, pos + query.length + 50);
      return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
    }

    function highlight(text, query) {
      if (!query) return escapeHtml(text);
      var re = new RegExp("(" + escapeRegExp(query) + ")", "ig");
      return escapeHtml(text).replace(
        new RegExp("(" + escapeRegExp(escapeHtml(query)) + ")", "ig"),
        "<mark>$1</mark>"
      );
    }

    function render(query) {
      var q = query.trim();
      if (!q) {
        resultsEl.innerHTML = "";
        resultsEl.classList.add("hidden");
        return;
      }

      var qLower = q.toLowerCase();
      var matches = index.filter(function (doc) {
        return (
          doc.title.toLowerCase().indexOf(qLower) !== -1 ||
          doc.text.toLowerCase().indexOf(qLower) !== -1
        );
      });

      resultsEl.classList.remove("hidden");

      if (!matches.length) {
        resultsEl.innerHTML = '<li class="result-empty">검색 결과가 없습니다.</li>';
        return;
      }

      resultsEl.innerHTML = matches
        .slice(0, 15)
        .map(function (doc) {
          var snippet =
            doc.title.toLowerCase().indexOf(qLower) !== -1
              ? doc.text.slice(0, 80)
              : snippetFor(doc.text, q);
          return (
            '<li><a href="' +
            doc.url +
            '"><span class="result-title">' +
            highlight(doc.title, q) +
            '</span><span class="result-snippet">' +
            highlight(snippet, q) +
            "</span></a></li>"
          );
        })
        .join("");
    }

    input.addEventListener("input", function () {
      render(input.value);
    });

    input.addEventListener("focus", function () {
      if (input.value.trim()) render(input.value);
    });

    document.addEventListener("click", function (e) {
      if (!resultsEl.contains(e.target) && e.target !== input) {
        resultsEl.classList.add("hidden");
      }
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        resultsEl.classList.add("hidden");
        input.blur();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupSidebar();
    setupToc();
    setupScrollSpy();
    setupCopyButtons();
    setupSearch();
  });
})();
