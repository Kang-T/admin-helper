import { planFor, type CalendarItem } from "../catalog/calendar";
import { consoleUrl, settingById } from "../catalog/settings";
import type { TaskId } from "../catalog/tasks";

// 달마다 할 일 목록: 제목·보조 설명·[열기] 버튼. 홈 「이달의 할 일」과 「연간 일정」이 함께 쓴다.
export function PlanItems({ items, openTask }: { items: CalendarItem[]; openTask: (id: TaskId) => void }) {
  return (
    <ul className="list settings">
      {items.map((i) => (
        <li key={i.title}>
          <div className="t">
            <b>{i.title}</b>
            {i.detail && <span>{i.detail}</span>}
          </div>
          <div className="actions">
            {i.url && (
              <a className="btn" href={i.url} target="_blank" rel="noopener noreferrer">
                새 탭에서 열기
                <span className="icon" aria-hidden="true">
                  open_in_new
                </span>
              </a>
            )}
            {i.setting && (
              <a className="btn" href={consoleUrl(settingById(i.setting).url)} target="_blank" rel="noopener noreferrer">
                콘솔에서 열기
                <span className="icon" aria-hidden="true">
                  open_in_new
                </span>
              </a>
            )}
            {i.task && (
              <button type="button" className="btn" onClick={() => openTask(i.task!)}>
                열기
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// 홈: 이번 달 할 일 + [연간 일정 보기]
export default function MonthCard({ openTask }: { openTask: (id: TaskId) => void }) {
  const plan = planFor(new Date().getMonth() + 1);
  return (
    <div className="card">
      <div className="hd">
        <h2>
          이달의 할 일 · {plan.month}월 — {plan.label}
        </h2>
      </div>
      <div className="bd">
        <PlanItems items={plan.items} openTask={openTask} />
      </div>
      <div className="card-actions">
        <button type="button" className="btn text" onClick={() => openTask("calendar")}>
          연간 일정 보기
        </button>
      </div>
    </div>
  );
}
