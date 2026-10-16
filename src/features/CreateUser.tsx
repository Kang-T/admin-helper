import { useState, type FormEvent } from "react";
import Confirm from "../components/Confirm";
import { createUser, errorMessage, isStatus } from "../google/api";
import type { PanelProps } from "../catalog/tasks";
import { OuSelect, useOrgUnits } from "./MoveOu";
import { SecretBox, generatePassword } from "./ResetPassword";

export default function CreateUser({ domain }: PanelProps) {
  const { units, error: loadError } = useOrgUnits();
  const [familyName, setFamilyName] = useState("");
  const [givenName, setGivenName] = useState("");
  const [local, setLocal] = useState("");
  const [ou, setOu] = useState("/");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  const email = `${local.trim()}@${domain}`;

  function check(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!familyName.trim() || !givenName.trim()) return setError("성과 이름을 모두 입력하세요.");
    if (!/^[A-Za-z0-9._-]+$/.test(local.trim())) {
      return setError("이메일 앞부분은 영문, 숫자, 점(.), 밑줄(_), 하이픈(-)만 쓸 수 있습니다.");
    }
    setConfirming(true);
  }

  async function run() {
    setConfirming(false);
    setBusy(true);
    setError("");
    setCreated(null);
    const password = generatePassword();
    try {
      await createUser({
        primaryEmail: email,
        name: { familyName: familyName.trim(), givenName: givenName.trim() },
        password,
        changePasswordAtNextLogin: true,
        orgUnitPath: ou,
      });
      setCreated({ email, password });
      setFamilyName("");
      setGivenName("");
      setLocal("");
    } catch (e) {
      setError(isStatus(e, 409) ? "이미 있는 이메일입니다." : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {created && (
        <>
          <p className="msg ok">계정을 만들었습니다. 첫 로그인 때 새 비밀번호를 정하게 됩니다.</p>
          <SecretBox
            rows={[
              ["이메일", created.email],
              ["임시 비밀번호", created.password],
            ]}
            copyText={`${created.email}\n${created.password}`}
          />
        </>
      )}
      <form className="form" onSubmit={check}>
        <div className="row">
          <div className="field">
            <label htmlFor="cu-family">성</label>
            <input id="cu-family" value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cu-given">이름</label>
            <input id="cu-given" value={givenName} onChange={(e) => setGivenName(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="cu-local">이메일</label>
          <div className="row email-row">
            <input
              id="cu-local"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="domain">@{domain}</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="cu-ou">조직(OU)</label>
          <OuSelect id="cu-ou" units={units} value={ou} onChange={setOu} />
          {loadError && <p className="msg error">{loadError}</p>}
        </div>
        <p className="muted">임시 비밀번호는 자동으로 만들어집니다.</p>
        <div className="actions">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "만드는 중…" : "계정 만들기"}
          </button>
        </div>
      </form>
      {error && <p className="msg error">{error}</p>}
      {confirming && (
        <Confirm
          message={`${familyName.trim()}${givenName.trim()}(${email}) 계정을 '${ou}' 조직에 새로 만듭니다.`}
          confirmLabel="만들기"
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
