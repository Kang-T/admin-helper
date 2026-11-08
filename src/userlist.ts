// 사용자 목록·일괄 작업용: 거르기, 날짜·관리자 표시, CSV 만들기. 화면 코드와 분리해 Node에서도 시험한다.
import { toCsv } from "./csv";
import type { User } from "./google/api";

// 구글은 로그인 기록이 없으면 이 값을 준다.
export const NEVER = "1970-01-01T00:00:00.000Z";

export function lastLogin(u: User): Date | null {
  if (!u.lastLoginTime || u.lastLoginTime === NEVER) return null;
  return new Date(u.lastLoginTime);
}

export interface Filters {
  ou: string; // "/"=전체
  status: "all" | "active" | "suspended";
  inactiveMonths: number | null; // null=조건 없음
  excludeAdmins: boolean;
}

// n개월 전 같은 날 같은 시각. 그 달에 없는 날(3월 31일의 1개월 전)이면 그 달 마지막 날.
function monthsBefore(d: Date, n: number): Date {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() - n);
  const lastDay = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, lastDay));
  return r;
}

// 보관(archived) 계정은 항상 뺀다. 미접속은 마지막 로그인이 정확히 N개월 전이거나 그보다 이전, 또는 기록 없음.
export function filterUsers(users: User[], f: Filters, now: Date): User[] {
  const prefix = f.ou === "/" ? "/" : f.ou + "/";
  const cutoff = f.inactiveMonths === null ? null : monthsBefore(now, f.inactiveMonths);
  return users.filter((u) => {
    if (u.archived) return false;
    if (u.orgUnitPath !== f.ou && !u.orgUnitPath.startsWith(prefix)) return false;
    if (f.status === "active" && u.suspended) return false;
    if (f.status === "suspended" && !u.suspended) return false;
    if (f.excludeAdmins && (u.isAdmin || u.isDelegatedAdmin)) return false;
    if (cutoff) {
      const last = lastLogin(u);
      if (last && last > cutoff) return false;
    }
    return true;
  });
}

// 이 컴퓨터 시각 기준 YYYY-MM-DD
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function adminLabel(u: User): string {
  return u.isAdmin ? "최고" : u.isDelegatedAdmin ? "위임" : "";
}

export function usersToCsv(users: User[]): string {
  return toCsv([
    ["이름", "이메일", "조직단위", "상태", "마지막 로그인", "관리자"],
    ...users.map((u) => {
      const last = lastLogin(u);
      return [
        u.name.fullName,
        u.primaryEmail,
        u.orgUnitPath,
        u.suspended ? "정지" : "활성",
        last ? ymd(last) : "기록 없음",
        adminLabel(u),
      ];
    }),
  ]);
}
