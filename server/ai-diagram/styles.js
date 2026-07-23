// AI Diagram v2가 지원하는 스타일(컨설팅/빅테크 톤)별 프롬프트 지시문.
//
// 이 단계(프롬프트 빌더 분리)에서는 스타일이 "노드 라벨링/구조를 어떤 톤으로 만들지"에만
// 영향을 준다. 실제 색상 팔레트(Mermaid themeVariables)는 프론트엔드 렌더링 단계의 몫이며
// 아직 구현하지 않는다 — 이 파일은 프롬프트 문구만 다룬다.
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
  },
  mckinsey: {
    label: "McKinsey",
    instruction:
      "McKinsey 스타일 컨설팅 보고서처럼, 각 노드 라벨을 명사구가 아닌 완결된 액션/인사이트 문장(액션 타이틀)으로 간결하게 작성하라.",
  },
  bcg: {
    label: "BCG",
    instruction:
      "BCG 스타일 전략 보고서처럼, 구조를 2x2 매트릭스나 대비되는 축(예: 높음/낮음, 성장/점유율) 개념이 드러나도록 노드를 구성하고 라벨을 간결한 키워드로 작성하라.",
  },
  deloitte: {
    label: "Deloitte",
    instruction:
      "Deloitte 스타일 컨설팅 자료처럼, 프로세스/역량 단계를 명확히 번호가 매겨진 순서형 라벨(예: '1. ...', '2. ...')로 구성하라.",
  },
  microsoft: {
    label: "Microsoft",
    instruction:
      "Microsoft 제품 문서 스타일처럼, 기술적이고 명료한 용어로 노드 라벨을 작성하고 시스템/컴포넌트 간의 관계를 명확한 동사(예: '요청', '반환', '호출')로 표현하라.",
  },
  apple: {
    label: "Apple",
    instruction:
      "Apple 스타일 제품 소개 자료처럼, 노드 라벨을 최소한의 단어로 압축하고 불필요한 수식어 없이 핵심 개념만 남겨라.",
  },
};

const DEFAULT_STYLE = "default";

module.exports = { STYLES, DEFAULT_STYLE };
