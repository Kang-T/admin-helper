// 구글 로그인(OAuth 2.0 암시적 흐름, 같은 탭 이동).
// 팝업 창을 쓰지 않는다. 로그인 버튼을 누르면 이 탭이 구글 로그인 화면으로 갔다가
// 토큰을 주소 뒤(#access_token=…)에 붙여 돌아온다. 토큰은 읽자마자 주소에서 지우고
// 이 파일의 변수(메모리)에만 둔다. 새로고침하면 사라진다.

const SCOPE_LIST = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/admin.directory.user",
  "https://www.googleapis.com/auth/admin.directory.group.member",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/apps.licensing",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/cloud-identity.policies.readonly",
];

export const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

const STATE_KEY = "admin-helper-oauth-state"; // CSRF 방지용 난수. 토큰이 아니다.

let token: string | null = null;
let expiresAt = 0;
let loginError = "";

// 구글에서 돌아온 직후(주소에 #access_token=…)의 처리. 모듈이 로드될 때 한 번 실행된다.
(function readTokenFromUrl() {
  const hash = window.location.hash;
  if (!hash.includes("access_token=") && !hash.includes("error=")) return;
  const p = new URLSearchParams(hash.slice(1));
  window.history.replaceState(null, "", window.location.pathname); // 주소에서 토큰 제거

  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (!expected || p.get("state") !== expected) {
    loginError = "로그인 확인값이 맞지 않습니다. 다시 로그인하세요";
    return;
  }
  const error = p.get("error");
  if (error) {
    loginError =
      error === "access_denied"
        ? "로그인이 취소됐거나 조직에서 이 앱을 허용하지 않았습니다"
        : `로그인하지 못했습니다 (${error})`;
    return;
  }
  // 권한 화면은 항목별 체크박스가 있다. 체크를 빠뜨리면 그 권한이 없는 토큰이 와서
  // 다음 요청이 401로 떨어진다. 여기서 미리 잡아 알려준다.
  const granted = new Set((p.get("scope") ?? "").split(" "));
  const missing = SCOPE_LIST.filter((s) => !granted.has(s));
  if (missing.length) {
    loginError = `권한 화면에서 ${missing.length}개 항목이 선택되지 않았습니다. 다시 로그인해서 "모두 선택"을 눌러 주세요`;
    return;
  }
  token = p.get("access_token");
  // 만료 1분 전부터는 새 토큰을 받는다.
  expiresAt = Date.now() + (Number(p.get("expires_in") ?? 3600) - 60) * 1000;
})();

export function hasToken(): boolean {
  return !!token && Date.now() < expiresAt;
}

// 돌아온 직후의 로그인 오류(있으면). 한 번 읽으면 지운다.
export function takeLoginError(): string {
  const e = loginError;
  loginError = "";
  return e;
}

// 유효한 토큰이 있으면 그대로 준다. 없으면 구글 로그인 화면으로 이동한다(이 함수는 돌아오지 않는다).
export function getToken(): Promise<string> {
  if (token && Date.now() < expiresAt) return Promise.resolve(token);
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: window.location.origin + "/",
    response_type: "token",
    scope: SCOPE_LIST.join(" "),
    include_granted_scopes: "true",
    state,
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  return new Promise(() => {}); // 페이지가 떠나므로 끝나지 않는다
}

export function clearToken(): void {
  token = null;
  expiresAt = 0;
}

// 로그아웃: 구글에 토큰 폐기를 요청하고 메모리에서도 지운다.
export function signOut(): void {
  if (token) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(
      () => undefined,
    );
  }
  clearToken();
}
