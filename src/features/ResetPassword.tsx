import { useState } from "react";
import Confirm from "../components/Confirm";
import UserPicker from "../components/UserPicker";
import { errorMessage, updateUser } from "../google/api";
import type { PanelProps } from "../catalog/tasks";

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
          className="btn primary"
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

export default function ResetPassword({ user, setUser }: PanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState<string | null>(null);

  async function run() {
    if (!user) return;
    setConfirming(false);
    setBusy(true);
    setError("");
    const pw = generatePassword();
    try {
      setUser(await updateUser(user.primaryEmail, { password: pw, changePasswordAtNextLogin: true }));
      setPassword(pw);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <UserPicker user={user} onChange={setUser} />
      {user && !password && (
        <>
          <p>임시 비밀번호(12자)를 새로 만들고, 다음 로그인 때 비밀번호를 바꾸도록 설정합니다.</p>
          <button type="button" className="btn primary" disabled={busy} onClick={() => setConfirming(true)}>
            {busy ? "처리 중…" : "비밀번호 초기화"}
          </button>
        </>
      )}
      {user && password && (
        <>
          <p className="msg ok">비밀번호를 초기화했습니다.</p>
          <SecretBox
            rows={[
              ["이메일", user.primaryEmail],
              ["임시 비밀번호", password],
            ]}
            copyText={password}
          />
        </>
      )}
      {error && <p className="msg error">{error}</p>}
      {confirming && user && (
        <Confirm
          message={`${user.name.fullName}(${user.primaryEmail})의 비밀번호를 임시 비밀번호로 바꿉니다. 다음 로그인 때 새 비밀번호를 정하게 됩니다.`}
          confirmLabel="초기화"
          danger
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
