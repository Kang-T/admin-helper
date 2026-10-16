import type { User } from "../google/api";

export type TaskId =
  | "lookup"
  | "reset-password"
  | "suspend"
  | "move-ou"
  | "create-user"
  | "approve-teacher"
  | "diagnose-classroom";

export interface Task {
  id: TaskId;
  title: string;
  description: string;
  keywords: string[];
}

// 작업 패널이 공통으로 받는 값. 선택한 사용자는 패널을 옮겨 다녀도 유지된다.
export interface PanelProps {
  domain: string;
  user: User | null;
  setUser: (user: User | null) => void;
  openTask: (id: TaskId) => void;
}

export const TASKS: Task[] = [
  {
    id: "lookup",
    title: "사용자 찾기·상태 보기",
    description: "계정 상태, 소속, 그룹, 라이선스를 한눈에 봅니다",
    keywords: ["사용자", "검색", "상태", "조회", "계정"],
  },
  {
    id: "reset-password",
    title: "비밀번호 초기화",
    description: "임시 비밀번호를 만들고 다음 로그인 때 바꾸게 합니다",
    keywords: ["비밀번호", "비번", "초기화", "암호", "패스워드"],
  },
  {
    id: "suspend",
    title: "계정 정지·해제",
    description: "계정을 정지하거나 정지를 풉니다",
    keywords: ["정지", "해제", "차단", "비활성", "활성"],
  },
  {
    id: "move-ou",
    title: "조직 단위(OU) 이동",
    description: "사용자를 다른 학교·학년 조직으로 옮깁니다",
    keywords: ["OU", "조직", "이동", "소속", "학교", "학년", "전출", "전입"],
  },
  {
    id: "create-user",
    title: "신규 계정 만들기",
    description: "새 계정을 만들고 임시 비밀번호를 발급합니다",
    keywords: ["신규", "생성", "추가", "새", "발급", "교사", "전입"],
  },
  {
    id: "approve-teacher",
    title: "클래스룸 교사 승인",
    description: "classroom_teachers 그룹에 넣어 수업을 만들 수 있게 합니다",
    keywords: ["클래스룸", "교사", "승인", "인증", "수업 만들기"],
  },
  {
    id: "diagnose-classroom",
    title: "클래스룸 진단: 왜 수업을 못 만드나",
    description: "수업을 만들지 못하는 원인을 차례로 점검합니다",
    keywords: ["진단", "클래스룸", "수업", "못", "안됨", "오류", "왜"],
  },
];
