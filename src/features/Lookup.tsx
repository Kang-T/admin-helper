import UserCard from "../components/UserCard";
import UserPicker from "../components/UserPicker";
import type { PanelProps } from "../catalog/tasks";

export default function Lookup({ domain, user, setUser, openTask }: PanelProps) {
  return (
    <>
      <UserPicker user={user} onChange={setUser} />
      {user && <UserCard user={user} domain={domain} onAction={openTask} />}
    </>
  );
}
