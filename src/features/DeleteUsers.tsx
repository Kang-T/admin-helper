import { useEffect, useRef, useState } from "react";
import Confirm from "../components/Confirm";
import {
  createDriveTransfer,
  deleteUser,
  errorMessage,
  getDriveUsageMb,
  getTransfer,
  getUser,
  isStatus,
  listTransferApps,
  listTransfers,
  type Transfer,
  type User,
} from "../google/api";
import { clearToken, getToken, tokenSecondsLeft } from "../google/auth";
import type { PanelProps } from "../catalog/tasks";
import { runBulk, withRetry } from "../bulk";
import { downloadCsv, stamp, toCsv } from "../csv";
import { canDeleteNow, classifyDrive, reportDates, tierLabel, type Tier } from "../deletion";
import { pendingDelete } from "../selection";

type Step = "pick" | "assess" | "transfer" | "confirm" | "run" | "done";

interface Row {
  email: string;
  user: User | null;
  problem: string; // 계정 정보를 못 불러온 사유(있으면 제외)
  isMe: boolean;
  checked: boolean; // 드라이브 사용량을 확인했는지
  usedMb: number | null;
  totalMb: number | null;
  tier: Tier;
  usageError: string;
  transferAsked: boolean; // 소유권 이전을 요청했는지
  transferId: string;
  transferStatus: string; // 구글 값을 소문자로: inprogress·completed·failed 등
  transferError: string;
}

interface Result {
  row: Row;
  ok: boolean;
  message: string;
}

const MIN_LOGIN_SECONDS = 600; // 로그인이 이보다 적게 남았으면 시작하기 전에 다시 로그인하게 한다
const REFRESH_MS = 10_000;
const REFRESH_LIMIT_MS = 10 * 60_000;

const TIER_CHIP: Record<Tier, string> = { small: "ok", transfer: "warn", manual: "err", unknown: "muted" };

const statusOf = (t: Transfer) => (t.overallTransferStatusCode ?? "").toLowerCase();
const settled = (s: string) => s === "completed" || s === "failed";

// 정지·본인 여부를 볼 수 있는(불러오기에 성공한) 정지 계정만 사용량 확인·이전 대상이다.
const eligible = (r: Row) => !!r.user && !!r.user.suspended && !r.isMe;

// 불러오기 전 단계에서 보이는 제외 사유(정지 아님·본인·못 불러옴)
function baseExclusion(r: Row): string {
  if (r.problem) return r.problem;
  if (!r.user?.suspended) return "정지된 계정만";
  if (r.isMe) return "본인 계정";
  return "";
}

function decision(r: Row): { ok: boolean; reason: string } {
  if (!r.user) return { ok: false, reason: r.problem };
  return canDeleteNow({
    suspended: !!r.user.suspended,
    isMe: r.isMe,
    tier: r.tier,
    transferDone: r.transferStatus === "completed",
  });
}

// 보고서가 늦게 만들어지므로 날짜를 거슬러 가며 처음 나오는 값을 쓴다. 400·404·빈 보고서는 다음 날짜로.
async function usageOf(email: string, dates: string[]): Promise<{ usedMb: number | null; totalMb: number | null }> {
  for (const date of dates) {
    try {
      const u = await withRetry(() => getDriveUsageMb(email, date));
      if (u.usedMb !== null) return u;
    } catch (e) {
      if (isStatus(e, 400) || isStatus(e, 404)) continue;
      throw e;
    }
  }
  return { usedMb: null, totalMb: null };
}

// 한 명의 드라이브 이전. 이미 끝난 이전이 있으면 그것으로, 진행 중인 이전이 있으면 그 상태를 따라간다.
async function transferOne(r: Row, newOwnerId: string, appId: string): Promise<Row> {
  const asked = { ...r, transferAsked: true, transferError: "" };
  const oldId = r.user?.id;
  if (!oldId) return { ...asked, transferError: "사용자 id를 받지 못했습니다" };
  try {
    const mine = (await withRetry(() => listTransfers(oldId))).filter((t) =>
      t.applicationDataTransfers?.some((a) => String(a.applicationId) === appId),
    );
    const done = mine.find((t) => statusOf(t) === "completed");
    if (done) return { ...asked, transferId: done.id, transferStatus: "completed" };
    const running = mine.find((t) => !settled(statusOf(t)));
    if (running) return { ...asked, transferId: running.id, transferStatus: statusOf(running) || "inprogress" };
    // 만들기는 다시 시도하지 않는다(첫 요청이 실제로는 접수됐으면 이전이 둘 생긴다).
    const t = await createDriveTransfer(oldId, newOwnerId, appId);
    return { ...asked, transferId: t.id, transferStatus: statusOf(t) || "inprogress" };
  } catch (e) {
    return { ...asked, transferError: errorMessage(e) };
  }
}

function TransferChip({ r }: { r: Row }) {
  if (r.transferError && !r.transferId) return <span className="chip err">실패</span>;
  if (r.transferStatus === "completed") return <span className="chip ok">완료</span>;
  if (r.transferStatus === "failed") return <span className="chip err">실패</span>;
  return <span className="chip warn">진행 중</span>;
}

function StateChip({ user }: { user: User | null }) {
  if (!user) return <span className="chip muted">확인 못 함</span>;
  return user.suspended ? <span className="chip err">정지</span> : <span className="chip ok">활성</span>;
}

const driveText = (r: Row) => (!r.checked ? "" : r.usedMb === null ? "확인 못 함" : `${r.usedMb.toLocaleString()} MB`);

export default function DeleteUsers({ domain, me, setLocked, openTask }: PanelProps) {
  const [step, setStep] = useState<Step>("pick");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(pendingDelete.emails.length > 0);
  const [assessing, setAssessing] = useState(false); // 사용량 확인 중
  const [busy, setBusy] = useState(false); // 이전 요청 중
  const [progress, setProgress] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [target, setTarget] = useState("");
  const [targetError, setTargetError] = useState("");
  const [autoStopped, setAutoStopped] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [typed, setTyped] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [, recheck] = useState(0); // 실행 버튼을 누를 때 남은 로그인 시간을 다시 보게 한다

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const refreshingRef = useRef(false);

  const self = (me ?? "").toLowerCase();

  // 「목록·일괄 작업」에서 넘어온 이메일로 계정 정보를 불러온다.
  useEffect(() => {
    const emails = pendingDelete.emails;
    if (!emails.length) return;
    let cancelled = false;
    setLoading(true);
    setProgress(0);
    setProgressTotal(emails.length);
    const blank = (email: string, user: User | null, problem: string): Row => ({
      email: user?.primaryEmail ?? email,
      user,
      problem,
      isMe: (user?.primaryEmail ?? email).toLowerCase() === self,
      checked: false,
      usedMb: null,
      totalMb: null,
      tier: "unknown",
      usageError: "",
      transferAsked: false,
      transferId: "",
      transferStatus: "",
      transferError: "",
    });
    runBulk(
      emails,
      (email) =>
        withRetry(() => getUser(email)).then(
          (user) => blank(email, user, ""),
          (e) => blank(email, null, isStatus(e, 404) ? "없는 계정" : errorMessage(e)),
        ),
      (n) => !cancelled && setProgress(n),
    ).then((out) => {
      if (cancelled) return;
      setRows(out);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [self]);

  // 삭제 중에 탭을 닫거나 새로고침하면 어디까지 처리됐는지 알 수 없다. 브라우저가 한 번 묻게 한다.
  useEffect(() => {
    if (step !== "run") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [step]);

  // 실행 중에 패널이 사라지면(정상적으로는 일어나지 않는다) 메뉴 잠금을 푼다.
  useEffect(() => () => setLocked?.(false), [setLocked]);

  // 진행 중인 이전의 상태를 다시 본다.
  async function refresh() {
    if (refreshingRef.current) return;
    const pending = rowsRef.current.filter((r) => r.transferId && !settled(r.transferStatus));
    if (!pending.length) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const out = await runBulk(
        pending,
        (r) =>
          withRetry(() => getTransfer(r.transferId)).then(
            (t) => ({ email: r.email, status: statusOf(t) || r.transferStatus, error: "" }),
            (e) => ({ email: r.email, status: r.transferStatus, error: errorMessage(e) }),
          ),
        () => undefined,
      );
      const byEmail = new Map(out.map((o) => [o.email, o]));
      setRows((prev) =>
        prev.map((r) => {
          const o = byEmail.get(r.email);
          return o ? { ...r, transferStatus: o.status, transferError: o.error } : r;
        }),
      );
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  // 이전 단계에서는 10초마다 상태를 다시 본다(최대 10분). 모두 끝나면 멈춘다.
  useEffect(() => {
    if (step !== "transfer" || busy) return;
    setAutoStopped(false);
    const until = Date.now() + REFRESH_LIMIT_MS;
    const id = window.setInterval(() => {
      const pending = rowsRef.current.some((r) => r.transferId && !settled(r.transferStatus));
      if (!pending) return window.clearInterval(id);
      if (Date.now() > until) {
        window.clearInterval(id);
        setAutoStopped(true);
        return;
      }
      refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, busy]);

  async function assess() {
    const list = rows.filter(eligible);
    setStep("assess");
    setAssessing(true);
    setProgress(0);
    setProgressTotal(list.length);
    const dates = reportDates(new Date());
    try {
      const out = await runBulk(
        list,
        (r) =>
          usageOf(r.email, dates).then(
            (u): Row => ({ ...r, ...u, checked: true, tier: classifyDrive(u.usedMb, u.totalMb), usageError: "" }),
            (e): Row => ({ ...r, checked: true, usedMb: null, totalMb: null, tier: "unknown", usageError: errorMessage(e) }),
          ),
        setProgress,
      );
      const byEmail = new Map(out.map((r) => [r.email, r]));
      setRows((prev) => prev.map((r) => byEmail.get(r.email) ?? r));
    } finally {
      setAssessing(false);
    }
  }

  async function startTransfer() {
    if (tokenSecondsLeft() < MIN_LOGIN_SECONDS) return recheck((n) => n + 1);
    let email = target.trim().toLowerCase();
    if (email && !email.includes("@")) email = `${email}@${domain.toLowerCase()}`;
    if (!email) return setTargetError("드라이브 파일을 받을 계정을 입력하세요");
    if (email === self) return setTargetError("본인 계정은 받을 계정으로 정할 수 없습니다");
    if (rows.some((r) => r.email.toLowerCase() === email)) {
      return setTargetError("삭제 대상 계정은 받을 계정으로 정할 수 없습니다");
    }
    setTargetError("");
    setBusy(true);
    try {
      const app = (await withRetry(listTransferApps)).find((a) => a.name.includes("Drive"));
      if (!app) throw new Error("Drive 이전 앱을 찾지 못했습니다");
      const receiver = await withRetry(() => getUser(email)).catch((e) =>
        Promise.reject(isStatus(e, 404) ? new Error("받을 계정을 찾지 못했습니다") : e),
      );
      const receiverId = receiver.id;
      if (!receiverId) throw new Error("받을 계정의 id를 받지 못했습니다");
      const list = rows.filter((r) => eligible(r) && (r.tier === "transfer" || r.tier === "unknown"));
      setStep("transfer");
      setProgress(0);
      setProgressTotal(list.length);
      const out = await runBulk(list, (r) => transferOne(r, receiverId, app.id), setProgress);
      const byEmail = new Map(out.map((r) => [r.email, r]));
      setRows((prev) => prev.map((r) => byEmail.get(r.email) ?? r));
    } catch (e) {
      setTargetError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const targets = rows.filter((r) => decision(r).ok);

  function ask() {
    if (tokenSecondsLeft() < MIN_LOGIN_SECONDS) recheck((n) => n + 1);
    else setConfirming(true);
  }

  async function run() {
    const list = targets;
    setConfirming(false);
    setStep("run");
    setLocked?.(true);
    setProgress(0);
    setProgressTotal(list.length);
    let out: Result[] = [];
    try {
      out = await runBulk(
        list,
        (r) =>
          withRetry(() => deleteUser(r.email)).then(
            (): Result => ({ row: r, ok: true, message: "" }),
            (e): Result => ({ row: r, ok: false, message: isStatus(e, 404) ? "없는 계정" : errorMessage(e) }),
          ),
        setProgress,
      );
    } finally {
      setLocked?.(false);
    }
    setResults(out);
    setStep("done");
  }

  function downloadResults() {
    const lines = results.map((r) => [
      r.row.email,
      r.row.user?.name.fullName ?? "",
      r.row.usedMb === null ? "" : String(r.row.usedMb),
      r.ok ? "성공" : "실패",
      r.message,
    ]);
    downloadCsv(`계정_삭제결과_${stamp()}.csv`, toCsv([["이메일", "이름", "드라이브MB", "결과", "사유"], ...lines]));
  }

  // 이 탭이 구글 로그인 화면으로 갔다가 홈으로 돌아온다. 고른 계정은 사라진다.
  function relogin() {
    clearToken();
    getToken();
  }

  function restart() {
    pendingDelete.emails = [];
    setRows([]);
    setResults([]);
    setTarget("");
    setTargetError("");
    setTyped("");
    setStep("pick");
  }

  const secondsLeft = tokenSecondsLeft();
  const loginLow = secondsLeft < MIN_LOGIN_SECONDS;
  const loginWarn = loginLow && (
    <p className="msg warn">
      로그인이 {Math.ceil(secondsLeft / 60)}분 뒤 만료됩니다. 다시 로그인한 뒤 시작하세요.
      <br />
      다시 로그인하면 「목록·일괄 작업」에서 계정을 다시 골라야 합니다.
    </p>
  );
  const progressBar = (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progressTotal} aria-valuenow={progress}>
      <div style={{ width: `${progressTotal ? (progress / progressTotal) * 100 : 0}%` }} />
    </div>
  );
  const restartButton = (
    <button type="button" className="btn text" onClick={restart} disabled={busy}>
      처음부터
    </button>
  );

  if (step === "pick") {
    if (!loading && rows.length === 0) {
      return (
        <>
          <p>「목록·일괄 작업」에서 정지된 계정을 고른 뒤 [정지 계정 삭제 →]를 누르세요</p>
          <p className="muted">정지된 계정만 삭제할 수 있습니다. 본인 계정은 삭제할 수 없습니다.</p>
          <div className="actions">
            <button type="button" className="btn filled" onClick={() => openTask("user-list")}>
              목록으로
            </button>
          </div>
        </>
      );
    }
    if (loading) {
      return (
        <>
          <p>
            계정 정보를 불러오는 중… <strong>{progress} / {progressTotal}</strong>
          </p>
          {progressBar}
        </>
      );
    }
    const usable = rows.filter(eligible).length;
    return (
      <>
        <p>
          <strong>
            삭제 후보 {usable}명 · 제외 {rows.length - usable}명
          </strong>
        </p>
        <div className="table-wrap tall">
          <table className="table">
            <thead>
              <tr>
                <th>이메일</th>
                <th>이름</th>
                <th>상태</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const why = baseExclusion(r);
                return (
                  <tr key={r.email}>
                    <td>
                      <code>{r.email}</code>
                    </td>
                    <td>{r.user?.name.fullName}</td>
                    <td>
                      <StateChip user={r.user} />
                    </td>
                    <td className="wrap">{why ? `제외: ${why}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">다음 단계에서 각 계정의 드라이브 사용량을 확인합니다. 사용량 보고서는 2~3일 늦게 만들어집니다.</p>
        <div className="actions">
          <button type="button" className="btn filled" disabled={usable === 0} onClick={assess}>
            드라이브 사용량 확인
          </button>
          {restartButton}
        </div>
      </>
    );
  }

  if (step === "assess") {
    if (assessing) {
      return (
        <>
          <p>
            드라이브 사용량을 확인하는 중… <strong>{progress} / {progressTotal}</strong>
          </p>
          {progressBar}
        </>
      );
    }
    const list = rows.filter(eligible);
    const count = (t: Tier) => list.filter((r) => r.tier === t).length;
    const small = count("small");
    const needTransfer = count("transfer");
    const manual = count("manual");
    const unknown = count("unknown");
    return (
      <>
        <p>
          <strong>
            바로 삭제 {small} · 이전 필요 {needTransfer} · 직접 처리 {manual} · 확인 못 함 {unknown}
          </strong>
        </p>
        <div className="table-wrap tall">
          <table className="table">
            <thead>
              <tr>
                <th>이메일</th>
                <th>이름</th>
                <th>상태</th>
                <th>드라이브</th>
                <th>구분</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ok = eligible(r);
                const note = ok ? [decision(r).reason, r.usageError].filter(Boolean).join(" · ") : `제외: ${baseExclusion(r)}`;
                return (
                  <tr key={r.email}>
                    <td>
                      <code>{r.email}</code>
                    </td>
                    <td>{r.user?.name.fullName}</td>
                    <td>
                      <StateChip user={r.user} />
                    </td>
                    <td>{ok ? driveText(r) : ""}</td>
                    <td>
                      {ok ? (
                        <span className={`chip ${TIER_CHIP[r.tier]}`}>{tierLabel(r.tier)}</span>
                      ) : (
                        <span className="chip muted">제외</span>
                      )}
                    </td>
                    <td className="wrap">{note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {manual > 0 && (
          <p className="msg warn">
            드라이브가 5 GB를 넘거나 저장 한도의 90% 이상인 {manual}명은 이 앱에서 삭제하지 않습니다. 구글 관리 콘솔에서 사람이
            직접 데이터를 옮긴 뒤 삭제하세요.
          </p>
        )}
        {needTransfer + unknown > 0 && (
          <>
            <label htmlFor="du-target">드라이브 파일을 받을 계정</label>
            <input
              id="du-target"
              type="text"
              value={target}
              placeholder={`예: kim.teacher 또는 kim.teacher@${domain}`}
              onChange={(e) => setTarget(e.target.value)}
            />
            <p className="muted">
              이메일 앞부분만 써도 됩니다. 본인 계정과 삭제 대상 계정은 받을 수 없습니다.
              {unknown > 0 && " 사용량을 확인 못 한 계정도 받을 계정을 정하면 이전한 뒤 삭제할 수 있습니다."}
            </p>
            {targetError && <p className="msg error">{targetError}</p>}
          </>
        )}
        {loginWarn}
        <div className="actions">
          {needTransfer + unknown > 0 &&
            (loginLow ? (
              <button type="button" className="btn filled" onClick={relogin}>
                다시 로그인
              </button>
            ) : (
              <button type="button" className="btn filled" onClick={startTransfer} disabled={busy}>
                {busy ? "요청하는 중…" : "소유권 이전 시작"}
              </button>
            ))}
          {needTransfer === 0 && (
            <button type="button" className={needTransfer + unknown > 0 ? "btn" : "btn filled"} onClick={() => setStep("confirm")}>
              삭제 확인으로
            </button>
          )}
          {restartButton}
        </div>
      </>
    );
  }

  if (step === "transfer") {
    const list = rows.filter((r) => r.transferAsked);
    const allDone = list.length > 0 && list.every((r) => r.transferStatus === "completed");
    return (
      <>
        {busy ? (
          <>
            <p>
              소유권 이전을 요청하는 중… <strong>{progress} / {progressTotal}</strong>
            </p>
            {progressBar}
          </>
        ) : (
          <p>
            <strong>
              완료 {list.filter((r) => r.transferStatus === "completed").length} / {list.length}
            </strong>
          </p>
        )}
        <div className="table-wrap tall">
          <table className="table">
            <thead>
              <tr>
                <th>이메일</th>
                <th>이름</th>
                <th>드라이브</th>
                <th>이전 상태</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.email}>
                  <td>
                    <code>{r.email}</code>
                  </td>
                  <td>{r.user?.name.fullName}</td>
                  <td>{driveText(r)}</td>
                  <td>
                    <TransferChip r={r} />
                  </td>
                  <td className="wrap">{r.transferError}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          구글의 소유권 이전은 몇 분 걸릴 수 있습니다. 이 화면을 떠나도 구글이 계속 진행하며, 다시 오면 상태를 다시 봅니다.
        </p>
        {autoStopped && !allDone && (
          <p className="msg warn">10분이 지나 자동 새로고침을 멈췄습니다. [상태 새로고침]을 눌러 확인하세요.</p>
        )}
        <div className="actions">
          {allDone && (
            <button type="button" className="btn filled" onClick={() => setStep("confirm")}>
              삭제 확인으로
            </button>
          )}
          <button type="button" className="btn" onClick={refresh} disabled={busy || refreshing || allDone}>
            상태 새로고침
          </button>
          {restartButton}
        </div>
      </>
    );
  }

  if (step === "confirm") {
    const n = targets.length;
    return (
      <>
        <p>
          <strong>
            삭제 {n}명 · 제외 {rows.length - n}명
          </strong>
        </p>
        <div className="table-wrap tall">
          <table className="table">
            <thead>
              <tr>
                <th>이메일</th>
                <th>이름</th>
                <th>드라이브</th>
                <th>처리</th>
                <th>제외 사유</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = decision(r);
                return (
                  <tr key={r.email}>
                    <td>
                      <code>{r.email}</code>
                    </td>
                    <td>{r.user?.name.fullName}</td>
                    <td>{driveText(r)}</td>
                    <td>{d.ok ? <span className="chip err">삭제</span> : <span className="chip muted">제외</span>}</td>
                    <td className="wrap">{d.ok ? "" : d.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="msg warn">
          삭제하면 메일·드라이브·Classroom 자료가 함께 사라집니다. 구글 관리 콘솔에서 20일 안에 복구할 수 있습니다.
        </p>
        <label htmlFor="du-typed">확인하려면 삭제 라고 입력</label>
        <input id="du-typed" type="text" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        {loginWarn}
        <div className="actions">
          {loginLow ? (
            <button type="button" className="btn filled" onClick={relogin}>
              다시 로그인
            </button>
          ) : (
            <button type="button" className="btn danger" disabled={typed !== "삭제" || n === 0} onClick={ask}>
              {n}명 삭제
            </button>
          )}
          {restartButton}
        </div>
        {confirming && (
          <Confirm
            message={`${n}명을 삭제합니다. 되돌리려면 20일 안에 콘솔에서 복구해야 합니다.`}
            confirmLabel="삭제"
            danger
            onConfirm={run}
            onCancel={() => setConfirming(false)}
          />
        )}
      </>
    );
  }

  if (step === "run") {
    return (
      <>
        <p>
          삭제하는 중입니다… <strong>{progress} / {progressTotal}</strong>
        </p>
        {progressBar}
        <p className="muted">끝날 때까지 이 화면을 떠나지 마세요.</p>
      </>
    );
  }

  const okCount = results.filter((r) => r.ok).length;
  return (
    <>
      <p>
        <strong>
          성공 {okCount} · 실패 {results.length - okCount}
        </strong>
      </p>
      <div className="table-wrap tall">
        <table className="table">
          <thead>
            <tr>
              <th>이메일</th>
              <th>결과</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.row.email}>
                <td>
                  <code>{r.row.email}</code>
                </td>
                <td>{r.ok ? <span className="chip ok">성공</span> : <span className="chip err">실패</span>}</td>
                <td className="wrap">{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">지운 계정은 구글 관리 콘솔에서 20일 안에 복구할 수 있습니다.</p>
      <div className="actions">
        <button type="button" className="btn filled" onClick={downloadResults}>
          <span className="icon" aria-hidden="true">
            download
          </span>
          결과 CSV 내려받기
        </button>
        {restartButton}
      </div>
    </>
  );
}
