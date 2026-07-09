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

  /* ---------- Mermaid diagrams ---------- */
  function setupMermaid() {
    var blocks = document.querySelectorAll(".mermaid");
    if (!blocks.length) return;

    var mermaidRenderSeq = 0;

    // 블록 단위로 개별 렌더링해서 하나가 문법 오류여도 나머지 다이어그램은
    // 정상 렌더링되고, 실패한 블록에는 에러 메시지만 표시되게 한다.
    function renderBlock(mermaidLib, block) {
      var code = block.textContent;
      var id = "mermaid-site-" + ++mermaidRenderSeq;
      mermaidLib
        .render(id, code)
        .then(function (result) {
          block.innerHTML = result.svg;
          block.classList.remove("mermaid-error");
        })
        .catch(function (err) {
          block.classList.add("mermaid-error");
          block.innerHTML =
            '<div class="mermaid-error-box">' +
            '<div class="mermaid-error-title">Mermaid 렌더링 실패</div>' +
            '<div class="mermaid-error-message">' +
            escapeHtml((err && err.message) || String(err)) +
            "</div></div>";
        });
    }

    function render(mermaidLib) {
      var isDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;

      mermaidLib.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
        securityLevel: "strict",
      });

      blocks.forEach(function (block) {
        renderBlock(mermaidLib, block);
      });
    }

    if (typeof window.mermaid !== "undefined") {
      render(window.mermaid);
      return;
    }

    // CDN 스크립트가 아직 로드 중일 수 있으므로 잠시 재시도 (오프라인이면 자동 포기)
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      if (typeof window.mermaid !== "undefined") {
        clearInterval(timer);
        render(window.mermaid);
      } else if (attempts > 20) {
        clearInterval(timer);
      }
    }, 150);
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

  /* ---------- Sidebar category groups ---------- */
  function setupSidebarGroups() {
    var groups = document.querySelectorAll(".sidebar-group");
    groups.forEach(function (group) {
      var toggle = group.querySelector(".sidebar-group-toggle");
      if (!toggle) return;
      toggle.addEventListener("click", function () {
        var isOpen = group.classList.toggle("open");
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });
    });
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
  var SEARCH_WEIGHTS = { title: 10, tags: 6, description: 4, text: 1 };

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
      return escapeHtml(text).replace(
        new RegExp("(" + escapeRegExp(escapeHtml(query)) + ")", "ig"),
        "<mark>$1</mark>"
      );
    }

    function countOccurrences(haystack, needle) {
      if (!haystack || !needle) return 0;
      var count = 0;
      var pos = 0;
      while ((pos = haystack.indexOf(needle, pos)) !== -1) {
        count++;
        pos += needle.length;
      }
      return count;
    }

    function scoreDoc(doc, qLower) {
      var titleLower = doc.title.toLowerCase();
      var descLower = (doc.description || "").toLowerCase();
      var tagsLower = (doc.tags || []).join(" ").toLowerCase();
      var textLower = doc.text.toLowerCase();

      var score = 0;
      score += countOccurrences(titleLower, qLower) * SEARCH_WEIGHTS.title;
      score += countOccurrences(tagsLower, qLower) * SEARCH_WEIGHTS.tags;
      score += countOccurrences(descLower, qLower) * SEARCH_WEIGHTS.description;
      score += countOccurrences(textLower, qLower) * SEARCH_WEIGHTS.text;

      // 제목이 검색어로 시작하면 가산점 (완전 일치에 가까운 결과 우선)
      if (titleLower.indexOf(qLower) === 0) score += 5;

      return score;
    }

    function bestSnippetSource(doc, qLower) {
      if (doc.description && doc.description.toLowerCase().indexOf(qLower) !== -1) {
        return doc.description;
      }
      return doc.text;
    }

    function render(query) {
      var q = query.trim();
      if (!q) {
        resultsEl.innerHTML = "";
        resultsEl.classList.add("hidden");
        return;
      }

      var qLower = q.toLowerCase();
      var matches = index
        .map(function (doc) {
          return { doc: doc, score: scoreDoc(doc, qLower) };
        })
        .filter(function (entry) {
          return entry.score > 0;
        })
        .sort(function (a, b) {
          return b.score - a.score;
        });

      resultsEl.classList.remove("hidden");

      if (!matches.length) {
        resultsEl.innerHTML = '<li class="result-empty">검색 결과가 없습니다.</li>';
        return;
      }

      resultsEl.innerHTML = matches
        .slice(0, 15)
        .map(function (entry) {
          var doc = entry.doc;
          var snippetSource = bestSnippetSource(doc, qLower);
          var snippet =
            doc.title.toLowerCase().indexOf(qLower) !== -1 && snippetSource === doc.text
              ? doc.text.slice(0, 80)
              : snippetFor(snippetSource, q);
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
    setupSidebarGroups();
    setupToc();
    setupScrollSpy();
    setupCopyButtons();
    setupSearch();
    setupMermaid();
  });
})();
