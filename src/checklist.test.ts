import { describe, expect, it } from "vitest";
import type { OrgUnit, Policy, User } from "./google/api";
import {
  checklistText,
  classroomJoinCheck,
  driveSharingCheck,
  gmailStatusCheck,
  inactiveCheck,
  nextYearOuCheck,
  policyChecks,
  policyChecksUnavailable,
  summarize,
  takeoutCheck,
  teacherPermissionCheck,
  twoStepCheck,
} from "./checklist";

// 시험용 값은 모두 예시다(실제 학교·사람이 아님).
// 최상위 OU id는 ROOT, 하위 OU id는 SUB1·SUB2. 하위 OU 목록에는 최상위가 없다.
const ROOT = "03root";
const SUBS = ["id:sub1", "id:sub2"];

const policy = (
  orgUnitId: string,
  type: string,
  value?: Record<string, unknown>,
  extra: Partial<Policy["policyQuery"]> = {},
) => ({ policyQuery: { orgUnit: `orgUnits/${orgUnitId}`, ...extra }, setting: { type, value } }) as Policy;

const DRIVE = "settings/drive_and_docs.external_sharing";
const JOIN = "settings/classroom.class_membership";
const TEACHER = "settings/classroom.teacher_permissions";
const TWO_SV = "settings/security.two_step_verification_enforcement";
const GMAIL = "settings/gmail.service_status";

const NOW = new Date("2026-11-08T12:00:00.000Z");

describe("최상위 정책 고르기(드라이브 외부 공유로 시험)", () => {
  it("정책이 없으면 확인 불가", () => {
    expect(driveSharingCheck([], SUBS)).toEqual({
      title: "드라이브 외부 공유",
      status: "unknown",
      detail: "구글이 이 설정을 API로 돌려주지 않습니다. 콘솔에서 직접 확인하세요",
      link: "drive-sharing",
    });
  });

  it("하위 OU에만 있고 최상위에 없으면 확인 불가 + 하위 개수", () => {
    const c = driveSharingCheck([policy("sub1", DRIVE, { externalSharingMode: "ALLOWED" })], SUBS);
    expect(c.status).toBe("unknown");
    expect(c.detail).toBe("구글이 이 설정을 API로 돌려주지 않습니다. 콘솔에서 직접 확인하세요 (하위 조직 1곳에 다른 설정 있음)");
  });

  it("하위 OU 목록에 없는 OU의 정책을 최상위로 본다(id: 접두사는 떼고 비교)", () => {
    const c = driveSharingCheck(
      [policy("sub1", DRIVE, { externalSharingMode: "DISALLOWED" }), policy(ROOT, DRIVE, { externalSharingMode: "ALLOWED" })],
      SUBS,
    );
    expect(c.status).toBe("pass");
  });

  it("하위 OU에 따로 걸린 정책은 OU 수로 센다(같은 OU에 둘이어도 1곳)", () => {
    const c = driveSharingCheck(
      [
        policy(ROOT, DRIVE, { externalSharingMode: "ALLOWED" }),
        policy("sub1", DRIVE, { externalSharingMode: "DISALLOWED" }),
        policy("sub1", DRIVE, { externalSharingMode: "DISALLOWED" }, { sortOrder: 2 }),
        policy("sub2", DRIVE, { externalSharingMode: "ALLOWLISTED_DOMAINS" }),
      ],
      SUBS,
    );
    expect(c.detail).toBe("외부 공유 허용. 콘텐츠 전송으로 파일을 보낼 수 있습니다. (하위 조직 2곳에 다른 설정 있음)");
  });

  it("최상위에 여럿이면 sortOrder가 큰 것", () => {
    const c = driveSharingCheck(
      [
        policy(ROOT, DRIVE, { externalSharingMode: "ALLOWED" }, { sortOrder: 1 }),
        policy(ROOT, DRIVE, { externalSharingMode: "DISALLOWED" }, { sortOrder: 5 }),
      ],
      SUBS,
    );
    expect(c.status).toBe("problem");
  });

  it("그룹에 걸린 정책과 다른 설정 종류는 보지 않는다", () => {
    const c = driveSharingCheck(
      [
        policy(ROOT, DRIVE, { externalSharingMode: "DISALLOWED" }, { group: "groups/abc" }),
        policy(ROOT, "settings/drive_and_docs.shared_drive_creation", { externalSharingMode: "DISALLOWED" }),
      ],
      SUBS,
    );
    expect(c.status).toBe("unknown");
  });
});

describe("driveSharingCheck", () => {
  const one = (value: Record<string, unknown>) => driveSharingCheck([policy(ROOT, DRIVE, value)], SUBS);

  it("ALLOWED → 됨", () => {
    expect(one({ externalSharingMode: "ALLOWED" })).toEqual({
      title: "드라이브 외부 공유",
      status: "pass",
      detail: "외부 공유 허용. 콘텐츠 전송으로 파일을 보낼 수 있습니다.",
      link: "drive-sharing",
    });
  });

  it("ALLOWLISTED_DOMAINS → 주의", () => {
    const c = one({ externalSharingMode: "ALLOWLISTED_DOMAINS" });
    expect(c.status).toBe("info");
    expect(c.detail).toBe("허용 목록 도메인만. 받는 쪽 도메인이 목록에 있어야 콘텐츠 전송이 됩니다.");
  });

  it("DISALLOWED → 막힘", () => {
    const c = one({ externalSharingMode: "DISALLOWED" });
    expect(c.status).toBe("problem");
    expect(c.detail).toBe("외부 공유 금지. 콘텐츠 전송으로 파일을 보낼 수 없습니다.");
  });

  it("snake_case 필드 이름도 읽는다", () => {
    expect(one({ external_sharing_mode: "DISALLOWED" }).status).toBe("problem");
  });

  it("외부 파일 받기가 꺼져 있으면 문구를 붙이고 됨 → 주의", () => {
    const c = one({ externalSharingMode: "ALLOWED", allowReceivingExternalFiles: false });
    expect(c.status).toBe("info");
    expect(c.detail).toBe("외부 공유 허용. 콘텐츠 전송으로 파일을 보낼 수 있습니다. 외부 파일 받기 꺼짐(받는 쪽이면 막힘).");
  });

  it("외부 파일 받기 꺼짐이어도 막힘은 막힘", () => {
    expect(one({ external_sharing_mode: "DISALLOWED", allow_receiving_external_files: false }).status).toBe("problem");
  });

  it("외부 파일 받기가 true면 그대로", () => {
    expect(one({ externalSharingMode: "ALLOWED", allowReceivingExternalFiles: true }).status).toBe("pass");
  });

  it("모르는 값이면 확인 불가", () => {
    const c = one({ externalSharingMode: "SOMETHING_NEW" });
    expect(c.status).toBe("unknown");
    expect(c.detail).toBe("알 수 없는 값: SOMETHING_NEW");
  });
});

describe("classroomJoinCheck", () => {
  const one = (who?: string) => classroomJoinCheck([policy(ROOT, JOIN, who ? { whoCanJoinClasses: who } : {})], SUBS);

  it("같은 도메인만 → 막힘", () => {
    const c = one("ANYONE_IN_DOMAIN");
    expect(c.status).toBe("problem");
    expect(c.link).toBe("classroom-settings");
    expect(c.detail).toContain("공동 교사로 초대해 수업을 복사할 수 없습니다");
  });

  it("허용 목록 → 주의", () => {
    expect(one("ANYONE_IN_ALLOWLISTED_DOMAINS")).toMatchObject({ status: "info", detail: "허용 목록 도메인만 가능" });
  });

  it("모든 Workspace 사용자·누구나 → 됨", () => {
    expect(one("ANY_GOOGLE_WORKSPACE_USER").status).toBe("pass");
    expect(one("ANYONE").status).toBe("pass");
  });

  it("값이 없으면 확인 불가", () => {
    expect(one()).toMatchObject({ status: "unknown", detail: "알 수 없는 값: 없음" });
  });

  it("정책 없음", () => {
    expect(classroomJoinCheck([], SUBS).detail).toBe("구글이 이 설정을 API로 돌려주지 않습니다. 콘솔에서 직접 확인하세요");
  });
});

describe("teacherPermissionCheck", () => {
  const one = (who: string) => teacherPermissionCheck([policy(ROOT, TEACHER, { whoCanCreateClasses: who })], SUBS);

  it("인증된 교사만 → 주의", () => {
    expect(one("VERIFIED_TEACHERS_ONLY")).toMatchObject({
      status: "info",
      detail: "인증된 교사만 수업 생성. 새 계정 교사는 「교사 승인」이 필요합니다.",
      link: "classroom-settings",
    });
  });

  it("신청 후 승인 대기 → 주의", () => {
    expect(one("ALL_PENDING_AND_VERIFIED_TEACHERS")).toMatchObject({ status: "info", detail: "교사 신청 후 승인 대기" });
  });

  it("누구나 → 됨", () => {
    expect(one("ANYONE_IN_DOMAIN")).toMatchObject({ status: "pass", detail: "누구나 수업 생성" });
  });

  it("모르는 값 → 확인 불가", () => {
    expect(one("X").status).toBe("unknown");
  });
});

describe("twoStepCheck epoch", () => {
  it("1970-01-01은 강제 안 함", () => {
    const p = { setting: { type: "settings/security.two_step_verification_enforcement", value: { enforcedFrom: "1970-01-01T00:00:00Z" } }, policyQuery: { orgUnit: "orgUnits/root1", sortOrder: 1 } } as never;
    expect(twoStepCheck([p], []).detail).toBe("강제 안 함");
  });
});

describe("twoStepCheck", () => {
  const one = (value: Record<string, unknown>) => twoStepCheck([policy(ROOT, TWO_SV, value)], SUBS, NOW);

  it("강제 시점이 과거 → 주의(강제 중)", () => {
    const c = one({ enforcedFrom: "2026-01-01T00:00:00Z" });
    expect(c.status).toBe("info");
    expect(c.detail).toBe(
      "2단계 인증 강제 중. 새 계정은 등록 전까지 로그인이 막힐 수 있어 전환 기간엔 유예를 검토하세요.",
    );
    expect(c.link).toBe("2sv");
  });

  it("강제 시점이 미래 → 주의(N일 뒤)", () => {
    expect(one({ enforcedFrom: "2026-11-18T12:00:00Z" })).toMatchObject({ status: "info", detail: "10일 뒤 강제 시작" });
  });

  it("하루가 안 남았으면 1일 뒤", () => {
    expect(one({ enforcedFrom: "2026-11-08T13:00:00Z" }).detail).toBe("1일 뒤 강제 시작");
  });

  it("값이 없거나 빈 값 → 됨(강제 안 함)", () => {
    expect(one({})).toMatchObject({ status: "pass", detail: "강제 안 함" });
    expect(one({ enforcedFrom: "" })).toMatchObject({ status: "pass", detail: "강제 안 함" });
  });

  it("snake_case 필드도 읽는다", () => {
    expect(one({ enforced_from: "2026-01-01T00:00:00Z" }).detail).toContain("강제 중");
  });

  it("날짜가 아니면 확인 불가", () => {
    expect(one({ enforcedFrom: "언젠가" }).status).toBe("unknown");
  });
});

describe("gmailStatusCheck", () => {
  const one = (value: Record<string, unknown>, type = GMAIL) => gmailStatusCheck([policy(ROOT, type, value)], SUBS);

  it("켜짐 → 됨", () => {
    expect(one({ serviceState: "ENABLED" })).toMatchObject({
      status: "pass",
      detail: "Gmail 켜짐. 콘텐츠 전송 확인 코드를 받을 수 있습니다.",
      link: "apps-core",
    });
  });

  it("꺼짐 → 막힘(DISABLED 안의 ENABLED를 켜짐으로 착각하지 않는다)", () => {
    expect(one({ serviceState: "DISABLED" }).status).toBe("problem");
  });

  it("필드 이름이 달라도 값으로 판단한다", () => {
    expect(one({ service_state: "DISABLED" }).status).toBe("problem");
    expect(one({ state: { value: "ENABLED" } }).status).toBe("pass");
  });

  it("모르는 값 → 확인 불가", () => {
    expect(one({ serviceState: "UNKNOWN" }).status).toBe("unknown");
  });

  it("다른 서비스의 켜짐·꺼짐은 보지 않는다", () => {
    expect(one({ serviceState: "DISABLED" }, "settings/classroom.service_status").detail).toBe("구글이 이 설정을 API로 돌려주지 않습니다. 콘솔에서 직접 확인하세요");
  });

  it("하위 OU에 꺼진 곳이 있으면 개수", () => {
    const c = gmailStatusCheck(
      [policy(ROOT, GMAIL, { serviceState: "ENABLED" }), policy("sub2", GMAIL, { serviceState: "DISABLED" })],
      SUBS,
    );
    expect(c).toMatchObject({ status: "pass" });
    expect(c.detail).toContain("(하위 조직 1곳에 다른 설정 있음)");
  });
});

describe("policyChecks·policyChecksUnavailable", () => {
  it("다섯 항목을 같은 순서·제목·바로가기로 낸다", () => {
    const ok = policyChecks([], SUBS, NOW);
    const no = policyChecksUnavailable("최고관리자만 확인할 수 있습니다");
    expect(ok.map((c) => [c.title, c.link])).toEqual(no.map((c) => [c.title, c.link]));
    expect(no.every((c) => c.status === "unknown" && c.detail === "최고관리자만 확인할 수 있습니다")).toBe(true);
    expect(no).toHaveLength(5);
  });
});

describe("takeoutCheck", () => {
  it("항상 직접 확인, 바로가기 takeout", () => {
    expect(takeoutCheck()).toMatchObject({ status: "unknown", link: "takeout" });
  });
});

describe("inactiveCheck", () => {
  const user = (email: string, fields: Partial<User> = {}) =>
    ({
      primaryEmail: `${email}@school.example`,
      name: { fullName: email, familyName: "", givenName: email },
      orgUnitPath: "/학생",
      lastLoginTime: "2026-11-01T00:00:00.000Z",
      ...fields,
    }) as User;

  it("6개월 미접속(관리자·정지·보관 제외)과 정지(보관 제외) 수를 센다", () => {
    const users = [
      user("recent"),
      user("old", { lastLoginTime: "2026-01-01T00:00:00.000Z" }),
      user("never", { lastLoginTime: "1970-01-01T00:00:00.000Z" }),
      user("exactly6", { lastLoginTime: "2026-05-08T12:00:00.000Z" }),
      user("admin-old", { isAdmin: true, lastLoginTime: "2026-01-01T00:00:00.000Z" }),
      user("suspended-old", { suspended: true, lastLoginTime: "2026-01-01T00:00:00.000Z" }),
      user("suspended-recent", { suspended: true }),
      user("archived-old", { archived: true, suspended: true, lastLoginTime: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(inactiveCheck(users, NOW)).toEqual({
      title: "미접속·정지 계정",
      status: "info",
      detail: "6개월 이상 미접속 3명 · 정지 2명 (전체 8명). 전환 전에 정리하면 이전할 자료가 줄어듭니다.",
    });
  });

  it("사용자가 없으면 0", () => {
    expect(inactiveCheck([], NOW).detail).toBe(
      "6개월 이상 미접속 0명 · 정지 0명 (전체 0명). 전환 전에 정리하면 이전할 자료가 줄어듭니다.",
    );
  });
});

describe("nextYearOuCheck", () => {
  const ou = (orgUnitPath: string) => ({ orgUnitPath, name: orgUnitPath.split("/").pop(), orgUnitId: orgUnitPath }) as OrgUnit;

  it("다음 학년도 OU가 있으면 됨", () => {
    const c = nextYearOuCheck([ou("/2026학년도"), ou("/2026학년도/5-1"), ou("/2027학년도"), ou("/교직원")], NOW);
    expect(c).toEqual({ title: "다음 학년도 조직", status: "pass", detail: "/2027학년도 있음" });
  });

  it("없으면 주의, 학년 진급에서 만든다고 안내", () => {
    const c = nextYearOuCheck([ou("/2025학년도"), ou("/2026학년도"), ou("/교직원")], NOW);
    expect(c).toEqual({
      title: "다음 학년도 조직",
      status: "info",
      detail: "/2027학년도 없음. 「학년 진급」 실행 때 자동으로 만듭니다.",
    });
  });

  it("1·2월은 전년도가 현재 학년도", () => {
    const feb = new Date(2027, 1, 15);
    expect(nextYearOuCheck([ou("/2026학년도"), ou("/2027학년도")], feb).detail).toBe("/2027학년도 있음");
    const mar = new Date(2027, 2, 2);
    expect(nextYearOuCheck([ou("/2026학년도"), ou("/2027학년도")], mar).detail).toBe(
      "/2028학년도 없음. 「학년 진급」 실행 때 자동으로 만듭니다.",
    );
  });

  it("손자 OU의 연도는 보지 않는다", () => {
    const c = nextYearOuCheck([ou("/2026학년도"), ou("/졸업생/2027졸업")], NOW);
    expect(c.status).toBe("info");
  });

  it("학년도가 모두 미래면 그중 가장 큰 것을 현재로 본다", () => {
    expect(nextYearOuCheck([ou("/2030학년도")], NOW).detail).toBe("/2031학년도 없음. 「학년 진급」 실행 때 자동으로 만듭니다.");
  });

  it("학년도 OU가 없으면 주의", () => {
    expect(nextYearOuCheck([ou("/교직원")], NOW)).toMatchObject({ status: "info" });
  });
});

describe("summarize·checklistText", () => {
  const checks = [
    { title: "가", status: "problem" as const, detail: "막힌 이유" },
    { title: "나", status: "info" as const, detail: "주의할 점" },
    { title: "다", status: "pass" as const, detail: "됨" },
    { title: "라", status: "unknown" as const, detail: "직접 보기" },
    { title: "마", status: "unknown" as const, detail: "직접 보기 2" },
  ];

  it("막힘·주의·됨·직접 확인 순서로 센다", () => {
    expect(summarize(checks)).toBe("막힘 1 · 주의 1 · 됨 1 · 직접 확인 2");
  });

  it("복사용 글: 머리·요약·항목 줄", () => {
    expect(checklistText("school.example", checks.slice(0, 2), "2026-11-08")).toBe(
      ["전환 점검표 · school.example · 2026-11-08", "막힘 1 · 주의 1 · 됨 0 · 직접 확인 0", "", "1. 가 [막힘] 막힌 이유", "2. 나 [주의] 주의할 점"].join(
        "\n",
      ),
    );
  });
});
