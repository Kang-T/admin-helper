// 계정 삭제 판정: 드라이브 사용량 구분, 보고서 날짜, 지금 지워도 되는지.
// 화면 코드와 분리해 Node에서도 시험할 수 있게 둔다.

export type Tier = "small" | "transfer" | "manual" | "unknown";

const SMALL_MB = 50;
const MANUAL_MB = 5 * 1024;

// 거의 없음(≤ 50 MB) / 이전 필요 / 직접 처리(5 GB 초과 또는 한도의 90% 이상) / 확인 못 함
export function classifyDrive(usedMb: number | null, totalMb: number | null): Tier {
  if (usedMb === null) return "unknown";
  if (usedMb <= SMALL_MB) return "small";
  if (usedMb > MANUAL_MB) return "manual";
  // 한도가 0 이하(무제한 등)로 오면 비율은 따지지 않는다.
  if (totalMb !== null && totalMb > 0 && usedMb >= totalMb * 0.9) return "manual";
  return "transfer";
}

// 사용량 보고서는 2~3일 늦게 만들어진다. 오늘-3일부터 하루씩 거슬러 count개(UTC, YYYY-MM-DD).
export function reportDates(now: Date, back = 3, count = 6): string[] {
  return Array.from({ length: count }, (_, i) =>
    new Date(now.getTime() - (back + i) * 86_400_000).toISOString().slice(0, 10),
  );
}

export function tierLabel(t: Tier): string {
  if (t === "small") return "거의 없음";
  if (t === "transfer") return "이전 필요";
  if (t === "manual") return "직접 처리";
  return "확인 못 함";
}

export function canDeleteNow(row: {
  suspended: boolean;
  isMe: boolean;
  tier: Tier;
  transferDone: boolean;
}): { ok: boolean; reason: string } {
  if (!row.suspended) return { ok: false, reason: "정지된 계정만" };
  if (row.isMe) return { ok: false, reason: "본인 계정" };
  if (row.tier === "manual") return { ok: false, reason: "드라이브가 커서 콘솔에서 직접" };
  if (row.tier === "unknown") {
    return row.transferDone
      ? { ok: true, reason: "" }
      : { ok: false, reason: "사용량 확인 못 함(보고서 지연). 이전 대상을 지정하면 진행 가능" };
  }
  if (row.tier === "transfer" && !row.transferDone) return { ok: false, reason: "소유권 이전 먼저" };
  return { ok: true, reason: "" };
}

// 이전 기록 고르기. 이번에 지정한 받을 계정으로, 이전을 시작한 시점(since, ms) 이후에 요청된 것만 본다.
// 옛날에 다른 사정으로 끝난 이전을 이번 완료로 오인하면, 그 뒤 만든 파일을 옮기지 않고 계정을 지우게 된다.
export interface TransferRecord {
  id: string;
  overallTransferStatusCode?: string;
  newOwnerUserId?: string;
  requestTime?: string;
}

export function pickTransfer(
  list: TransferRecord[],
  newOwnerId: string,
  since: number,
): { kind: "done" | "running"; id: string; status: string } | null {
  const mine = list.filter((t) => {
    if (String(t.newOwnerUserId ?? "") !== String(newOwnerId)) return false;
    const at = t.requestTime ? Date.parse(t.requestTime) : NaN;
    return Number.isFinite(at) && at >= since;
  });
  const status = (t: TransferRecord) => (t.overallTransferStatusCode ?? "").toLowerCase();
  const done = mine.find((t) => status(t) === "completed");
  if (done) return { kind: "done", id: done.id, status: "completed" };
  const running = mine.find((t) => status(t) !== "completed" && status(t) !== "failed");
  if (running) return { kind: "running", id: running.id, status: status(running) || "inprogress" };
  return null;
}
