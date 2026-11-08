import { describe, expect, it } from "vitest";
import type { OrgUnit, User } from "./google/api";
import { missingOus, nextYearName, parseClassOu, planMoves, planRules, type Rule } from "./promote";

// 시험용 값은 모두 예시다(실제 학교·사람이 아님).
const ou = (orgUnitPath: string) =>
  ({ name: orgUnitPath.split("/").pop(), orgUnitPath, orgUnitId: `id:${orgUnitPath}` }) as OrgUnit;

const user = (email: string, orgUnitPath: string, fields: Partial<User> = {}) =>
  ({
    primaryEmail: `${email}@school.example`,
    name: { fullName: `학생 ${email}`, familyName: "학생", givenName: email },
    orgUnitPath,
    ...fields,
  }) as User;

const OPTS = { yearOu: "/2026학년도", newYear: "/2027학년도", lastGrade: 6, graduateOu: "/졸업생/2026" };
const rule = (from: string, to: string, fields: Partial<Rule> = {}): Rule => ({
  from,
  to,
  graduate: false,
  skip: false,
  count: 0,
  ...fields,
});

describe("parseClassOu", () => {
  it("숫자 반", () => {
    expect(parseClassOu("5-1")).toEqual({ grade: 5, cls: "1" });
  });

  it("한글 반", () => {
    expect(parseClassOu("5-가")).toEqual({ grade: 5, cls: "가" });
  });

  it("두 자리 학년·반", () => {
    expect(parseClassOu("12-10")).toEqual({ grade: 12, cls: "10" });
  });

  it("반 이름이 아니면 null", () => {
    expect(parseClassOu("크롬북실습용")).toBeNull();
    expect(parseClassOu("5-")).toBeNull();
    expect(parseClassOu("5-1 반")).toBeNull();
    expect(parseClassOu("123-1")).toBeNull();
  });
});

describe("nextYearName", () => {
  it("첫 4자리 숫자를 1 올린다", () => {
    expect(nextYearName("/2026학년도")).toBe("/2027학년도");
    expect(nextYearName("/학생/2026")).toBe("/학생/2027");
  });

  it("4자리 숫자가 여러 개면 첫 것만", () => {
    expect(nextYearName("/2026-2027")).toBe("/2027-2027");
  });

  it("숫자가 없으면 ' 다음'을 붙인다", () => {
    expect(nextYearName("/올해")).toBe("/올해 다음");
  });
});

describe("planRules", () => {
  const children = [
    ou("/2026학년도/6-2"),
    ou("/2026학년도/크롬북실습용"),
    ou("/2026학년도/5-10"),
    ou("/2026학년도/5-2"),
    ou("/2026학년도/5-2/모둠1"), // 손자 OU
    ou("/2026학년도/1-1"),
    ou("/2025학년도/5-1"), // 다른 학년도
    ou("/2026학년도"), // 학년도 자신
  ];

  it("자식 OU만, 학년·반 순서, 반이 아닌 것은 뒤에", () => {
    const rules = planRules(children, OPTS, {});
    expect(rules.map((r) => r.from)).toEqual([
      "/2026학년도/1-1",
      "/2026학년도/5-2",
      "/2026학년도/5-10",
      "/2026학년도/6-2",
      "/2026학년도/크롬북실습용",
    ]);
  });

  it("마지막 학년 전이면 한 학년 위 같은 반", () => {
    const rules = planRules([ou("/2026학년도/5-1"), ou("/2026학년도/5-가")], OPTS, {});
    expect(rules).toEqual([
      rule("/2026학년도/5-1", "/2027학년도/6-1"),
      rule("/2026학년도/5-가", "/2027학년도/6-가"),
    ]);
  });

  it("마지막 학년이면 졸업생 OU로, graduate", () => {
    const [r] = planRules([ou("/2026학년도/6-1")], OPTS, {});
    expect(r).toEqual(rule("/2026학년도/6-1", "/졸업생/2026", { graduate: true }));
  });

  it("마지막 학년을 바꾸면 졸업 판정도 바뀐다", () => {
    const [r] = planRules([ou("/2026학년도/6-1")], { ...OPTS, lastGrade: 9 }, {});
    expect(r).toEqual(rule("/2026학년도/6-1", "/2027학년도/7-1"));
  });

  it("반이 아니면 새 학년도 아래 같은 이름, 졸업 아님", () => {
    const [r] = planRules([ou("/2026학년도/크롬북실습용")], OPTS, {});
    expect(r).toEqual(rule("/2026학년도/크롬북실습용", "/2027학년도/크롬북실습용"));
  });

  it("인원은 counts에서, 없으면 0", () => {
    const rules = planRules([ou("/2026학년도/5-1"), ou("/2026학년도/5-2")], OPTS, { "/2026학년도/5-1": 24 });
    expect(rules.map((r) => r.count)).toEqual([24, 0]);
  });
});

describe("planMoves", () => {
  const rules = [
    rule("/2026학년도/5-1", "/2027학년도/6-1"),
    rule("/2026학년도/6-1", "/졸업생/2026", { graduate: true }),
    rule("/2026학년도/크롬북실습용", "/2027학년도/크롬북실습용", { skip: true }),
  ];

  it("현재 OU가 규칙과 정확히 같은 사람만, 이메일 순", () => {
    const users = [
      user("c", "/2026학년도/5-1"),
      user("a", "/2026학년도/6-1"),
      user("b", "/2026학년도/5-1/모둠1"), // 손자 OU: 규칙 없음
      user("d", "/2026학년도"), // 학년도 바로 아래: 규칙 없음
    ];
    expect(planMoves(users, rules, [], "")).toEqual([
      { email: "a@school.example", from: "/2026학년도/6-1", to: "/졸업생/2026", graduate: true, source: "rule" },
      { email: "c@school.example", from: "/2026학년도/5-1", to: "/2027학년도/6-1", graduate: false, source: "rule" },
    ]);
  });

  it("건너뛰기 규칙의 사람은 뺀다", () => {
    expect(planMoves([user("a", "/2026학년도/크롬북실습용")], rules, [], "")).toEqual([]);
  });

  it("CSV는 규칙을 덮어쓰고 졸업이 아니게 된다", () => {
    const moves = planMoves(
      [user("a", "/2026학년도/6-1"), user("b", "/2026학년도/5-1")],
      rules,
      [{ email: "A@school.example", orgUnitPath: "/2027학년도/6-3" }],
      "",
    );
    expect(moves).toEqual([
      { email: "a@school.example", from: "/2026학년도/6-1", to: "/2027학년도/6-3", graduate: false, source: "csv" },
      { email: "b@school.example", from: "/2026학년도/5-1", to: "/2027학년도/6-1", graduate: false, source: "rule" },
    ]);
  });

  it("규칙 밖 사람(손자 OU·건너뛰기)도 CSV에 있으면 포함, 이전 OU는 그 사람의 OU", () => {
    const moves = planMoves(
      [user("a", "/2026학년도/5-1/모둠1"), user("b", "/2026학년도/크롬북실습용")],
      rules,
      [
        { email: "a@school.example", orgUnitPath: "/2027학년도/6-2" },
        { email: "b@school.example", orgUnitPath: "/2027학년도/6-1" },
      ],
      "",
    );
    expect(moves.map((m) => [m.email, m.from, m.to, m.source])).toEqual([
      ["a@school.example", "/2026학년도/5-1/모둠1", "/2027학년도/6-2", "csv"],
      ["b@school.example", "/2026학년도/크롬북실습용", "/2027학년도/6-1", "csv"],
    ]);
  });

  it("CSV에 있어도 불러온 학생 목록에 없으면 넣지 않는다", () => {
    const moves = planMoves([], rules, [{ email: "x@school.example", orgUnitPath: "/2027학년도/6-1" }], "");
    expect(moves).toEqual([]);
  });

  it("본인과 관리자(위임 관리자 포함)는 규칙·CSV 모두 뺀다", () => {
    const users = [
      user("me", "/2026학년도/5-1"),
      user("adm", "/2026학년도/5-1", { isAdmin: true }),
      user("del", "/2026학년도/5-1", { isDelegatedAdmin: true }),
      user("kid", "/2026학년도/5-1"),
    ];
    const overrides = [
      { email: "adm@school.example", orgUnitPath: "/2027학년도/6-2" },
      { email: "me@school.example", orgUnitPath: "/2027학년도/6-2" },
    ];
    const moves = planMoves(users, rules, overrides, "ME@school.example");
    expect(moves.map((m) => m.email)).toEqual(["kid@school.example"]);
  });
});

describe("missingOus", () => {
  it("부모가 없으면 부모 먼저", () => {
    expect(missingOus(["/2027학년도/6-1"], ["/2026학년도"])).toEqual(["/2027학년도", "/2027학년도/6-1"]);
  });

  it("있는 OU와 '/'는 빼고, 중복 없이", () => {
    const targets = ["/2027학년도/6-1", "/2027학년도/6-2", "/2027학년도/6-1", "/졸업생/2026"];
    expect(missingOus(targets, ["/졸업생"])).toEqual([
      "/2027학년도",
      "/2027학년도/6-1",
      "/2027학년도/6-2",
      "/졸업생/2026",
    ]);
  });

  it("자식이 부모보다 먼저 와도 부모가 먼저 나온다", () => {
    expect(missingOus(["/2027학년도/6-1", "/2027학년도"], [])).toEqual(["/2027학년도", "/2027학년도/6-1"]);
  });

  it("모두 있으면 빈 목록", () => {
    expect(missingOus(["/2027학년도/6-1", "/"], ["/2027학년도", "/2027학년도/6-1"])).toEqual([]);
  });
});
