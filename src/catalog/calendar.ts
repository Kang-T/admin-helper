import type { TaskId } from "./tasks";

// 초등 학사 일정 기준으로 달마다 관리자가 할 일. 홈 「이달의 할 일」과 「연간 일정」 화면이 함께 쓴다.
export interface CalendarItem {
  title: string; // 한 줄
  detail?: string; // 보조 설명(선택)
  task?: TaskId; // 앱 화면으로 가는 버튼
  setting?: string; // 설정 바로가기 id(콘솔로)
  url?: string; // 그 외 외부 링크
}

export interface MonthPlan {
  month: number;
  label: string;
  items: CalendarItem[];
}

// 4~11월은 같은 내용
const EVERYDAY: CalendarItem[] = [
  { title: "비밀번호 초기화 요청 대응", task: "reset-password" },
  { title: "전출입 처리: 계정 정지·해제", task: "suspend" },
  { title: "전출입 처리: 조직 단위 이동", task: "move-ou" },
  { title: "클래스룸 진단", detail: "수업을 못 만든다는 문의가 오면", task: "diagnose-classroom" },
];

const everyday = (month: number): MonthPlan => ({ month, label: "평상시", items: EVERYDAY });

export const CALENDAR: MonthPlan[] = [
  {
    month: 1,
    label: "정리·준비",
    items: [
      { title: "안 쓰는 계정 정지", detail: "미접속 기간으로 걸러 한 번에 정지", task: "user-list" },
      { title: "정지된 계정 삭제", detail: "드라이브 소유권을 넘긴 뒤 삭제", task: "delete-users" },
      { title: "전환 점검표 확인", task: "checklist" },
    ],
  },
  {
    month: 2,
    label: "가장 바쁜 달(2월 말에 몰아서)",
    items: [
      { title: "학년 진급 실행", detail: "새 학년도 OU는 이때 자동으로 만들어집니다", task: "promote" },
      { title: "졸업생 정지", detail: "학년 진급에 포함돼 있습니다", task: "promote" },
      { title: "전출 교직원 정지", detail: "이메일 목록 CSV로 한 번에", task: "bulk-csv" },
      { title: "신입생·전입생 계정 일괄 생성", detail: "CSV로 한 번에", task: "bulk-create" },
      { title: "전입 교사 계정 만들기", task: "create-user" },
      { title: "전입 교사 클래스룸 승인", task: "approve-teacher" },
      { title: "새 학년 비밀번호 일괄 초기화", detail: "이메일 목록 CSV로 한 번에", task: "bulk-csv" },
    ],
  },
  {
    month: 3,
    label: "클래스룸 세팅",
    items: [
      {
        title: "학급 클래스룸 만들어 드리고 학생 넣기",
        detail: "아직 앱에 없는 기능. 교사가 Classroom에서 만들고 학생 초대. 안 될 때는 진단으로",
        url: "https://classroom.google.com",
        task: "diagnose-classroom",
      },
      { title: "전입생·새 교사 승인 마무리", task: "approve-teacher" },
      { title: "\"클래스룸이 안 돼요\" 진단", task: "diagnose-classroom" },
    ],
  },
  everyday(4),
  everyday(5),
  everyday(6),
  everyday(7),
  everyday(8),
  everyday(9),
  everyday(10),
  everyday(11),
  {
    month: 12,
    label: "학기 마무리 시작",
    items: [
      { title: "학생 계정 점검", detail: "미접속·정지 목록 내려받기", task: "user-list" },
      { title: "졸업생·전출 예정 정리 계획 세우기", task: "user-list" },
      { title: "내년도 준비 점검", task: "checklist" },
    ],
  },
];

export function planFor(month: number): MonthPlan {
  return CALENDAR.find((p) => p.month === month)!;
}
