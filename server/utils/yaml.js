// YAML 큰따옴표 문자열 값으로 안전하게 이스케이프 (colon, quote 등 특수문자 방어)
function formatYamlString(value) {
  return JSON.stringify(String(value));
}

// "tags:" 뒤에 바로 붙일 수 있는 완전한 YAML 조각을 반환한다.
// 빈 배열이면 "tags: []"(콜론 뒤 공백 필수 - 없으면 YAML 파싱 에러 발생),
// 값이 있으면 "tags:\n  - ..." 형태의 블록 리스트를 반환한다.
function formatYamlList(items) {
  if (!items.length) return " []";
  return "\n" + items.map((t) => `  - ${formatYamlString(t)}`).join("\n");
}

// 붙여넣은 Front Matter의 tags 값(배열 또는 쉼표 구분 문자열)을 배열로 정규화
function normalizeImportedTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

// front matter 블록 안에서 특정 key: 줄 하나만 정확히 찾아 치환한다.
// gray-matter로 파싱 후 matter.stringify로 재조합하면 따옴표 스타일, 날짜 포맷,
// 필드 순서 등이 원본과 달라져 "기존 문서 수정 금지" 원칙에 어긋나므로,
// 문자열 치환만으로 해당 줄 하나(그리고 그 값)만 바꾸고 나머지는 완전히 보존한다.
// 필드 자체가 없으면 null을 반환한다(title/projectTitle은 항상 존재해야 하는 필드이므로
// 없는 경우는 파일 형식이 예상과 다르다는 뜻이며 실패로 처리한다).
function replaceFrontMatterField(content, key, value) {
  const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*\r?\n?)/);
  if (!match) return null;

  const [, open, yamlBlock, close] = match;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyRe = new RegExp(`^${escapedKey}\\s*:`);

  let found = false;
  const newYaml = yamlBlock
    .split(/\r?\n/)
    .map((line) => {
      if (keyRe.test(line)) {
        found = true;
        return `${key}: ${formatYamlString(value)}`;
      }
      return line;
    })
    .join("\n");

  if (!found) return null;
  return open + newYaml + close + content.slice(match[0].length);
}

module.exports = {
  formatYamlString,
  formatYamlList,
  normalizeImportedTags,
  replaceFrontMatterField,
};
