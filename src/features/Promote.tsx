import { useEffect, useState, type ChangeEvent } from "react";
import Confirm from "../components/Confirm";
import {
  createOrgUnit,
  errorMessage,
  isStatus,
  listOrgUnits,
  listUsers,
  updateUser,
  type OrgUnit,
  type User,
} from "../google/api";
import { clearToken, getToken, tokenSecondsLeft } from "../google/auth";
import type { PanelProps } from "../catalog/tasks";
import { runBulk, withRetry } from "../bulk";
import { decodeCsv, downloadCsv, parseCsv, stamp, toCsv, validateActionRows, type ActionRow } from "../csv";
import { missingOus, nextYearName, planMoves, planRules, type Move, type Rule } from "../promote";

interface Result {
  move: Move;
  ok: boolean;
  message: string;
}

const MIN_LOGIN_SECONDS = 600; // 로그인이 이보다 적게 남았으면 시작하기 전에 다시 로그인하게 한다
const NO_OU = "조직 단위가 없습니다"; // 새 OU는 실행 때 만들므로 CSV 검사에서 이 문제는 허용한다

// 앞에 "/"를 붙이고 끝의 "/"는 뗀다. 빈 값이면 "/".
const norm = (p: string) => {
  const t = p.trim().replace(/\/+$/, "");
  return t.startsWith("/") ? t : `/${t}`;
};
const yearDigits = (path: string) => /\d{4}/.exec(path)?.[0] ?? "";
const graduateDefault = (yearOu: string) => (yearDigits(yearOu) ? `/졸업생/${yearDigits(yearOu)}` : "/졸업생");

// 최상위 바로 아래 OU 중 하위 OU가 있는 것(학년도 후보)
function yearCandidates(units: OrgUnit[]): OrgUnit[] {
  return units.filter(
    (u) =>
      u.orgUnitPath.split("/").length === 2 && units.some((c) => c.orgUnitPath.startsWith(`${u.orgUnitPath}/`)),
  );
}

export default function Promote({ domain, me, setLocked }: PanelProps) {
  // 조직 목록
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [ouError, setOuError] = useState("");

  // 설정
  const [yearOu, setYearOu] = useState("");
  const [newYear, setNewYear] = useState("");
  const [lastGradeText, setLastGradeText] = useState("6");
  const [graduateOu, setGraduateOu] = useState("");
  const [suspendGraduates, setSuspendGraduates] = useState(true);

  // 규칙·CSV
  const [users, setUsers] = useState<User[]>([]);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [csvRows, setCsvRows] = useState<ActionRow[]>([]);
  const [csvError, setCsvError] = useState("");
  const [reading, setReading] = useState(false);

  // 검토·실행
  const [step, setStep] = useState<"setup" | "review" | "run" | "done">("setup");
  const [moves, setMoves] = useState<Move[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<"ous" | "users">("ous");
  const [ouTotal, setOuTotal] = useState(0);
  const [ouDone, setOuDone] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [runError, setRunError] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [, recheck] = useState(0); // 실행 버튼을 누를 때 남은 로그인 시간을 다시 보게 한다

  const years = yearCandidates(units);
  const lastGrade = Number.parseInt(lastGradeText, 10);
  const overrides = csvRows.filter((r) => !r.problem);
  const csvBad = csvRows.filter((r) => r.problem);

  function loadUnits() {
    setOuError("");
    return listOrgUnits().then(setUnits, (e) => setOuError(`조직 목록을 불러오지 못했습니다: ${errorMessage(e)}`));
  }

  useEffect(() => {
    loadUnits();
  }, []);

  // 조직 목록이 오면 이름에 4자리 숫자가 가장 큰 학년도를 기본으로 고른다.
  useEffect(() => {
    if (yearOu || years.length === 0) return;
    const best = years.reduce((a, b) => (Number(yearDigits(b.orgUnitPath) || -1) > Number(yearDigits(a.orgUnitPath) || -1) ? b : a));
    pickYear(best.orgUnitPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units]);

  // 실행 중에 탭을 닫거나 새로고침하면 어디까지 처리됐는지 알 수 없다. 브라우저가 한 번 묻게 한다.
  useEffect(() => {
    if (step !== "run" || runError) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [step, runError]);

  // 실행 중에 패널이 사라지면(정상적으로는 일어나지 않는다) 메뉴 잠금을 푼다.
  useEffect(() => () => setLocked?.(false), [setLocked]);

  // 학년도를 바꾸면 새 학년도·졸업생 OU를 기본값으로 다시 채운다. 설정이 바뀌면 규칙을 다시 만들어야 한다.
  function pickYear(path: string) {
    setYearOu(path);
    setNewYear(nextYearName(path));
    setGraduateOu(graduateDefault(path));
    setRules(null);
  }

  async function makeRules() {
    setLoading(true);
    setLoadError("");
    setLoadedCount(0);
    setRules(null);
    try {
      const list: User[] = [];
      let pageToken: string | undefined;
      do {
        const res = await listUsers({ orgUnitPath: yearOu, pageToken });
        list.push(...res.users);
        setLoadedCount(list.length);
        pageToken = res.nextPageToken;
      } while (pageToken);
      const counts: Record<string, number> = {};
      for (const u of list) counts[u.orgUnitPath] = (counts[u.orgUnitPath] ?? 0) + 1;
      setUsers(list);
      setRules(
        planRules(units, { yearOu, newYear: norm(newYear), lastGrade, graduateOu: norm(graduateOu) }, counts),
      );
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function editRule(i: number, fields: Partial<Rule>) {
    setRules((list) => list && list.map((r, j) => (j === i ? { ...r, ...fields } : r)));
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 고쳐서 다시 골라도 다시 읽게 한다
    if (!file || !rules) return;
    setCsvError("");
    setReading(true);
    try {
      const buf = await file.arrayBuffer();
      const head = new Uint8Array(buf.slice(0, 2));
      if (head[0] === 0x50 && head[1] === 0x4b) {
        return setCsvError("엑셀 파일(.xlsx)은 읽지 못합니다. 엑셀에서 'CSV UTF-8'로 저장해 올리세요.");
      }
      const ouPaths = [...units.map((u) => u.orgUnitPath), ...rules.map((r) => norm(r.to))];
      const checked = validateActionRows(parseCsv(decodeCsv(buf)), domain, ouPaths, "move", me ?? "");
      if ("error" in checked) return setCsvError(checked.error);
      setCsvRows(
        checked.rows.map((r) => ({
          ...r,
          problem: r.problem
            .split(", ")
            .filter((p) => p && p !== NO_OU)
            .join(", "),
        })),
      );
    } catch (err) {
      setCsvError(errorMessage(err));
    } finally {
      setReading(false);
    }
  }

  function review() {
    if (!rules) return;
    const fixed = rules.map((r) => ({ ...r, to: norm(r.to) }));
    setMoves(planMoves(users, fixed, overrides, me ?? ""));
    setStep("review");
  }

  async function run() {
    setConfirming(false);
    setStep("run");
    setPhase("ous");
    setRunError("");
    setOuTotal(0);
    setOuDone(0);
    setDoneCount(0);
    setLocked?.(true);
    try {
      // 실행 직전의 조직 목록으로 다시 계산한다(검토 뒤에 누가 만들었을 수 있다).
      let existing: string[];
      try {
        existing = (await listOrgUnits()).map((u) => u.orgUnitPath);
      } catch (e) {
        setRunError(`조직 목록을 불러오지 못했습니다. ${errorMessage(e)}`);
        return;
      }
      const create = missingOus([...new Set(moves.map((m) => m.to))], existing);
      setOuTotal(create.length);
      for (let i = 0; i < create.length; i++) {
        try {
          await createOrgUnit(create[i]);
        } catch (e) {
          setRunError(
            isStatus(e, 403)
              ? "조직 단위를 만들 권한이 없습니다. 로그아웃 후 다시 로그인해 권한을 허용하세요"
              : `'${create[i]}' 조직 단위를 만들지 못했습니다. ${errorMessage(e)}`,
          );
          return;
        }
        setOuDone(i + 1);
      }

      setPhase("users");
      const out = await runBulk(
        moves,
        (m) =>
          withRetry(() =>
            updateUser(m.email, {
              orgUnitPath: m.to,
              ...(m.graduate && suspendGraduates ? { suspended: true } : {}),
            }),
          ).then(
            (): Result => ({ move: m, ok: true, message: "" }),
            (e): Result => ({ move: m, ok: false, message: isStatus(e, 404) ? "없는 계정" : errorMessage(e) }),
          ),
        setDoneCount,
      );
      setResults(out);
      setStep("done");
    } finally {
      setLocked?.(false);
    }
  }

  function downloadResults() {
    const grad = (m: Move) => (m.graduate ? (suspendGraduates ? "졸업(정지)" : "졸업") : "");
    const table = [
      ["이메일", "이전 조직단위", "새 조직단위", "졸업", "결과", "사유"],
      ...results.map((r) => [r.move.email, r.move.from, r.move.to, grad(r.move), r.ok ? "성공" : "실패", r.message]),
    ];
    downloadCsv(`학년진급결과_${stamp()}.csv`, toCsv(table));
  }

  // 이 탭이 구글 로그인 화면으로 갔다가 홈으로 돌아온다. 설정은 사라진다.
  function relogin() {
    clearToken();
    getToken();
  }

  function restart() {
    setRules(null);
    setUsers([]);
    setCsvRows([]);
    setCsvError("");
    setMoves([]);
    setResults([]);
    setRunError("");
    setStep("setup");
    loadUnits(); // 실행 때 만든 OU를 반영한다
  }

  if (step === "setup") {
    const blankTo = !!rules && rules.some((r) => !r.skip && r.to.trim() === "");
    return (
      <>
        {ouError && <p className="msg error">{ouError}</p>}
        <label htmlFor="pr-year">현재 학년도</label>
        <select
          id="pr-year"
          value={yearOu}
          onChange={(e) => pickYear(e.target.value)}
          disabled={loading || years.length === 0}
        >
          {years.length === 0 && <option value="">학년도 조직 단위가 없습니다</option>}
          {years.map((u) => (
            <option key={u.orgUnitPath} value={u.orgUnitPath}>
              {u.orgUnitPath}
            </option>
          ))}
        </select>
        <label htmlFor="pr-new">새 학년도 OU</label>
        <input
          id="pr-new"
          type="text"
          value={newYear}
          disabled={loading}
          onChange={(e) => {
            setNewYear(e.target.value);
            setRules(null);
          }}
        />
        <label htmlFor="pr-last">마지막 학년</label>
        <input
          id="pr-last"
          type="number"
          min={1}
          value={lastGradeText}
          disabled={loading}
          onChange={(e) => {
            setLastGradeText(e.target.value);
            setRules(null);
          }}
        />
        <label htmlFor="pr-grad">졸업생 OU</label>
        <input
          id="pr-grad"
          type="text"
          value={graduateOu}
          disabled={loading}
          onChange={(e) => {
            setGraduateOu(e.target.value);
            setRules(null);
          }}
        />
        <div className="filters">
          <div className="check">
            <label>
              <input
                type="checkbox"
                checked={suspendGraduates}
                onChange={(e) => setSuspendGraduates(e.target.checked)}
              />
              졸업생은 정지
            </label>
          </div>
        </div>
        <div className="actions">
          <button
            type="button"
            className={rules ? "btn" : "btn filled"}
            disabled={loading || !yearOu || !newYear.trim() || !graduateOu.trim() || !(lastGrade > 0)}
            onClick={makeRules}
          >
            규칙 만들기
          </button>
        </div>
        {loading && <p className="muted">학생을 불러오는 중… {loadedCount}명</p>}
        {loadError && <p className="msg error">{loadError}</p>}

        {rules && (
          <>
            <p>
              <strong>
                {yearOu} 아래 {rules.length}개 조직 · {users.length}명
              </strong>
            </p>
            {rules.length === 0 ? (
              <p className="muted">이 학년도 바로 아래에 조직 단위가 없습니다.</p>
            ) : (
              <div className="table-wrap tall">
                <table className="table">
                  <thead>
                    <tr>
                      <th>현재 OU</th>
                      <th>인원</th>
                      <th>새 OU</th>
                      <th>졸업</th>
                      <th>건너뛰기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r, i) => (
                      <tr key={r.from}>
                        <td>
                          <code>{r.from}</code>
                        </td>
                        <td>{r.count}명</td>
                        <td>
                          <input
                            type="text"
                            aria-label={`${r.from}의 새 OU`}
                            value={r.to}
                            disabled={r.skip}
                            onChange={(e) => editRule(i, { to: e.target.value })}
                          />
                        </td>
                        <td>{r.graduate && <span className="chip warn">졸업</span>}</td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${r.from} 건너뛰기`}
                            checked={r.skip}
                            onChange={(e) => editRule(i, { skip: e.target.checked })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted">
              현재 OU에 바로 들어 있는 학생만 옮깁니다(그 아래 하위 OU의 학생은 그대로). 관리자와 본인 계정은 옮기지
              않습니다.
            </p>

            <label htmlFor="pr-csv">학생별 새 반 CSV(선택)</label>
            <p className="muted">
              반 편성이 바뀌는 학생만 머리글 <code>이메일,조직단위</code>로 적어 올리면 위 규칙 대신 그 조직으로
              옮깁니다. 없는 조직 단위는 실행할 때 만듭니다.
            </p>
            <input id="pr-csv" type="file" accept=".csv,text/csv" onChange={onFile} disabled={reading} />
            {reading && <p className="muted">파일을 확인하는 중…</p>}
            {csvError && <p className="msg error">{csvError}</p>}
            {csvRows.length > 0 && (
              <>
                <p>
                  <strong>
                    CSV 지정 {overrides.length}명 · 문제 {csvBad.length}줄(제외됨)
                  </strong>
                </p>
                {csvBad.length > 0 && (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>이메일</th>
                          <th>조직단위</th>
                          <th>사유</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvBad.map((r, i) => (
                          <tr key={i}>
                            <td>
                              <code>{r.email}</code>
                            </td>
                            <td>
                              <code>{r.orgUnitPath}</code>
                            </td>
                            <td className="wrap">{r.problem}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="actions">
                  <button type="button" className="btn text" onClick={() => setCsvRows([])}>
                    CSV 지정 빼기
                  </button>
                </div>
              </>
            )}

            {blankTo && <p className="msg warn">새 OU가 빈 줄이 있습니다. 채우거나 건너뛰기를 고르세요.</p>}
            <div className="actions">
              <button type="button" className="btn filled" disabled={blankTo || reading} onClick={review}>
                검토
              </button>
            </div>
          </>
        )}
      </>
    );
  }

  if (step === "review") {
    const grads = moves.filter((m) => m.graduate);
    const targets = [...new Set(moves.map((m) => m.to))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
    const newOus = missingOus(targets, units.map((u) => u.orgUnitPath));
    const created = new Set(newOus);
    const csvCount = moves.filter((m) => m.source === "csv").length;
    const loaded = new Set(users.map((u) => u.primaryEmail.toLowerCase()));
    const notFound = overrides.filter((o) => !loaded.has(o.email)).length;
    const gradOus = [...new Set(grads.map((m) => m.to))].join("', '");
    const secondsLeft = tokenSecondsLeft();
    const loginLow = secondsLeft < MIN_LOGIN_SECONDS;
    const message =
      `${moves.length}명을 새 학년도 조직으로 옮깁니다.` +
      (grads.length
        ? ` 졸업생 ${grads.length}명은 '${gradOus}'로 ${suspendGraduates ? "옮기고 정지합니다" : "옮깁니다"}.`
        : "") +
      " 되돌리려면 같은 CSV로 다시 옮겨야 합니다.";
    return (
      <>
        <p>
          <strong>
            {moves.length}명 이동 · 그중 졸업 {grads.length}명{grads.length > 0 && (suspendGraduates ? "(정지)" : "(정지 안 함)")}{" "}
            · 새로 만들 OU {newOus.length}개
          </strong>
        </p>
        {newOus.length > 0 && (
          <>
            <p>새로 만들 조직 단위</p>
            <ul>
              {newOus.map((p) => (
                <li key={p}>
                  <code>{p}</code>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="table-wrap tall">
          <table className="table">
            <thead>
              <tr>
                <th>새 OU</th>
                <th>인원</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t}>
                  <td>
                    <code>{t}</code>
                  </td>
                  <td>{moves.filter((m) => m.to === t).length}명</td>
                  <td>{created.has(t) && <span className="chip info">새로 만듦</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>CSV 지정 {csvCount}명</p>
        {notFound > 0 && (
          <p className="msg warn">CSV의 {notFound}명은 {yearOu}에서 찾지 못해 제외했습니다.</p>
        )}
        {loginLow && (
          <p className="msg warn">
            로그인이 {Math.ceil(secondsLeft / 60)}분 뒤 만료됩니다. 일괄 작업은 1시간 안에 끝나지 않을 수 있어, 다시
            로그인한 뒤 시작하세요.
            <br />
            다시 로그인하면 처음부터 다시 설정해야 합니다.
          </p>
        )}
        <div className="actions">
          {loginLow ? (
            <button type="button" className="btn filled" onClick={relogin}>
              다시 로그인
            </button>
          ) : (
            <button
              type="button"
              className="btn filled"
              disabled={moves.length === 0}
              onClick={() => (tokenSecondsLeft() < MIN_LOGIN_SECONDS ? recheck((n) => n + 1) : setConfirming(true))}
            >
              {moves.length}명 진급 실행
            </button>
          )}
          <button type="button" className="btn text" onClick={() => setStep("setup")}>
            설정으로 돌아가기
          </button>
        </div>
        {confirming && (
          <Confirm
            message={message}
            confirmLabel="진급 실행"
            danger
            onConfirm={run}
            onCancel={() => setConfirming(false)}
          />
        )}
      </>
    );
  }

  if (step === "run") {
    if (runError) {
      return (
        <>
          <p className="msg error">{runError}</p>
          <p className="muted">
            학생은 아무도 옮기지 않았습니다.{ouDone > 0 && ` 조직 단위 ${ouDone}개는 이미 만들어졌습니다.`}
          </p>
          <div className="actions">
            <button type="button" className="btn text" onClick={restart}>
              처음부터
            </button>
          </div>
        </>
      );
    }
    const total = phase === "ous" ? ouTotal : moves.length;
    const done = phase === "ous" ? ouDone : doneCount;
    return (
      <>
        <p>
          {phase === "ous" ? "조직 단위를 만드는 중입니다…" : "학생을 옮기는 중입니다…"}{" "}
          <strong>
            {done} / {total}
          </strong>
        </p>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <p className="muted">끝날 때까지 이 화면을 떠나지 마세요.</p>
      </>
    );
  }

  const ok = results.filter((r) => r.ok).length;
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
              <th>이전 OU</th>
              <th>새 OU</th>
              <th>결과</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.move.email}>
                <td>
                  <code>{r.move.email}</code>
                </td>
                <td>
                  <code>{r.move.from}</code>
                </td>
                <td>
                  <code>{r.move.to}</code>
                </td>
                <td>{r.ok ? <span className="chip ok">성공</span> : <span className="chip err">실패</span>}</td>
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
      </div>
      <p className="muted">
        되돌리려면 결과 CSV에서 '이메일'과 '이전 조직단위' 열만 남겨 머리글을 <code>이메일,조직단위</code>로 바꾼 뒤
        「일괄 작업(CSV)」의 조직 단위 이동에 올리세요.
      </p>
      <div className="actions">
        <button type="button" className="btn text" onClick={restart}>
          처음부터
        </button>
      </div>
    </>
  );
}
