import { useEffect, useState, type ChangeEvent } from "react";
import Confirm from "../components/Confirm";
import { errorMessage, isStatus, listOrgUnits, updateUser } from "../google/api";
import { clearToken, getToken, tokenSecondsLeft } from "../google/auth";
import type { PanelProps } from "../catalog/tasks";
import { runBulk, withRetry } from "../bulk";
import {
  ACTION_LABEL,
  MAX_ROWS,
  actionTemplate,
  decodeCsv,
  downloadCsv,
  parseCsv,
  stamp,
  toCsv,
  validateActionRows,
  type ActionRow,
  type BulkAction as Action,
} from "../csv";
import { PasswordChangeCheck, generatePassword, passwordLabel } from "./ResetPassword";

interface Result {
  email: string;
  outcome: "ok" | "fail";
  message: string;
  password?: string; // 비밀번호 초기화에 성공한 줄만
}

const MIN_LOGIN_SECONDS = 600; // 로그인이 이보다 적게 남았으면 시작하기 전에 다시 로그인하게 한다

const DESCRIPTION: Record<Action, string> = {
  suspend: "정지되면 로그인할 수 없습니다.",
  unsuspend: "정지된 계정을 다시 로그인할 수 있게 합니다.",
  move: "조직단위는 /2026학년도/4-1처럼 전체 경로로 씁니다.",
  reset: "비밀번호 열에 적은 값으로 바꿉니다. 비워 두면 12자를 자동으로 만듭니다. 결과 파일에 비밀번호가 들어갑니다.",
};

function confirmBase(action: Action, n: number, changeAtNext: boolean): string {
  if (action === "suspend") return `${n}명을 정지합니다. 정지되면 로그인할 수 없습니다.`;
  if (action === "unsuspend") return `${n}명의 정지를 해제합니다.`;
  if (action === "move") return `${n}명을 각자 지정한 조직 단위로 옮깁니다.`;
  const after = changeAtNext ? "다음 로그인 때 새 비밀번호를 정하게 됩니다." : "다음 로그인 때 바꾸라고 하지 않습니다.";
  return `${n}명의 비밀번호를 바꿉니다(적은 값, 비운 줄은 자동 생성). ${after}`;
}

// 한 명 처리. 429·500·503은 2초 뒤 한 번만 다시 시도한다(withRetry).
async function runOne(action: Action, row: ActionRow, changeAtNext: boolean): Promise<Result> {
  const password = action === "reset" ? row.password || generatePassword() : undefined;
  const fields =
    action === "move"
      ? { orgUnitPath: row.orgUnitPath }
      : action === "reset"
        ? { password, changePasswordAtNextLogin: changeAtNext }
        : { suspended: action === "suspend" };
  try {
    await withRetry(() => updateUser(row.email, fields));
    return { email: row.email, outcome: "ok", message: "", password };
  } catch (e) {
    return { email: row.email, outcome: "fail", message: isStatus(e, 404) ? "없는 계정" : errorMessage(e) };
  }
}

export default function BulkAction({ domain, me, setLocked }: PanelProps) {
  const [action, setAction] = useState<Action>("suspend");
  const [step, setStep] = useState<"pick" | "review" | "run" | "done">("pick");
  const [fileError, setFileError] = useState("");
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [changeAtNext, setChangeAtNext] = useState(false);
  const [, recheck] = useState(0); // 실행 버튼을 누를 때 남은 로그인 시간을 다시 보게 한다

  const label = ACTION_LABEL[action];
  const isMove = action === "move";
  const isReset = action === "reset";
  const good = rows.filter((r) => !r.problem);
  const bad = rows.length - good.length;

  // 실행 중에 탭을 닫거나 새로고침하면 어디까지 처리됐는지(초기화면 임시 비밀번호도) 잃는다. 브라우저가 한 번 묻게 한다.
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

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 고쳐서 다시 골라도 다시 읽게 한다
    if (!file) return;
    setFileError("");
    setReading(true);
    try {
      const buf = await file.arrayBuffer();
      const head = new Uint8Array(buf.slice(0, 2));
      if (head[0] === 0x50 && head[1] === 0x4b) {
        return setFileError("엑셀 파일(.xlsx)은 읽지 못합니다. 엑셀에서 'CSV UTF-8'로 저장해 올리세요.");
      }
      const ouPaths = isMove
        ? await listOrgUnits().then(
            (list) => list.map((u) => u.orgUnitPath),
            (err) => Promise.reject(new Error(`조직 목록을 불러오지 못했습니다. ${errorMessage(err)}`)),
          )
        : [];
      const checked = validateActionRows(parseCsv(decodeCsv(buf)), domain, ouPaths, action, me ?? "");
      if ("error" in checked) return setFileError(checked.error);
      setRows(checked.rows);
      setStep("review");
    } catch (err) {
      setFileError(errorMessage(err));
    } finally {
      setReading(false);
    }
  }

  async function run() {
    setConfirming(false);
    setStep("run");
    setLocked?.(true);
    setDoneCount(0);
    let out: Result[] = [];
    try {
      out = await runBulk(good, (row) => runOne(action, row, changeAtNext), setDoneCount);
    } finally {
      setLocked?.(false);
    }
    setResults(out);
    setStep("done");
  }

  function downloadResults() {
    const outcome = (r: Result) => (r.outcome === "ok" ? "성공" : "실패");
    const table = isReset
      ? [["이메일", passwordLabel(changeAtNext), "결과", "사유"], ...results.map((r) => [r.email, r.password ?? "", outcome(r), r.message])]
      : [["이메일", "결과", "사유"], ...results.map((r) => [r.email, outcome(r), r.message])];
    downloadCsv(`일괄_${label}결과_${stamp()}.csv`, toCsv(table));
  }

  // 이 탭이 구글 로그인 화면으로 갔다가 홈으로 돌아온다. 고른 파일은 사라진다.
  function relogin() {
    clearToken();
    getToken();
  }

  function restart() {
    setRows([]);
    setResults([]);
    setFileError("");
    setStep("pick");
  }

  if (step === "pick") {
    return (
      <>
        <label htmlFor="ba-action">작업</label>
        <select id="ba-action" value={action} onChange={(e) => setAction(e.target.value as Action)} disabled={reading}>
          {(Object.keys(ACTION_LABEL) as Action[]).map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a]}
            </option>
          ))}
        </select>
        <p>{DESCRIPTION[action]}</p>
        <p>
          머리글이 <code>{isMove ? "이메일,조직단위" : isReset ? "이메일,비밀번호" : "이메일"}</code>인 CSV 파일로 한 번에{" "}
          {MAX_ROWS}명까지 처리합니다. 이메일은 앞부분만 써도 됩니다.
          {isReset && " 비밀번호는 8자 이상, 영문·숫자·기호로 쓰고, 비우면 자동으로 만듭니다."}
        </p>
        <p className="muted">엑셀에서는 '다른 이름으로 저장 → CSV UTF-8'을 권합니다. 일반 CSV(EUC-KR)도 읽습니다.</p>
        <div className="actions">
          <button
            type="button"
            className="btn text"
            onClick={() => downloadCsv(`일괄_${label}_양식.csv`, actionTemplate(action))}
          >
            <span className="icon" aria-hidden="true">
              download
            </span>
            양식 내려받기
          </button>
        </div>
        <label htmlFor="ba-file">CSV 파일</label>
        <input id="ba-file" type="file" accept=".csv,text/csv" onChange={onFile} disabled={reading} />
        {reading && <p className="muted">파일을 확인하는 중…</p>}
        {fileError && <p className="msg error">{fileError}</p>}
      </>
    );
  }

  if (step === "review") {
    const secondsLeft = tokenSecondsLeft();
    const loginLow = secondsLeft < MIN_LOGIN_SECONDS;
    return (
      <>
        <p>
          <strong>
            정상 {good.length}명 · 문제 {bad}줄(제외됨)
          </strong>
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>상태</th>
                <th>이메일</th>
                {isMove && <th>조직단위</th>}
                {isReset && <th>비밀번호</th>}
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.problem ? <span className="chip err">문제</span> : <span className="chip ok">정상</span>}</td>
                  <td>
                    <code>{r.email}</code>
                  </td>
                  {isMove && (
                    <td>
                      <code>{r.orgUnitPath}</code>
                    </td>
                  )}
                  {isReset && <td>{r.password ? "입력됨" : "자동 생성"}</td>}
                  <td className="wrap">{r.problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isReset && <PasswordChangeCheck checked={changeAtNext} onChange={setChangeAtNext} />}
        {loginLow && (
          <p className="msg warn">
            로그인이 {Math.ceil(secondsLeft / 60)}분 뒤 만료됩니다. 일괄 작업은 1시간 안에 끝나지 않을 수 있어, 다시
            로그인한 뒤 시작하세요.
            <br />
            다시 로그인하면 파일을 다시 골라야 합니다.
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
              className={action === "suspend" ? "btn danger" : "btn filled"}
              disabled={good.length === 0}
              onClick={() =>
                tokenSecondsLeft() < MIN_LOGIN_SECONDS ? recheck((n) => n + 1) : setConfirming(true)
              }
            >
              {good.length}명 {label}
            </button>
          )}
          <button type="button" className="btn text" onClick={restart}>
            다른 파일 선택
          </button>
        </div>
        {confirming && (
          <Confirm
            message={`${confirmBase(action, good.length, changeAtNext)}${bad ? ` 문제가 있는 ${bad}줄은 제외됩니다.` : ""}`}
            confirmLabel={label}
            danger={action === "suspend" || isReset}
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
          처리하는 중입니다… <strong>{doneCount} / {good.length}</strong>
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={good.length}
          aria-valuenow={doneCount}
        >
          <div style={{ width: `${good.length ? (doneCount / good.length) * 100 : 0}%` }} />
        </div>
        <p className="muted">
          끝날 때까지 이 화면을 떠나지 마세요.{isReset && " 떠나면 비밀번호를 볼 수 없습니다."}
        </p>
      </>
    );
  }

  const ok = results.filter((r) => r.outcome === "ok").length;
  return (
    <>
      <p>
        <strong>
          성공 {ok} · 실패 {results.length - ok}
        </strong>
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>이메일</th>
              {isReset && <th>{passwordLabel(changeAtNext)}</th>}
              <th>결과</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>
                  <code>{r.email}</code>
                </td>
                {isReset && <td>{r.password && <code className="pw">{r.password}</code>}</td>}
                <td>{r.outcome === "ok" ? <span className="chip ok">성공</span> : <span className="chip err">실패</span>}</td>
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
      {isReset && (
        <p className="msg warn">
          이 파일에는 비밀번호가 들어 있습니다. 나눠 준 뒤에는 지우세요. 이 화면을 떠나면 다시 볼 수 없습니다.
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn text" onClick={restart}>
          처음부터
        </button>
      </div>
    </>
  );
}
