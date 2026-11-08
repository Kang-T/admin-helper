// 여러 명에게 같은 요청을 보내는 일괄 실행(일괄 생성·사용자 목록 일괄 작업이 같이 쓴다).
import { isStatus } from "./google/api";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 429·500·503이면 2초 뒤 한 번만 다시 시도한다. 그래도 실패하면 그 오류를 던진다.
export async function withRetry<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (e) {
    if (![429, 500, 503].some((s) => isStatus(e, s))) throw e;
    await sleep(2000);
    return fn();
  }
}

// 최대 concurrency개씩 동시에 처리한다. 결과는 items와 같은 순서. 하나 끝날 때마다 끝난 개수를 알린다.
export async function runBulk<T, R>(
  items: T[],
  one: (item: T) => Promise<R>,
  onProgress: (done: number) => void,
  concurrency = 3,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await one(items[i]);
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}
