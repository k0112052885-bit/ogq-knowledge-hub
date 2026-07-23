const { sendJson, readRequestBody } = require("../utils/http.js");
const { buildDiagramPrompt } = require("../ai-diagram/prompt-builder.js");

const AI_DIAGRAM_MAX_INPUT_LENGTH = 4000;
const DEFAULT_VARIANT_COUNT = 1;
const MIN_VARIANT_COUNT = 1;
const MAX_VARIANT_COUNT = 3;

// variantCount가 없거나(undefined) 유효 범위(1~3) 밖의 값(문자열, 소수, 0, 4 이상 등)이면
// 기존 단일 생성 동작과 동일하게 기본값(1)으로 안전하게 처리한다.
function resolveVariantCount(value) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return DEFAULT_VARIANT_COUNT;
  }
  if (value < MIN_VARIANT_COUNT || value > MAX_VARIANT_COUNT) {
    return DEFAULT_VARIANT_COUNT;
  }
  return value;
}

// 모델이 코드펜스나 설명을 덧붙여 응답하는 경우를 방어적으로 정리해
// 순수 Mermaid 코드만 남긴다.
function extractMermaidCode(raw) {
  let text = String(raw || "").trim();

  const fenceMatch = text.match(/```(?:mermaid)?\r?\n([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  return text;
}

async function callOpenAiForDiagram(text, apiKey, model, systemPrompt) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = (data && data.error && data.error.message) || `OpenAI API 오류 (HTTP ${response.status})`;
    throw new Error(message);
  }

  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error("OpenAI 응답에서 다이어그램 코드를 찾을 수 없습니다.");
  }
  return content;
}

async function handleAiDiagram(req, res, apiKey, model) {
  if (!apiKey) {
    sendJson(res, 500, {
      error: "OPENAI_API_KEY가 설정되지 않았습니다. 프로젝트 루트에 .env 파일을 만들고 OPENAI_API_KEY=sk-... 를 추가한 뒤 서버를 재시작하세요.",
    });
    return;
  }

  let body;
  try {
    body = await readRequestBody(req);
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

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) {
    sendJson(res, 400, { error: "변환할 텍스트가 비어 있습니다." });
    return;
  }
  if (text.length > AI_DIAGRAM_MAX_INPUT_LENGTH) {
    sendJson(res, 400, { error: `선택한 텍스트가 너무 깁니다. (최대 ${AI_DIAGRAM_MAX_INPUT_LENGTH}자)` });
    return;
  }

  // diagramType/style을 둘 다 지정하지 않은 요청(v1 클라이언트, 기존 AI Diagram 버튼)은
  // 스타일 지시문 없이 v1과 바이트 단위로 동일한 시스템 프롬프트를 사용해야 하므로
  // includeStyleInstruction을 false로 둔다. 둘 중 하나라도 지정되면 v2 동작으로 간주해
  // 스타일 지시문까지 포함한다.
  const diagramType = typeof payload.diagramType === "string" ? payload.diagramType : undefined;
  const style = typeof payload.style === "string" ? payload.style : undefined;
  const isV2Request = diagramType !== undefined || style !== undefined;

  const systemPrompt = buildDiagramPrompt({
    diagramType,
    style,
    includeStyleInstruction: isV2Request,
  });

  const variantCount = resolveVariantCount(payload.variantCount);

  try {
    // variantCount(1~3)만큼 동일한 프롬프트로 OpenAI를 병렬 호출해 여러 시안을 만든다.
    // 개별 호출이 실패하거나 빈 코드를 반환해도 다른 시안에는 영향이 없도록
    // Promise.allSettled로 모은 뒤, 성공한 것만 골라 results에 담는다.
    const settled = await Promise.allSettled(
      Array.from({ length: variantCount }, () => callOpenAiForDiagram(text, apiKey, model, systemPrompt))
    );

    const results = settled
      .filter((r) => r.status === "fulfilled")
      .map((r) => extractMermaidCode(r.value))
      .filter((code) => code)
      .map((code) => ({ code }));

    if (!results.length) {
      const firstError = settled.find((r) => r.status === "rejected");
      // v1과 동일한 두 가지 오류 메시지 포맷을 그대로 재현한다.
      // - OpenAI 호출 자체가 실패(callOpenAiForDiagram이 throw)한 경우: "AI 다이어그램 생성 실패: {message}"
      // - 호출은 성공했지만 코드 추출 결과가 빈 문자열인 경우: "AI가 빈 응답을 반환했습니다. 다시 시도해주세요."
      const message = firstError
        ? `AI 다이어그램 생성 실패: ${firstError.reason.message}`
        : "AI가 빈 응답을 반환했습니다. 다시 시도해주세요.";
      sendJson(res, 502, { error: message });
      return;
    }

    // 기존 단일 생성 응답 형식({ ok, code })은 항상 유지하고, variantCount가 1보다
    // 클 때만 results 배열을 추가로 포함한다(하위 호환: code는 항상 results[0]과 동일).
    const responsePayload = { ok: true, code: results[0].code };
    if (variantCount > 1) {
      responsePayload.results = results;
    }
    sendJson(res, 200, responsePayload);
  } catch (err) {
    sendJson(res, 502, { error: `AI 다이어그램 생성 실패: ${err.message}` });
  }
}

module.exports = { handleAiDiagram };
