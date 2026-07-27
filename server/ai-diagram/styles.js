// AI Diagram v2가 지원하는 스타일(컨설팅/빅테크 톤)별 프롬프트 지시문 + 색상 팔레트.
//
// 이전 버전은 스타일이 "노드 라벨링 톤"에만 영향을 주고 실제 색상은 프론트가 단일
// 다크 팔레트로 고정 렌더링했다. 이번 버전은 스타일별로 실제 Mermaid themeVariables에
// 반영될 palette(배경/노드/글자/테두리/포인트색)를 함께 정의해, 프론트(ai-diagram.js)가
// 카드 렌더링 시 선택된 style에 맞는 palette로 mermaid.initialize를 호출할 수 있게 한다.
// instruction은 여전히 라벨링 톤을 지시하되, 이제는 palette가 실제 색상/형태 차이를 만든다.
//
// key가 없거나 목록에 없는 값이 오면 prompt-builder.js가 DEFAULT_STYLE(default, Docs Builder
// 차콜 테마 기준의 중립 톤)로 fallback하므로, v1 호출(스타일 미지정)은 이 항목의 instruction만
// 추가로 받는다. 이 instruction은 "포함할 것"만 지시하고 "코드펜스 금지/타입 키워드로 시작"
// 같은 출력 형식 규칙은 건드리지 않는다.
const STYLES = {
  default: {
    label: "기본 (Docs Builder)",
    instruction:
      "특별한 스타일 지시가 없다면 간결하고 명확한 라벨을 사용해 일반적인 다이어그램으로 표현하라.",
    palette: {
      background: "#0b0e14",
      nodeBg: "#171c26",
      nodeAccentBg: "#202a3a",
      text: "#f4f7fb",
      textSecondary: "#a7b0c0",
      border: "#4f7cff",
      line: "#536074",
      accent: "#6c8cff",
    },
  },
  mckinsey: {
    label: "McKinsey",
    instruction:
      "McKinsey 스타일 컨설팅 보고서처럼, 각 노드 라벨을 명사구가 아닌 완결된 액션/인사이트 문장(액션 타이틀)으로 간결하게 작성하라.",
    palette: {
      background: "#0d1117",
      nodeBg: "#172033",
      nodeAccentBg: "#1d2c4a",
      text: "#f8fafc",
      textSecondary: "#94a3b8",
      border: "#3b82f6",
      line: "#475569",
      accent: "#3b82f6",
    },
  },
  bcg: {
    label: "BCG",
    instruction:
      "BCG 스타일 전략 보고서처럼, 구조를 2x2 매트릭스나 대비되는 축(예: 높음/낮음, 성장/점유율) 개념이 드러나도록 노드를 구성하고 라벨을 간결한 키워드로 작성하라.",
    palette: {
      background: "#0c1110",
      nodeBg: "#15241f",
      nodeAccentBg: "#1a3129",
      text: "#ecfdf5",
      textSecondary: "#86efac",
      border: "#34d399",
      line: "#4b6359",
      accent: "#34d399",
    },
  },
  deloitte: {
    label: "Deloitte",
    instruction:
      "Deloitte 스타일 컨설팅 자료처럼, 프로세스/역량 단계를 명확히 번호가 매겨진 순서형 라벨(예: '1. ...', '2. ...')로 구성하라.",
    palette: {
      background: "#10120f",
      nodeBg: "#20251c",
      nodeAccentBg: "#293121",
      text: "#f7fee7",
      textSecondary: "#bef264",
      border: "#a3e635",
      line: "#5a6350",
      accent: "#a3e635",
    },
  },
  microsoft: {
    label: "Microsoft",
    instruction:
      "Microsoft 제품 문서 스타일처럼, 기술적이고 명료한 용어로 노드 라벨을 작성하고 시스템/컴포넌트 간의 관계를 명확한 동사(예: '요청', '반환', '호출')로 표현하라.",
    palette: {
      background: "#0e1118",
      nodeBg: "#182235",
      nodeAccentBg: "#1e2d47",
      text: "#f1f5f9",
      textSecondary: "#93c5fd",
      border: "#38bdf8",
      line: "#4b5c73",
      accent: "#38bdf8",
    },
  },
  apple: {
    label: "Apple",
    instruction:
      "Apple 스타일 제품 소개 자료처럼, 노드 라벨을 최소한의 단어로 압축하고 불필요한 수식어 없이 핵심 개념만 남겨라.",
    palette: {
      background: "#0e1116",
      nodeBg: "#1c222c",
      nodeAccentBg: "#262d38",
      text: "#f5f5f7",
      textSecondary: "#a1a1a6",
      border: "#64748b",
      line: "#4b5563",
      accent: "#8ab4f8",
    },
  },
};

const DEFAULT_STYLE = "default";

module.exports = { STYLES, DEFAULT_STYLE };
