const fs = require("fs");
const path = require("path");

const { sendJson, readRequestBody } = require("../utils/http.js");
const { asciiSlug } = require("../utils/slug.js");

let sharp = null;
try {
  sharp = require("sharp");
} catch (e) {
  // sharp 모듈이 없으면 리사이즈/재인코딩 없이 원본을 그대로 저장한다.
}

const IMAGE_MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// 원본이 이보다 크면 가로/세로 중 긴 변을 기준으로 축소한다 (비율 유지, 확대는 안 함).
const IMAGE_MAX_DIMENSION = 1920;
const IMAGE_JPEG_QUALITY = 85;
const IMAGE_WEBP_QUALITY = 85;
const IMAGE_PNG_QUALITY = 85;

// "YYYYMMDD-HHMMSS" 형태의 타임스탬프 (로컬 시간 기준)
function timestampSlug(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

// 큰 이미지는 긴 변 기준으로 축소하고 포맷별 품질로 재인코딩해 용량을 줄인다.
// sharp가 없거나 처리에 실패하면 원본 버퍼를 그대로 반환한다(업로드 자체는 계속 진행).
async function optimizeImageBuffer(buffer, mimeType) {
  if (!sharp) return buffer;
  try {
    const image = sharp(buffer);
    const meta = await image.metadata();
    const needsResize =
      meta.width && meta.height && Math.max(meta.width, meta.height) > IMAGE_MAX_DIMENSION;

    let pipeline = image;
    if (needsResize) {
      pipeline = pipeline.resize({
        width: meta.width >= meta.height ? IMAGE_MAX_DIMENSION : null,
        height: meta.height > meta.width ? IMAGE_MAX_DIMENSION : null,
        withoutEnlargement: true,
      });
    }

    if (mimeType === "image/jpeg") {
      pipeline = pipeline.jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true });
    } else if (mimeType === "image/webp") {
      pipeline = pipeline.webp({ quality: IMAGE_WEBP_QUALITY });
    } else if (mimeType === "image/png") {
      pipeline = pipeline.png({ quality: IMAGE_PNG_QUALITY, compressionLevel: 9 });
    }

    const optimized = await pipeline.toBuffer();
    // 재인코딩 결과가 원본보다 오히려 크면(이미 최적화된 작은 이미지 등) 원본을 유지한다.
    return optimized.length < buffer.length ? optimized : buffer;
  } catch (e) {
    return buffer;
  }
}

// 문서명(slug) 기반으로 안전한 이미지 파일명을 만든다.
// 예: docSlug="07_goal" → "07_goal-1.png", 중복 시 "07_goal-2.png"...
// docSlug가 없거나 slug화 후 빈 문자열이면 기존 타임스탬프 방식으로 fallback한다.
function buildImageFilename(imagesDir, docSlug, ext) {
  const base = docSlug ? asciiSlug(docSlug) : "";
  if (!base) {
    return `image-${timestampSlug(new Date())}.${ext}`;
  }

  let n = 1;
  let filename = `${base}-${n}.${ext}`;
  while (fs.existsSync(path.join(imagesDir, filename))) {
    n++;
    filename = `${base}-${n}.${ext}`;
  }
  return filename;
}

async function handleUploadImage(req, res, imagesDir) {
  let body;
  try {
    body = await readRequestBody(req, 20 * 1024 * 1024);
  } catch (e) {
    sendJson(res, 413, { error: e.message });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    sendJson(res, 400, { error: "요청 본문이 올바른 JSON이 아닙니다." });
    return;
  }

  const mimeType = typeof payload.mimeType === "string" ? payload.mimeType.toLowerCase() : "";
  const ext = IMAGE_MIME_EXT[mimeType];
  if (!ext) {
    sendJson(res, 400, { error: "지원하지 않는 이미지 형식입니다. (PNG/JPEG/WebP만 가능)" });
    return;
  }

  const dataUrlPrefix = /^data:[^;]+;base64,/;
  const rawData = typeof payload.data === "string" ? payload.data.replace(dataUrlPrefix, "") : "";
  if (!rawData) {
    sendJson(res, 400, { error: "이미지 데이터가 비어 있습니다." });
    return;
  }

  let buffer;
  try {
    buffer = Buffer.from(rawData, "base64");
  } catch (e) {
    sendJson(res, 400, { error: "이미지 데이터를 디코딩할 수 없습니다." });
    return;
  }
  if (!buffer.length) {
    sendJson(res, 400, { error: "이미지 데이터가 비어 있습니다." });
    return;
  }

  const docSlug =
    typeof payload.docSlug === "string" ? payload.docSlug.replace(/\.md$/i, "") : "";

  let optimized;
  try {
    optimized = await optimizeImageBuffer(buffer, mimeType);
  } catch (e) {
    optimized = buffer;
  }

  fs.mkdirSync(imagesDir, { recursive: true });

  const filename = buildImageFilename(imagesDir, docSlug, ext);
  const filePath = path.resolve(imagesDir, filename);
  if (!filePath.startsWith(imagesDir + path.sep)) {
    sendJson(res, 400, { error: "생성된 파일명이 허용되지 않은 경로입니다." });
    return;
  }

  fs.writeFile(filePath, optimized, (err) => {
    if (err) {
      sendJson(res, 500, { error: "이미지 저장에 실패했습니다." });
      return;
    }
    sendJson(res, 201, { ok: true, filename, path: `images/${filename}` });
  });
}

module.exports = { handleUploadImage };
