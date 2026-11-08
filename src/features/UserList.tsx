import { useEffect, useState } from "react";
import Confirm from "../components/Confirm";
import { errorMessage, listUsers, updateUser, type User } from "../google/api";
import { clearToken, getToken, tokenSecondsLeft } from "../google/auth";
import type { PanelProps } from "../catalog/tasks";
import { runBulk, withRetry } from "../bulk";
import { downloadCsv, stamp, toCsv } from "../csv";
import { adminLabel, filterUsers, lastLogin, usersToCsv, ymd, type Filters } from "../userlist";
import { OuSelect, useOrgUnits } from "./MoveOu";

type Kind = "suspend" | "unsuspend" | "move";
type Sort = "name" | "login" | "email";
interface Outcome {
  user: User;
  updated: User | null; // 성공하면 구글이 돌려준 새 상태
  message: string;
}

const KIND_LABEL: Record<Kind, string> = { suspend: "정지", unsuspend: "해제", move: "이동" };
const MAX_PAGES = 10; // 500명 × 10 = 5,000명
const MIN_LOGIN_SECONDS = 600; // 로그인이 이보다 적게 남았으면 시작하기 전에 다시 로그인하게 한다

function compare(sort: Sort) {
  if (sort === "login") return (a: User, b: User) => (lastLogin(a)?.getTime() ?? 0) - (lastLogin(b)?.getTime() ?? 0);
  if (sort === "email") return (a: User, b: User) => a.primaryEmail.localeCompare(b.primaryEmail);
  return (a: User, b: User) => a.name.fullName.localeCompare(b.name.fullName, "ko");
}

export default function UserList({ setUser, openTask, setLocked, me }: PanelProps) {
  const { units, error: ouError } = useOrgUnits();

  // 필터
  const [ou, setOu] = useState("/");
  const [status, setStatus] = useState<Filters["status"]>("all");
  const [inactiveOn, setInactiveOn] = useState(false);
  const [monthsText, setMonthsText] = useState("6");
  const [excludeAdmins, setExcludeAdmins] = useState(true);
  const [sort, setSort] = useState<Sort>("name");

  // 불러온 목록
  const [all, setAll] = useState<User[]>([]);
  const [loadedOu, setLoadedOu] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [capped, setCapped] = useState(false);
  const [loadError, setLoadError] = useState("");

  // 선택·실행
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState("/");
  const [confirming, setConfirming] = useState<Kind | null>(null);
  const [step, setStep] = useState<"list" | "run" | "done">("list");
  const [runKind, setRunKind] = useState<Kind>("suspend");
  const [runTotal, setRunTotal] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [results, setResults] = useState<Outcome[]>([]);
  const [, recheck] = useState(0); // 실행 버튼을 누를 때 남은 로그인 시간을 다시 보게 한다

  // 실행 중에 탭을 닫거나 새로고침하면 어디까지 처리됐는지 알 수 없다. 브라우저가 한 번 묻게 한다.
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

  // 조직 단위는 불러올 때의 값으로 거른다. 바꾸면 [불러오기]를 다시 눌러야 반영된다.
  const months = Number.parseInt(monthsText, 10);
  const filters: Filters = {
    ou: loadedOu ?? "/",
    status,
    inactiveMonths: inactiveOn && months > 0 ? months : null,
    excludeAdmins,
  };
  const visible = filterUsers(all, filters, new Date()).sort(compare(sort));
  const chosen = visible.filter((u) => selected.has(u.primaryEmail)); // 화면에 보이는 사람만 작업 대상
  const allChecked = visible.length > 0 && chosen.length === visible.length;
  const meChosen = !!me && chosen.some((u) => u.primaryEmail.toLowerCase() === me.toLowerCase());
  const adminCount = chosen.filter((u) => u.isAdmin || u.isDelegatedAdmin).length;
  const needsLoad = loadedOu !== ou;

  async function load() {
    setLoading(true);
    setLoadError("");
    setLoadedCount(0);
    const list: User[] = [];
    try {
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await listUsers({ orgUnitPath: ou, pageToken });
        list.push(...res.users);
        setLoadedCount(list.length);
        pageToken = res.nextPageToken;
        if (!pageToken) break;
      }
      setAll(list);
      setLoadedOu(ou);
      setCapped(!!pageToken);
      setSelected(new Set());
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const u of visible) {
        if (allChecked) next.delete(u.primaryEmail);
        else next.add(u.primaryEmail);
      }
      return next;
    });
  }

  function ask(kind: Kind) {
    if (tokenSecondsLeft() < MIN_LOGIN_SECONDS) recheck((n) => n + 1);
    else setConfirming(kind);
  }

  async function run(kind: Kind) {
    const targets = chosen;
    const fields = kind === "move" ? { orgUnitPath: moveTarget } : { suspended: kind === "suspend" };
    setConfirming(null);
    setRunKind(kind);
    setRunTotal(targets.length);
    setDoneCount(0);
    setStep("run");
    setLocked?.(true);
    let out: Outcome[] = [];
    try {
      out = await runBulk(
        targets,
        (user) =>
          withRetry(() => updateUser(user.primaryEmail, fields)).then(
            (updated): Outcome => ({ user, updated, message: "" }),
            (e): Outcome => ({ user, updated: null, message: errorMessage(e) }),
          ),
        setDoneCount,
      );
    } finally {
      setLocked?.(false);
    }
    setResults(out);
    setStep("done");
  }

  // 성공한 사람의 새 상태·조직을 불러온 목록에 반영하고 선택을 푼다.
  function backToList() {
    const updated = new Map(results.flatMap((r) => (r.updated ? [[r.user.primaryEmail, r.updated] as const] : [])));
    setAll((list) => list.map((u) => updated.get(u.primaryEmail) ?? u));
    setSelected(new Set());
    setResults([]);
    setStep("list");
  }

  function downloadResults() {
    const lines = results.map((r) => [r.user.primaryEmail, r.updated ? "성공" : "실패", r.message]);
    downloadCsv(`일괄_${KIND_LABEL[runKind]}결과_${stamp()}.csv`, toCsv([["이메일", "결과", "사유"], ...lines]));
  }

  // 이 탭이 구글 로그인 화면으로 갔다가 홈으로 돌아온다. 불러온 목록은 사라진다.
  function relogin() {
    clearToken();
    getToken();
  }

  function confirmMessage(kind: Kind): string {
    const n = chosen.length;
    const base =
      kind === "suspend"
        ? `선택한 ${n}명을 정지합니다. 정지되면 로그인할 수 없습니다.`
        : kind === "unsuspend"
          ? `선택한 ${n}명의 정지를 해제합니다.`
          : `선택한 ${n}명을 '${moveTarget}'(으)로 옮깁니다. 새 조직의 설정이 바로 적용됩니다.`;
    return adminCount ? `${base} 관리자 ${adminCount}명 포함.` : base;
  }

  if (step === "run") {
    return (
      <>
        <p>
          처리하는 중입니다… <strong>{doneCount} / {runTotal}</strong>
        </p>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={runTotal} aria-valuenow={doneCount}>
          <div style={{ width: `${runTotal ? (doneCount / runTotal) * 100 : 0}%` }} />
        </div>
        <p className="muted">끝날 때까지 이 화면을 떠나지 마세요.</p>
      </>
    );
  }

  if (step === "done") {
    const ok = results.filter((r) => r.updated).length;
    return (
      <>
        <p>
          <strong>
            성공 {ok} · 실패 {results.length - ok}
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
                <tr key={r.user.primaryEmail}>
                  <td>
                    <code>{r.user.primaryEmail}</code>
                  </td>
                  <td>{r.updated ? <span className="chip ok">성공</span> : <span className="chip err">실패</span>}</td>
                  <td className="wrap">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="actions">
          <button type="button" className="btn filled" onClick={downloadResults}>
            <span className="icon" aria-hidden="true">
              download
            </span>
            결과 CSV 내려받기
          </button>
          <button type="button" className="btn text" onClick={backToList}>
            목록으로
          </button>
        </div>
      </>
    );
  }

  const secondsLeft = tokenSecondsLeft();
  const loginLow = secondsLeft < MIN_LOGIN_SECONDS;
  return (
    <>
      <div className="filters">
        <div>
          <label htmlFor="ul-ou">조직 단위</label>
          <OuSelect id="ul-ou" units={units} value={ou} onChange={setOu} rootLabel="/ (전체)" />
        </div>
        <div>
          <label htmlFor="ul-status">상태</label>
          <select id="ul-status" value={status} onChange={(e) => setStatus(e.target.value as Filters["status"])}>
            <option value="all">전체</option>
            <option value="active">활성</option>
            <option value="suspended">정지</option>
          </select>
        </div>
        <div className="check">
          <label>
            <input type="checkbox" checked={inactiveOn} onChange={(e) => setInactiveOn(e.target.checked)} />
            미접속
          </label>
          <input
            type="number"
            min={1}
            aria-label="미접속 개월 수"
            value={monthsText}
            onChange={(e) => setMonthsText(e.target.value)}
          />
          <span>개월 이상</span>
        </div>
        <div className="check">
          <label>
            <input type="checkbox" checked={excludeAdmins} onChange={(e) => setExcludeAdmins(e.target.checked)} />
            관리자 제외
          </label>
        </div>
        <button type="button" className={needsLoad ? "btn filled" : "btn"} disabled={loading} onClick={load}>
          불러오기
        </button>
      </div>
      {ouError && <p className="msg error">{ouError}</p>}
      {loading && <p className="muted">불러오는 중… {loadedCount}명</p>}
      {loadError && <p className="msg error">{loadError}</p>}
      {capped && <p className="msg warn">5,000명까지만 불러왔습니다. 조직 단위를 골라 범위를 줄이세요</p>}

      {loadedOu !== null && (
        <>
          <div className="filters">
            <strong>{visible.length}명</strong>
            <div>
              <label htmlFor="ul-sort">정렬</label>
              <select id="ul-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="name">이름</option>
                <option value="login">마지막 로그인(오래된 순)</option>
                <option value="email">이메일</option>
              </select>
            </div>
            <button
              type="button"
              className="btn text"
              disabled={visible.length === 0}
              onClick={() => downloadCsv(`사용자_목록_${stamp()}.csv`, usersToCsv(visible))}
            >
              <span className="icon" aria-hidden="true">
                download
              </span>
              CSV 내려받기
            </button>
          </div>

          {chosen.length > 0 && (
            <>
              <div className="filters">
                <strong>선택 {chosen.length}명</strong>
                {loginLow ? (
                  <button type="button" className="btn filled" onClick={relogin}>
                    다시 로그인
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn danger" disabled={meChosen} onClick={() => ask("suspend")}>
                      정지
                    </button>
                    <button type="button" className="btn" onClick={() => ask("unsuspend")}>
                      정지 해제
                    </button>
                    <button type="button" className="btn" onClick={() => ask("move")}>
                      조직 단위 이동 →
                    </button>
                    <div>
                      <label className="sr-only" htmlFor="ul-move">
                        옮길 조직
                      </label>
                      <OuSelect id="ul-move" units={units} value={moveTarget} onChange={setMoveTarget} />
                    </div>
                  </>
                )}
              </div>
              {meChosen && !loginLow && <p className="muted">본인 계정은 정지할 수 없습니다</p>}
              {loginLow && (
                <p className="msg warn">
                  로그인이 {Math.ceil(secondsLeft / 60)}분 뒤 만료됩니다. 일괄 작업은 1시간 안에 끝나지 않을 수 있어, 다시
                  로그인한 뒤 시작하세요.
                  <br />
                  다시 로그인하면 목록을 다시 불러와야 합니다.
                </p>
              )}
            </>
          )}

          <div className="table-wrap tall">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="현재 목록 전체 선택"
                      checked={allChecked}
                      disabled={visible.length === 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>조직단위</th>
                  <th>상태</th>
                  <th>마지막 로그인</th>
                  <th>관리자</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => {
                  const last = lastLogin(u);
                  return (
                    <tr key={u.primaryEmail}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${u.primaryEmail} 선택`}
                          checked={selected.has(u.primaryEmail)}
                          onChange={() => toggle(u.primaryEmail)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            setUser(u);
                            openTask("lookup");
                          }}
                        >
                          {u.name.fullName}
                        </button>
                      </td>
                      <td>
                        <code>{u.primaryEmail}</code>
                      </td>
                      <td>
                        <code>{u.orgUnitPath}</code>
                      </td>
                      <td>{u.suspended ? <span className="chip err">정지</span> : <span className="chip ok">활성</span>}</td>
                      <td>{last ? ymd(last) : <span className="muted">기록 없음</span>}</td>
                      <td>{adminLabel(u)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirming && (
        <Confirm
          message={confirmMessage(confirming)}
          confirmLabel={confirming === "suspend" ? "정지" : confirming === "unsuspend" ? "정지 해제" : "이동"}
          danger={confirming === "suspend"}
          onConfirm={() => run(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
