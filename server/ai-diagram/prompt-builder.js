const { DIAGRAM_TYPES, DEFAULT_DIAGRAM_TYPE } = require("./diagram-types.js");
const { STYLES, DEFAULT_STYLE } = require("./styles.js");

// v1(AI_DIAGRAM_SYSTEM_PROMPT)과 동일한 규칙을 유지하는 공통 지시문.
// PREFIX는 유형 지시보다 앞에, SUFFIX는 유형 지시보다 뒤에 위치해야
// diagramType을 지정하지 않았을 때 v1과 완전히 동일한 문자열이 재현된다.
const COMMON_PREFIX = ["너는 텍스트를 Mermaid 다이어그램 코드로 변환하는 도구다."];
const COMMON_SUFFIX = [
  "flowchart를 쓸 경우 방향은 LR을 기본으로 하되, 내용상 TD가 더 적합하면 TD를 써도 된다.",
  "노드 라벨과 텍스트는 입력 언어(주로 한국어)를 그대로 유지하라.",
  "응답은 오직 Mermaid 코드만 반환하라. 코드 펜스(```)나 설명 문장, 인사말을 절대 포함하지 마라.",
  "첫 줄은 반드시 다이어그램 타입 키워드(flowchart, sequenceDiagram 등)로 시작해야 한다.",
];

function resolveDiagramType(diagramType) {
  if (typeof diagramType === "string" && DIAGRAM_TYPES[diagramType]) {
    return DIAGRAM_TYPES[diagramType];
  }
  return DIAGRAM_TYPES[DEFAULT_DIAGRAM_TYPE];
}

function resolveStyle(style) {
  if (typeof style === "string" && STYLES[style]) {
    return STYLES[style];
  }
  return STYLES[DEFAULT_STYLE];
}

// diagramType/style을 조합해 시스템 프롬프트를 만든다.
// 문장 순서: [유형 지시] + [공통 출력 규칙] + [스타일 지시]
// diagramType과 style을 모두 지정하지 않으면(undefined) 유형은 "unspecified"(v1과 동일한
// "AI가 알아서 판단"), 스타일은 "default"(중립 톤 한 문장 추가)로 fallback된다.
// v1과 완전히 동일한 문자열이 필요하면 style 지시문 없이 유형+공통규칙만 쓰도록
// 호출부(handler)에서 style을 명시적으로 넘기지 않으면 된다 — 이 함수 자체는 항상
// style 지시문을 이어붙이므로, 완전한 v1 fallback 여부는 handler의 옵션으로 제어한다.
function buildDiagramPrompt({ diagramType, style, includeStyleInstruction = true } = {}) {
  const typeInfo = resolveDiagramType(diagramType);
  const parts = [...COMMON_PREFIX, typeInfo.instruction, ...COMMON_SUFFIX];

  if (includeStyleInstruction) {
    const styleInfo = resolveStyle(style);
    parts.push(styleInfo.instruction);
  }

  return parts.join(" ");
}

module.exports = { buildDiagramPrompt, resolveDiagramType, resolveStyle };
