# OGQ Knowledge Hub

Markdown 문서를 넣으면 탭형 HTML 문서 묶음으로 자동 생성되는 정적 문서 생성기입니다.
결과물은 `file://` 로 직접 열어도 동작하며, 별도의 서버가 필요 없습니다.

## 폴더 구조

```
docs/        # 원본 Markdown 문서 (Front Matter 포함)
assets/      # CSS 등 정적 자산 (빌드 시 dist/assets 로 복사됨)
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
6. 모든 HTML 상단에 문서 목록 기반 탭 네비게이션을 생성하고,
   현재 보고 있는 문서의 탭에 `active` 스타일을 적용합니다.

빌드가 끝나면 `dist/index.html` 을 브라우저에서 더블클릭(또는 `file://` 경로로)
열어 확인할 수 있습니다.

## 문서 작성법

`docs/` 폴더에 `.md` 파일을 추가하면 자동으로 빌드 대상이 됩니다.
각 문서는 아래와 같은 YAML Front Matter 로 시작해야 합니다.

```markdown
---
title: 문서 제목
status: draft   # draft(초안) | review(검토중) | locked(확정)
order: 1        # 탭 정렬 순서 (숫자가 작을수록 앞쪽)
---

# 본문 제목

여기부터 Markdown 본문을 작성합니다.
```

### 규칙

- `docs/index.md` 는 항상 `dist/index.html` 로 생성되며, 문서 묶음의 첫 화면 역할을 합니다.
- 파일명이 곧 결과 HTML 파일명이 됩니다. 예: `01_design.md` → `01_design.html`
- 문서 간 링크는 **같은 폴더 기준 상대 경로**로 작성하세요. (`file://` 환경에서도 동작하려면 필수)
  ```markdown
  [설계 문서 보기](01_design.html)
  ```
- `status` 값에 따라 탭과 본문 상단에 상태 배지가 표시됩니다.
  - `draft` → 초안
  - `review` → 검토중
  - `locked` → 확정
- `order` 를 지정하지 않으면 맨 뒤로 정렬됩니다.

### 지원하는 Markdown 문법

- 표(테이블)
- 코드 블록 (` ``` `)
- 체크박스 목록 (`- [ ]`, `- [x]`)
- 인용문(`>`), 링크, 강조 등 기본 Markdown 문법 전반

## 샘플 문서

`docs/` 폴더에는 통신사 구독 연동 프로젝트를 예시로 한 샘플 문서 4개가 포함되어 있습니다.

- `index.md` — 문서 묶음 소개 및 목차
- `01_design.md` — 연동 설계
- `02_candidates.md` — 연동 방식 후보 비교
- `03_decision_gate.md` — 최종 의사결정 기록
- `04_partner_inquiry.md` — 파트너사 문의서 초안

새 프로젝트에 맞게 이 파일들을 수정하거나, 같은 형식으로 새 문서를 추가해서 사용하세요.
