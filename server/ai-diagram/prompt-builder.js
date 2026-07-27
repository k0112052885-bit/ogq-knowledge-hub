const { DIAGRAM_TYPES, DEFAULT_DIAGRAM_TYPE } = require("./diagram-types.js");
const { STYLES, DEFAULT_STYLE } = require("./styles.js");

// v1(AI_DIAGRAM_SYSTEM_PROMPT)과 동일한 규칙을 유지하는 공통 지시문.
// PREFIX는 유형 지시보다 앞에, SUFFIX는 유형 지시보다 뒤에 위치해야
// diagramType을 지정하지 않았을 때 v1과 완전히 동일한 문자열이 재현된다.
const COMMON_PREFIX = ["너는 텍스트를 Mermaid 다이어그램 코드로 변환하는 도구다."];
const COMMON_SUFFIX = [
  "flowchart를 쓸 경우 방향은 LR을 기본으로 하되, 내용상 TD가 더 적합하면 TD를 써도 된다.",
  "flowchart 노드는 각진 사각형 대신 둥근 형태를 우선 사용하라: 일반 노드는 A(\"라벨\") 형태(round-edge), 강조하고 싶은 핵심 노드는 A([\"라벨\"]) 형태(stadium)를 사용하라. 대괄호만 쓰는 각진 사각형 A[\"라벨\"]은 꼭 필요한 경우(예: subgraph 컨테이너 라벨)가 아니면 피하라.",
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
// - Variant 1(index 0): 선택된 타입의 가장 표준적인 구조. 별도 지시 없이 기본 동작 그대로.
// - Variant 2(index 1): 같은 내용을 다른 레이아웃/그룹핑으로 재구성(subgraph, 계층, 강조 단계 등).
// - Variant 3(index 2): 핵심 메시지를 요약한 프레젠테이션형 구조. 중요 노드를 강조하고
//   Variant 1/2와 다른 시각적 구성을 취한다.
const VARIANT_PERSPECTIVES = [
  null,
  "이 시안(Variant 2)에서는 Variant 1과 다른 레이아웃 방향이나 그룹 구조를 사용하라. 예를 들어 Variant 1이 가로(LR) 단순 흐름이었다면 세로(TD) 계층 구조로, 또는 subgraph로 단계를 그룹핑하거나 분기 구조를 추가해 표현하라. Variant 1과 노드 개수/연결 방식이 동일한 코드를 만들지 마라.",
  "이 시안(Variant 3)에서는 전체 내용을 그대로 나열하지 말고, 핵심 메시지만 압축한 프레젠테이션형 요약 구조로 표현하라. 가장 중요한 1~2개 노드는 강조 노드 형태(예: A([\"핵심 강조\"]) 같은 stadium/둥근 강조 도형)로 구분하고, Variant 1·2와는 전혀 다른 배치(예: 순환, 방사형, 비교형 중 앞에서 쓰지 않은 방식)를 사용하라. Variant 1, 2와 노드 구성이 비슷한 코드를 반복하지 마라.",
];

// process(프로세스) 타입 전용 variant 관점 지시문.
// 일반 VARIANT_PERSPECTIVES의 "분기 구조를 추가하라"/"순환·방사형 배치"는
// process 타입의 핵심 규칙("분기나 되돌아가는 화살표 없이 선형 흐름")과 정면으로
// 충돌해, 모델이 두 지시를 동시에 만족시키려다 같은 노드에 화살표가 몰리거나
// 레이아웃이 붕괴하는 원인이 되었다. process는 방향/그룹 구조만 바꾸고 "선형"이라는
// 제약은 세 시안 모두에서 항상 유지하도록 별도로 명시한다.
const PROCESS_VARIANT_PERSPECTIVES = [
  "이 시안(Variant 1)은 flowchart LR을 사용해 각 단계를 왼쪽에서 오른쪽으로 한 줄로 배치하라. 분기, 병렬 경로, 되돌아가는 화살표 없이 각 노드는 정확히 다음 노드 하나로만 이어지는 완전한 선형 흐름으로 표현하라.",
  "이 시안(Variant 2)은 Variant 1과 다르게 flowchart TD를 사용해 각 단계를 위에서 아래로 한 줄로 배치하라. 방향만 세로로 바꿀 뿐, Variant 1과 마찬가지로 분기·병렬 경로·되돌아가는 화살표 없이 각 노드가 정확히 다음 노드 하나로만 이어지는 완전한 선형 흐름을 유지하라.",
  "이 시안(Variant 3)은 flowchart LR과 subgraph를 사용해 전체 단계를 2~3개의 phase(단계 그룹)로 묶어라. 각 phase는 subgraph로 감싸고, phase 내부와 phase 사이 모두 각 노드가 정확히 다음 노드 하나로만 이어지는 선형 흐름을 유지하라(분기, 병렬 경로, 되돌아가는 화살표 금지). 하나의 노드에서 두 개 이상의 화살표가 나가거나 들어오게 만들지 마라.",
];

function resolveVariantPerspective(variantIndex, diagramType) {
  if (typeof variantIndex !== "number" || variantIndex < 0) {
    return null;
  }
  if (diagramType === "process") {
    return PROCESS_VARIANT_PERSPECTIVES[variantIndex] || PROCESS_VARIANT_PERSPECTIVES[PROCESS_VARIANT_PERSPECTIVES.length - 1];
  }
  if (variantIndex === 0) return null;
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

  const perspective = resolveVariantPerspective(variantIndex, diagramType);
  if (perspective) {
    parts.push(perspective);
  }

  return parts.join(" ");
}

module.exports = { buildDiagramPrompt, resolveDiagramType, resolveStyle };
