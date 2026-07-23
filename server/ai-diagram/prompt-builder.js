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

// 여러 시안(variant)을 생성할 때 각 시안이 서로 다른 표현 방식을 쓰도록 유도하는
// 관점(perspective) 지시문. 같은 텍스트 + 같은 diagramType/style이어도 시안마다
// 이 지시문만 다르게 붙여 실제로 구조/레이아웃이 달라지게 한다.
// index 0은 "가장 일반적인 구성"이라 별도 지시 없이 기본 동작을 그대로 둔다.
const VARIANT_PERSPECTIVES = [
  null,
  "이 시안(Variant 2)에서는 Variant 1과 다른 레이아웃 방향이나 구조를 사용하라. 예를 들어 Variant 1이 가로(LR) 흐름이었다면 세로(TD) 흐름으로, 단순 순서 나열이었다면 계층 구조나 분기 구조로 바꿔서 표현하라. 같은 Mermaid 코드를 반복하지 마라.",
  "이 시안(Variant 3)에서는 Variant 1, 2와도 다른 세 번째 표현 방식을 사용하라. 예를 들어 순환 구조(cycle), 로드맵(마일스톤), 타임라인, 트리/계층 구조 중 앞의 두 시안에서 쓰지 않은 방식을 선택해 표현하라. 같은 Mermaid 코드를 반복하지 마라.",
];

function resolveVariantPerspective(variantIndex) {
  if (typeof variantIndex !== "number" || variantIndex <= 0) {
    return null;
  }
  return VARIANT_PERSPECTIVES[variantIndex] || VARIANT_PERSPECTIVES[VARIANT_PERSPECTIVES.length - 1];
}

// diagramType/style을 조합해 시스템 프롬프트를 만든다.
// 문장 순서: [유형 지시] + [공통 출력 규칙] + [스타일 지시] + [variant 관점 지시(있는 경우)]
// diagramType과 style을 모두 지정하지 않으면(undefined) 유형은 "unspecified"(v1과 동일한
// "AI가 알아서 판단"), 스타일은 "default"(중립 톤 한 문장 추가)로 fallback된다.
// v1과 완전히 동일한 문자열이 필요하면 style 지시문 없이 유형+공통규칙만 쓰도록
// 호출부(handler)에서 style을 명시적으로 넘기지 않으면 된다 — 이 함수 자체는 항상
// style 지시문을 이어붙이므로, 완전한 v1 fallback 여부는 handler의 옵션으로 제어한다.
// variantIndex(0-based)를 넘기지 않으면(undefined) 관점 지시 없이 기존과 동일하게 동작해,
// 단일 생성(v1) 호출부에는 영향이 없다.
function buildDiagramPrompt({ diagramType, style, includeStyleInstruction = true, variantIndex } = {}) {
  const typeInfo = resolveDiagramType(diagramType);
  const parts = [...COMMON_PREFIX, typeInfo.instruction, ...COMMON_SUFFIX];

  if (includeStyleInstruction) {
    const styleInfo = resolveStyle(style);
    parts.push(styleInfo.instruction);
  }

  const perspective = resolveVariantPerspective(variantIndex);
  if (perspective) {
    parts.push(perspective);
  }

  return parts.join(" ");
}

module.exports = { buildDiagramPrompt, resolveDiagramType, resolveStyle };
