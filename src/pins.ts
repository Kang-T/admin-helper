import { SETTINGS } from "./catalog/settings";

// 홈 「자주 쓰는 바로가기」에 고정할 설정 바로가기 id. 이 브라우저에만 저장된다.
const KEY = "admin-helper-pins";
const MAX = 8;

export const DEFAULT_PINS = ["users", "classroom-settings", "drive-sharing", "password-mgmt", "2sv", "takeout"];

const exists = (id: unknown): id is string => SETTINGS.some((s) => s.id === id);

export function getPins(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return DEFAULT_PINS;
    const ids: unknown = JSON.parse(raw);
    if (!Array.isArray(ids)) return DEFAULT_PINS;
    return ids.filter(exists);
  } catch {
    return DEFAULT_PINS;
  }
}

// 고정돼 있으면 빼고, 아니면 끝에 더한다. 이미 8개면 더하지 않고 그대로 돌려준다.
export function togglePin(id: string): string[] {
  const pins = getPins();
  let next: string[];
  if (pins.includes(id)) next = pins.filter((p) => p !== id);
  else if (pins.length >= MAX) return pins;
  else next = [...pins, id];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 저장이 막힌 브라우저: 이번 화면에서만 바뀐다
  }
  return next;
}
