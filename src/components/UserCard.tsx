import { useEffect, useState, type ReactNode } from "react";
import {
  errorMessage,
  getLicenseLabel,
  getTeacherStatus,
  listUserGroups,
  type TeacherStatus,
  type User,
} from "../google/api";
import type { TaskId } from "../catalog/tasks";

// 항목별로 따로 불러온다. 하나가 실패해도 다른 항목은 보인다.
function useLoad<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    load().then(
      (data) => alive && setState({ key, data }),
      (e) => alive && setState({ key, error: errorMessage(e) }),
    );
    return () => {
      alive = false;
    };
  }, [key]); // 사용자(이메일)가 바뀔 때만 다시 불러온다
  return state?.key === key ? state : null;
}

function show<T>(state: { data?: T; error?: string } | null, render: (data: T) => ReactNode) {
  if (!state) return <span className="muted">불러오는 중…</span>;
  if (state.error !== undefined) return <span className="error-text">불러오지 못함: {state.error}</span>;
  return render(state.data as T);
}

function formatTime(iso?: string, never = "-") {
  if (!iso) return "-";
  const d = new Date(iso);
  if (d.getUTCFullYear() <= 1970) return never;
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

const yesNo = (v?: boolean) => (v ? "예" : "아니오");

const TEACHER_LABEL: Record<TeacherStatus, string> = {
  member: "승인됨 (classroom_teachers 그룹 가입)",
  "not-member": "미승인 (classroom_teachers 그룹 미가입)",
  "no-group": "이 도메인에 classroom_teachers 그룹이 없음",
};

export default function UserCard({
  user,
  domain,
  onAction,
}: {
  user: User;
  domain: string;
  onAction: (id: TaskId) => void;
}) {
  const email = user.primaryEmail;
  const groups = useLoad(() => listUserGroups(email), email);
  const license = useLoad(() => getLicenseLabel(email), email);
  const teacher = useLoad(() => getTeacherStatus(email, domain), email);

  const admin = user.isAdmin ? "최고 관리자" : user.isDelegatedAdmin ? "위임 관리자" : "아님";
  const suspended = user.suspended
    ? `정지됨${user.suspensionReason ? ` (사유: ${user.suspensionReason})` : ""}`
    : "정지 안 됨";

  const rows: [string, ReactNode][] = [
    ["이름", user.name.fullName],
    ["이메일", email],
    ["소속 조직(OU)", user.orgUnitPath],
    ["정지 여부", suspended],
    ["보관", yesNo(user.archived)],
    ["마지막 로그인", formatTime(user.lastLoginTime, "로그인 기록 없음")],
    ["생성일", formatTime(user.creationTime)],
    ["관리자", admin],
    ["2단계 인증", user.isEnrolledIn2Sv ? "사용 중" : "사용 안 함"],
    ["다음 로그인 때 비밀번호 변경", yesNo(user.changePasswordAtNextLogin)],
    [
      "소속 그룹",
      show(groups, (list) =>
        list.length === 0 ? (
          "없음"
        ) : (
          <ul className="plain">
            {list.map((g) => (
              <li key={g.email}>
                {g.name} <span className="muted">{g.email}</span>
              </li>
            ))}
          </ul>
        ),
      ),
    ],
    ["라이선스", show(license, (label) => label)],
    ["클래스룸 교사", show(teacher, (s) => TEACHER_LABEL[s])],
  ];

  return (
    <div className="card">
      <dl className="fields">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="actions wrap">
        <button type="button" className="btn" onClick={() => onAction("reset-password")}>
          비밀번호 초기화
        </button>
        <button type="button" className="btn" onClick={() => onAction("suspend")}>
          {user.suspended ? "정지 해제" : "정지"}
        </button>
        <button type="button" className="btn" onClick={() => onAction("move-ou")}>
          OU 이동
        </button>
        <button type="button" className="btn" onClick={() => onAction("approve-teacher")}>
          클래스룸 교사 승인
        </button>
        <button type="button" className="btn" onClick={() => onAction("diagnose-classroom")}>
          클래스룸 진단
        </button>
      </div>
    </div>
  );
}
