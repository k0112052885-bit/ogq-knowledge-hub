// AI Diagram v2가 지원하는 다이어그램 유형별 프롬프트 지시문.
//
// 각 항목의 instruction은 시스템 프롬프트에 그대로 이어붙는 한 문장(또는 여러 문장)이며,
// 기존 AI_DIAGRAM_SYSTEM_PROMPT(v1)의 규칙(방향/코드펜스 금지/타입 키워드로 시작)과
// 상충하지 않도록 "무엇을 표현할지"만 지시하고 "어떻게 출력할지"는 건드리지 않는다.
//
// 이전 버전은 "권장" 수준의 문장이라 LLM이 결국 비슷한 flowchart LR 나열로 수렴하는
// 문제가 있었다. 이번 버전은 타입마다 반드시 지켜야 할 문법 요소(방향, subgraph 사용 여부,
// 노드 형태, 금지 사항)를 명시적으로 못박아 타입 간 구조 차이가 실제로 드러나게 한다.
//
// key가 없거나 목록에 없는 값이 오면 prompt-builder.js가 DEFAULT_DIAGRAM_TYPE(unspecified)로
// fallback하므로, 이 파일에 새 유형을 추가할 때 기존 항목을 변경할 필요는 없다.
const DIAGRAM_TYPES = {
  unspecified: {
    label: "자동",
    instruction:
      "사용자가 준 문장/구조 설명을 분석해 내용에 가장 적합한 구조(순차 프로세스, 계층, 순환, 비교, 타임라인 등)를 스스로 판단하고 그 구조에 맞는 Mermaid 다이어그램 종류(flowchart, sequenceDiagram, classDiagram 등)로 표현하라.",
  },
  process: {
    label: "프로세스",
    instruction:
      "이 내용을 단계별 프로세스(순서가 있는 절차)로 표현하라. flowchart LR 또는 TD를 사용해 각 단계를 화살표(-->)로 순서대로 한 줄로 연결하라. 분기나 되돌아가는 화살표 없이 명확한 시작과 끝이 있는 선형 흐름으로 표현하라.",
  },
  orgchart: {
    label: "조직도",
    instruction:
      "이 내용을 계층 구조(조직도)로 표현하라. 반드시 flowchart TD(위에서 아래로)를 사용하고, 최상위 노드 1개에서 시작해 여러 하위 노드로 뻗어나가는 트리 형태(한 부모가 두 개 이상의 자식을 갖는 분기 구조)로 연결하라. 단순히 A-->B-->C처럼 일렬로만 나열하지 마라.",
  },
  cycle: {
    label: "순환 구조",
    instruction:
      "이 내용을 순환 구조(반복되는 사이클)로 표현하라. flowchart TD 또는 LR을 사용해 각 단계를 순서대로 연결하고, 반드시 마지막 노드에서 첫 번째 노드로 되돌아가는 화살표를 추가로 포함해 원형 순환이 시각적으로 닫히게 하라(예: A-->B-->C-->A). 순환 화살표가 없으면 안 된다.",
  },
  timeline: {
    label: "타임라인",
    instruction:
      "이 내용을 시간 순서에 따른 타임라인으로 표현하라. flowchart LR을 사용해 좌에서 우로 시간이 흐르도록 배치하고, 각 노드 라벨 앞이나 별도 텍스트로 순서 번호나 기간/시점(예: '1단계', '2026-Q1' 등, 텍스트에 근거가 있으면 그 표현을 쓰고 없으면 순번을 붙여라)을 표시하라.",
  },
  pyramid: {
    label: "피라미드",
    instruction:
      "이 내용을 우선순위 또는 위계가 있는 피라미드 구조로 표현하라. flowchart TD를 사용하되, 상위 계층 노드 1개가 여러 개의 하위 계층 노드로 넓어지는 형태(한 노드에서 2개 이상의 화살표가 다음 레벨로 뻗어나가는 트리형)로 만들어라. A-->B-->C처럼 단순히 세로로 한 줄만 나열하는 것은 절대 금지한다.",
  },
  comparison: {
    label: "비교 구조",
    instruction:
      "이 내용을 두 개 이상의 대상을 나란히 비교하는 구조로 표현하라. 반드시 flowchart LR과 함께 subgraph 문법을 두 개 이상 사용해 비교 대상 그룹을 좌/우(또는 여러 열)로 분리하고, 각 subgraph 안에 해당 대상의 세부 노드를 배치하라. subgraph 없이 단순 나열하지 마라.",
  },
  roadmap: {
    label: "로드맵",
    instruction:
      "이 내용을 단계별 로드맵(마일스톤 계획)으로 표현하라. flowchart LR을 사용하고, 반드시 subgraph로 2개 이상의 phase(단계/분기)를 구분한 뒤 각 phase 안에 해당 시기의 milestone 노드를 배치하라. subgraph 구분 없이 milestone을 한 줄로만 나열하는 일반 프로세스 형태와 명확히 다르게 만들어라.",
  },
};

const DEFAULT_DIAGRAM_TYPE = "unspecified";

module.exports = { DIAGRAM_TYPES, DEFAULT_DIAGRAM_TYPE };
