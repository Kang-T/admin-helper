import { clearToken, getToken } from "./auth";

const DIRECTORY = "https://admin.googleapis.com/admin/directory/v1";
const LICENSING = "https://licensing.googleapis.com/apps/licensing/v1";
const CLASSROOM = "https://classroom.googleapis.com/v1";
const CLOUD_IDENTITY = "https://cloudidentity.googleapis.com/v1";

const enc = encodeURIComponent;

export class ApiError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(statusMessage(status, detail));
    this.status = status;
  }
}

function statusMessage(status: number, detail: string): string {
  if (status === 401) return "로그인이 만료되었습니다. 다시 로그인하세요";
  if (status === 403) {
    return "이 작업을 할 권한이 없습니다. 학교 관리자 권한 범위 밖이거나 API가 사용 설정되지 않았을 수 있습니다";
  }
  if (status === 404) return "찾을 수 없습니다";
  // 구글 오류 문구에 이메일 주소가 섞여 있으면 가린다.
  return `오류 (${status}): ${detail.replace(/\S+@\S+/g, "(이메일)")}`;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "알 수 없는 오류가 발생했습니다";
}

export function isStatus(e: unknown, status: number): boolean {
  return e instanceof ApiError && e.status === status;
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const token = await getToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // 401이면 토큰을 지운다. 다음 요청 때 getToken()이 로그인 창을 다시 띄운다.
    if (res.status === 401) clearToken();
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.message ?? res.statusText);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// ---- 로그인한 관리자 ----

export function getUserInfo(): Promise<{ email: string }> {
  return request("https://www.googleapis.com/oauth2/v3/userinfo");
}

// ---- 사용자 ----

export interface User {
  primaryEmail: string;
  name: { fullName: string; familyName: string; givenName: string };
  orgUnitPath: string;
  suspended?: boolean;
  suspensionReason?: string;
  archived?: boolean;
  lastLoginTime?: string;
  creationTime?: string;
  isAdmin?: boolean;
  isDelegatedAdmin?: boolean;
  isEnrolledIn2Sv?: boolean;
  changePasswordAtNextLogin?: boolean;
}

async function queryUsers(query: string): Promise<User[]> {
  const data = await request<{ users?: User[] }>(
    `${DIRECTORY}/users?customer=my_customer&maxResults=10&query=${enc(query)}`,
  );
  return data.users ?? [];
}

// 구글 검색 문법: 앞글자 검색(*)은 email·givenName·familyName만 되고 name은 안 된다.
// 영문·@는 이메일 앞글자로, 한글 등은 성·이름 앞글자와 전체 이름 포함으로 찾아 합친다.
export async function searchUsers(input: string): Promise<User[]> {
  const q = input.trim().replace(/'/g, "");
  const lists = /^[\x21-\x7e]+$/.test(q)
    ? [queryUsers(`email:${q}*`)]
    : [queryUsers(`givenName:${q}*`), queryUsers(`familyName:${q}*`), queryUsers(`name:'${q}'`)];
  const seen = new Set<string>();
  return (await Promise.all(lists)).flat().filter((u) => !seen.has(u.primaryEmail) && seen.add(u.primaryEmail));
}

export function getUser(email: string): Promise<User> {
  return request(`${DIRECTORY}/users/${enc(email)}`);
}

export function updateUser(
  email: string,
  fields: { password?: string; changePasswordAtNextLogin?: boolean; suspended?: boolean; orgUnitPath?: string },
): Promise<User> {
  return request(`${DIRECTORY}/users/${enc(email)}`, "PUT", fields);
}

export function createUser(fields: {
  primaryEmail: string;
  name: { familyName: string; givenName: string };
  password: string;
  changePasswordAtNextLogin: boolean;
  orgUnitPath: string;
}): Promise<User> {
  return request(`${DIRECTORY}/users`, "POST", fields);
}

// ---- 그룹 ----

export interface Group {
  email: string;
  name: string;
}

export async function listUserGroups(email: string): Promise<Group[]> {
  const data = await request<{ groups?: Group[] }>(`${DIRECTORY}/groups?userKey=${enc(email)}`);
  return data.groups ?? [];
}

export const teacherGroup = (domain: string) => `classroom_teachers@${domain}`;

export type TeacherStatus = "member" | "not-member" | "no-group";

// classroom_teachers 그룹 가입 여부. 멤버 조회가 404면 그룹 자체가 있는지 한 번 더 본다.
export async function getTeacherStatus(email: string, domain: string): Promise<TeacherStatus> {
  const group = enc(teacherGroup(domain));
  try {
    await request(`${DIRECTORY}/groups/${group}/members/${enc(email)}`);
    return "member";
  } catch (e) {
    if (!isStatus(e, 404)) throw e;
  }
  try {
    await request(`${DIRECTORY}/groups/${group}`);
    return "not-member";
  } catch (e) {
    if (isStatus(e, 404)) return "no-group";
    throw e;
  }
}

export function addTeacher(email: string, domain: string): Promise<unknown> {
  return request(`${DIRECTORY}/groups/${enc(teacherGroup(domain))}/members`, "POST", {
    email,
    role: "MEMBER",
  });
}

// ---- 조직 단위(OU) ----

export interface OrgUnit {
  name: string;
  orgUnitPath: string;
  orgUnitId: string;
  parentOrgUnitId?: string;
  parentOrgUnitPath?: string;
}

// 경로를 마디별로 비교해 트리 순서(상위 바로 아래에 하위)로 정렬한다.
function byTree(a: OrgUnit, b: OrgUnit): number {
  const x = a.orgUnitPath.split("/");
  const y = b.orgUnitPath.split("/");
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i].localeCompare(y[i], "ko");
  }
  return x.length - y.length;
}

export async function listOrgUnits(): Promise<OrgUnit[]> {
  const data = await request<{ organizationUnits?: OrgUnit[] }>(
    `${DIRECTORY}/customer/my_customer/orgunits?type=all`,
  );
  return (data.organizationUnits ?? []).sort(byTree);
}

export function getOrgUnit(path: string): Promise<OrgUnit> {
  const segments = path.slice(1).split("/").map(enc).join("/");
  return request(`${DIRECTORY}/customer/my_customer/orgunits/${segments}`);
}

// ---- 라이선스 ----

const EDUCATION_SKUS: Record<string, string> = {
  "1010310002": "Teaching and Learning Upgrade",
  "1010310003": "Education Standard",
  "1010310005": "Education Plus",
  "1010310006": "Education Plus",
};

// Licensing API는 사용자 1명 조회에 SKU가 필요하다(product/{p}/sku/{s}/user/{u}).
// 알려진 Education SKU를 모두 조회해 배정된 것만 모은다. 하나도 없으면 기본(Fundamentals).
export async function getLicenseLabel(email: string): Promise<string> {
  const found = await Promise.all(
    Object.entries(EDUCATION_SKUS).map(([sku, label]) =>
      request<{ skuName?: string }>(`${LICENSING}/product/101031/sku/${sku}/user/${enc(email)}`).then(
        (a) => a.skuName || label,
        (e) => {
          if (isStatus(e, 404)) return null;
          throw e;
        },
      ),
    ),
  );
  const names = [...new Set(found.filter((n): n is string => n !== null))];
  return names.length ? names.join(", ") : "Education Fundamentals(기본)";
}

// ---- 클래스룸 ----

export interface ClassroomProfile {
  permissions?: { permission: string }[];
  verifiedTeacher?: boolean;
}

export function getClassroomProfile(email: string): Promise<ClassroomProfile> {
  return request(`${CLASSROOM}/userProfiles/${enc(email)}`);
}

// ---- Cloud Identity 정책 ----

export interface Policy {
  policyQuery: { orgUnit?: string; group?: string; sortOrder?: number };
  setting: { type: string; value?: Record<string, unknown> };
}

export async function listPolicies(): Promise<Policy[]> {
  // 서비스 켜짐·꺼짐 정책만 받는다. 전체를 받으면 수백 건이라 페이지를 여러 번 넘겨야 한다.
  const filter = enc("setting.type.matches('.*service_status')");
  const all: Policy[] = [];
  let pageToken = "";
  do {
    const data = await request<{ policies?: Policy[]; nextPageToken?: string }>(
      `${CLOUD_IDENTITY}/policies?filter=${filter}&pageSize=100${pageToken ? `&pageToken=${enc(pageToken)}` : ""}`,
    );
    all.push(...(data.policies ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return all;
}
