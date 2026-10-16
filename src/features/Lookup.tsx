import UserCard from "../components/UserCard";
import UserPicker from "../components/UserPicker";
import type { PanelProps } from "../catalog/tasks";

export default function Lookup({ domain, user, setUser, openTask }: PanelProps) {
  return (
    <>
      <div className="card">
        <div className="bd">
          <UserPicker user={user} onChange={setUser} />
        </div>
      </div>
      {user && <UserCard user={user} domain={domain} onAction={openTask} />}
    </>
  );
}
