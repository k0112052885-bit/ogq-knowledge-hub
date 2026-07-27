const { sendJson, readRequestBody } = require("../utils/http.js");
const { buildDiagramPrompt, resolveStyle } = require("../ai-diagram/prompt-builder.js");
const { STYLES, DEFAULT_STYLE } = require("../ai-diagram/styles.js");

const AI_DIAGRAM_MAX_INPUT_LENGTH = 4000;
const DEFAULT_VARIANT_COUNT = 1;
const MIN_VARIANT_COUNT = 1;
const MAX_VARIANT_COUNT = 3;
const STYLE_KEYS = new Set(Object.keys(STYLES));
const DEFAULT_STYLE_KEY = DEFAULT_STYLE;

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

// 두 Mermaid 코드가 "구조적으로 거의 동일한지" 비교하기 위한 정규화.
// 노드 라벨 텍스트(자연어)는 그대로 두되, 공백/줄바꿈 차이나 따옴표 종류처럼
// 의미 없는 표면적 차이를 무시하고 소문자로 맞춰, 실제로 같은 골격(동일한 화살표
// 나열/동일한 subgraph 구조)을 재사용한 응답인지 판별하는 데 쓴다.
function normalizeForComparison(code) {
  return String(code || "")
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 여러 시안(variant) 코드가 서로 구조적으로 거의 동일한지 확인한다.
// 정규화한 문자열이 완전히 같거나, 한쪽이 다른 쪽 정규화 문자열을 대부분(90% 이상)
// 포함할 만큼 유사하면 "구별되지 않는다"고 판단한다. 실제 프롬프트에 variant별
// 관점 지시문을 넣어도 모델이 같은 구조를 반복하는 드문 경우를 잡아내기 위함이다.
function isNearDuplicate(codeA, codeB) {
  const a = normalizeForComparison(codeA);
  const b = normalizeForComparison(codeB);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length / longer.length < 0.6) return false;
  // 짧은 쪽 문자열이 긴 쪽 안에 거의 그대로 들어있으면(부분 문자열) 사실상 동일 구조로 본다.
  return longer.includes(shorter);
}

// Mermaid flowchart 코드에서 "A --> B" / "A -->|라벨| B" 형태의 화살표 목록을
// 아주 단순하게(정규식 기반) 추출한다. subgraph/스타일 지시 등은 무시하고 순수하게
// "어떤 노드 ID에서 어떤 노드 ID로 화살표가 나가는지"만 뽑아 process 타입 구조
// 검증(겹침/역방향/쏠림 감지)에 쓴다. 완전한 Mermaid 파서가 아니라 휴리스틱이므로,
// 노드 ID는 라벨(따옴표/괄호 안 텍스트)을 제외한 화살표 좌우의 식별자만 본다.
function extractEdges(code) {
  const edgeRe = /([A-Za-z0-9_]+)\s*(?:\([^)]*\)|\[[^\]]*\]|\{[^}]*\})?\s*--[->x]*>\s*(?:\|[^|]*\|\s*)?([A-Za-z0-9_]+)/g;
  const edges = [];
  let match;
  while ((match = edgeRe.exec(code))) {
    edges.push([match[1], match[2]]);
  }
  return edges;
}

// process(프로세스) 타입으로 생성된 Mermaid 코드가 요청한 "겹침 없는 안정적인
// 선형 흐름" 조건을 지키는지 검사한다. 실제 렌더링 좌표까지는 서버에서 알 수 없으므로,
// 구조적으로 겹침/붕괴가 발생하기 쉬운 패턴만 정적으로 판별한다:
// - 같은 노드로 들어오는 화살표가 3개 이상(한 지점에 화살표가 몰림)
// - 순환 화살표 포함(마지막 노드가 앞의 어떤 노드로도 다시 연결됨) — process는 순환 금지
// - 노드가 1~2개뿐이라 사실상 모든 내용이 한 지점에 뭉침
function hasProcessLayoutIssue(code) {
  const edges = extractEdges(code);
  if (!edges.length) return false;

  const nodeSet = new Set();
  const inDegree = new Map();
  edges.forEach(([from, to]) => {
    nodeSet.add(from);
    nodeSet.add(to);
    inDegree.set(to, (inDegree.get(to) || 0) + 1);
  });

  // 같은 노드로 화살표가 3개 이상 몰리면(여러 화살표가 한 점에 겹쳐 보이는 전형적 패턴)
  const hasCrowdedNode = Array.from(inDegree.values()).some((count) => count >= 3);

  // 순환 화살표: to가 from보다 먼저 등장한 노드로 되돌아가는 경우(A->B->C->A 등).
  // 인접 리스트로 그래프를 만들고, 뒤에서 앞으로 가는 edge가 있는지 확인한다.
  const order = Array.from(nodeSet);
  const indexOf = new Map(order.map((id, i) => [id, i]));
  const hasBackwardEdge = edges.some(([from, to]) => {
    const fromIdx = indexOf.get(from);
    const toIdx = indexOf.get(to);
    return fromIdx !== undefined && toIdx !== undefined && toIdx < fromIdx;
  });

  // 노드가 사실상 1개로만 인식되면(추출 실패거나 극단적으로 축약된 구조) 쏠림으로 간주.
  const allNodesCrammed = nodeSet.size <= 1;

  return hasCrowdedNode || hasBackwardEdge || allNodesCrammed;
}

async function callOpenAiForDiagram(text, apiKey, model, systemPrompt, temperature = 0.2) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
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

  const variantCount = resolveVariantCount(payload.variantCount);

  // variantIndex 하나에 대한 시스템 프롬프트를 만들고 OpenAI를 호출해 코드를 추출한다.
  // variantCount가 1이면(v1 단일 생성 포함) variantIndex를 넘기지 않아 기존과 완전히
  // 동일한 프롬프트/temperature를 유지한다(하위 호환).
  async function generateVariantCode(variantIndex) {
    const systemPrompt = buildDiagramPrompt({
      diagramType,
      style,
      includeStyleInstruction: isV2Request,
      variantIndex: variantCount > 1 ? variantIndex : undefined,
    });
    const temperature = variantCount > 1 ? 0.2 + variantIndex * 0.25 : 0.2;
    const raw = await callOpenAiForDiagram(text, apiKey, model, systemPrompt, temperature);
    return extractMermaidCode(raw);
  }

  try {
    // variantCount(1~3)만큼 OpenAI를 병렬 호출해 여러 시안을 만든다. 개별 호출이 실패하거나
    // 빈 코드를 반환해도 다른 시안에는 영향이 없도록 Promise.allSettled로 모은 뒤,
    // 성공한 것만 골라 codes에 담는다.
    const settled = await Promise.allSettled(
      Array.from({ length: variantCount }, (_, i) => generateVariantCode(i))
    );

    let codes = settled
      .filter((r) => r.status === "fulfilled")
      .map((r, idx) => ({ index: idx, code: r.value }))
      .filter((entry) => entry.code);

    // variant 하나씩 "재생성이 필요한지" 판단한다. 두 가지 조건 중 하나라도 해당하면
    // 재생성 대상이다:
    // - 앞선 variant와 구조적으로 거의 동일함(관점 지시문에도 불구하고 모델이 같은
    //   골격을 반복한 경우)
    // - diagramType이 process인데 겹침 유발 패턴을 가짐(같은 노드에 화살표 3개 이상
    //   몰림, 순환선 포함, 노드가 사실상 한 지점에 뭉침) — process는 "겹침 없는 선형
    //   흐름"이 핵심 요구사항이므로 이 경우 재생성하지 않으면 카드 Preview가 붕괴된
    //   레이아웃으로 보인다.
    function needsRegeneration(entry, earlierEntries) {
      const isDuplicateOfEarlier = earlierEntries.some((earlier) => isNearDuplicate(earlier.code, entry.code));
      if (isDuplicateOfEarlier) return true;
      if (diagramType === "process" && hasProcessLayoutIssue(entry.code)) return true;
      return false;
    }

    if (codes.length > 0) {
      for (let i = 0; i < codes.length; i++) {
        if (!needsRegeneration(codes[i], codes.slice(0, i))) continue;
        try {
          const retrySystemPrompt = buildDiagramPrompt({
            diagramType,
            style,
            includeStyleInstruction: isV2Request,
            variantIndex: variantCount > 1 ? codes[i].index : undefined,
          });
          const retryRaw = await callOpenAiForDiagram(
            text,
            apiKey,
            model,
            retrySystemPrompt,
            Math.min(0.9, 0.2 + codes[i].index * 0.25 + 0.3)
          );
          const retryCode = extractMermaidCode(retryRaw);
          // 재생성 결과가 비어있지 않으면 채택한다. 재생성 결과가 여전히 문제(process
          // 레이아웃 이슈)를 가질 수도 있지만, 1회 재시도까지가 이 로직의 한계이므로
          // 그 이상은 모델의 한계로 보고 재생성된 결과를 그대로 사용한다 — 완전히
          // 실패로 보이는 것(원래 코드 그대로 방치)보다는 재시도라도 한 결과가 낫다.
          if (retryCode) {
            codes[i] = { index: codes[i].index, code: retryCode };
          }
        } catch (e) {
          // 재생성 실패 시 기존 코드를 그대로 유지한다 — 전체 요청을 실패시키지 않는다.
        }
      }
    }

    const results = codes.map(({ code }) => ({ code }));

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
      // 요청한 개수(variantCount)보다 실제 성공한 시안 수(results.length)가 적으면
      // (OpenAI 개별 호출 중 일부만 rate limit/오류로 실패한 경우) 그 사실을 클라이언트가
      // 알 수 있도록 requestedCount를 함께 내려준다. 응답 형식은 하위 호환을 위해
      // 항상 존재하는 필드가 아니라 부족한 경우에만 추가되는 선택적 필드로 둔다.
      if (results.length < variantCount) {
        responsePayload.requestedCount = variantCount;
      }
    }
    // v2 요청(diagramType/style 중 하나라도 명시)에만 style/palette를 함께 내려준다.
    // v1(스타일 미지정) 요청은 응답 형식이 완전히 그대로 유지되어야 하므로 이 필드를 붙이지 않는다.
    // 프론트는 이 palette로 카드 Preview의 Mermaid themeVariables를 선택된 스타일에 맞게 렌더링한다.
    if (isV2Request) {
      const styleInfo = resolveStyle(style);
      responsePayload.style = style && STYLE_KEYS.has(style) ? style : DEFAULT_STYLE_KEY;
      responsePayload.palette = styleInfo.palette;
    }
    sendJson(res, 200, responsePayload);
  } catch (err) {
    sendJson(res, 502, { error: `AI 다이어그램 생성 실패: ${err.message}` });
  }
}

module.exports = { handleAiDiagram };
