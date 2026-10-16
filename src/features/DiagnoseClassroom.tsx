import { useCallback, useEffect, useState } from "react";
import Confirm from "../components/Confirm";
import UserPicker from "../components/UserPicker";
import { consoleUrl, settingById } from "../catalog/settings";
import { addTeacher, errorMessage, teacherGroup, updateUser } from "../google/api";
import { runDiagnosis, type Check, type CheckStatus } from "../diagnose";
import type { PanelProps } from "../catalog/tasks";

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: "통과",
  problem: "문제",
  unknown: "확인 불가",
  info: "참고",
};

export default function DiagnoseClassroom({ domain, user, setUser }: PanelProps) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);
  const [fix, setFix] = useState<Check["fix"]>();
  const [error, setError] = useState("");
  const email = user?.primaryEmail;

  const run = useCallback(async () => {
    if (!email) return;
    setRunning(true);
    setChecks(null);
    try {
      setChecks(await runDiagnosis(email, domain));
    } finally {
      setRunning(false);
    }
  }, [email, domain]);

  useEffect(() => {
    run();
  }, [run]);

  async function applyFix() {
    if (!user || !fix) return;
    const action = fix;
    setFix(undefined);
    setError("");
    try {
      if (action === "unsuspend") setUser(await updateUser(user.primaryEmail, { suspended: false }));
      else await addTeacher(user.primaryEmail, domain);
      await run();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <UserPicker user={user} onChange={setUser} />
      {user && running && <p className="muted">진단하는 중… (정책 확인에 몇 초 걸릴 수 있습니다)</p>}
      {user && checks && (
        <>
          <ol className="checks">
            {checks.map((c) => (
              <li key={c.title} className={`check ${c.status}`}>
                <div className="check-head">
                  <span className={`badge ${c.status}`}>{STATUS_LABEL[c.status]}</span>
                  <strong>{c.title}</strong>
                </div>
                <p>{c.detail}</p>
                {(c.fix || c.link) && (
                  <div className="actions wrap">
                    {c.fix === "unsuspend" && (
                      <button type="button" className="btn primary" onClick={() => setFix("unsuspend")}>
                        정지 해제
                      </button>
                    )}
                    {c.fix === "approve" && (
                      <button type="button" className="btn primary" onClick={() => setFix("approve")}>
                        교사로 승인
                      </button>
                    )}
                    {c.link && (
                      <a className="btn" href={consoleUrl(settingById(c.link).url)} target="_blank" rel="noopener noreferrer">
                        {settingById(c.link).title} 열기
                      </a>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="actions">
            <button type="button" className="btn" onClick={run} disabled={running}>
              다시 진단
            </button>
          </div>
        </>
      )}
      {error && <p className="msg error">{error}</p>}
      {fix && user && (
        <Confirm
          message={
            fix === "unsuspend"
              ? `${user.name.fullName}(${user.primaryEmail}) 계정의 정지를 해제합니다.`
              : `${user.name.fullName}(${user.primaryEmail})을(를) ${teacherGroup(domain)} 그룹에 넣어 클래스룸 교사로 승인합니다.`
          }
          confirmLabel={fix === "unsuspend" ? "정지 해제" : "승인"}
          onConfirm={applyFix}
          onCancel={() => setFix(undefined)}
        />
      )}
    </>
  );
}
