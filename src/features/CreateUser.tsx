import { useState, type FormEvent } from "react";
import Confirm from "../components/Confirm";
import { createUser, errorMessage, isStatus } from "../google/api";
import type { PanelProps } from "../catalog/tasks";
import { OuSelect, useOrgUnits } from "./MoveOu";
import { PasswordOptions, SecretBox, generatePassword, passwordLabel } from "./ResetPassword";
import { passwordProblem } from "../csv";

export default function CreateUser({ domain }: PanelProps) {
  const { units, error: loadError } = useOrgUnits();
  const [familyName, setFamilyName] = useState("");
  const [givenName, setGivenName] = useState("");
  const [local, setLocal] = useState("");
  const [ou, setOu] = useState("/");
  const [typed, setTyped] = useState("");
  const [changeAtNext, setChangeAtNext] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string; changeAtNext: boolean } | null>(null);

  const email = `${local.trim()}@${domain}`;

  function check(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!familyName.trim() || !givenName.trim()) return setError("성과 이름을 모두 입력하세요.");
    if (!/^[A-Za-z0-9._-]+$/.test(local.trim())) {
      return setError("이메일 앞부분은 영문, 숫자, 점(.), 밑줄(_), 하이픈(-)만 쓸 수 있습니다.");
    }
    const problem = passwordProblem(typed.trim());
    if (problem) return setError(`${problem}.`);
    setConfirming(true);
  }

  async function run() {
    setConfirming(false);
    setBusy(true);
    setError("");
    setCreated(null);
    const password = typed.trim() || generatePassword();
    try {
      await createUser({
        primaryEmail: email,
        name: { familyName: familyName.trim(), givenName: givenName.trim() },
        password,
        changePasswordAtNextLogin: changeAtNext,
        orgUnitPath: ou,
      });
      setCreated({ email, password, changeAtNext });
      setFamilyName("");
      setGivenName("");
      setLocal("");
      setTyped("");
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
          <p className="msg ok">
            계정을 만들었습니다.{created.changeAtNext ? " 첫 로그인 때 새 비밀번호를 정하게 됩니다." : ""}
          </p>
          <SecretBox
            rows={[
              ["이메일", created.email],
              [passwordLabel(created.changeAtNext), created.password],
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
        <PasswordOptions
          id="cu-password"
          password={typed}
          onPassword={setTyped}
          changeAtNext={changeAtNext}
          onChangeAtNext={setChangeAtNext}
        />
        <div className="actions">
          <button type="submit" className="btn filled" disabled={busy}>
            {busy ? "만드는 중…" : "계정 만들기"}
          </button>
        </div>
      </form>
      {error && <p className="msg error">{error}</p>}
      {confirming && (
        <Confirm
          message={`${familyName.trim()}${givenName.trim()}(${email}) 계정을 '${ou}' 조직에 새로 만듭니다. 비밀번호는 ${typed.trim() ? "입력한 값" : "자동 생성 12자"}이고, ${changeAtNext ? "첫 로그인 때 바꾸게 합니다" : "첫 로그인 때 바꾸라고 하지 않습니다"}.`}
          confirmLabel="만들기"
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
