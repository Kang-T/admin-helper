// 전환 점검표: 도메인 전환(콘텐츠 전송)과 학년 초 준비에 필요한 설정을 점검한다.
// API 응답 → 점검 결과로 바꾸는 순수 함수만 둔다. 화면 코드와 분리해 Node에서도 시험한다. 구글에 요청하지 않는다.
import type { Check, CheckStatus } from "./diagnose";
import type { OrgUnit, Policy, User } from "./google/api";
import { nextYearName } from "./promote";
import { filterUsers } from "./userlist";

export const TITLES = {
  drive: "드라이브 외부 공유",
  join: "Classroom 수업 가입 범위",
  teacher: "Classroom 수업 만들기 권한",
  twoStep: "2단계 인증 강제",
  gmail: "Gmail 서비스",
  takeout: "Google Takeout·콘텐츠 전송",
  inactive: "미접속·정지 계정",
  nextYear: "다음 학년도 조직",
} as const;

export const STATUS_LABEL: Record<CheckStatus, string> = {
  problem: "막힘",
  info: "주의",
  pass: "됨",
  unknown: "직접 확인",
};

const stripId = (id: string) => id.replace(/^id:/, "");

// 최상위 OU는 listOrgUnits() 결과에 없을 수 있다. 그래서 "어느 하위 OU에도 해당하지 않는 OU에 걸린 정책"을 최상위로 본다.
// 같은 설정이 여럿이면 sortOrder가 큰 것. 그룹에 걸린 정책은 보지 않는다.
function resolvePolicy(
  policies: Policy[],
  isType: (type: string) => boolean,
  subOuIds: string[],
): { top?: Policy; others: number } {
  const subs = new Set(subOuIds.map(stripId));
  const mine = policies.filter(
    (p) => !p.policyQuery.group && p.policyQuery.orgUnit?.startsWith("orgUnits/") && isType(p.setting.type),
  );
  const ouOf = (p: Policy) => p.policyQuery.orgUnit!.slice("orgUnits/".length);
  const top = mine
    .filter((p) => !subs.has(ouOf(p)))
    .sort((a, b) => (b.policyQuery.sortOrder ?? 0) - (a.policyQuery.sortOrder ?? 0))[0];
  const others = new Set(mine.filter((p) => subs.has(ouOf(p))).map(ouOf)).size;
  return { top, others };
}

// "settings/drive_and_docs.external_sharing"처럼 앞에 settings/가 붙어 온다.
const typeIs = (name: string) => (type: string) => type === name || type.endsWith(`/${name}`);

// 값 필드 이름이 camelCase(API 응답)일 수도, snake_case(설정 문서)일 수도 있어 둘 다 본다.
function field(p: Policy, ...names: string[]): unknown {
  const v = p.setting.value ?? {};
  for (const n of names) if (n in v) return v[n];
  return undefined;
}

type Verdict = { status: CheckStatus; detail: string };

const unknownValue = (x: unknown): Verdict => ({
  status: "unknown",
  detail: `알 수 없는 값: ${x === undefined ? "없음" : typeof x === "string" ? x : JSON.stringify(x)}`,
});

function fromPolicy(
  title: string,
  link: string,
  policies: Policy[],
  subOuIds: string[],
  isType: (type: string) => boolean,
  judge: (p: Policy) => Verdict,
): Check {
  const { top, others } = resolvePolicy(policies, isType, subOuIds);
  const tail = others ? ` (하위 조직 ${others}곳에 다른 설정 있음)` : "";
  if (!top) return { title, status: "unknown", detail: `정책을 읽지 못했습니다${tail}`, link };
  const v = judge(top);
  return { title, status: v.status, detail: v.detail + tail, link };
}

export function driveSharingCheck(policies: Policy[], subOuIds: string[]): Check {
  return fromPolicy(TITLES.drive, "drive-sharing", policies, subOuIds, typeIs("drive_and_docs.external_sharing"), (p) => {
    const mode = field(p, "externalSharingMode", "external_sharing_mode");
    let v: Verdict;
    if (mode === "ALLOWED") v = { status: "pass", detail: "외부 공유 허용. 콘텐츠 전송으로 파일을 보낼 수 있습니다." };
    else if (mode === "ALLOWLISTED_DOMAINS") {
      v = { status: "info", detail: "허용 목록 도메인만. 받는 쪽 도메인이 목록에 있어야 콘텐츠 전송이 됩니다." };
    } else if (mode === "DISALLOWED") {
      v = { status: "problem", detail: "외부 공유 금지. 콘텐츠 전송으로 파일을 보낼 수 없습니다." };
    } else v = unknownValue(mode);
    if (field(p, "allowReceivingExternalFiles", "allow_receiving_external_files") === false) {
      v = {
        status: v.status === "pass" ? "info" : v.status,
        detail: `${v.detail} 외부 파일 받기 꺼짐(받는 쪽이면 막힘).`,
      };
    }
    return v;
  });
}

export function classroomJoinCheck(policies: Policy[], subOuIds: string[]): Check {
  return fromPolicy(TITLES.join, "classroom-settings", policies, subOuIds, typeIs("classroom.class_membership"), (p) => {
    const who = field(p, "whoCanJoinClasses", "who_can_join_classes");
    if (who === "ANYONE_IN_DOMAIN") {
      return {
        status: "problem",
        detail:
          "같은 도메인만 수업에 들어올 수 있음. 다른 도메인 계정을 공동 교사로 초대해 수업을 복사할 수 없습니다.",
      };
    }
    if (who === "ANYONE_IN_ALLOWLISTED_DOMAINS") return { status: "info", detail: "허용 목록 도메인만 가능" };
    if (who === "ANY_GOOGLE_WORKSPACE_USER" || who === "ANYONE") {
      return { status: "pass", detail: "다른 도메인 계정도 수업에 들어올 수 있습니다." };
    }
    return unknownValue(who);
  });
}

export function teacherPermissionCheck(policies: Policy[], subOuIds: string[]): Check {
  return fromPolicy(TITLES.teacher, "classroom-settings", policies, subOuIds, typeIs("classroom.teacher_permissions"), (p) => {
    const who = field(p, "whoCanCreateClasses", "who_can_create_classes");
    if (who === "VERIFIED_TEACHERS_ONLY") {
      return { status: "info", detail: "인증된 교사만 수업 생성. 새 계정 교사는 「교사 승인」이 필요합니다." };
    }
    if (who === "ALL_PENDING_AND_VERIFIED_TEACHERS") return { status: "info", detail: "교사 신청 후 승인 대기" };
    if (who === "ANYONE_IN_DOMAIN") return { status: "pass", detail: "누구나 수업 생성" };
    return unknownValue(who);
  });
}

const DAY = 24 * 60 * 60 * 1000;

export function twoStepCheck(policies: Policy[], subOuIds: string[], now: Date = new Date()): Check {
  return fromPolicy(TITLES.twoStep, "2sv", policies, subOuIds, typeIs("security.two_step_verification_enforcement"), (p) => {
    const from = field(p, "enforcedFrom", "enforced_from");
    if (from === undefined || from === null || from === "") return { status: "pass", detail: "강제 안 함" };
    const t = typeof from === "string" ? Date.parse(from) : NaN;
    if (Number.isNaN(t)) return unknownValue(from);
    if (t <= now.getTime()) {
      return {
        status: "info",
        detail: "2단계 인증 강제 중. 새 계정은 등록 전까지 로그인이 막힐 수 있어 전환 기간엔 유예를 검토하세요.",
      };
    }
    return { status: "info", detail: `${Math.ceil((t - now.getTime()) / DAY)}일 뒤 강제 시작` };
  });
}

export function gmailStatusCheck(policies: Policy[], subOuIds: string[]): Check {
  const isGmail = (type: string) => type.endsWith("service_status") && type.toLowerCase().includes("gmail");
  return fromPolicy(TITLES.gmail, "apps-core", policies, subOuIds, isGmail, (p) => {
    // 필드 이름(serviceState·service_state 등)에 기대지 않고 값 안의 문자열로 판단한다. "ENABLED"는 "DISABLED"에도 들어 있어 따옴표째 찾는다.
    const raw = JSON.stringify(p.setting.value ?? {});
    if (raw.includes('"DISABLED"')) {
      return {
        status: "problem",
        detail: "Gmail 꺼짐. 콘텐츠 전송 확인 코드가 새 계정 메일로 오므로 받는 쪽은 켜져 있어야 합니다.",
      };
    }
    if (raw.includes('"ENABLED"')) {
      return { status: "pass", detail: "Gmail 켜짐. 콘텐츠 전송 확인 코드를 받을 수 있습니다." };
    }
    return unknownValue(p.setting.value);
  });
}

export function policyChecks(policies: Policy[], subOuIds: string[], now: Date = new Date()): Check[] {
  return [
    driveSharingCheck(policies, subOuIds),
    classroomJoinCheck(policies, subOuIds),
    teacherPermissionCheck(policies, subOuIds),
    twoStepCheck(policies, subOuIds, now),
    gmailStatusCheck(policies, subOuIds),
  ];
}

// 정책을 읽지 못했을 때(권한 없음 등) 정책 기반 항목 1~5를 같은 제목·바로가기로 "확인 불가" 처리한다.
export function policyChecksUnavailable(detail: string): Check[] {
  return [
    { title: TITLES.drive, link: "drive-sharing" },
    { title: TITLES.join, link: "classroom-settings" },
    { title: TITLES.teacher, link: "classroom-settings" },
    { title: TITLES.twoStep, link: "2sv" },
    { title: TITLES.gmail, link: "apps-core" },
  ].map((c) => ({ ...c, status: "unknown" as const, detail }));
}

export function takeoutCheck(): Check {
  return {
    title: TITLES.takeout,
    status: "unknown",
    detail:
      "직접 확인: 관리 콘솔 → 데이터 → 데이터 가져오기 및 내보내기 → Google Takeout → '콘텐츠 전송 허용' 체크와 드라이브·Gmail 서비스 켜짐",
    link: "takeout",
  };
}

// 미접속은 관리자·정지·보관 계정을 빼고 센다(정지 계정은 따로 센다).
export function inactiveCheck(users: User[], now: Date): Check {
  const inactive = filterUsers(users, { ou: "/", status: "active", inactiveMonths: 6, excludeAdmins: true }, now).length;
  const suspended = filterUsers(users, { ou: "/", status: "suspended", inactiveMonths: null, excludeAdmins: false }, now).length;
  return {
    title: TITLES.inactive,
    status: "info",
    detail: `6개월 이상 미접속 ${inactive}명 · 정지 ${suspended}명 (전체 ${users.length}명). 전환 전에 정리하면 이전할 자료가 줄어듭니다.`,
  };
}

// 학년도는 3월에 시작한다. 2027년 2월은 2026학년도.
const schoolYear = (now: Date) => (now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1);

// 최상위 바로 아래 OU 중 이름에 4자리 연도가 든 것을 학년도 OU로 본다. 오늘 기준 학년도 이하에서 가장 큰 것이 현재 학년도.
// (가장 큰 연도를 현재로 보면 다음 학년도 OU를 만든 순간 그것이 현재가 되어 늘 "없음"이 나온다.)
export function nextYearOuCheck(orgUnits: OrgUnit[], now: Date): Check {
  const title = TITLES.nextYear;
  const years = orgUnits
    .filter((u) => u.orgUnitPath.split("/").filter(Boolean).length === 1)
    .map((u) => ({ path: u.orgUnitPath, year: Number(/\d{4}/.exec(u.orgUnitPath)?.[0] ?? NaN) }))
    .filter((y) => !Number.isNaN(y.year));
  if (years.length === 0) {
    return { title, status: "info", detail: "최상위에 학년도 조직(이름에 4자리 연도)이 없습니다." };
  }
  const sy = schoolYear(now);
  const past = years.filter((y) => y.year <= sy);
  const current = (past.length ? past : years).sort((a, b) => b.year - a.year)[0];
  const next = nextYearName(current.path);
  return orgUnits.some((u) => u.orgUnitPath === next)
    ? { title, status: "pass", detail: `${next} 있음` }
    : { title, status: "info", detail: `${next} 없음. 「학년 진급」 실행 때 자동으로 만듭니다.` };
}

const ORDER: CheckStatus[] = ["problem", "info", "pass", "unknown"];

// "막힘 1 · 주의 2 · 됨 3 · 직접 확인 2"
export function summarize(checks: Check[]): string {
  return ORDER.map((s) => `${STATUS_LABEL[s]} ${checks.filter((c) => c.status === s).length}`).join(" · ");
}

// [결과 복사]용 줄글. 교육청에 보내기 좋게 도메인·날짜·요약을 앞에 붙인다.
export function checklistText(domain: string, checks: Check[], date: string): string {
  return [
    `전환 점검표 · ${domain} · ${date}`,
    summarize(checks),
    "",
    ...checks.map((c, i) => `${i + 1}. ${c.title} [${STATUS_LABEL[c.status]}] ${c.detail}`),
  ].join("\n");
}
