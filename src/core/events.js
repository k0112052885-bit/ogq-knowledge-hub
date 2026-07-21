// 최소 pub/sub 이벤트 버스. features 간 직접 참조를 줄이기 위한 통신 채널.
const listeners = new Map();

export function on(eventName, handler) {
  if (!listeners.has(eventName)) listeners.set(eventName, new Set());
  listeners.get(eventName).add(handler);
  return () => off(eventName, handler);
}

export function off(eventName, handler) {
  const set = listeners.get(eventName);
  if (set) set.delete(handler);
}

export function emit(eventName, payload) {
  const set = listeners.get(eventName);
  if (!set) return;
  set.forEach((handler) => handler(payload));
}
