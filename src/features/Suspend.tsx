import { useState } from "react";
import Confirm from "../components/Confirm";
import UserPicker from "../components/UserPicker";
import { errorMessage, updateUser } from "../google/api";
import type { PanelProps } from "../catalog/tasks";

export default function Suspend({ user, setUser }: PanelProps) {
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
      const updated = await updateUser(user.primaryEmail, { suspended: !user.suspended });
      setUser(updated);
      setDone(updated.suspended ? "계정을 정지했습니다." : "정지를 해제했습니다.");
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
            현재 상태:{" "}
            <strong>
              {user.suspended
                ? `정지됨${user.suspensionReason ? ` (사유: ${user.suspensionReason})` : ""}`
                : "사용 중"}
            </strong>
          </p>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {busy ? "처리 중…" : user.suspended ? "정지 해제" : "계정 정지"}
          </button>
        </>
      )}
      {done && <p className="msg ok">{done}</p>}
      {error && <p className="msg error">{error}</p>}
      {confirming && user && (
        <Confirm
          message={
            user.suspended
              ? `${user.name.fullName}(${user.primaryEmail}) 계정의 정지를 해제합니다. 다시 로그인할 수 있게 됩니다.`
              : `${user.name.fullName}(${user.primaryEmail}) 계정을 정지합니다. 정지되면 로그인할 수 없습니다.`
          }
          confirmLabel={user.suspended ? "정지 해제" : "정지"}
          danger={!user.suspended}
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
