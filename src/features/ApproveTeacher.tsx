import { useEffect, useState } from "react";
import Confirm from "../components/Confirm";
import UserPicker from "../components/UserPicker";
import { settingById, consoleUrl } from "../catalog/settings";
import {
  addTeacher,
  errorMessage,
  getTeacherStatus,
  isStatus,
  teacherGroup,
  type TeacherStatus,
} from "../google/api";
import type { PanelProps } from "../catalog/tasks";

export default function ApproveTeacher({ domain, user, setUser }: PanelProps) {
  const [status, setStatus] = useState<TeacherStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const email = user?.primaryEmail;

  useEffect(() => {
    if (!email) return;
    let alive = true;
    getTeacherStatus(email, domain).then(
      (s) => alive && setStatus(s),
      (e) => alive && setError(errorMessage(e)),
    );
    return () => {
      alive = false;
    };
  }, [email, domain]);

  async function run() {
    if (!user) return;
    setConfirming(false);
    setBusy(true);
    setError("");
    try {
      await addTeacher(user.primaryEmail, domain);
      setStatus("member");
      setDone(true);
    } catch (e) {
      // 409: 이미 그룹에 있음
      if (isStatus(e, 409)) setStatus("member");
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const group = teacherGroup(domain);
  const classroomSettings = settingById("classroom-settings");

  return (
    <>
      <UserPicker user={user} onChange={setUser} />
      {user && !status && !error && <p className="muted">확인하는 중…</p>}
      {user && status === "member" && (
        <p className={done ? "msg ok" : ""}>
          {done ? "클래스룸 교사로 승인했습니다." : "이미 클래스룸 교사로 승인되어 있습니다."} ({group} 그룹 가입)
        </p>
      )}
      {user && status === "not-member" && (
        <>
          <p>
            아직 승인되지 않았습니다. {group} 그룹에 넣으면 수업을 만들 수 있습니다.
          </p>
          <button type="button" className="btn primary" disabled={busy} onClick={() => setConfirming(true)}>
            {busy ? "처리 중…" : "교사로 승인"}
          </button>
        </>
      )}
      {user && status === "no-group" && (
        <div className="msg warn">
          <p>
            이 도메인에 classroom_teachers 그룹이 없습니다. 콘솔 &gt; 앱 &gt; Google Workspace &gt; Classroom &gt;
            일반 설정 &gt; 교사 권한에서 확인하세요.
          </p>
          <a className="btn" href={consoleUrl(classroomSettings.url)} target="_blank" rel="noopener noreferrer">
            Classroom 설정 열기
          </a>
        </div>
      )}
      {error && <p className="msg error">{error}</p>}
      {confirming && user && (
        <Confirm
          message={`${user.name.fullName}(${user.primaryEmail})을(를) ${group} 그룹에 넣어 클래스룸 교사로 승인합니다.`}
          confirmLabel="승인"
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
