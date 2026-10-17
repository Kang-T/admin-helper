import { useEffect, useState, type ChangeEvent } from "react";
import Confirm from "../components/Confirm";
import { createUser, errorMessage, isStatus, listOrgUnits } from "../google/api";
import type { PanelProps } from "../catalog/tasks";
import { MAX_ROWS, TEMPLATE, decodeCsv, downloadCsv, parseCsv, toCsv, validateRows, type BulkRow } from "../csv";
import { generatePassword } from "./ResetPassword";

type Outcome = "ok" | "exists" | "fail";
interface Result {
  row: BulkRow;
  password: string; // 성공한 줄만. 나머지는 비밀번호가 바뀌지 않았으므로 비운다.
  outcome: Outcome;
  message: string;
}

const OUTCOME_LABEL: Record<Outcome, string> = { ok: "성공", exists: "이미 있음", fail: "실패" };
const OUTCOME_CHIP: Record<Outcome, string> = { ok: "chip ok", exists: "chip warn", fail: "chip err" };
const CONCURRENCY = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 한 명 만들기. 409는 이미 있음. 429·500·503은 2초 뒤 한 번만 다시 시도한다.
async function createOne(row: BulkRow): Promise<Result> {
  const password = row.password || generatePassword();
  for (let attempt = 0; ; attempt++) {
    try {
      await createUser({
        primaryEmail: row.email,
        name: { familyName: row.familyName, givenName: row.givenName },
        password,
        changePasswordAtNextLogin: true,
        orgUnitPath: row.orgUnitPath,
      });
      return { row, password, outcome: "ok", message: "" };
    } catch (e) {
      if (isStatus(e, 409)) {
        // 첫 요청이 서버 오류로 끝났지만 실제로는 만들어졌을 수 있다. 비밀번호를 장담할 수 없다.
        const message = attempt > 0 ? "다시 시도하는 사이에 생겼습니다. 비밀번호 초기화로 새로 발급하세요" : "";
        return { row, password: "", outcome: "exists", message };
      }
      if (attempt === 0 && [429, 500, 503].some((s) => isStatus(e, s))) {
        await sleep(2000);
        continue;
      }
      return { row, password: "", outcome: "fail", message: errorMessage(e) };
    }
  }
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export default function BulkCreate({ domain }: PanelProps) {
  const [step, setStep] = useState<"pick" | "review" | "run" | "done">("pick");
  const [fileError, setFileError] = useState("");
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [results, setResults] = useState<Result[]>([]);

  const good = rows.filter((r) => !r.problem);
  const bad = rows.length - good.length;

  // 실행 중에 탭을 닫거나 새로고침하면 만든 계정의 비밀번호를 잃는다. 브라우저가 한 번 묻게 한다.
  useEffect(() => {
    if (step !== "run") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [step]);

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
      const ouPaths = await listOrgUnits().then(
        (list) => list.map((u) => u.orgUnitPath),
        (err) => Promise.reject(new Error(`조직 목록을 불러오지 못했습니다. ${errorMessage(err)}`)),
      );
      const checked = validateRows(parseCsv(decodeCsv(buf)), domain, ouPaths);
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
    setDoneCount(0);
    const out: Result[] = new Array(good.length);
    let next = 0;
    const worker = async () => {
      while (next < good.length) {
        const i = next++;
        out[i] = await createOne(good[i]);
        setDoneCount((n) => n + 1);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setResults(out);
    setStep("done");
  }

  function downloadResults() {
    const lines = results.map((r) => [
      r.row.email,
      r.row.familyName,
      r.row.givenName,
      r.row.orgUnitPath,
      r.password,
      OUTCOME_LABEL[r.outcome] + (r.message ? `: ${r.message}` : ""),
    ]);
    downloadCsv(
      `계정_생성결과_${stamp()}.csv`,
      toCsv([["이메일", "성", "이름", "조직단위", "임시 비밀번호", "결과"], ...lines]),
    );
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
        <p>
          머리글이 <code>성,이름,이메일,조직단위,비밀번호</code>인 CSV 파일로 한 번에 {MAX_ROWS}명까지 만듭니다. 이메일은
          앞부분만 써도 되고, 조직단위는 <code>/2026학년도/4-1</code>처럼 전체 경로로 씁니다. 비밀번호를 비우면 자동으로
          만듭니다.
        </p>
        <p className="muted">엑셀에서는 '다른 이름으로 저장 → CSV UTF-8'을 권합니다. 일반 CSV(EUC-KR)도 읽습니다.</p>
        <div className="actions">
          <button type="button" className="btn text" onClick={() => downloadCsv("계정_일괄생성_양식.csv", TEMPLATE)}>
            <span className="icon" aria-hidden="true">
              download
            </span>
            양식 내려받기
          </button>
        </div>
        <label htmlFor="bulk-file">CSV 파일</label>
        <input id="bulk-file" type="file" accept=".csv,text/csv" onChange={onFile} disabled={reading} />
        {reading && <p className="muted">파일을 확인하는 중…</p>}
        {fileError && <p className="msg error">{fileError}</p>}
      </>
    );
  }

  if (step === "review") {
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
                <th>성</th>
                <th>이름</th>
                <th>이메일</th>
                <th>조직단위</th>
                <th>비밀번호</th>
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.problem ? <span className="chip err">문제</span> : <span className="chip ok">정상</span>}</td>
                  <td>{r.familyName}</td>
                  <td>{r.givenName}</td>
                  <td>
                    <code>{r.email}</code>
                  </td>
                  <td>
                    <code>{r.orgUnitPath}</code>
                  </td>
                  <td>{r.password ? "입력됨" : "자동 생성"}</td>
                  <td className="wrap">{r.problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn filled"
            disabled={good.length === 0}
            onClick={() => setConfirming(true)}
          >
            {good.length}명 만들기
          </button>
          <button type="button" className="btn text" onClick={restart}>
            다른 파일 선택
          </button>
        </div>
        {confirming && (
          <Confirm
            message={`${good.length}명의 계정을 만듭니다. ${bad ? `문제가 있는 ${bad}줄은 제외됩니다. ` : ""}모두 다음 로그인 때 비밀번호를 바꾸게 됩니다.`}
            confirmLabel="만들기"
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
          계정을 만드는 중입니다… <strong>{doneCount} / {good.length}</strong>
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={good.length}
          aria-valuenow={doneCount}
        >
          <div style={{ width: `${(doneCount / good.length) * 100}%` }} />
        </div>
        <p className="muted">끝날 때까지 이 화면을 떠나지 마세요. 떠나면 임시 비밀번호를 볼 수 없습니다.</p>
      </>
    );
  }

  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  return (
    <>
      <p>
        <strong>
          성공 {count("ok")} · 이미 있음 {count("exists")} · 실패 {count("fail")}
        </strong>
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>이메일</th>
              <th>성</th>
              <th>이름</th>
              <th>조직단위</th>
              <th>임시 비밀번호</th>
              <th>결과</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>
                  <code>{r.row.email}</code>
                </td>
                <td>{r.row.familyName}</td>
                <td>{r.row.givenName}</td>
                <td>
                  <code>{r.row.orgUnitPath}</code>
                </td>
                <td>{r.password && <code className="pw">{r.password}</code>}</td>
                <td className="wrap">
                  <span className={OUTCOME_CHIP[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</span>
                  {r.message && <span className="reason">{r.message}</span>}
                </td>
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
      <p className="msg warn">
        이 파일에는 임시 비밀번호가 들어 있습니다. 나눠 준 뒤에는 지우세요. 이 화면을 떠나면 다시 볼 수 없습니다.
      </p>
      <div className="actions">
        <button type="button" className="btn text" onClick={restart}>
          처음부터
        </button>
      </div>
    </>
  );
}
