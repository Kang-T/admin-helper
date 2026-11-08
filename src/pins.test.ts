import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PINS, getPins, togglePin } from "./pins";
import { SETTINGS } from "./catalog/settings";

const KEY = "admin-helper-pins";

// 브라우저 localStorage 대신 쓰는 간단한 가짜
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

let store: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  store = fakeStorage();
  vi.stubGlobal("localStorage", store);
});
afterEach(() => vi.unstubAllGlobals());

describe("바로가기 고정", () => {
  it("기본 핀 6개는 모두 실제 설정이다", () => {
    expect(DEFAULT_PINS).toHaveLength(6);
    for (const id of DEFAULT_PINS) expect(SETTINGS.some((s) => s.id === id), id).toBe(true);
  });

  it("저장된 값이 없으면 기본 핀", () => {
    expect(getPins()).toEqual(DEFAULT_PINS);
  });

  it("저장된 값이 깨졌거나 배열이 아니면 기본 핀", () => {
    store.data.set(KEY, "{깨짐");
    expect(getPins()).toEqual(DEFAULT_PINS);
    store.data.set(KEY, JSON.stringify({ a: 1 }));
    expect(getPins()).toEqual(DEFAULT_PINS);
  });

  it("저장소를 쓸 수 없으면 기본 핀", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(getPins()).toEqual(DEFAULT_PINS);
  });

  it("없는 id는 걸러낸다", () => {
    store.data.set(KEY, JSON.stringify(["users", "없는-설정", 3, "takeout"]));
    expect(getPins()).toEqual(["users", "takeout"]);
  });

  it("고정된 것은 빼고 저장한다", () => {
    const next = togglePin("users");
    expect(next).toEqual(DEFAULT_PINS.filter((id) => id !== "users"));
    expect(JSON.parse(store.data.get(KEY)!)).toEqual(next);
  });

  it("고정 안 된 것은 끝에 더한다", () => {
    expect(togglePin("groups")).toEqual([...DEFAULT_PINS, "groups"]);
    expect(getPins()).toEqual([...DEFAULT_PINS, "groups"]);
  });

  it("8개가 차면 더하지 않고 그대로 돌려준다", () => {
    togglePin("groups");
    togglePin("orgunits");
    const full = getPins();
    expect(full).toHaveLength(8);
    expect(togglePin("audit")).toEqual(full);
    expect(getPins()).toEqual(full);
  });

  it("모두 빼면 빈 목록이 유지된다", () => {
    for (const id of DEFAULT_PINS) togglePin(id);
    expect(getPins()).toEqual([]);
  });
});
