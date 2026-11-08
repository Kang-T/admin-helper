import { CALENDAR } from "../catalog/calendar";
import type { PanelProps } from "../catalog/tasks";
import { PlanItems } from "../components/MonthCard";

// 연간 일정: 12개월을 카드 12개로. 이번 달은 파란 테두리와 「이번 달」 표시.
export default function Calendar({ openTask }: PanelProps) {
  const now = new Date().getMonth() + 1;
  return (
    <div className="grid3">
      {CALENDAR.map((p) => (
        <div className="card" key={p.month} style={p.month === now ? { borderColor: "var(--blue)" } : undefined}>
          <div className="hd">
            <h2>{p.month}월</h2>
            {p.month === now && <span className="chip info">이번 달</span>}
          </div>
          <div className="bd">
            <p className="muted">{p.label}</p>
            <PlanItems items={p.items} openTask={openTask} />
          </div>
        </div>
      ))}
    </div>
  );
}
