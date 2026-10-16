import {
  errorMessage,
  getClassroomProfile,
  getLicenseLabel,
  getOrgUnit,
  getTeacherStatus,
  getUser,
  isStatus,
  listOrgUnits,
  listPolicies,
  teacherGroup,
  type ClassroomProfile,
  type Policy,
  type TeacherStatus,
  type User,
} from "./google/api";

export type CheckStatus = "pass" | "problem" | "unknown" | "info";

export interface Check {
  title: string;
  status: CheckStatus;
  detail: string;
  fix?: "unsuspend" | "approve"; // 이 화면에서 바로 고칠 수 있는 문제
  link?: string; // 설정 바로가기 id (catalog/settings.ts)
}

// ---- 순수 함수: API 응답 → 점검 결과 ----

export function accountCheck(user: User): Check {
  const title = "계정 상태";
  if (user.suspended) {
    const reason = user.suspensionReason ? ` (사유: ${user.suspensionReason})` : "";
    return { title, status: "problem", detail: `정지된 계정입니다${reason}.`, fix: "unsuspend" };
  }
  if (user.archived) {
    return { title, status: "problem", detail: "보관 처리된 계정입니다. 보관 해제는 콘솔의 사용자 목록에서 합니다.", link: "users" };
  }
  return { title, status: "pass", detail: "정지·보관되지 않은 정상 계정입니다." };
}

export function profileCheck(profile: ClassroomProfile): Check {
  const canCreate = profile.permissions?.some((p) => p.permission === "CREATE_COURSE") ?? false;
  const verified =
    profile.verifiedTeacher === undefined ? "알 수 없음" : profile.verifiedTeacher ? "예" : "아니오";
  const detail = `수업 만들기 권한(CREATE_COURSE): ${canCreate ? "있음" : "없음"} · 인증된 교사: ${verified}`;
  return canCreate
    ? { title: "클래스룸 프로필", status: "pass", detail }
    : {
        title: "클래스룸 프로필",
        status: "problem",
        detail: `${detail}. 교사 권한이 "인증된 교사만"이면 classroom_teachers 그룹에 넣어야 수업을 만들 수 있습니다.`,
        link: "classroom-settings",
      };
}

export function groupCheck(status: TeacherStatus, domain: string): Check {
  const title = "classroom_teachers 그룹";
  const group = teacherGroup(domain);
  if (status === "member") return { title, status: "pass", detail: `${group} 그룹에 가입되어 있습니다.` };
  if (status === "not-member") {
    return { title, status: "problem", detail: `${group} 그룹에 가입되어 있지 않습니다.`, fix: "approve" };
  }
  return {
    title,
    status: "unknown",
    detail:
      "이 도메인에 classroom_teachers 그룹이 없습니다. 콘솔 > 앱 > Google Workspace > Classroom > 일반 설정 > 교사 권한에서 확인하세요.",
    link: "classroom-settings",
  };
}

// "/a/b" → ["/a/b", "/a", "/"] (가까운 OU부터)
export function ouAncestors(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const result: string[] = [];
  for (let i = parts.length; i > 0; i--) result.push("/" + parts.slice(0, i).join("/"));
  result.push("/");
  return result;
}

// 사용자 OU부터 위로 올라가며 가장 가까운 Classroom 서비스 상태 정책을 찾는다.
// 반환값의 depth: 0이면 사용자 OU에 직접 걸린 정책, 1 이상이면 상위 OU에서 상속.
export function closestClassroomPolicy(
  policies: Policy[],
  ouIdsNearestFirst: string[],
): { policy: Policy; depth: number } | null {
  const classroom = policies.filter(
    (p) =>
      p.setting.type.endsWith("service_status") &&
      p.setting.type.toLowerCase().includes("classroom") &&
      !p.policyQuery.group,
  );
  for (const [depth, id] of ouIdsNearestFirst.entries()) {
    const policy = classroom
      .filter((p) => p.policyQuery.orgUnit === `orgUnits/${id}`)
      .sort((a, b) => (b.policyQuery.sortOrder ?? 0) - (a.policyQuery.sortOrder ?? 0))[0];
    if (policy) return { policy, depth };
  }
  return null;
}

export function policyCheck(found: { policy: Policy; depth: number } | null): Check {
  const title = "Classroom 서비스 상태(정책)";
  if (!found) {
    return { title, status: "unknown", detail: "이 사용자 OU에 해당하는 Classroom 서비스 상태 정책을 찾지 못했습니다.", link: "apps-core" };
  }
  const value = found.policy.setting.value;
  const state = typeof value?.serviceState === "string" ? value.serviceState : JSON.stringify(value ?? {});
  const where = found.depth === 0 ? "사용자 OU에 직접 설정" : "상위 OU에서 상속";
  const detail = `서비스 상태: ${state} (${where})`;
  if (state === "ENABLED") return { title, status: "pass", detail };
  if (state === "DISABLED") return { title, status: "problem", detail: `${detail}. Classroom이 꺼져 있습니다.`, link: "apps-core" };
  return { title, status: "unknown", detail, link: "apps-core" };
}

// ---- API 호출 ----

// 사용자 OU부터 루트까지의 OU id 목록(id: 접두사 제거, 가까운 것부터)
async function ouIdChain(path: string): Promise<string[]> {
  const units = await Promise.all(ouAncestors(path).filter((p) => p !== "/").map(getOrgUnit));
  let rootId = units.at(-1)?.parentOrgUnitId;
  if (!rootId) {
    rootId = (await listOrgUnits()).find((u) => u.parentOrgUnitPath === "/")?.parentOrgUnitId;
  }
  return [...units.map((u) => u.orgUnitId), ...(rootId ? [rootId] : [])].map((id) => id.replace(/^id:/, ""));
}

// 순서대로 점검한다. 한 단계가 실패해도 나머지는 계속한다.
export async function runDiagnosis(email: string, domain: string): Promise<Check[]> {
  const checks: Check[] = [];
  let user: User | null = null;

  try {
    user = await getUser(email);
    checks.push(accountCheck(user));
  } catch (e) {
    checks.push({ title: "계정 상태", status: "unknown", detail: errorMessage(e) });
  }

  try {
    checks.push(profileCheck(await getClassroomProfile(email)));
  } catch (e) {
    checks.push(
      isStatus(e, 403) || isStatus(e, 404)
        ? {
            title: "클래스룸 프로필",
            status: "problem",
            detail: "클래스룸 프로필을 읽지 못했습니다. Classroom 서비스가 이 사용자(OU)에 꺼져 있을 수 있습니다.",
            link: "apps-core",
          }
        : { title: "클래스룸 프로필", status: "unknown", detail: errorMessage(e) },
    );
  }

  try {
    checks.push(groupCheck(await getTeacherStatus(email, domain), domain));
  } catch (e) {
    checks.push({ title: "classroom_teachers 그룹", status: "unknown", detail: errorMessage(e) });
  }

  try {
    if (!user) throw new Error("no user");
    const [policies, ouIds] = await Promise.all([listPolicies(), ouIdChain(user.orgUnitPath)]);
    checks.push(policyCheck(closestClassroomPolicy(policies, ouIds)));
  } catch {
    checks.push({ title: "Classroom 서비스 상태(정책)", status: "unknown", detail: "확인 불가(권한 또는 API 미사용)", link: "apps-core" });
  }

  try {
    const label = await getLicenseLabel(email);
    checks.push({ title: "라이선스", status: "info", detail: `${label} (참고용: Classroom은 라이선스 없이도 쓸 수 있습니다)` });
  } catch (e) {
    checks.push({ title: "라이선스", status: "info", detail: `확인 불가: ${errorMessage(e)} (참고용: Classroom은 라이선스 없이도 쓸 수 있습니다)` });
  }

  return checks;
}
