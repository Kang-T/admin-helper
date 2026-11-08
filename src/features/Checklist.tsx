import { useCallback, useEffect, useRef, useState } from "react";
import { consoleUrl, settingById } from "../catalog/settings";
import type { PanelProps, TaskId } from "../catalog/tasks";
import { errorMessage, isStatus, listOrgUnits, listPolicies, listUsers, type User } from "../google/api";
import type { Check, CheckStatus } from "../diagnose";
import {
  STATUS_LABEL,
  TITLES,
  checklistText,
  inactiveCheck,
  nextYearOuCheck,
  policyChecks,
  policyChecksUnavailable,
  summarize,
  takeoutCheck,
} from "../checklist";
import { ymd } from "../userlist";

// 배지 색: 됨 초록, 막힘 빨강, 주의 노랑, 직접 확인 회색
const CHIP: Record<CheckStatus, string> = {
  pass: "ok",
  problem: "err",
  info: "warn",
  unknown: "muted",
};

// 콘솔 바로가기 대신 이 앱의 다른 작업으로 보내는 항목
const TASK_BUTTON: Record<string, { id: TaskId; label: string }> = {
  [TITLES.inactive]: { id: "user-list", label: "목록 보기" },
  [TITLES.nextYear]: { id: "promote", label: "학년 진급" },
};

// 점검에 쓰는 설정 종류. 앞에 settings/가 붙어 오므로 .*로 시작한다.
const POLICY_TYPES = [
  ".*drive_and_docs.external_sharing",
  ".*classroom.class_membership",
  ".*classroom.teacher_permissions",
  ".*security.two_step_verification_enforcement",
  ".*service_status",
];
const matchFilter = (pattern: string) => `setting.type.matches('${pattern}')`;

// 한 번에 받는다. 정규식 묶음(|)을 거절(400)하면 설정마다 따로 부른다.
async function loadPolicies() {
  try {
    return await listPolicies(matchFilter(POLICY_TYPES.join("|")));
  } catch (e) {
    if (!isStatus(e, 400)) throw e;
    return (await Promise.all(POLICY_TYPES.map((t) => listPolicies(matchFilter(t))))).flat();
  }
}

const MAX_PAGES = 10; // 500명 × 10쪽 = 5,000명

async function loadAllUsers(): Promise<{ users: User[]; capped: boolean }> {
  const users: User[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await listUsers({ pageToken });
    users.push(...res.users);
    pageToken = res.nextPageToken;
    if (!pageToken) return { users, capped: false };
  }
  return { users, capped: true };
}

// 점검표는 읽기만 한다. 구글 설정을 바꾸지 않는다.
export default function Checklist({ domain, openTask }: PanelProps) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);
  const [copy, setCopy] = useState<"" | "ok" | "fail">("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setChecks(null);
    setCopy("");
    const now = new Date();
    const [policies, orgUnits, users] = await Promise.allSettled([loadPolicies(), listOrgUnits(), loadAllUsers()]);
    const result: Check[] = [];

    if (policies.status === "fulfilled" && orgUnits.status === "fulfilled") {
      result.push(...policyChecks(policies.value, orgUnits.value.map((u) => u.orgUnitId), now));
    } else if (policies.status === "rejected") {
      result.push(
        ...policyChecksUnavailable(
          isStatus(policies.reason, 403)
            ? "최고관리자만 확인할 수 있습니다"
            : `확인 불가: ${errorMessage(policies.reason)}`,
        ),
      );
    } else {
      // 조직 목록이 없으면 어느 정책이 최상위인지 가릴 수 없다.
      result.push(...policyChecksUnavailable(`확인 불가: ${errorMessage((orgUnits as PromiseRejectedResult).reason)}`));
    }

    result.push(takeoutCheck());

    if (users.status === "fulfilled") {
      const c = inactiveCheck(users.value.users, now);
      result.push(users.value.capped ? { ...c, detail: `${c.detail} (5,000명까지만 셌습니다)` } : c);
    } else {
      result.push({ title: TITLES.inactive, status: "unknown", detail: `확인 불가: ${errorMessage(users.reason)}` });
    }

    result.push(
      orgUnits.status === "fulfilled"
        ? nextYearOuCheck(orgUnits.value, now)
        : { title: TITLES.nextYear, status: "unknown", detail: `확인 불가: ${errorMessage(orgUnits.reason)}` },
    );

    setChecks(result);
    setRunning(false);
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const text = checks ? checklistText(domain, checks, ymd(new Date())) : "";

  function copyResult() {
    // 클립보드를 못 쓰는 환경(권한 거부·http)이면 아래 글 상자를 선택해 직접 복사하게 한다.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => setCopy("ok"),
        () => setCopy("fail"),
      );
  }

  useEffect(() => {
    if (copy === "fail") textRef.current?.select();
  }, [copy]);

  return (
    <>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" className="btn" onClick={run} disabled={running}>
          다시 점검
        </button>
      </div>
      {running && <p className="muted">점검하는 중… (정책·조직·사용자)</p>}
      {checks && (
        <>
          <p>
            <b>{summarize(checks)}</b>
          </p>
          <ul className="list">
            {checks.map((c) => {
              const task = TASK_BUTTON[c.title];
              return (
                <li key={c.title}>
                  <span className={`chip ${CHIP[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                  <div className="t">
                    <b>{c.title}</b>
                    <span>{c.detail}</span>
                    {(c.link || task) && (
                      <div className="actions">
                        {c.link && (
                          <a
                            className="btn text"
                            href={consoleUrl(settingById(c.link).url)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            콘솔에서 열기
                            <span className="icon" aria-hidden="true">
                              open_in_new
                            </span>
                          </a>
                        )}
                        {task && (
                          <button type="button" className="btn text" onClick={() => openTask(task.id)}>
                            {task.label}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="actions">
            <button type="button" className="btn" onClick={copyResult}>
              {copy === "ok" ? "복사했습니다" : "결과 복사"}
            </button>
          </div>
          {copy === "fail" && (
            <>
              <p className="msg error">복사하지 못했습니다. 아래 글이 선택된 상태에서 Ctrl+C(맥은 ⌘C)를 누르세요.</p>
              <textarea
                ref={textRef}
                readOnly
                value={text}
                rows={12}
                aria-label="점검 결과"
                style={{ width: "100%", font: "inherit", fontSize: 13 }}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
