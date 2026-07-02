# OGQ Knowledge Hub

Markdown 문서를 넣으면 GitBook/Docusaurus 스타일의 탭형 HTML 문서 사이트로
자동 생성되는 정적 문서 생성기입니다. 결과물은 `file://` 로 직접 열어도 동작하며,
별도의 서버가 필요 없습니다.

## 폴더 구조

```
docs/        # 원본 Markdown 문서 (Front Matter 포함)
assets/      # CSS/JS 등 정적 자산 (빌드 시 dist/assets 로 복사됨)
dist/        # 빌드 결과물 (npm run build 시마다 삭제 후 재생성)
generate.js  # 빌드 스크립트
```

## 설치

```bash
npm install
```

## 실행 (빌드)

```bash
npm run build
```

실행하면 다음 순서로 동작합니다.

1. `dist/` 폴더를 삭제하고 새로 만듭니다.
2. `assets/` 를 `dist/assets/` 로 복사합니다.
3. `docs/*.md` 파일을 모두 읽어 Front Matter(YAML)와 본문을 파싱합니다.
4. `docs/index.md` → `dist/index.html`
5. 나머지 `docs/파일명.md` → `dist/파일명.html`
6. 좌측 사이드바(카테고리별 문서 그룹), 우측 목차(TOC), 이전/다음 문서
   네비게이션을 모든 페이지에 자동 생성합니다.
7. 검색용 데이터를 `dist/assets/search-index.js`(페이지 내 검색창용),
   `dist/search-index.json`, `dist/sidebar.json`(향후 검색/탐색 기능 확장용)로 생성합니다.

빌드가 끝나면 `dist/index.html` 을 브라우저에서 더블클릭(또는 `file://` 경로로)
열어 확인할 수 있습니다.

## 화면 구성

- **좌측 사이드바**: `category` 기준으로 문서를 그룹화해 아코디언 형태로 표시하고,
  문서 검색창을 제공합니다. 데스크톱에서는 고정, 모바일에서는 오프캔버스 메뉴로 접힙니다.
- **중앙 본문**: 문서 제목, 상태 배지, 마지막 수정일, 태그, 본문, 이전/다음 문서 링크 순으로 표시됩니다.
- **우측 목차(TOC)**: 본문의 `h2`/`h3` 헤딩을 자동 추출해 표시하며, 스크롤 위치에 따라
  현재 보고 있는 섹션이 강조됩니다. 1180px 이하에서는 숨겨지고, 모바일에서는 본문 하단에 표시됩니다.
- **다크모드**: OS/브라우저의 `prefers-color-scheme` 설정에 따라 자동으로 전환됩니다.
  별도 토글 없이 라이트/다크 톤 모두 CSS 변수로 관리됩니다.

## 문서 작성법

`docs/` 폴더에 `.md` 파일을 추가하면 자동으로 빌드 대상이 됩니다.
각 문서는 아래와 같은 YAML Front Matter 로 시작합니다.

```markdown
---
title: 설계 문서
description: 프로젝트 설계 내용
category: 설계
tags:
  - architecture
  - docs
status: review
order: 1
updated: 2026-07-02
---

# 본문 제목

여기부터 Markdown 본문을 작성합니다.
```

### Front Matter 필드

| 필드 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `title` | 아니오 | 파일명(slug) | 사이드바/탭/`<title>`에 표시되는 문서 제목 |
| `description` | 아니오 | 빈 문자열 | 문서 요약. 검색 시 매칭 대상이며 검색 결과 스니펫으로도 사용됨 |
| `category` | 아니오 | `기타` | 사이드바 그룹핑 기준. 같은 값을 가진 문서끼리 하나의 접이식 그룹으로 묶임 |
| `tags` | 아니오 | 빈 배열 | 본문 상단에 `#tag` 형태로 표시. YAML 리스트 또는 쉼표 구분 문자열 모두 지원 |
| `status` | 아니오 | 없음(배지 미표시) | `draft`(초안) / `review`(검토중) / `locked`(확정) 상태 배지 |
| `order` | 아니오 | `999` | 사이드바/이전·다음 네비게이션 정렬 순서. 숫자가 작을수록 앞쪽 |
| `updated` | 아니오 | 없음(표시 안 됨) | 마지막 수정일. 문서 제목 아래 "마지막 수정: YYYY-MM-DD"로 표시 |

**기존 문서와의 호환성**: `category`, `tags`, `description`, `updated` 필드가 없는
기존 문서도 그대로 빌드됩니다. `category`가 없으면 "기타" 그룹으로 자동 분류되고,
`tags`/`updated`가 없으면 해당 UI 요소가 자동으로 생략됩니다.

### 규칙

- `docs/index.md` 는 항상 `dist/index.html` 로 생성되며, 문서 묶음의 첫 화면 역할을 합니다.
- 파일명이 곧 결과 HTML 파일명이 됩니다. 예: `01_design.md` → `01_design.html`
- 문서 간 링크는 **같은 폴더 기준 상대 경로**로 작성하세요. (`file://` 환경에서도 동작하려면 필수)
  ```markdown
  [설계 문서 보기](01_design.html)
  ```
- `h2`, `h3` 제목에는 자동으로 anchor id가 부여되어 우측 목차와 연결됩니다.
- `order` 를 지정하지 않으면 맨 뒤로 정렬되며, 이전/다음 문서 네비게이션도 이 순서를 따릅니다.
  - 첫 번째 문서는 "다음 문서" 링크만, 마지막 문서는 "이전 문서" 링크만 표시됩니다.

### 지원하는 Markdown 문법

- 표(테이블) — 헤더 배경, 행 hover 효과 적용
- 코드 블록 (` ``` `) — GitHub 스타일 다크 코드블록 + Copy 버튼
- 체크박스 목록 (`- [ ]`, `- [x]`)
- 인용문(`>`), 링크, 강조 등 기본 Markdown 문법 전반
- Mermaid 다이어그램, Callout(강조 박스), 이미지 캡션 (아래 항목 참고)

### Mermaid 다이어그램

코드블록 언어를 `mermaid`로 지정하면 흐름도/시퀀스 다이어그램 등이 자동으로
렌더링됩니다.

````markdown
```mermaid
flowchart LR
  A[문서 작성] --> B[npm run build]
  B --> C[HTML 생성]
  C --> D[브라우저 확인]
```
````

- 렌더링은 [Mermaid CDN](https://cdn.jsdelivr.net/npm/mermaid@10)을 통해 클라이언트에서 이루어집니다.
  인터넷 연결이 없으면 다이어그램 대신 원본 코드가 표시됩니다.
- 다크모드(`prefers-color-scheme: dark`)에서는 Mermaid 테마도 자동으로 다크 테마로 전환됩니다.
- 문서에 `mermaid` 코드블록이 없으면 CDN 스크립트 자체가 로드되지 않아 불필요한 요청이 발생하지 않습니다.

### Callout (강조 박스)

GitHub 스타일 alert 문법을 사용합니다. blockquote 첫 줄에 `[!TYPE]` 마커를 넣으면
자동으로 색상 박스로 변환됩니다.

```markdown
> [!NOTE]
> 참고할 정보를 여기에 작성합니다.

> [!TIP]
> 도움이 되는 팁입니다.

> [!WARNING]
> 주의가 필요한 내용입니다.

> [!DANGER]
> 위험하거나 되돌릴 수 없는 작업에 대한 경고입니다.
```

지원 타입은 `NOTE`(파랑) / `TIP`(초록) / `WARNING`(노랑) / `DANGER`(빨강) 4종이며,
대소문자를 구분하지 않습니다. 마커가 없는 일반 `>` 인용문은 기존과 동일하게 표시됩니다.

### 이미지

일반 Markdown 이미지 문법을 그대로 사용하면 됩니다.

```markdown
![대체 텍스트(캡션으로도 표시됨)](assets/images/파일명.png)
```

- 이미지는 `<figure>`로 감싸져 렌더링되며, `alt` 텍스트가 있으면 이미지 아래
  캡션으로 함께 표시됩니다.
- 반응형으로 처리되어 뷰포트 폭에 맞게 자동으로 축소됩니다.
- 이미지 파일은 `assets/` 아래(예: `assets/images/`)에 두면 빌드 시 `dist/assets/`로
  함께 복사되어 `file://` 환경에서도 상대 경로로 정상 표시됩니다.

## 검색

사이드바 상단 검색창에 입력하면 아래 항목을 기준으로 문서를 찾습니다.

- 제목 (`title`)
- 설명 (`description`)
- 태그 (`tags`)
- 본문 텍스트

검색 결과는 필드별 가중치(제목 > 태그 > 설명 > 본문)를 적용한 관련도 점수로
정렬됩니다. 제목이 검색어로 시작하는 문서는 더 높은 우선순위를 받습니다.
검색은 빌드 시 생성되는 `dist/assets/search-index.js`를 `<script>` 태그로 불러와
클라이언트에서 동작하므로, `file://` 환경에서도 별도 서버 없이 정상 작동합니다.

## 빌드 산출물

`npm run build` 실행 시 `dist/` 아래에 다음이 생성됩니다.

- `index.html`, `문서명.html` — 각 문서의 페이지
- `assets/style.css`, `assets/main.js` — 스타일 및 클라이언트 스크립트
- `assets/search-index.js` — 페이지 내 검색창이 사용하는 인덱스 (`file://`에서도 동작하도록 JS 형태)
- `search-index.json` — 동일한 검색 데이터의 JSON 버전 (향후 검색 성능 개선/외부 도구 연동용)
- `sidebar.json` — 카테고리별로 그룹화된 문서 목록 데이터 (향후 탐색 UI 개선용)

## 샘플 문서

`docs/` 폴더에는 통신사 구독 연동 프로젝트를 예시로 한 샘플 문서 5개가 포함되어 있습니다.

- `index.md` (category: 개요) — 문서 묶음 소개 및 목차
- `01_design.md` (category: 설계) — 연동 설계
- `02_candidates.md` (category: 설계) — 연동 방식 후보 비교
- `03_decision_gate.md` (category: 운영) — 최종 의사결정 기록
- `04_partner_inquiry.md` (category: 운영) — 파트너사 문의서 초안

새 프로젝트에 맞게 이 파일들을 수정하거나, 같은 형식으로 새 문서를 추가해서 사용하세요.
