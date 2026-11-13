import { describe, expect, it } from "vitest";
import {
  ACTION_LABEL,
  MAX_ROWS,
  actionTemplate,
  decodeCsv,
  parseCsv,
  toCsv,
  validateActionRows,
  validateRows,
  type BulkAction,
  passwordProblem,
} from "./csv";

// 시험용 값은 모두 예시다(실제 학교·사람이 아님).
const DOMAIN = "school.example";
const OUS = ["/2026학년도", "/2026학년도/4-1"];
const HEAD = ["성", "이름", "이메일", "조직단위", "비밀번호"];

const bytes = (...b: number[]) => new Uint8Array(b).buffer;
const utf8 = (s: string) => new TextEncoder().encode(s);

// 머리글 + 줄들을 검증하고, 결과가 줄 목록이라고 단언한다.
function rowsOf(body: string[][], domain = DOMAIN) {
  const r = validateRows([HEAD, ...body], domain, OUS);
  if ("error" in r) throw new Error(`예상하지 못한 오류: ${r.error}`);
  return r.rows;
}

describe("decodeCsv", () => {
  it("UTF-8을 읽는다", () => {
    expect(decodeCsv(utf8("성,이름\n홍,길동\n").buffer as ArrayBuffer)).toBe("성,이름\n홍,길동\n");
  });

  it("UTF-8 BOM을 지운다", () => {
    const body = utf8("성,이름\n");
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...body]);
    const text = decodeCsv(withBom.buffer);
    expect(text).toBe("성,이름\n");
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("UTF-8로 깨지는 바이트는 EUC-KR로 읽는다", () => {
    // "홍길동" (EUC-KR)
    expect(decodeCsv(bytes(0xc8, 0xab, 0xb1, 0xe6, 0xb5, 0xbf))).toBe("홍길동");
  });

  it("EUC-KR 안의 영문·쉼표·줄바꿈은 그대로 둔다", () => {
    // "길,a\n" (EUC-KR). 0xB1로 시작해 UTF-8로는 깨지므로 EUC-KR로 읽힌다.
    // ("홍"만 있는 C8 AB는 UTF-8로도 맞는 바이트(ȫ)라 EUC-KR로 넘어가지 않는다.)
    expect(decodeCsv(bytes(0xb1, 0xe6, 0x2c, 0x61, 0x0a))).toBe("길,a\n");
  });
});

describe("parseCsv", () => {
  it("쉼표로 칸을, 줄바꿈으로 줄을 나눈다", () => {
    expect(parseCsv("a,b,c\nd,e,f\n")).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  it("마지막 줄에 줄바꿈이 없어도 읽는다", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("CRLF 줄 끝을 한 번의 줄바꿈으로 본다", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("따옴표 안의 쉼표는 칸을 나누지 않는다", () => {
    expect(parseCsv('a,"b,c",d\n')).toEqual([["a", "b,c", "d"]]);
  });

  it("따옴표 안의 줄바꿈(LF·CRLF)은 줄을 나누지 않는다", () => {
    expect(parseCsv('"첫\n둘째",x\n"셋\r\n넷",y\n')).toEqual([
      ["첫\n둘째", "x"],
      ["셋\r\n넷", "y"],
    ]);
  });

  it('따옴표 안의 ""는 따옴표 하나다', () => {
    expect(parseCsv('"그는 ""안녕""이라 했다",b\n')).toEqual([['그는 "안녕"이라 했다', "b"]]);
  });

  it("칸 중간의 따옴표는 글자로 둔다", () => {
    expect(parseCsv('a"b,c\n')).toEqual([['a"b', "c"]]);
  });

  it("끝의 빈 칸을 남긴다", () => {
    expect(parseCsv("a,\n")).toEqual([["a", ""]]);
  });

  it("빈 줄은 빈 칸 하나짜리 줄로 남긴다(지우는 것은 validateRows)", () => {
    expect(parseCsv("a,b\n\nc,d\n")).toEqual([["a", "b"], [""], ["c", "d"]]);
  });

  it("빈 문자열은 줄이 없다", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("toCsv", () => {
  it("평범한 칸은 그대로 쓰고 줄 끝은 CRLF", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d\r\n");
  });

  it("쉼표·따옴표·줄바꿈이 든 칸만 따옴표로 감싸고 따옴표는 두 번 쓴다", () => {
    expect(toCsv([["a,b", 'say "hi"', "x\ny", "p\rq", "평범"]])).toBe(
      '"a,b","say ""hi""","x\ny","p\rq",평범\r\n',
    );
  });

  it("parseCsv로 다시 읽으면 원래 표가 된다", () => {
    const table = [
      ["이메일", "결과"],
      ["a@school.example", '실패: "권한", 없음'],
      ["b@school.example", "줄\n바꿈"],
    ];
    expect(parseCsv(toCsv(table))).toEqual(table);
  });
});

describe("validateRows: 파일 전체 검사", () => {
  it("필수 머리글(성·이름·이메일·조직단위)이 없으면 오류", () => {
    const r = validateRows([["성", "이름", "이메일"], ["홍", "길동", "hong"]], DOMAIN, OUS);
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toContain("첫 줄(머리글)이 양식과 다릅니다");
  });

  it("비밀번호 머리글은 없어도 된다(비밀번호는 빈 값)", () => {
    const r = validateRows([["성", "이름", "이메일", "조직단위"], ["홍", "길동", "hong", "/"]], DOMAIN, OUS);
    expect("rows" in r && r.rows[0]).toMatchObject({ password: "", problem: "" });
  });

  it("머리글 앞뒤 공백과 순서는 상관없다", () => {
    const r = validateRows(
      [[" 이메일 ", "조직단위", "이름", "성 "], ["hong", "/2026학년도/4-1", "길동", "홍"]],
      DOMAIN,
      OUS,
    );
    expect("rows" in r && r.rows[0]).toEqual({
      familyName: "홍",
      givenName: "길동",
      email: "hong@school.example",
      orgUnitPath: "/2026학년도/4-1",
      password: "",
      problem: "",
    });
  });

  it("내용 줄이 없으면 오류(빈 줄·쉼표만 있는 줄은 내용이 아니다)", () => {
    const r = validateRows([HEAD, [""], ["", "", "", "", ""], [" ", ""]], DOMAIN, OUS);
    expect(r).toEqual({ error: "계정 정보가 들어 있는 줄이 없습니다. 둘째 줄부터 한 사람씩 쓰세요." });
  });

  it("빈 줄은 결과에서 빠진다", () => {
    const r = validateRows(parseCsv("성,이름,이메일,조직단위,비밀번호\n홍,길동,hong,/\n\n,,,,\n김,철수,kim,/\n"), DOMAIN, OUS);
    expect("rows" in r && r.rows.map((x) => x.email)).toEqual(["hong@school.example", "kim@school.example"]);
  });

  it(`${MAX_ROWS}줄까지는 받는다`, () => {
    const body = Array.from({ length: MAX_ROWS }, (_, i) => ["홍", "길동", `user${i}`, "/", ""]);
    expect(rowsOf(body)).toHaveLength(MAX_ROWS);
  });

  it(`${MAX_ROWS}줄을 넘으면 오류`, () => {
    const body = Array.from({ length: MAX_ROWS + 1 }, (_, i) => ["홍", "길동", `user${i}`, "/", ""]);
    const r = validateRows([HEAD, ...body], DOMAIN, OUS);
    expect(r).toEqual({
      error: `한 번에 ${MAX_ROWS}명까지 만들 수 있습니다. 이 파일은 ${MAX_ROWS + 1}줄입니다. 파일을 나눠 올리세요.`,
    });
  });
});

describe("validateRows: 줄별 검사", () => {
  it("정상 줄은 problem이 비고, 칸 앞뒤 공백을 지운다", () => {
    expect(rowsOf([[" 홍 ", " 길동 ", " hong ", " /2026학년도 ", " password1 "]])[0]).toEqual({
      familyName: "홍",
      givenName: "길동",
      email: "hong@school.example",
      orgUnitPath: "/2026학년도",
      password: "password1",
      problem: "",
    });
  });

  it("성이나 이름이 비면 문제", () => {
    const [a, b] = rowsOf([
      ["", "길동", "a1", "/", ""],
      ["홍", "", "a2", "/", ""],
    ]);
    expect(a.problem).toBe("성·이름이 비었습니다");
    expect(b.problem).toBe("성·이름이 비었습니다");
  });

  it("이메일이 비면 문제", () => {
    expect(rowsOf([["홍", "길동", "", "/", ""]])[0].problem).toBe("이메일이 비었습니다");
  });

  it("이메일 앞부분만 쓰면 도메인을 붙이고 소문자로 바꾼다", () => {
    expect(rowsOf([["홍", "길동", "Hong.Gil_Dong-1", "/", ""]], "School.Example")[0]).toMatchObject({
      email: "hong.gil_dong-1@school.example",
      problem: "",
    });
  });

  it("전체 이메일은 대문자를 소문자로 바꿔 받는다", () => {
    expect(rowsOf([["홍", "길동", "HONG@SCHOOL.EXAMPLE", "/", ""]])[0]).toMatchObject({
      email: "hong@school.example",
      problem: "",
    });
  });

  it("다른 도메인 이메일은 문제", () => {
    expect(rowsOf([["홍", "길동", "hong@other.example", "/", ""]])[0]).toMatchObject({
      email: "hong@other.example",
      problem: "@school.example이 아닌 이메일입니다",
    });
  });

  it("앞부분에 영문·숫자·. _ - 밖의 글자가 있으면 문제", () => {
    const [a, b] = rowsOf([
      ["홍", "길동", "홍길동", "/", ""],
      ["홍", "길동", "a+b@school.example", "/", ""],
    ]);
    expect(a).toMatchObject({ email: "홍길동@school.example", problem: "이메일 앞부분은 영문·숫자·. _ -만 됩니다" });
    expect(b.problem).toBe("이메일 앞부분은 영문·숫자·. _ -만 됩니다");
  });

  it("파일 안 중복 이메일은 두 번째부터 문제(도메인 보완·대소문자 무시 후 비교)", () => {
    const [a, b, c] = rowsOf([
      ["홍", "길동", "kim", "/", ""],
      ["김", "철수", "KIM@school.example", "/", ""],
      ["이", "영희", "kim", "/", ""],
    ]);
    expect(a.problem).toBe("");
    expect(b.problem).toBe("파일 안에 중복");
    expect(c.problem).toBe("파일 안에 중복");
  });

  it("조직단위가 비면 최상위(/)로 본다", () => {
    expect(rowsOf([["홍", "길동", "hong", "", ""]])[0]).toMatchObject({ orgUnitPath: "/", problem: "" });
  });

  it("조직단위가 /로 시작하지 않으면 앞에 /를 붙인다", () => {
    expect(rowsOf([["홍", "길동", "hong", "2026학년도/4-1", ""]])[0]).toMatchObject({
      orgUnitPath: "/2026학년도/4-1",
      problem: "",
    });
  });

  it("목록에 없는 조직단위는 문제", () => {
    expect(rowsOf([["홍", "길동", "hong", "/2026학년도/9-9", ""]])[0]).toMatchObject({
      orgUnitPath: "/2026학년도/9-9",
      problem: "조직 단위가 없습니다",
    });
  });

  it("비밀번호가 8자 미만이면 문제, 8자면 통과, 비우면 통과", () => {
    const [a, b, c] = rowsOf([
      ["홍", "길동", "a1", "/", "1234567"],
      ["홍", "길동", "a2", "/", "12345678"],
      ["홍", "길동", "a3", "/", ""],
    ]);
    expect(a.problem).toBe("비밀번호는 8자 이상이어야 합니다");
    expect(b.problem).toBe("");
    expect(c.problem).toBe("");
  });

  it("문제가 여럿이면 쉼표로 이어 붙인다", () => {
    expect(rowsOf([["", "", "a+b", "/없음", "123"]])[0].problem).toBe(
      "성·이름이 비었습니다, 이메일 앞부분은 영문·숫자·. _ -만 됩니다, 조직 단위가 없습니다, 비밀번호는 8자 이상이어야 합니다",
    );
  });

  it("칸이 모자란 줄은 없는 칸을 빈 값으로 본다", () => {
    expect(rowsOf([["홍", "길동", "hong"]])[0]).toMatchObject({ orgUnitPath: "/", password: "", problem: "" });
  });
});

const ME = "admin@school.example";

// 일괄 작업 표를 검증하고, 결과가 줄 목록이라고 단언한다.
function actionRowsOf(action: BulkAction, table: string[][]) {
  const r = validateActionRows(table, DOMAIN, OUS, action, ME);
  if ("error" in r) throw new Error(`예상하지 못한 오류: ${r.error}`);
  return r.rows;
}

describe("actionTemplate", () => {
  it("이동은 이메일·조직단위, 나머지는 이메일만", () => {
    expect(actionTemplate("move")).toBe("이메일,조직단위\nhong.gildong,/2026학년도/4-1\n");
    for (const a of ["suspend", "unsuspend", "reset"] as const) expect(actionTemplate(a)).toBe("이메일\nhong.gildong\n");
  });

  it("양식을 그대로 올리면 정상으로 읽힌다", () => {
    for (const a of Object.keys(ACTION_LABEL) as BulkAction[]) {
      const rows = actionRowsOf(a, parseCsv(actionTemplate(a)));
      expect(rows).toEqual([
        {
          email: "hong.gildong@school.example",
          orgUnitPath: a === "move" ? "/2026학년도/4-1" : "",
          problem: "",
        },
      ]);
    }
  });
});

describe("validateActionRows: 파일 전체 검사", () => {
  it("이메일 머리글이 없으면 오류", () => {
    const r = validateActionRows([["메일"], ["hong"]], DOMAIN, OUS, "suspend", ME);
    expect(r).toEqual({ error: "첫 줄(머리글)이 양식과 다릅니다. '이메일'로 시작해야 합니다. 양식을 내려받아 쓰세요." });
  });

  it("이동인데 조직단위 머리글이 없으면 오류", () => {
    const r = validateActionRows([["이메일"], ["hong"]], DOMAIN, OUS, "move", ME);
    expect(r).toEqual({
      error: "첫 줄(머리글)이 양식과 다릅니다. '이메일,조직단위'로 시작해야 합니다. 양식을 내려받아 쓰세요.",
    });
  });

  it("이동이 아니면 다른 열이 있어도 이메일만 본다", () => {
    expect(actionRowsOf("unsuspend", [["이름", " 이메일 ", "조직단위"], ["홍길동", "hong", "/없음"]])).toEqual([
      { email: "hong@school.example", orgUnitPath: "", problem: "" },
    ]);
  });

  it("내용 줄이 없으면 오류", () => {
    const r = validateActionRows([["이메일"], [""], [" "]], DOMAIN, OUS, "suspend", ME);
    expect(r).toEqual({ error: "이메일이 들어 있는 줄이 없습니다. 둘째 줄부터 한 사람씩 쓰세요." });
  });

  it("빈 줄은 결과에서 빠진다", () => {
    const rows = actionRowsOf("suspend", parseCsv("이메일\nhong\n\n \nkim\n"));
    expect(rows.map((x) => x.email)).toEqual(["hong@school.example", "kim@school.example"]);
  });

  it(`${MAX_ROWS}줄까지는 받고, 넘으면 오류`, () => {
    const body = (n: number) => Array.from({ length: n }, (_, i) => [`user${i}`]);
    expect(actionRowsOf("reset", [["이메일"], ...body(MAX_ROWS)])).toHaveLength(MAX_ROWS);
    expect(validateActionRows([["이메일"], ...body(MAX_ROWS + 1)], DOMAIN, OUS, "reset", ME)).toEqual({
      error: `한 번에 ${MAX_ROWS}명까지 처리할 수 있습니다. 이 파일은 ${MAX_ROWS + 1}줄입니다. 파일을 나눠 올리세요.`,
    });
  });
});

describe("validateActionRows: 줄별 검사", () => {
  it("이메일 앞부분만 쓰면 도메인을 붙이고 소문자로 바꾼다", () => {
    expect(actionRowsOf("suspend", [["이메일"], [" Hong.Gil_Dong-1 "], ["KIM@SCHOOL.EXAMPLE"]])).toEqual([
      { email: "hong.gil_dong-1@school.example", orgUnitPath: "", problem: "" },
      { email: "kim@school.example", orgUnitPath: "", problem: "" },
    ]);
  });

  it("빈 이메일·다른 도메인·허용 안 되는 글자·파일 안 중복은 문제", () => {
    const rows = actionRowsOf("unsuspend", [["이메일", "메모"], ["", "x"], ["hong@other.example"], ["a+b"], ["kim"], ["KIM"]]);
    expect(rows.map((x) => x.problem)).toEqual([
      "이메일이 비었습니다",
      "@school.example이 아닌 이메일입니다",
      "이메일 앞부분은 영문·숫자·. _ -만 됩니다",
      "",
      "파일 안에 중복",
    ]);
  });

  it("정지·초기화는 본인 계정이면 문제(대소문자 무시, 앞부분만 써도)", () => {
    for (const a of ["suspend", "reset"] as const) {
      const rows = actionRowsOf(a, [["이메일"], ["ADMIN"], ["hong"]]);
      expect(rows.map((x) => x.problem)).toEqual(["본인 계정은 할 수 없습니다", ""]);
    }
    const r = validateActionRows([["이메일"], ["admin@school.example"]], DOMAIN, OUS, "suspend", "Admin@School.Example");
    expect("rows" in r && r.rows[0].problem).toBe("본인 계정은 할 수 없습니다");
  });

  it("이동·정지 해제는 본인 계정도 된다", () => {
    expect(actionRowsOf("unsuspend", [["이메일"], ["admin"]])[0].problem).toBe("");
    expect(actionRowsOf("move", [["이메일", "조직단위"], ["admin", "/2026학년도"]])[0].problem).toBe("");
  });

  it("이동: 조직단위가 비면 문제(최상위로 보지 않는다)", () => {
    expect(actionRowsOf("move", [["이메일", "조직단위"], ["hong", " "], ["kim"]]).map((x) => x.problem)).toEqual([
      "조직 단위가 비었습니다",
      "조직 단위가 비었습니다",
    ]);
  });

  it("이동: /로 시작하지 않으면 붙이고, 최상위(/)도 받는다", () => {
    expect(actionRowsOf("move", [["조직단위", "이메일"], ["2026학년도/4-1", "hong"], ["/", "kim"]])).toEqual([
      { email: "hong@school.example", orgUnitPath: "/2026학년도/4-1", problem: "" },
      { email: "kim@school.example", orgUnitPath: "/", problem: "" },
    ]);
  });

  it("이동: 목록에 없는 조직단위는 문제", () => {
    expect(actionRowsOf("move", [["이메일", "조직단위"], ["hong", "/2026학년도/9-9"]])[0]).toEqual({
      email: "hong@school.example",
      orgUnitPath: "/2026학년도/9-9",
      problem: "조직 단위가 없습니다",
    });
  });

  it("문제가 여럿이면 쉼표로 이어 붙인다", () => {
    expect(actionRowsOf("move", [["이메일", "조직단위"], ["a+b", "/없음"]])[0].problem).toBe(
      "이메일 앞부분은 영문·숫자·. _ -만 됩니다, 조직 단위가 없습니다",
    );
  });
});

describe("passwordProblem", () => {
  it("비우면 통과(자동 생성)", () => {
    expect(passwordProblem("")).toBe("");
  });
  it("8자 미만은 문제, 8자와 100자는 통과, 101자는 문제", () => {
    expect(passwordProblem("abc1234")).toBe("비밀번호는 8자 이상이어야 합니다");
    expect(passwordProblem("abc12345")).toBe("");
    expect(passwordProblem("a".repeat(100))).toBe("");
    expect(passwordProblem("a".repeat(101))).toBe("비밀번호는 100자 이하여야 합니다");
  });
  it("기호는 되고, 한글·빈칸은 안 된다", () => {
    expect(passwordProblem("Hyorim!2026#")).toBe("");
    expect(passwordProblem("효림초등학교2026")).toBe("비밀번호는 영문·숫자·기호만 됩니다(한글·빈칸 불가)");
    expect(passwordProblem("hyorim 2026")).toBe("비밀번호는 영문·숫자·기호만 됩니다(한글·빈칸 불가)");
  });
});
