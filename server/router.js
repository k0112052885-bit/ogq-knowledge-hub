const url = require("url");

const { sendJson, serveStatic } = require("./utils/http.js");
const { handlePreview } = require("./handlers/preview.js");
const { handleBuild } = require("./handlers/build.js");
const { handleGitPush } = require("./handlers/git.js");
const { handleListDocs, handleCreateDoc, handleGetDoc, handleSaveDoc } = require("./handlers/docs.js");
const {
  handleRenamePage,
  handleDeletePage,
  handleRenameProject,
  handleDeleteProject,
} = require("./handlers/docs-rename-delete.js");
const { handleUploadImage } = require("./handlers/images.js");
const { handleAiDiagram } = require("./handlers/ai-diagram.js");

// 어디서도 호출되지 않는 헬퍼이지만(기존 server.js에도 동일하게 미사용 상태로 존재했음),
// 동작 변경 없이 위치만 옮기기 위해 그대로 보존한다.
function getFrontMatterField(data, key, fallback) {
  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
}

// http.createServer에 그대로 전달할 요청 핸들러를 만든다.
// config: { rootDir, docsDir, imagesDir, distDir, adminDir, openaiApiKey, openaiModel }
function createRequestHandler(config, getServerInstance) {
  const { rootDir, docsDir, imagesDir, distDir, adminDir, openaiApiKey, openaiModel } = config;

  return async function handleRequest(req, res) {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    try {
      if (pathname === "/api/docs" && req.method === "GET") {
        handleListDocs(req, res, docsDir);
        return;
      }
      if (pathname === "/api/docs" && req.method === "POST") {
        await handleCreateDoc(req, res, docsDir);
        return;
      }

      const docMatch = pathname.match(/^\/api\/docs\/([^/]+)$/);
      if (docMatch && req.method === "GET") {
        handleGetDoc(req, res, decodeURIComponent(docMatch[1]), docsDir);
        return;
      }
      if (docMatch && req.method === "POST") {
        await handleSaveDoc(req, res, decodeURIComponent(docMatch[1]), docsDir);
        return;
      }
      if (docMatch && req.method === "DELETE") {
        await handleDeletePage(req, res, decodeURIComponent(docMatch[1]), docsDir);
        return;
      }

      const docTitleMatch = pathname.match(/^\/api\/docs\/([^/]+)\/title$/);
      if (docTitleMatch && req.method === "PATCH") {
        await handleRenamePage(req, res, decodeURIComponent(docTitleMatch[1]), docsDir);
        return;
      }

      const projectTitleMatch = pathname.match(/^\/api\/projects\/([^/]+)\/title$/);
      if (projectTitleMatch && req.method === "PATCH") {
        await handleRenameProject(req, res, decodeURIComponent(projectTitleMatch[1]), docsDir);
        return;
      }

      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projectMatch && req.method === "DELETE") {
        await handleDeleteProject(req, res, decodeURIComponent(projectMatch[1]), docsDir);
        return;
      }

      if (pathname === "/api/images" && req.method === "POST") {
        await handleUploadImage(req, res, imagesDir);
        return;
      }

      if (pathname === "/api/ai-diagram" && req.method === "POST") {
        await handleAiDiagram(req, res, openaiApiKey, openaiModel);
        return;
      }

      if (pathname === "/api/build" && req.method === "POST") {
        handleBuild(req, res);
        return;
      }

      if (pathname === "/api/git-push" && req.method === "POST") {
        await handleGitPush(req, res, rootDir);
        return;
      }

      if (pathname === "/api/preview" && req.method === "POST") {
        await handlePreview(req, res);
        return;
      }

      if (pathname === "/api/shutdown" && req.method === "POST") {
        sendJson(res, 200, { ok: true, message: "서버를 종료합니다." });
        // 응답을 먼저 내려보낸 뒤 서버를 종료
        res.on("finish", () => {
          const server = getServerInstance();
          server.close(() => process.exit(0));
          // 열려있는 연결이 있어도 일정 시간 뒤 강제 종료
          setTimeout(() => process.exit(0), 500).unref();
        });
        return;
      }

      // 문서 딥링크(?doc=, ?project=&page=)는 항상 /admin 경로로만 진입한다.
      // 사이트 루트("/")는 정적 사이트 전용으로 남겨, 쿼리 파라미터가 우연히 겹쳐도
      // 정적 사이트 방문이 admin 화면으로 우회되지 않게 한다.
      if (pathname === "/admin" || pathname === "/admin/") {
        serveStatic(req, res, adminDir, "/index.html");
        return;
      }
      if (pathname.startsWith("/admin/")) {
        serveStatic(req, res, adminDir, pathname.replace(/^\/admin/, ""));
        return;
      }

      // admin/app.js가 ES 모듈로 분리되어 /src 아래 파일들을 상대 경로로 import하므로
      // 브라우저가 직접 요청할 수 있도록 정적 서빙 경로를 추가한다 (adminDir과 동일한 패턴).
      if (pathname.startsWith("/src/")) {
        serveStatic(req, res, rootDir, pathname);
        return;
      }

      // /admin 미리보기에서 방금 업로드한 이미지를 바로 볼 수 있도록
      // docs/images를 /images/ 경로로 직접 서빙 (dist/images는 build 후에만 최신 상태가 됨)
      if (pathname.startsWith("/images/")) {
        serveStatic(req, res, imagesDir, pathname.replace(/^\/images/, ""));
        return;
      }

      // 나머지는 dist/ 정적 사이트 서빙
      serveStatic(req, res, distDir, pathname);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  };
}

module.exports = { createRequestHandler, getFrontMatterField };
