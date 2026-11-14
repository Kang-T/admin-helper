// 일괄 생성(CSV)용: 파일 읽기(인코딩), CSV 파싱·만들기, 줄별 검증.
// 브라우저 밖으로 아무것도 보내지 않는다. 화면 코드와 분리해 Node에서도 시험할 수 있게 둔다.

export const MAX_ROWS = 500;
export const HEADERS = ["성", "이름", "이메일", "조직단위", "비밀번호"] as const;
export const TEMPLATE = "성,이름,이메일,조직단위,비밀번호\n홍,길동,hong.gildong,/2026학년도/4-1,\n";

// UTF-8로 먼저 읽고, 깨지면(엑셀의 일반 CSV) EUC-KR로 읽는다. 앞의 BOM은 지운다.
export function decodeCsv(buf: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("euc-kr").decode(buf);
  }
  return text.replace(/^﻿/, "");
}

// RFC 4180: 큰따옴표로 감싼 칸 안의 쉼표·줄바꿈, ""(따옴표 하나), CRLF·LF 줄 끝.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && cell === "") {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else cell += c;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

// 쉼표·따옴표·줄바꿈이 든 칸만 따옴표로 감싼다. 엑셀에 맞춰 줄 끝은 CRLF.
export function toCsv(rows: string[][]): string {
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}

export interface BulkRow {
  familyName: string;
  givenName: string;
  email: string;
  orgUnitPath: string;
  password: string; // 비어 있으면 실행할 때 자동 생성
  problem: string; // 비어 있으면 정상
}

// 표(머리글 포함)를 줄별로 검증한다. 파일 자체가 잘못됐으면 { error }.
// ouPaths: listOrgUnits()의 orgUnitPath 목록(최상위 "/"는 따로 허용).
export function validateRows(
  table: string[][],
  domain: string,
  ouPaths: string[],
): { rows: BulkRow[] } | { error: string } {
  const head = (table[0] ?? []).map((h) => h.trim());
  const col = Object.fromEntries(HEADERS.map((h) => [h, head.indexOf(h)])) as Record<(typeof HEADERS)[number], number>;
  if (col["성"] < 0 || col["이름"] < 0 || col["이메일"] < 0 || col["조직단위"] < 0) {
    return { error: `첫 줄(머리글)이 양식과 다릅니다. '${HEADERS.join(",")}'로 시작해야 합니다. 양식을 내려받아 쓰세요.` };
  }
  // 엑셀이 끝에 붙이는 빈 줄(,,,,)은 뺀다.
  const body = table.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  if (body.length === 0) return { error: "계정 정보가 들어 있는 줄이 없습니다. 둘째 줄부터 한 사람씩 쓰세요." };
  if (body.length > MAX_ROWS) {
    return { error: `한 번에 ${MAX_ROWS}명까지 만들 수 있습니다. 이 파일은 ${body.length}줄입니다. 파일을 나눠 올리세요.` };
  }

  const ous = new Set(["/", ...ouPaths]);
  const seen = new Set<string>();
  const dom = domain.toLowerCase();
  return {
    rows: body.map((r) => {
      const get = (h: (typeof HEADERS)[number]) => (col[h] < 0 ? "" : (r[col[h]] ?? "").trim());
      const problems: string[] = [];
      const familyName = get("성");
      const givenName = get("이름");
      if (!familyName || !givenName) problems.push("성·이름이 비었습니다");

      let email = get("이메일").toLowerCase();
      if (!email) problems.push("이메일이 비었습니다");
      else {
        if (!email.includes("@")) email = `${email}@${dom}`;
        const at = email.lastIndexOf("@");
        const local = email.slice(0, at);
        if (email.slice(at + 1) !== dom) problems.push(`@${dom}이 아닌 이메일입니다`);
        else if (!/^[a-z0-9._-]+$/.test(local)) problems.push("이메일 앞부분은 영문·숫자·. _ -만 됩니다");
        if (seen.has(email)) problems.push("파일 안에 중복");
        seen.add(email);
      }

      let orgUnitPath = get("조직단위") || "/";
      if (!orgUnitPath.startsWith("/")) orgUnitPath = `/${orgUnitPath}`;
      if (!ous.has(orgUnitPath)) problems.push("조직 단위가 없습니다");

      const password = get("비밀번호");
      const pwProblem = passwordProblem(password);
      if (pwProblem) problems.push(pwProblem);

      return { familyName, givenName, email, orgUnitPath, password, problem: problems.join(", ") };
    }),
  };
}

// ---- 일괄 작업(CSV): 이메일 목록으로 정지·해제·이동·비밀번호 초기화 ----

export type BulkAction = "suspend" | "unsuspend" | "move" | "reset";

export const ACTION_LABEL: Record<BulkAction, string> = {
  suspend: "정지",
  unsuspend: "정지 해제",
  move: "조직 단위 이동",
  reset: "비밀번호 초기화",
};

// 내려받는 양식: 머리글 + 예시 한 줄
export function actionTemplate(a: BulkAction): string {
  if (a === "move") return "이메일,조직단위\nhong.gildong,/2026학년도/4-1\n";
  if (a === "reset") return "이메일,비밀번호\nhong.gildong,\n";
  return "이메일\nhong.gildong\n";
}

export interface ActionRow {
  email: string;
  orgUnitPath: string; // move일 때만 쓴다. 나머지는 빈 값
  password: string; // reset일 때만. 비어 있으면 실행할 때 자동 생성
  problem: string; // 비어 있으면 정상
}

// 표(머리글 포함)를 줄별로 검증한다. 파일 자체가 잘못됐으면 { error }.
// ouPaths: move일 때 listOrgUnits()의 orgUnitPath 목록(최상위 "/"는 따로 허용). me: 로그인한 관리자 이메일.
export function validateActionRows(
  table: string[][],
  domain: string,
  ouPaths: string[],
  action: BulkAction,
  me: string,
): { rows: ActionRow[] } | { error: string } {
  const isMove = action === "move";
  const head = (table[0] ?? []).map((h) => h.trim());
  const emailCol = head.indexOf("이메일");
  const ouCol = head.indexOf("조직단위");
  const pwCol = action === "reset" ? head.indexOf("비밀번호") : -1; // 비밀번호 열은 없어도 된다(모두 자동 생성)
  if (emailCol < 0 || (isMove && ouCol < 0)) {
    const need = isMove ? "이메일,조직단위" : "이메일";
    return { error: `첫 줄(머리글)이 양식과 다릅니다. '${need}'로 시작해야 합니다. 양식을 내려받아 쓰세요.` };
  }
  // 엑셀이 끝에 붙이는 빈 줄(,,)은 뺀다.
  const body = table.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  if (body.length === 0) return { error: "이메일이 들어 있는 줄이 없습니다. 둘째 줄부터 한 사람씩 쓰세요." };
  if (body.length > MAX_ROWS) {
    return { error: `한 번에 ${MAX_ROWS}명까지 처리할 수 있습니다. 이 파일은 ${body.length}줄입니다. 파일을 나눠 올리세요.` };
  }

  const ous = new Set(["/", ...ouPaths]);
  const seen = new Set<string>();
  const dom = domain.toLowerCase();
  const self = me.toLowerCase();
  return {
    rows: body.map((r) => {
      const get = (c: number) => (c < 0 ? "" : (r[c] ?? "").trim());
      const problems: string[] = [];

      let email = get(emailCol).toLowerCase();
      if (!email) problems.push("이메일이 비었습니다");
      else {
        if (!email.includes("@")) email = `${email}@${dom}`;
        const at = email.lastIndexOf("@");
        const local = email.slice(0, at);
        if (email.slice(at + 1) !== dom) problems.push(`@${dom}이 아닌 이메일입니다`);
        else if (!/^[a-z0-9._-]+$/.test(local)) problems.push("이메일 앞부분은 영문·숫자·. _ -만 됩니다");
        if (seen.has(email)) problems.push("파일 안에 중복");
        seen.add(email);
        if (email === self && (action === "suspend" || action === "reset")) problems.push("본인 계정은 할 수 없습니다");
      }

      let orgUnitPath = "";
      if (isMove) {
        orgUnitPath = get(ouCol);
        if (!orgUnitPath) problems.push("조직 단위가 비었습니다");
        else {
          if (!orgUnitPath.startsWith("/")) orgUnitPath = `/${orgUnitPath}`;
          if (!ous.has(orgUnitPath)) problems.push("조직 단위가 없습니다");
        }
      }

      const password = get(pwCol);
      const pwProblem = passwordProblem(password);
      if (pwProblem) problems.push(pwProblem);

      return { email, orgUnitPath, password, problem: problems.join(", ") };
    }),
  };
}

// 내려받는 파일 이름 끝에 붙이는 시각: YYYYMMDD_HHMM
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// UTF-8 BOM을 붙여 내려받게 한다(엑셀이 한글을 바로 읽는다). 파일은 브라우저 안에서만 만들어진다.
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 직접 정한 비밀번호 검사. 비어 있으면 자동 생성이므로 통과. 구글 규칙: 8~100자, 영문·숫자·기호(ASCII)만.
export function passwordProblem(pw: string): string {
  if (!pw) return "";
  if (pw.length < 8) return "비밀번호는 8자 이상이어야 합니다";
  if (pw.length > 100) return "비밀번호는 100자 이하여야 합니다";
  if (!/^[\x21-\x7e]+$/.test(pw)) return "비밀번호는 영문·숫자·기호만 됩니다(한글·빈칸 불가)";
  return "";
}
