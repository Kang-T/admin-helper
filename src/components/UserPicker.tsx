import { useState, type FormEvent } from "react";
import { errorMessage, searchUsers, type User } from "../google/api";

// 사용자가 선택돼 있으면 이름·이메일과 [다른 사용자 선택]을, 아니면 검색창을 보여준다.
export default function UserPicker({
  user,
  onChange,
}: {
  user: User | null;
  onChange: (user: User | null) => void;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<User[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (user) {
    return (
      <div className="picked">
        <div>
          <strong>{user.name.fullName}</strong>
          <span className="muted"> {user.primaryEmail}</span>
        </div>
        <button type="button" className="btn" onClick={() => onChange(null)}>
          다른 사용자 선택
        </button>
      </div>
    );
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    setBusy(true);
    setError("");
    try {
      setResults(await searchUsers(q));
    } catch (err) {
      setResults(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="picker">
      <form className="row" onSubmit={search}>
        <label className="sr-only" htmlFor="user-search">
          사용자 검색
        </label>
        <input
          id="user-search"
          type="search"
          placeholder="이메일 또는 이름(앞부분만 써도 됩니다)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "찾는 중…" : "찾기"}
        </button>
      </form>
      {error && <p className="msg error">{error}</p>}
      {results && results.length === 0 && <p className="muted">검색 결과가 없습니다.</p>}
      {results && results.length > 0 && (
        <ul className="results">
          {results.map((u) => (
            <li key={u.primaryEmail}>
              <button type="button" onClick={() => onChange(u)}>
                <strong>{u.name.fullName}</strong>
                <span>{u.primaryEmail}</span>
                <span className="muted">{u.orgUnitPath}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
