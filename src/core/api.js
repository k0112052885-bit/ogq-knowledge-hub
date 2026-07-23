// ============================================================
// API helper
// ============================================================
export async function api(path, options) {
  const res = await fetch(path, options);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // 본문 없는 응답 허용
  }
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `요청 실패 (HTTP ${res.status})`;
    throw new Error(message);
  }
  return data;
}
