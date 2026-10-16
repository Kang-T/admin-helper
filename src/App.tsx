import { useEffect, useRef, useState, type ComponentType } from "react";
import { CLIENT_ID, getToken, hasToken, signOut, takeLoginError } from "./google/auth";
import { errorMessage, getUserInfo, type User } from "./google/api";
import { TASKS, type PanelProps, type TaskId } from "./catalog/tasks";
import { SETTINGS, consoleUrl, setConsoleAccount } from "./catalog/settings";
import Lookup from "./features/Lookup";
import ResetPassword from "./features/ResetPassword";
import Suspend from "./features/Suspend";
import MoveOu from "./features/MoveOu";
import CreateUser from "./features/CreateUser";
import ApproveTeacher from "./features/ApproveTeacher";
import DiagnoseClassroom from "./features/DiagnoseClassroom";

const PANELS: Record<TaskId, ComponentType<PanelProps>> = {
  lookup: Lookup,
  "reset-password": ResetPassword,
  suspend: Suspend,
  "move-ou": MoveOu,
  "create-user": CreateUser,
  "approve-teacher": ApproveTeacher,
  "diagnose-classroom": DiagnoseClassroom,
};

// 작업 버튼 왼쪽 원형 칩에 넣는 Material Symbols Rounded 아이콘 이름 (DESIGN.md 4항)
const ICONS: Record<TaskId, string> = {
  lookup: "person_search",
  "reset-password": "key",
  suspend: "block",
  "move-ou": "move_down",
  "create-user": "person_add",
  "approve-teacher": "verified",
  "diagnose-classroom": "troubleshoot",
};

interface Account {
  email: string;
  domain: string;
}

// 제목·설명·키워드 중 하나라도 검색어를 포함하면 보인다(대소문자 무시).
function matches(query: string, item: { title: string; description: string; keywords: string[] }) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.title, item.description, ...item.keywords].some((t) => t.toLowerCase().includes(q));
}

export default function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(() => hasToken()); // 구글에서 막 돌아왔으면 바로 계정 확인
  const [error, setError] = useState(() => takeLoginError());

  async function finishLogin() {
    try {
      const { email } = await getUserInfo();
      setConsoleAccount(email);
      setAccount({ email, domain: email.split("@")[1] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // 구글 로그인 화면에서 토큰을 받아 돌아온 직후: 로그인한 계정을 확인한다.
  useEffect(() => {
    if (hasToken() && !account) finishLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function login() {
    setBusy(true);
    setError("");
    getToken(); // 이 탭이 구글 로그인 화면으로 이동한다
  }

  function logout() {
    signOut();
    setAccount(null);
  }

  if (!account) {
    return (
      <main className="container login">
        <div className="login-stage">
          <div className="glow" aria-hidden="true" />
          <div className="login-card">
            <h1>Admin Helper</h1>
            <p className="subtitle">Google Workspace 관리자 도우미</p>
            <p className="lead">
              관리자 계정으로 로그인하면 자주 하는 관리 작업을 버튼 하나로 처리합니다. 서버 없이 브라우저에서 구글에
              직접 요청하며, 아무것도 저장하지 않습니다.
            </p>
            {CLIENT_ID ? (
              <button type="button" className="btn primary large" onClick={login} disabled={busy}>
                {busy ? "로그인하는 중…" : "Google 관리자 계정으로 로그인"}
              </button>
            ) : (
              <p className="msg warn">설정이 필요합니다: SETUP_OAUTH.md를 보세요</p>
            )}
            {error && <p className="msg error">{error}</p>}
          </div>
        </div>
      </main>
    );
  }

  return <Main account={account} onLogout={logout} />;
}

function Main({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<TaskId | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  const tasks = TASKS.filter((t) => matches(query, t));
  const settings = SETTINGS.filter((s) => matches(query, s));

  useEffect(() => {
    if (active) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [active]);

  function runFirst() {
    if (tasks[0]) setActive(tasks[0].id);
    else if (settings[0]) window.open(consoleUrl(settings[0].url), "_blank", "noopener,noreferrer");
  }

  const activeTask = TASKS.find((t) => t.id === active);
  const Panel = active ? PANELS[active] : null;

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <strong className="brand">Admin Helper</strong>
          <div className="who">
            <span>{account.email}</span>
            <span className="muted">도메인 {account.domain}</span>
          </div>
          <button type="button" className="btn" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </header>

      <main className="container">
        <label className="sr-only" htmlFor="main-search">
          작업·설정 검색
        </label>
        <div className="search-box">
          <span className="icon" aria-hidden="true">
            search
          </span>
          <input
            id="main-search"
            className="search"
            type="search"
            placeholder="무엇을 할까요? 예: 비밀번호, 정지, 클래스룸, OU"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runFirst()}
            autoFocus
          />
        </div>

        <section>
          <h2>자주 하는 작업</h2>
          {tasks.length === 0 ? (
            <p className="muted">맞는 작업이 없습니다.</p>
          ) : (
            <div className="task-grid">
              {tasks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`task-btn${t.id === active ? " active" : ""}`}
                  onClick={() => setActive(t.id)}
                >
                  <span className="task-icon icon" aria-hidden="true">
                    {ICONS[t.id]}
                  </span>
                  <span className="task-text">
                    <span className="task-title">{t.title}</span>
                    <span className="task-desc">{t.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {Panel && activeTask && (
          <section className="panel" ref={panelRef}>
            <div className="panel-head">
              <h2>{activeTask.title}</h2>
              <button type="button" className="btn" onClick={() => setActive(null)}>
                닫기
              </button>
            </div>
            {/* 작업이나 사용자가 바뀌면 패널을 새로 그려 이전 결과(임시 비밀번호 등)를 지운다 */}
            <Panel
              key={`${active}:${user?.primaryEmail ?? ""}`}
              domain={account.domain}
              user={user}
              setUser={setUser}
              openTask={setActive}
            />
          </section>
        )}

        <section>
          <h2>설정 바로가기</h2>
          {settings.length === 0 ? (
            <p className="muted">맞는 설정이 없습니다.</p>
          ) : (
            <ul className="settings">
              {settings.map((s) => (
                <li key={s.id} className="setting">
                  <div className="setting-head">
                    <div>
                      <h3>{s.title}</h3>
                      <p className="muted">{s.description}</p>
                    </div>
                    <a className="btn" href={consoleUrl(s.url)} target="_blank" rel="noopener noreferrer">
                      콘솔에서 열기
                      <span className="icon" aria-hidden="true">
                        open_in_new
                      </span>
                    </a>
                  </div>
                  <details>
                    <summary>단계 안내</summary>
                    <ol>
                      {s.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
