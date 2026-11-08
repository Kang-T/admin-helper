// 학년 진급: 현재 학년도 OU 아래 반 OU의 학생을 새 학년도 반으로 옮기는 계획을 세운다.
// 화면 코드와 분리해 Node에서도 시험할 수 있게 둔다. 구글에 요청하지 않는다.
import type { OrgUnit, User } from "./google/api";

// "5-1" → { grade: 5, cls: "1" }, "5-가" → { grade: 5, cls: "가" }, 반 이름이 아니면 null
export function parseClassOu(name: string): { grade: number; cls: string } | null {
  const m = /^(\d{1,2})-(\S+)$/.exec(name);
  return m ? { grade: Number(m[1]), cls: m[2] } : null;
}

// "/2026학년도" → "/2027학년도". 첫 4자리 숫자를 1 올린다. 숫자가 없으면 뒤에 " 다음"을 붙인다.
export function nextYearName(current: string): string {
  const m = /\d{4}/.exec(current);
  if (!m) return `${current} 다음`;
  return current.slice(0, m.index) + String(Number(m[0]) + 1) + current.slice(m.index + 4);
}

export interface Rule {
  from: string;
  to: string;
  graduate: boolean;
  skip: boolean;
  count: number;
}

// yearOu 바로 아래 자식 OU마다 옮길 곳을 정한다. 손자 OU는 보지 않는다.
// 반 OU: 마지막 학년 전이면 한 학년 위 같은 반, 마지막 학년이면 졸업생 OU. 반이 아니면 새 학년도 아래 같은 이름.
// 정렬: 학년·반 오름차순, 반이 아닌 것은 뒤에(이름순).
export function planRules(
  children: OrgUnit[],
  opts: { yearOu: string; newYear: string; lastGrade: number; graduateOu: string },
  counts: Record<string, number>,
): Rule[] {
  const prefix = `${opts.yearOu}/`;
  const direct = children.filter(
    (u) => u.orgUnitPath.startsWith(prefix) && !u.orgUnitPath.slice(prefix.length).includes("/"),
  );
  const items = direct.map((u) => {
    const name = u.orgUnitPath.slice(prefix.length);
    const c = parseClassOu(name);
    const graduate = !!c && c.grade === opts.lastGrade;
    const to = !c
      ? `${opts.newYear}/${name}`
      : graduate
        ? opts.graduateOu
        : `${opts.newYear}/${c.grade + 1}-${c.cls}`;
    const rule: Rule = { from: u.orgUnitPath, to, graduate, skip: false, count: counts[u.orgUnitPath] ?? 0 };
    return { rule, name, c };
  });
  items.sort((a, b) => {
    if (a.c && b.c) {
      return a.c.grade - b.c.grade || a.c.cls.localeCompare(b.c.cls, "ko", { numeric: true });
    }
    if (a.c) return -1;
    if (b.c) return 1;
    return a.name.localeCompare(b.name, "ko");
  });
  return items.map((i) => i.rule);
}

export interface Move {
  email: string;
  from: string;
  to: string;
  graduate: boolean;
  source: "rule" | "csv";
}

// 규칙(현재 OU가 rule.from과 정확히 같은 사람, 건너뛰기 제외)과 CSV 지정(이메일로 덮어쓰기)을 합친다.
// CSV 지정은 users에 있는 사람만 반영한다(이전 OU와 관리자 여부를 알아야 하므로).
// 본인(me)과 관리자는 뺀다. 결과는 이메일 순.
export function planMoves(
  users: User[],
  rules: Rule[],
  overrides: { email: string; orgUnitPath: string }[],
  me: string,
): Move[] {
  const byFrom = new Map(rules.map((r) => [r.from, r]));
  const csv = new Map(overrides.map((o) => [o.email.toLowerCase(), o.orgUnitPath]));
  const self = me.toLowerCase();
  const out: Move[] = [];
  for (const u of users) {
    const email = u.primaryEmail.toLowerCase();
    if (email === self || u.isAdmin || u.isDelegatedAdmin) continue;
    const to = csv.get(email);
    if (to !== undefined) {
      out.push({ email: u.primaryEmail, from: u.orgUnitPath, to, graduate: false, source: "csv" });
      continue;
    }
    const rule = byFrom.get(u.orgUnitPath);
    if (!rule || rule.skip) continue;
    out.push({ email: u.primaryEmail, from: u.orgUnitPath, to: rule.to, graduate: rule.graduate, source: "rule" });
  }
  return out.sort((a, b) => a.email.localeCompare(b.email));
}

// 만들어야 할 OU 경로. 부모가 먼저 오고 중복은 없다. "/"는 늘 있으므로 만들지 않는다.
export function missingOus(targets: string[], existing: string[]): string[] {
  const have = new Set(["/", ...existing]);
  const out: string[] = [];
  for (const t of targets) {
    const parts = t.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const path = `/${parts.slice(0, i).join("/")}`;
      if (have.has(path)) continue;
      have.add(path);
      out.push(path);
    }
  }
  return out;
}
