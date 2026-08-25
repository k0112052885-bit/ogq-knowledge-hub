// Docs Builder 앱 버전의 단일 출처(source of truth). package.json의 version 필드는
// 이 프로젝트의 릴리스 버전과 별개로 관리되어 온 값(1.0.0에 고정)이라 실제 표시용
// 버전과 다르므로 재사용하지 않는다. 이 상수를 여러 파일에 문자열로 흩뿌리지 않고
// admin 헤더 배지 등 버전을 표시해야 하는 곳에서 항상 이 값만 import해서 쓴다.
export const APP_VERSION = "v1.2.2";
