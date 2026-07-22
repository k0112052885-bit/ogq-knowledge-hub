const { sendJson, readRequestBody } = require("../utils/http.js");

const AI_DIAGRAM_MAX_INPUT_LENGTH = 4000;

const AI_DIAGRAM_SYSTEM_PROMPT = [
  "너는 텍스트를 Mermaid 다이어그램 코드로 변환하는 도구다.",
  "사용자가 준 문장/구조 설명을 가장 적절한 Mermaid 다이어그램 종류(flowchart, sequenceDiagram, classDiagram 등)로 표현하라.",
  "flowchart를 쓸 경우 방향은 LR을 기본으로 하되, 내용상 TD가 더 적합하면 TD를 써도 된다.",
  "노드 라벨과 텍스트는 입력 언어(주로 한국어)를 그대로 유지하라.",
  "응답은 오직 Mermaid 코드만 반환하라. 코드 펜스(```)나 설명 문장, 인사말을 절대 포함하지 마라.",
  "첫 줄은 반드시 다이어그램 타입 키워드(flowchart, sequenceDiagram 등)로 시작해야 한다.",
].join(" ");

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

async function callOpenAiForDiagram(text, apiKey, model) {
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
        { role: "system", content: AI_DIAGRAM_SYSTEM_PROMPT },
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

  try {
    const raw = await callOpenAiForDiagram(text, apiKey, model);
    const code = extractMermaidCode(raw);
    if (!code) {
      sendJson(res, 502, { error: "AI가 빈 응답을 반환했습니다. 다시 시도해주세요." });
      return;
    }
    sendJson(res, 200, { ok: true, code });
  } catch (err) {
    sendJson(res, 502, { error: `AI 다이어그램 생성 실패: ${err.message}` });
  }
}

module.exports = { handleAiDiagram };
