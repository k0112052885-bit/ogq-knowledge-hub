const http = require("http");
const path = require("path");

const { loadDotEnv } = require("./server/utils/env.js");
const { createRequestHandler } = require("./server/router.js");

const ROOT_DIR = __dirname;
const DOCS_DIR = path.join(ROOT_DIR, "docs");
const IMAGES_DIR = path.join(DOCS_DIR, "images");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const ADMIN_DIR = path.join(ROOT_DIR, "admin");

loadDotEnv(ROOT_DIR);

const PORT = process.env.PORT || 7778;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

let server;
const requestHandler = createRequestHandler(
  {
    rootDir: ROOT_DIR,
    docsDir: DOCS_DIR,
    imagesDir: IMAGES_DIR,
    distDir: DIST_DIR,
    adminDir: ADMIN_DIR,
    openaiApiKey: OPENAI_API_KEY,
    openaiModel: OPENAI_MODEL,
  },
  () => server
);

server = http.createServer(requestHandler);

server.listen(PORT, () => {
  console.log(`OGQ Knowledge Hub 로컬 서버가 실행 중입니다.`);
  console.log(`  사이트 보기: http://localhost:${PORT}/`);
  console.log(`  문서 편집:   http://localhost:${PORT}/admin`);
  console.log(`\n이 서버는 로컬 개발 전용입니다. 외부에 노출하지 마세요.`);
});
