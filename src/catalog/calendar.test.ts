import { describe, expect, it } from "vitest";
import { CALENDAR, planFor } from "./calendar";
import { TASKS } from "./tasks";
import { SETTINGS } from "./settings";

const items = CALENDAR.flatMap((p) => p.items);

describe("연간 일정", () => {
  it("1~12월이 모두 있다", () => {
    expect(CALENDAR).toHaveLength(12);
    expect(CALENDAR.map((p) => p.month).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("달이 겹치지 않는다", () => {
    expect(new Set(CALENDAR.map((p) => p.month)).size).toBe(CALENDAR.length);
  });

  it("달마다 제목과 할 일이 있다", () => {
    for (const p of CALENDAR) {
      expect(p.label).not.toBe("");
      expect(p.items.length).toBeGreaterThan(0);
    }
  });

  it("작업 id는 모두 실제 작업이다", () => {
    const ids = new Set(TASKS.map((t) => t.id));
    for (const i of items) if (i.task) expect(ids.has(i.task), i.title).toBe(true);
  });

  it("설정 id는 모두 실제 설정 바로가기다", () => {
    const ids = new Set(SETTINGS.map((s) => s.id));
    for (const i of items) if (i.setting) expect(ids.has(i.setting), i.title).toBe(true);
  });

  it("항목마다 갈 곳(작업·설정·링크)이 하나 이상 있다", () => {
    for (const i of items) expect(Boolean(i.task || i.setting || i.url), i.title).toBe(true);
  });

  it("planFor는 1월과 12월 경계에서도 그 달을 돌려준다", () => {
    expect(planFor(1).month).toBe(1);
    expect(planFor(1).label).toBe("정리·준비");
    expect(planFor(12).month).toBe(12);
    expect(planFor(12).label).toBe("학기 마무리 시작");
  });

  it("4~11월은 평상시", () => {
    for (let m = 4; m <= 11; m++) expect(planFor(m).label).toBe("평상시");
  });
});
