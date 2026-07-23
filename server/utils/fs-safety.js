const path = require("path");

// 파일명이 docs 폴더를 벗어나지 못하도록 검증.
// 알파벳/숫자/하이픈/언더스코어만 허용하고 .md 확장자를 강제한다.
const SAFE_FILENAME_RE = /^[a-zA-Z0-9_-]+\.md$/;

function isSafeDocFilename(filename) {
  if (typeof filename !== "string") return false;
  if (!SAFE_FILENAME_RE.test(filename)) return false;
  // path.basename으로 정규화한 결과가 원본과 같아야 함 (../ 등 경로 조작 방지)
  return path.basename(filename) === filename;
}

function resolveDocPath(docsDir, filename) {
  const resolved = path.resolve(docsDir, filename);
  if (!resolved.startsWith(docsDir + path.sep)) {
    return null;
  }
  return resolved;
}

module.exports = { SAFE_FILENAME_RE, isSafeDocFilename, resolveDocPath };
