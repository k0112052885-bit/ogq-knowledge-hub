// AI Diagram v2가 지원하는 다이어그램 유형별 프롬프트 지시문.
//
// 각 항목의 instruction은 시스템 프롬프트에 그대로 이어붙는 한 문장(또는 여러 문장)이며,
// 기존 AI_DIAGRAM_SYSTEM_PROMPT(v1)의 규칙(방향/코드펜스 금지/타입 키워드로 시작)과
// 상충하지 않도록 "무엇을 표현할지"만 지시하고 "어떻게 출력할지"는 건드리지 않는다.
//
// key가 없거나 목록에 없는 값이 오면 prompt-builder.js가 DEFAULT_DIAGRAM_TYPE(unspecified)로
// fallback하므로, 이 파일에 새 유형을 추가할 때 기존 항목을 변경할 필요는 없다.
const DIAGRAM_TYPES = {
  unspecified: {
    label: "자동",
    instruction:
      "사용자가 준 문장/구조 설명을 가장 적절한 Mermaid 다이어그램 종류(flowchart, sequenceDiagram, classDiagram 등)로 표현하라.",
  },
  process: {
    label: "프로세스",
    instruction:
      "이 내용을 단계별 프로세스(순서가 있는 절차)로 표현하라. flowchart를 사용하고, 각 단계를 화살표로 순서대로 연결하라.",
  },
  orgchart: {
    label: "조직도",
    instruction:
      "이 내용을 계층 구조(조직도)로 표현하라. flowchart TD(위에서 아래로)를 사용해 상위 조직/역할에서 하위 조직/역할로 트리 형태로 연결하라.",
  },
  cycle: {
    label: "순환 구조",
    instruction:
      "이 내용을 순환 구조(반복되는 사이클)로 표현하라. flowchart를 사용하고 마지막 단계에서 첫 단계로 돌아가는 화살표를 포함해 순환이 명확히 드러나게 하라.",
  },
  timeline: {
    label: "타임라인",
    instruction:
      "이 내용을 시간 순서에 따른 타임라인으로 표현하라. 가능하면 Mermaid의 timeline 문법을 사용하고, 적합하지 않다면 flowchart LR로 좌에서 우로 시간 흐름을 표현하라.",
  },
  pyramid: {
    label: "피라미드",
    instruction:
      "이 내용을 우선순위 또는 위계가 있는 피라미드 구조로 표현하라. flowchart TD를 사용해 상위 개념을 위쪽, 하위/세부 개념을 아래쪽에 배치하고 계층 관계를 화살표로 표현하라.",
  },
  comparison: {
    label: "비교 구조",
    instruction:
      "이 내용을 두 개 이상의 대상을 나란히 비교하는 구조로 표현하라. flowchart LR을 사용해 비교 대상들을 좌우로 배치하고, 공통 기준이나 관계가 있다면 화살표나 subgraph로 묶어 표현하라.",
  },
  roadmap: {
    label: "로드맵",
    instruction:
      "이 내용을 단계별 로드맵(마일스톤 계획)으로 표현하라. flowchart LR을 사용해 시간/단계 순서대로 마일스톤을 좌에서 우로 연결하라.",
  },
};

const DEFAULT_DIAGRAM_TYPE = "unspecified";

module.exports = { DIAGRAM_TYPES, DEFAULT_DIAGRAM_TYPE };
