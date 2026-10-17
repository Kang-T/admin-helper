import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { CLIENT_ID, getToken, hasToken, signOut, takeLoginError } from "./google/auth";
import { errorMessage, getUserInfo, type User } from "./google/api";
import { TASKS, type PanelProps, type TaskId } from "./catalog/tasks";
import {
  SETTINGS,
  consoleUrl,
  setConsoleAccount,
  settingById,
  type SettingGroup,
  type SettingLink,
} from "./catalog/settings";
import UserCard from "./components/UserCard";
import UserPicker from "./components/UserPicker";
import Lookup from "./features/Lookup";
import ResetPassword from "./features/ResetPassword";
import Suspend from "./features/Suspend";
import MoveOu from "./features/MoveOu";
import CreateUser from "./features/CreateUser";
import BulkCreate from "./features/BulkCreate";
import ApproveTeacher from "./features/ApproveTeacher";
import DiagnoseClassroom from "./features/DiagnoseClassroom";

const PANELS: Record<TaskId, ComponentType<PanelProps>> = {
  lookup: Lookup,
  "reset-password": ResetPassword,
  suspend: Suspend,
  "move-ou": MoveOu,
  "create-user": CreateUser,
  "bulk-create": BulkCreate,
  "approve-teacher": ApproveTeacher,
  "diagnose-classroom": DiagnoseClassroom,
};

// 왼쪽 메뉴의 작업 항목 (DESIGN.md 1항). label은 메뉴·제목(h1)·빵부스러기에 같이 쓴다.
const TASK_NAV: { id: TaskId; label: string; icon: string; section: "사용자" | "클래스룸" }[] = [
  { id: "lookup", label: "사용자 찾기·상태", icon: "person_search", section: "사용자" },
  { id: "reset-password", label: "비밀번호 초기화", icon: "key", section: "사용자" },
  { id: "suspend", label: "정지·해제", icon: "block", section: "사용자" },
  { id: "move-ou", label: "조직 단위 이동", icon: "move_down", section: "사용자" },
  { id: "create-user", label: "신규 계정", icon: "person_add", section: "사용자" },
  { id: "bulk-create", label: "일괄 생성(CSV)", icon: "upload_file", section: "사용자" },
  { id: "approve-teacher", label: "교사 승인", icon: "verified", section: "클래스룸" },
  { id: "diagnose-classroom", label: "왜 수업을 못 만드나", icon: "troubleshoot", section: "클래스룸" },
];

// 왼쪽 메뉴 「설정 바로가기」 묶음과 아이콘
const SETTING_NAV: { group: SettingGroup; icon: string }[] = [
  { group: "디렉터리", icon: "group" },
  { group: "앱", icon: "apps" },
  { group: "생성형 AI", icon: "auto_awesome" },
  { group: "보안", icon: "security" },
  { group: "결제·라이선스", icon: "credit_card" },
  { group: "보고", icon: "bar_chart" },
  { group: "계정", icon: "manage_accounts" },
  { group: "기기", icon: "devices" },
];
const groupIcon = (group: SettingGroup) => SETTING_NAV.find((n) => n.group === group)!.icon;

// 홈 오른쪽 카드에 보이는 자주 쓰는 설정
const FREQUENT = ["apps-core", "classroom-settings", "genai-app", "users"].map(settingById);

type View =
  | { kind: "home" }
  | { kind: "task"; id: TaskId }
  | { kind: "settings"; group: SettingGroup | null }; // null = 전체 보기

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

function Logo() {
  return <div className="logo" aria-hidden="true" />;
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
      <main className="login">
        <div className="login-card">
          <div className="brand">
            <Logo />
            <b>Admin Helper</b>
          </div>
          <p className="subtitle">Google Workspace 관리자 도우미</p>
          <p className="lead">
            관리자 계정으로 로그인하면 자주 하는 관리 작업을 버튼 하나로 처리합니다. 서버 없이 브라우저에서 구글에
            직접 요청하며, 아무것도 저장하지 않습니다.
          </p>
          {CLIENT_ID ? (
            <button type="button" className="btn filled" onClick={login} disabled={busy}>
              {busy ? "로그인하는 중…" : "Google 관리자 계정으로 로그인"}
            </button>
          ) : (
            <p className="msg warn">설정이 필요합니다: SETUP_OAUTH.md를 보세요</p>
          )}
          {error && <p className="msg error">{error}</p>}
        </div>
      </main>
    );
  }

  return <Main account={account} onLogout={logout} />;
}

// 설정 바로가기 목록: 제목·설명·[콘솔에서 열기]·펼치는 단계 안내
function SettingList({ items }: { items: SettingLink[] }) {
  return (
    <ul className="list settings">
      {items.map((s) => (
        <li key={s.id}>
          <span className="icon" aria-hidden="true">
            {groupIcon(s.group)}
          </span>
          <div className="t">
            <b>{s.title}</b>
            <span>{s.description}</span>
            <details>
              <summary>단계 안내</summary>
              <ol>
                {s.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </details>
          </div>
          <a className="btn" href={consoleUrl(s.url)} target="_blank" rel="noopener noreferrer">
            콘솔에서 열기
            <span className="icon" aria-hidden="true">
              open_in_new
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

// 홈·진단 화면 오른쪽: 자주 쓰는 설정 4개 + [전체 보기]
function FrequentSettings({ onAll }: { onAll: () => void }) {
  return (
    <div className="card">
      <div className="hd">
        <h2>설정 바로가기</h2>
        <button type="button" className="btn text" onClick={onAll}>
          전체 보기
        </button>
      </div>
      <div className="bd">
        <ul className="list">
          {FREQUENT.map((s) => (
            <li key={s.id}>
              <a className="row-link" href={consoleUrl(s.url)} target="_blank" rel="noopener noreferrer">
                <span className="icon" aria-hidden="true">
                  {groupIcon(s.group)}
                </span>
                <span className="t">
                  <b>{s.title}</b>
                  <span>{s.description}</span>
                </span>
                <span className="icon" aria-label="콘솔에서 열기">
                  open_in_new
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Main({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>({ kind: "home" });
  const [user, setUser] = useState<User | null>(null);
  const [drawer, setDrawer] = useState(false); // 900px 미만에서 왼쪽 메뉴 서랍

  const tasks = TASKS.filter((t) => matches(query, t));
  const settings = SETTINGS.filter((s) => matches(query, s));
  const searching = query.trim() !== "";

  function go(next: View) {
    setView(next);
    setQuery("");
    setDrawer(false);
    window.scrollTo(0, 0);
  }
  const openTask = (id: TaskId) => go({ kind: "task", id });
  const showAll = () => go({ kind: "settings", group: null });

  function runFirst() {
    if (tasks[0]) openTask(tasks[0].id);
    else if (settings[0]) window.open(consoleUrl(settings[0].url), "_blank", "noopener,noreferrer");
  }

  const navItem = (key: string, on: boolean, icon: string, label: string, onClick: () => void, ext = false) => (
    <button
      key={key}
      type="button"
      className={`item${on ? " on" : ""}`}
      aria-current={on ? "page" : undefined}
      onClick={onClick}
    >
      <span className="icon" aria-hidden="true">
        {icon}
      </span>
      {label}
      {ext && (
        <span className="icon ext" aria-hidden="true">
          open_in_new
        </span>
      )}
    </button>
  );
  // 검색 결과를 보는 동안에는 메뉴 선택 표시를 끈다(본문과 맞춘다).
  const at = searching ? null : view;
  const taskNav = (section: "사용자" | "클래스룸") =>
    TASK_NAV.filter((n) => n.section === section).map((n) =>
      navItem(n.id, at?.kind === "task" && at.id === n.id, n.icon, n.label, () => openTask(n.id)),
    );

  // 본문: 빵부스러기·제목·내용
  let crumb: string[];
  let title: string;
  let lead = "";
  let body: ReactNode;

  if (searching) {
    crumb = ["홈", "검색"];
    title = "검색 결과";
    body = (
      <>
        <div className="card">
          <div className="hd">
            <h2>작업</h2>
          </div>
          <div className="bd">
            {tasks.length === 0 ? (
              <p className="muted">맞는 작업이 없습니다.</p>
            ) : (
              <ul className="list">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="row-link" onClick={() => openTask(t.id)}>
                      <span className="icon" aria-hidden="true">
                        {TASK_NAV.find((n) => n.id === t.id)!.icon}
                      </span>
                      <span className="t">
                        <b>{t.title}</b>
                        <span>{t.description}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="card">
          <div className="hd">
            <h2>설정 바로가기</h2>
          </div>
          <div className="bd">
            {settings.length === 0 ? <p className="muted">맞는 설정이 없습니다.</p> : <SettingList items={settings} />}
          </div>
        </div>
      </>
    );
  } else if (view.kind === "task") {
    const nav = TASK_NAV.find((n) => n.id === view.id)!;
    const Panel = PANELS[view.id];
    crumb = ["홈", nav.section, nav.label];
    title = nav.label;
    lead = TASKS.find((t) => t.id === view.id)!.description;
    // 작업이나 사용자가 바뀌면 패널을 새로 그려 이전 결과(임시 비밀번호 등)를 지운다
    const panel = (
      <Panel
        key={`${view.id}:${user?.primaryEmail ?? ""}`}
        domain={account.domain}
        user={user}
        setUser={setUser}
        openTask={openTask}
      />
    );
    // 찾기·상태는 패널 안에 사용자 카드가 있고, 신규 계정·일괄 생성은 선택한 사용자와 관계없다.
    const showUser = user && view.id !== "lookup" && view.id !== "create-user" && view.id !== "bulk-create";
    body = (
      <>
        {showUser && <UserCard user={user} domain={account.domain} onAction={openTask} />}
        {view.id === "lookup" ? (
          panel
        ) : view.id === "diagnose-classroom" ? (
          <div className="grid2">
            {panel}
            <FrequentSettings onAll={showAll} />
          </div>
        ) : (
          <div className="card">
            <div className="bd">{panel}</div>
          </div>
        )}
      </>
    );
  } else if (view.kind === "settings") {
    const group = view.group;
    crumb = group ? ["홈", "설정 바로가기", group] : ["홈", "설정 바로가기"];
    title = group ?? "설정 바로가기";
    body = group ? (
      <div className="card">
        <div className="bd">
          <SettingList items={SETTINGS.filter((s) => s.group === group)} />
        </div>
      </div>
    ) : (
      SETTING_NAV.map(({ group: g }) => (
        <div className="card" key={g}>
          <div className="hd">
            <h2>{g}</h2>
          </div>
          <div className="bd">
            <SettingList items={SETTINGS.filter((s) => s.group === g)} />
          </div>
        </div>
      ))
    );
  } else {
    crumb = ["홈"];
    title = "무엇을 도와드릴까요?";
    body = (
      <>
        <div className="card">
          <div className="bd">
            {/* 홈의 찾기 상자는 늘 검색 상태로 둔다. 고른 사람은 아래 카드로 보인다. */}
            <UserPicker user={null} onChange={setUser} />
            <p className="note">검색 결과를 고르면 아래에 상태와 할 수 있는 작업이 나옵니다. 콘솔을 열 필요가 없습니다.</p>
          </div>
        </div>
        {user && <UserCard user={user} domain={account.domain} onAction={openTask} />}
        <div className="grid2">
          <FrequentSettings onAll={showAll} />
        </div>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <button
          type="button"
          className="menu"
          aria-label="메뉴 열기"
          aria-expanded={drawer}
          onClick={() => setDrawer(true)}
        >
          <span className="icon" aria-hidden="true">
            menu
          </span>
        </button>
        <div className="brand">
          <Logo />
          <b>Admin Helper</b>
          <span>{account.domain}</span>
        </div>
        <div className="gsearch">
          <span className="icon" aria-hidden="true">
            search
          </span>
          <label className="sr-only" htmlFor="main-search">
            작업·설정 검색
          </label>
          <input
            id="main-search"
            type="search"
            placeholder="작업 또는 설정 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runFirst()}
          />
        </div>
        <div className="who">
          <span className="who-email">{account.email}</span>
          <div className="avatar" aria-hidden="true">
            {account.email.slice(0, 1).toUpperCase()}
          </div>
          <button type="button" className="btn text" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </header>

      <nav className={`nav${drawer ? " open" : ""}`} aria-label="메뉴">
        {navItem("home", at?.kind === "home", "home", "홈", () => go({ kind: "home" }))}
        <h4>사용자</h4>
        {taskNav("사용자")}
        <h4>클래스룸</h4>
        {taskNav("클래스룸")}
        <h4>
          설정 바로가기 <span>(콘솔로 이동)</span>
        </h4>
        {SETTING_NAV.map((n) =>
          navItem(
            n.group,
            at?.kind === "settings" && at.group === n.group,
            n.icon,
            n.group,
            () => go({ kind: "settings", group: n.group }),
            true,
          ),
        )}
      </nav>
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}

      <main className="main">
        <div className="crumb">{crumb.join(" › ")}</div>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
        {body}
      </main>
    </>
  );
}
