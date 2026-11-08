import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./google/api";
import { runBulk, withRetry } from "./bulk";

// auth.ts는 불러오는 순간 브라우저 주소(window.location)를 읽는다. Node에는 없으므로 가짜로 바꾼다.
vi.mock("./google/auth", () => ({ getToken: vi.fn(), clearToken: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const wait = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

describe("runBulk", () => {
  it("끝나는 순서와 관계없이 결과는 입력 순서", async () => {
    const delays = [50, 10, 30, 5, 40];
    const progress: number[] = [];
    const p = runBulk(delays, (ms) => wait(ms, ms * 2), (n) => progress.push(n));
    await vi.runAllTimersAsync();
    expect(await p).toEqual([100, 20, 60, 10, 80]);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
  });

  it("동시에 3개를 넘지 않고, 3개까지는 동시에 돈다", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const p = runBulk(
      items,
      async (i) => {
        active++;
        peak = Math.max(peak, active);
        await wait(10 + (i % 3) * 7, null);
        active--;
        return i;
      },
      () => {},
    );
    await vi.runAllTimersAsync();
    expect(await p).toEqual(items);
    expect(peak).toBe(3);
  });

  it("빈 목록이면 빈 결과", async () => {
    expect(await runBulk([], async () => 1, () => {})).toEqual([]);
  });
});

describe("withRetry", () => {
  it("429 한 번 뒤 2초 기다려 다시 시도해 성공", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new ApiError(429, "too many")).mockResolvedValueOnce("ok");
    const p = withRetry(fn);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("500·503도 다시 시도한다", async () => {
    for (const status of [500, 503]) {
      const fn = vi.fn().mockRejectedValueOnce(new ApiError(status, "x")).mockResolvedValueOnce("ok");
      const p = withRetry(fn);
      await vi.runAllTimersAsync();
      expect(await p).toBe("ok");
    }
  });

  it("두 번 연속 실패하면 두 번째 오류를 던진다", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(503, "first"))
      .mockRejectedValueOnce(new ApiError(429, "second"));
    const p = withRetry(fn);
    const caught = p.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const e = await caught;
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("다시 시도할 오류가 아니면(404) 바로 던진다", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new ApiError(404, "x"));
    await expect(withRetry(fn)).rejects.toBeInstanceOf(ApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
