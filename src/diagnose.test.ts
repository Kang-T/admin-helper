import { describe, expect, it, vi } from "vitest";
import type { ClassroomProfile, Policy, User } from "./google/api";
import {
  accountCheck,
  closestClassroomPolicy,
  groupCheck,
  ouAncestors,
  policyCheck,
  profileCheck,
} from "./diagnose";

// auth.ts는 불러오는 순간 브라우저 주소(window.location)를 읽는다. Node에는 없으므로 가짜로 바꾼다.
// 여기서 시험하는 함수는 네트워크를 쓰지 않는다.
vi.mock("./google/auth", () => ({ getToken: vi.fn(), clearToken: vi.fn() }));

const DOMAIN = "school.example";

const user = (fields: Partial<User> = {}) =>
  ({ primaryEmail: "user@school.example", orgUnitPath: "/", ...fields }) as User;

const policy = (orgUnitId: string, type: string, value?: Record<string, unknown>, extra: Partial<Policy["policyQuery"]> = {}) =>
  ({ policyQuery: { orgUnit: `orgUnits/${orgUnitId}`, ...extra }, setting: { type, value } }) as Policy;

const CLASSROOM = "settings/classroom.service_status";

describe("accountCheck", () => {
  it("정상 계정은 통과", () => {
    expect(accountCheck(user())).toEqual({
      title: "계정 상태",
      status: "pass",
      detail: "정지·보관되지 않은 정상 계정입니다.",
    });
  });

  it("정지된 계정은 문제, 사유를 붙이고 이 화면에서 해제할 수 있다", () => {
    expect(accountCheck(user({ suspended: true, suspensionReason: "ADMIN" }))).toEqual({
      title: "계정 상태",
      status: "problem",
      detail: "정지된 계정입니다 (사유: ADMIN).",
      fix: "unsuspend",
    });
  });

  it("사유가 없으면 사유 없이 쓴다", () => {
    expect(accountCheck(user({ suspended: true })).detail).toBe("정지된 계정입니다.");
  });

  it("보관된 계정은 문제, 콘솔의 사용자 목록으로 안내한다", () => {
    const c = accountCheck(user({ archived: true }));
    expect(c).toMatchObject({ status: "problem", link: "users" });
    expect(c.fix).toBeUndefined();
  });

  it("정지와 보관이 같이 있으면 정지를 먼저 알린다", () => {
    expect(accountCheck(user({ suspended: true, archived: true })).fix).toBe("unsuspend");
  });
});

describe("profileCheck", () => {
  it("CREATE_COURSE 권한이 있으면 통과", () => {
    const p: ClassroomProfile = { permissions: [{ permission: "CREATE_COURSE" }], verifiedTeacher: true };
    expect(profileCheck(p)).toEqual({
      title: "클래스룸 프로필",
      status: "pass",
      detail: "수업 만들기 권한(CREATE_COURSE): 있음 · 인증된 교사: 예",
    });
  });

  it("권한이 없으면 문제, 클래스룸 설정으로 안내한다", () => {
    const c = profileCheck({ permissions: [], verifiedTeacher: false });
    expect(c).toMatchObject({ status: "problem", link: "classroom-settings" });
    expect(c.detail).toMatch(/^수업 만들기 권한\(CREATE_COURSE\): 없음 · 인증된 교사: 아니오\. /);
  });

  it("permissions·verifiedTeacher가 없으면 권한 없음·알 수 없음", () => {
    const c = profileCheck({});
    expect(c.status).toBe("problem");
    expect(c.detail).toContain("없음 · 인증된 교사: 알 수 없음");
  });

  it("다른 권한만 있으면 문제", () => {
    expect(profileCheck({ permissions: [{ permission: "OTHER" }] }).status).toBe("problem");
  });
});

describe("groupCheck", () => {
  it("가입되어 있으면 통과", () => {
    expect(groupCheck("member", DOMAIN)).toEqual({
      title: "classroom_teachers 그룹",
      status: "pass",
      detail: "classroom_teachers@school.example 그룹에 가입되어 있습니다.",
    });
  });

  it("가입되어 있지 않으면 문제, 이 화면에서 승인할 수 있다", () => {
    expect(groupCheck("not-member", DOMAIN)).toEqual({
      title: "classroom_teachers 그룹",
      status: "problem",
      detail: "classroom_teachers@school.example 그룹에 가입되어 있지 않습니다.",
      fix: "approve",
    });
  });

  it("그룹이 없으면 확인 불가, 클래스룸 설정으로 안내한다", () => {
    const c = groupCheck("no-group", DOMAIN);
    expect(c).toMatchObject({ status: "unknown", link: "classroom-settings" });
    expect(c.fix).toBeUndefined();
  });
});

describe("ouAncestors", () => {
  it("가까운 OU부터 최상위까지", () => {
    expect(ouAncestors("/a/b/c")).toEqual(["/a/b/c", "/a/b", "/a", "/"]);
  });

  it("최상위는 / 하나", () => {
    expect(ouAncestors("/")).toEqual(["/"]);
    expect(ouAncestors("")).toEqual(["/"]);
  });

  it("끝의 / 와 겹친 / 는 무시한다", () => {
    expect(ouAncestors("/a//b/")).toEqual(["/a/b", "/a", "/"]);
  });

  it("한글 OU 이름도 그대로", () => {
    expect(ouAncestors("/2026학년도/4-1")).toEqual(["/2026학년도/4-1", "/2026학년도", "/"]);
  });
});

describe("closestClassroomPolicy", () => {
  const ids = ["leaf", "mid", "root"]; // 가까운 것부터

  it("사용자 OU에 직접 걸린 정책은 depth 0", () => {
    const leaf = policy("leaf", CLASSROOM, { serviceState: "DISABLED" });
    const root = policy("root", CLASSROOM, { serviceState: "ENABLED" });
    expect(closestClassroomPolicy([root, leaf], ids)).toEqual({ policy: leaf, depth: 0 });
  });

  it("없으면 위로 올라가 가장 가까운 상위 OU의 정책(depth는 올라간 칸 수)", () => {
    const mid = policy("mid", CLASSROOM, { serviceState: "ENABLED" });
    const root = policy("root", CLASSROOM, { serviceState: "DISABLED" });
    expect(closestClassroomPolicy([root, mid], ids)).toEqual({ policy: mid, depth: 1 });
    expect(closestClassroomPolicy([root], ids)).toEqual({ policy: root, depth: 2 });
  });

  it("그룹 대상 정책, 다른 서비스, service_status가 아닌 클래스룸 설정은 뺀다", () => {
    const root = policy("root", CLASSROOM, { serviceState: "ENABLED" });
    const others = [
      policy("leaf", CLASSROOM, { serviceState: "DISABLED" }, { group: "groups/abc" }),
      policy("leaf", "settings/gmail.service_status", { serviceState: "DISABLED" }),
      policy("leaf", "settings/classroom.teacher_permissions", {}),
    ];
    expect(closestClassroomPolicy([...others, root], ids)).toEqual({ policy: root, depth: 2 });
  });

  it("클래스룸 이름은 대소문자를 가리지 않는다", () => {
    const p = policy("leaf", "settings/Classroom.service_status", { serviceState: "ENABLED" });
    expect(closestClassroomPolicy([p], ids)).toEqual({ policy: p, depth: 0 });
  });

  it("같은 OU에 여럿이면 sortOrder가 큰 것(없으면 0)", () => {
    const low = policy("leaf", CLASSROOM, { serviceState: "ENABLED" }, { sortOrder: 1 });
    const high = policy("leaf", CLASSROOM, { serviceState: "DISABLED" }, { sortOrder: 5 });
    const none = policy("leaf", CLASSROOM, { serviceState: "ENABLED" });
    expect(closestClassroomPolicy([low, high, none], ids)?.policy).toBe(high);
    expect(closestClassroomPolicy([none, low], ids)?.policy).toBe(low);
  });

  it("맞는 정책이 없으면 null", () => {
    expect(closestClassroomPolicy([], ids)).toBeNull();
    expect(closestClassroomPolicy([policy("elsewhere", CLASSROOM, {})], ids)).toBeNull();
  });
});

describe("policyCheck", () => {
  it("정책을 못 찾으면 확인 불가", () => {
    expect(policyCheck(null)).toEqual({
      title: "Classroom 서비스 상태(정책)",
      status: "unknown",
      detail: "이 사용자 OU에 해당하는 Classroom 서비스 상태 정책을 찾지 못했습니다.",
      link: "apps-core",
    });
  });

  it("ENABLED는 통과, 직접 설정이면 그렇게 쓴다", () => {
    expect(policyCheck({ policy: policy("leaf", CLASSROOM, { serviceState: "ENABLED" }), depth: 0 })).toEqual({
      title: "Classroom 서비스 상태(정책)",
      status: "pass",
      detail: "서비스 상태: ENABLED (사용자 OU에 직접 설정)",
    });
  });

  it("DISABLED는 문제, 상속이면 그렇게 쓴다", () => {
    expect(policyCheck({ policy: policy("root", CLASSROOM, { serviceState: "DISABLED" }), depth: 2 })).toEqual({
      title: "Classroom 서비스 상태(정책)",
      status: "problem",
      detail: "서비스 상태: DISABLED (상위 OU에서 상속). Classroom이 꺼져 있습니다.",
      link: "apps-core",
    });
  });

  it("serviceState가 없거나 다른 값이면 확인 불가, 값을 그대로 보여 준다", () => {
    expect(policyCheck({ policy: policy("leaf", CLASSROOM, { foo: 1 }), depth: 0 })).toMatchObject({
      status: "unknown",
      detail: '서비스 상태: {"foo":1} (사용자 OU에 직접 설정)',
    });
    expect(policyCheck({ policy: policy("leaf", CLASSROOM), depth: 1 })).toMatchObject({
      status: "unknown",
      detail: "서비스 상태: {} (상위 OU에서 상속)",
      link: "apps-core",
    });
    expect(policyCheck({ policy: policy("leaf", CLASSROOM, { serviceState: "PARTIAL" }), depth: 0 }).status).toBe(
      "unknown",
    );
  });
});
