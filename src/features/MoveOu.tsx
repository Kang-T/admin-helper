import { useEffect, useState } from "react";
import Confirm from "../components/Confirm";
import UserPicker from "../components/UserPicker";
import { errorMessage, listOrgUnits, updateUser, type OrgUnit } from "../google/api";
import type { PanelProps } from "../catalog/tasks";

// OU 목록을 트리처럼 들여쓴 선택 상자. units는 트리 순서로 정렬돼 있어야 한다.
export function OuSelect({
  id,
  units,
  value,
  onChange,
}: {
  id: string;
  units: OrgUnit[];
  value: string;
  onChange: (path: string) => void;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="/">/ (최상위)</option>
      {units.map((u) => (
        <option key={u.orgUnitPath} value={u.orgUnitPath}>
          {"    ".repeat(u.orgUnitPath.split("/").length - 2)}
          {u.name}
        </option>
      ))}
    </select>
  );
}

// 패널이 열릴 때 OU 목록을 한 번 불러온다. 실패해도 최상위("/")는 고를 수 있다.
export function useOrgUnits() {
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    listOrgUnits().then(
      (list) => alive && setUnits(list),
      (e) => alive && setError(`조직 목록을 불러오지 못했습니다: ${errorMessage(e)}`),
    );
    return () => {
      alive = false;
    };
  }, []);
  return { units, error };
}

export default function MoveOu({ user, setUser }: PanelProps) {
  const { units, error: loadError } = useOrgUnits();
  const [target, setTarget] = useState(user?.orgUnitPath ?? "/");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function run() {
    if (!user) return;
    setConfirming(false);
    setBusy(true);
    setError("");
    setDone("");
    try {
      const updated = await updateUser(user.primaryEmail, { orgUnitPath: target });
      setUser(updated);
      setDone(`'${updated.orgUnitPath}'(으)로 옮겼습니다.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <UserPicker user={user} onChange={setUser} />
      {user && (
        <>
          <p>
            현재 소속: <strong>{user.orgUnitPath}</strong>
          </p>
          <label htmlFor="move-ou-target">옮길 조직</label>
          <OuSelect id="move-ou-target" units={units} value={target} onChange={setTarget} />
          {loadError && <p className="msg error">{loadError}</p>}
          <div className="actions">
            <button
              type="button"
              className="btn filled"
              disabled={busy || target === user.orgUnitPath}
              onClick={() => setConfirming(true)}
            >
              {busy ? "처리 중…" : "이동"}
            </button>
          </div>
        </>
      )}
      {done && <p className="msg ok">{done}</p>}
      {error && <p className="msg error">{error}</p>}
      {confirming && user && (
        <Confirm
          message={`${user.name.fullName}(${user.primaryEmail})의 소속을 '${user.orgUnitPath}'에서 '${target}'(으)로 옮깁니다. 새 조직의 설정(앱 사용 여부 등)이 바로 적용됩니다.`}
          confirmLabel="이동"
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
