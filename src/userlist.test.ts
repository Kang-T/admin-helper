import { describe, expect, it } from "vitest";
import type { User } from "./google/api";
import { NEVER, filterUsers, lastLogin, usersToCsv, type Filters } from "./userlist";

// 시험용 값은 모두 예시다(실제 학교·사람이 아님).
const user = (email: string, fields: Partial<User> = {}) =>
  ({
    primaryEmail: `${email}@school.example`,
    name: { fullName: `사용자 ${email}`, familyName: "사용자", givenName: email },
    orgUnitPath: "/",
    lastLoginTime: "2026-11-01T12:00:00.000Z",
    ...fields,
  }) as User;

const ALL: Filters = { ou: "/", status: "all", inactiveMonths: null, excludeAdmins: false };
const NOW = new Date("2026-11-08T12:00:00.000Z");
const emails = (list: User[]) => list.map((u) => u.primaryEmail.split("@")[0]);

describe("lastLogin", () => {
  it("기록이 없으면 null", () => {
    expect(lastLogin(user("a", { lastLoginTime: undefined }))).toBeNull();
  });

  it("구글의 '기록 없음' 값(1970-01-01)이면 null", () => {
    expect(lastLogin(user("a", { lastLoginTime: NEVER }))).toBeNull();
  });

  it("있으면 그 시각", () => {
    expect(lastLogin(user("a"))?.toISOString()).toBe("2026-11-01T12:00:00.000Z");
  });
});

describe("filterUsers", () => {
  it("'/'는 전체", () => {
    const list = [user("a"), user("b", { orgUnitPath: "/2026학년도/4-1" })];
    expect(emails(filterUsers(list, ALL, NOW))).toEqual(["a", "b"]);
  });

  it("조직 단위는 그 조직과 하위 조직만, 이름이 비슷한 다른 조직은 뺀다", () => {
    const list = [
      user("same", { orgUnitPath: "/2026학년도" }),
      user("child", { orgUnitPath: "/2026학년도/4-1" }),
      user("other", { orgUnitPath: "/2026학년도졸업" }),
      user("root", { orgUnitPath: "/" }),
    ];
    expect(emails(filterUsers(list, { ...ALL, ou: "/2026학년도" }, NOW))).toEqual(["same", "child"]);
  });

  it("보관 계정은 어떤 조건에서도 뺀다", () => {
    const list = [user("a"), user("archived", { archived: true })];
    expect(emails(filterUsers(list, ALL, NOW))).toEqual(["a"]);
    expect(emails(filterUsers(list, { ...ALL, status: "active" }, NOW))).toEqual(["a"]);
  });

  it("상태: 활성만·정지만", () => {
    const list = [user("on"), user("off", { suspended: true })];
    expect(emails(filterUsers(list, { ...ALL, status: "active" }, NOW))).toEqual(["on"]);
    expect(emails(filterUsers(list, { ...ALL, status: "suspended" }, NOW))).toEqual(["off"]);
  });

  it("관리자 제외: 최고·위임 관리자 모두 뺀다", () => {
    const list = [user("a"), user("super", { isAdmin: true }), user("deleg", { isDelegatedAdmin: true })];
    expect(emails(filterUsers(list, { ...ALL, excludeAdmins: true }, NOW))).toEqual(["a"]);
    expect(emails(filterUsers(list, ALL, NOW))).toEqual(["a", "super", "deleg"]);
  });

  it("미접속 N개월: 정확히 N개월 전은 포함, 그보다 1밀리초 뒤는 제외", () => {
    const list = [
      user("exact", { lastLoginTime: "2026-05-08T12:00:00.000Z" }),
      user("after", { lastLoginTime: "2026-05-08T12:00:00.001Z" }),
      user("older", { lastLoginTime: "2025-01-01T00:00:00.000Z" }),
    ];
    expect(emails(filterUsers(list, { ...ALL, inactiveMonths: 6 }, NOW))).toEqual(["exact", "older"]);
  });

  it("미접속 조건에서 로그인 기록이 없는 계정(NEVER·값 없음)은 포함", () => {
    const list = [user("never", { lastLoginTime: NEVER }), user("none", { lastLoginTime: undefined }), user("recent")];
    expect(emails(filterUsers(list, { ...ALL, inactiveMonths: 6 }, NOW))).toEqual(["never", "none"]);
  });

  it("미접속 조건이 null이면 최근 접속자도 남는다", () => {
    expect(emails(filterUsers([user("recent")], ALL, NOW))).toEqual(["recent"]);
  });

  it("그 달에 없는 날의 N개월 전은 그 달 마지막 날(3월 31일 → 2월 28일)", () => {
    const now = new Date("2026-03-31T12:00:00.000Z");
    const list = [
      user("feb28", { lastLoginTime: "2026-02-28T12:00:00.000Z" }),
      user("mar01", { lastLoginTime: "2026-03-01T00:00:00.000Z" }),
    ];
    expect(emails(filterUsers(list, { ...ALL, inactiveMonths: 1 }, now))).toEqual(["feb28"]);
  });
});

describe("usersToCsv", () => {
  it("머리글과 상태·마지막 로그인·관리자 표시", () => {
    const csv = usersToCsv([
      user("a"),
      user("b", { suspended: true, lastLoginTime: NEVER, isAdmin: true, orgUnitPath: "/2026학년도/4-1" }),
      user("c", { lastLoginTime: undefined, isDelegatedAdmin: true }),
    ]);
    expect(csv.split("\r\n")).toEqual([
      "이름,이메일,조직단위,상태,마지막 로그인,관리자",
      "사용자 a,a@school.example,/,활성,2026-11-01,",
      "사용자 b,b@school.example,/2026학년도/4-1,정지,기록 없음,최고",
      "사용자 c,c@school.example,/,활성,기록 없음,위임",
      "",
    ]);
  });

  it("쉼표가 든 이름은 따옴표로 감싼다", () => {
    const u = user("a", { name: { fullName: "홍, 길동", familyName: "홍", givenName: "길동" } });
    expect(usersToCsv([u]).split("\r\n")[1]).toBe('"홍, 길동",a@school.example,/,활성,2026-11-01,');
  });
});
