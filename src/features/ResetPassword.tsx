import { useState } from "react";
import Confirm from "../components/Confirm";
import UserPicker from "../components/UserPicker";
import { errorMessage, updateUser } from "../google/api";
import type { PanelProps } from "../catalog/tasks";
import { passwordProblem } from "../csv";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// 영문 대소문자+숫자 12자. 치우침이 없도록 범위를 벗어난 난수는 버린다.
// 대문자·소문자·숫자가 하나씩은 들어가게 한다.
export function generatePassword(): string {
  const limit = Math.floor(2 ** 32 / CHARS.length) * CHARS.length;
  for (;;) {
    let pw = "";
    while (pw.length < 12) {
      const [n] = crypto.getRandomValues(new Uint32Array(1));
      if (n < limit) pw += CHARS[n % CHARS.length];
    }
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw)) return pw;
  }
}

// 임시 비밀번호를 한 번만 보여준다. 컴포넌트가 사라지면(화면을 떠나면) 값도 사라진다.
export function SecretBox({ rows, copyText }: { rows: [string, string][]; copyText: string }) {
  const [copy, setCopy] = useState<"" | "ok" | "fail">("");
  return (
    <div className="secret">
      {rows.map(([label, value]) => (
        <div key={label} className="secret-row">
          <span className="muted">{label}</span>
          <code>{value}</code>
        </div>
      ))}
      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() =>
            navigator.clipboard.writeText(copyText).then(
              () => setCopy("ok"),
              () => setCopy("fail"),
            )
          }
        >
          {copy === "ok" ? "복사했습니다" : "복사"}
        </button>
      </div>
      {copy === "fail" && <p className="msg error">복사하지 못했습니다. 위 글자를 직접 선택해 복사하세요.</p>}
      <p className="muted">이 화면을 떠나면 다시 볼 수 없습니다. 지금 복사해 전달하세요.</p>
    </div>
  );
}

// 비밀번호 직접 입력(선택)과 「다음 로그인 때 바꾸게 하기」. 신규 계정·초기화가 같이 쓴다.
// 기본은 자동 생성 + 바꾸기 꺼짐(학년 초 기기 세팅 때 정한 비밀번호가 그대로 유지되게).
export function PasswordOptions({
  id,
  password,
  onPassword,
  changeAtNext,
  onChangeAtNext,
}: {
  id: string;
  password: string;
  onPassword: (v: string) => void;
  changeAtNext: boolean;
  onChangeAtNext: (v: boolean) => void;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor={id}>비밀번호 (선택)</label>
        <input
          id={id}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          placeholder="비우면 12자를 자동으로 만듭니다"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="muted">8자 이상, 영문·숫자·기호. 예: 학번+생일처럼 학교에서 정한 규칙</p>
      </div>
      <PasswordChangeCheck checked={changeAtNext} onChange={onChangeAtNext} />
    </>
  );
}

export function PasswordChangeCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="filters">
      <div className="check">
        <label>
          <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
          다음 로그인 때 비밀번호를 바꾸게 하기
        </label>
      </div>
      {!checked && (
        <p className="muted">
          꺼 두면 정한 비밀번호가 계속 유지됩니다. 학년 초 기기 세팅이 끝나면 학생이 직접 바꾸도록 안내하세요.
        </p>
      )}
    </div>
  );
}

export function passwordLabel(changeAtNext: boolean): string {
  return changeAtNext ? "임시 비밀번호" : "비밀번호";
}

export default function ResetPassword({ user, setUser }: PanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [changeAtNext, setChangeAtNext] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [doneChange, setDoneChange] = useState(false);

  function check() {
    setError("");
    const problem = passwordProblem(typed.trim());
    if (problem) return setError(`${problem}.`);
    setConfirming(true);
  }

  async function run() {
    if (!user) return;
    setConfirming(false);
    setBusy(true);
    setError("");
    const pw = typed.trim() || generatePassword();
    try {
      setUser(await updateUser(user.primaryEmail, { password: pw, changePasswordAtNextLogin: changeAtNext }));
      setPassword(pw);
      setDoneChange(changeAtNext);
      setTyped("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const how = typed.trim() ? "입력한 비밀번호로" : "자동으로 만든 12자 비밀번호로";
  const after = changeAtNext ? " 다음 로그인 때 새 비밀번호를 정하게 됩니다." : " 다음 로그인 때 바꾸라고 하지 않습니다.";

  return (
    <>
      <UserPicker user={user} onChange={setUser} />
      {user && !password && (
        <div className="form">
          <PasswordOptions
            id="rp-password"
            password={typed}
            onPassword={setTyped}
            changeAtNext={changeAtNext}
            onChangeAtNext={setChangeAtNext}
          />
          <div className="actions">
            <button type="button" className="btn filled" disabled={busy} onClick={check}>
              {busy ? "처리 중…" : "비밀번호 초기화"}
            </button>
          </div>
        </div>
      )}
      {user && password && (
        <>
          <p className="msg ok">비밀번호를 초기화했습니다.{doneChange ? " 다음 로그인 때 새 비밀번호를 정하게 됩니다." : ""}</p>
          <SecretBox
            rows={[
              ["이메일", user.primaryEmail],
              [passwordLabel(doneChange), password],
            ]}
            copyText={password}
          />
        </>
      )}
      {error && <p className="msg error">{error}</p>}
      {confirming && user && (
        <Confirm
          message={`${user.name.fullName}(${user.primaryEmail})의 비밀번호를 ${how} 바꿉니다.${after}`}
          confirmLabel="초기화"
          danger
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
