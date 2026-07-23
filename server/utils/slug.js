// 자주 쓰는 한글 카테고리를 의미 있는 영문 slug로 매핑.
// 제목/카테고리가 전부 한글이라 ASCII 필터링 후 빈 문자열이 될 때의 fallback으로 사용된다.
const CATEGORY_SLUG_MAP = {
  목표: "goal",
  전략: "strategy",
  기획: "plan",
  설계: "design",
  개발: "dev",
  운영: "ops",
  마케팅: "marketing",
  영업: "sales",
  회의록: "meeting",
  정책: "policy",
  가이드: "guide",
  기타: "doc",
};

function asciiSlug(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function categoryToSlug(category) {
  if (!category) return "";
  const trimmed = String(category).trim();
  if (CATEGORY_SLUG_MAP[trimmed]) return CATEGORY_SLUG_MAP[trimmed];
  return asciiSlug(trimmed);
}

// 제목 → 카테고리 → 생성 날짜 순으로 시도해 의미 있는 영문 slug를 만든다.
// 예: 제목 "마켓본부 운영"(한글만) + 카테고리 "목표" → "goal"
//     제목/카테고리 모두 매핑 실패 → "doc-0707"(월일) 같은 날짜 기반 fallback
function slugifyTitle(title, category) {
  const fromTitle = asciiSlug(title);
  if (fromTitle) return fromTitle;

  const fromCategory = categoryToSlug(category);
  if (fromCategory) return fromCategory;

  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `doc-${mm}${dd}`;
}

module.exports = { CATEGORY_SLUG_MAP, asciiSlug, categoryToSlug, slugifyTitle };
