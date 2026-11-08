import { describe, expect, it } from "vitest";
import { canDeleteNow, classifyDrive, reportDates, tierLabel, type Tier } from "./deletion";

describe("classifyDrive", () => {
  it("사용량을 모르면 확인 못 함", () => {
    expect(classifyDrive(null, null)).toBe("unknown");
    expect(classifyDrive(null, 15360)).toBe("unknown");
  });

  it("50 MB 이하는 거의 없음, 넘으면 이전 필요", () => {
    expect(classifyDrive(0, null)).toBe("small");
    expect(classifyDrive(50, 15360)).toBe("small");
    expect(classifyDrive(51, 15360)).toBe("transfer");
    expect(classifyDrive(50.5, null)).toBe("transfer");
  });

  it("5120 MB까지는 이전 필요, 넘으면 직접 처리", () => {
    expect(classifyDrive(5120, null)).toBe("transfer");
    expect(classifyDrive(5121, null)).toBe("manual");
    expect(classifyDrive(5120, 1_000_000)).toBe("transfer");
  });

  it("한도의 90% 이상이면 직접 처리", () => {
    expect(classifyDrive(900, 1000)).toBe("manual");
    expect(classifyDrive(899, 1000)).toBe("transfer");
    expect(classifyDrive(1000, 1000)).toBe("manual");
  });

  it("한도가 없거나 0 이하이면 비율을 따지지 않는다", () => {
    expect(classifyDrive(1000, null)).toBe("transfer");
    expect(classifyDrive(1000, 0)).toBe("transfer");
    expect(classifyDrive(1000, -1)).toBe("transfer");
  });

  it("50 MB 이하는 한도 비율과 관계없이 거의 없음", () => {
    expect(classifyDrive(40, 40)).toBe("small");
  });
});

describe("reportDates", () => {
  it("오늘-3일부터 6개, UTC 기준", () => {
    expect(reportDates(new Date("2026-11-08T05:00:00Z"))).toEqual([
      "2026-11-05",
      "2026-11-04",
      "2026-11-03",
      "2026-11-02",
      "2026-11-01",
      "2026-10-31",
    ]);
  });

  it("UTC 자정 직전·직후", () => {
    expect(reportDates(new Date("2026-11-08T23:59:59Z"), 3, 1)).toEqual(["2026-11-05"]);
    expect(reportDates(new Date("2026-11-08T00:00:00Z"), 3, 1)).toEqual(["2026-11-05"]);
    // 한국 시각 11-08 08:00 = UTC 11-07 23:00
    expect(reportDates(new Date("2026-11-08T08:00:00+09:00"), 3, 1)).toEqual(["2026-11-04"]);
  });

  it("월·연 경계를 넘는다", () => {
    expect(reportDates(new Date("2027-01-02T12:00:00Z"), 3, 3)).toEqual(["2026-12-30", "2026-12-29", "2026-12-28"]);
  });

  it("back·count를 바꿀 수 있다", () => {
    expect(reportDates(new Date("2026-11-08T12:00:00Z"), 1, 2)).toEqual(["2026-11-07", "2026-11-06"]);
    expect(reportDates(new Date("2026-11-08T12:00:00Z"), 3, 0)).toEqual([]);
  });
});

describe("tierLabel", () => {
  it("구분별 글", () => {
    expect(tierLabel("small")).toBe("거의 없음");
    expect(tierLabel("transfer")).toBe("이전 필요");
    expect(tierLabel("manual")).toBe("직접 처리");
    expect(tierLabel("unknown")).toBe("확인 못 함");
  });
});

describe("canDeleteNow", () => {
  const row = (fields: Partial<{ suspended: boolean; isMe: boolean; tier: Tier; transferDone: boolean }> = {}) => ({
    suspended: true,
    isMe: false,
    tier: "small" as Tier,
    transferDone: false,
    ...fields,
  });

  it("정지되지 않은 계정은 안 된다(구분과 관계없이)", () => {
    expect(canDeleteNow(row({ suspended: false }))).toEqual({ ok: false, reason: "정지된 계정만" });
    expect(canDeleteNow(row({ suspended: false, transferDone: true, tier: "transfer" })).ok).toBe(false);
  });

  it("본인 계정은 안 된다", () => {
    expect(canDeleteNow(row({ isMe: true }))).toEqual({ ok: false, reason: "본인 계정" });
  });

  it("정지 확인이 본인 확인보다 먼저", () => {
    expect(canDeleteNow(row({ suspended: false, isMe: true })).reason).toBe("정지된 계정만");
  });

  it("직접 처리는 이전이 끝나도 안 된다", () => {
    expect(canDeleteNow(row({ tier: "manual" }))).toEqual({ ok: false, reason: "드라이브가 커서 콘솔에서 직접" });
    expect(canDeleteNow(row({ tier: "manual", transferDone: true })).ok).toBe(false);
  });

  it("확인 못 함은 이전이 끝나야 된다", () => {
    expect(canDeleteNow(row({ tier: "unknown" }))).toEqual({
      ok: false,
      reason: "사용량 확인 못 함(보고서 지연). 이전 대상을 지정하면 진행 가능",
    });
    expect(canDeleteNow(row({ tier: "unknown", transferDone: true }))).toEqual({ ok: true, reason: "" });
  });

  it("이전 필요는 이전이 끝나야 된다", () => {
    expect(canDeleteNow(row({ tier: "transfer" }))).toEqual({ ok: false, reason: "소유권 이전 먼저" });
    expect(canDeleteNow(row({ tier: "transfer", transferDone: true }))).toEqual({ ok: true, reason: "" });
  });

  it("거의 없음은 바로 된다", () => {
    expect(canDeleteNow(row())).toEqual({ ok: true, reason: "" });
    expect(canDeleteNow(row({ transferDone: true }))).toEqual({ ok: true, reason: "" });
  });
});
