export interface SettingLink {
  id: string;
  title: string;
  description: string;
  url: string;
  keywords: string[];
  steps: string[];
}

export const SETTINGS: SettingLink[] = [
  {
    id: "users",
    title: "사용자 목록",
    description: "전체 사용자 보기·추가·CSV 일괄 업로드",
    url: "https://admin.google.com/ac/users",
    keywords: ["사용자", "목록", "일괄", "CSV", "업로드"],
    steps: ["상단 [새 사용자 추가] 또는 [사용자 일괄 업데이트]", "CSV 템플릿 다운로드 후 채워서 업로드"],
  },
  {
    id: "orgunits",
    title: "조직 단위",
    description: "학교·학년별 OU 만들기·이름 바꾸기",
    url: "https://admin.google.com/ac/orgunits",
    keywords: ["OU", "조직", "학교", "학년"],
    steps: ["상위 OU 옆 + 로 하위 OU 추가"],
  },
  {
    id: "groups",
    title: "그룹",
    description: "classroom_teachers 등 그룹 관리",
    url: "https://admin.google.com/ac/groups",
    keywords: ["그룹", "교사 그룹"],
    steps: ["그룹 검색", "구성원 탭"],
  },
  {
    id: "apps-core",
    title: "Google Workspace 앱 켜기·끄기",
    description: "Classroom·Drive·Gmail 등 서비스를 OU별로 켜고 끄기",
    url: "https://admin.google.com/ac/appslist/core",
    keywords: ["앱", "서비스", "켜기", "끄기", "사용 설정", "Classroom", "Drive", "Gmail", "Meet"],
    steps: ["앱 클릭", "왼쪽에서 OU 선택", "서비스 상태 → 켜기/끄기", "재정의 저장"],
  },
  {
    id: "apps-additional",
    title: "추가 Google 서비스",
    description: "Gemini 앱·YouTube·지도 등 켜고 끄기",
    url: "https://admin.google.com/ac/appslist/additional",
    keywords: ["추가 서비스", "Gemini", "유튜브", "YouTube", "지도"],
    steps: ["서비스 검색", "OU 선택", "켜기/끄기"],
  },
  {
    id: "classroom-settings",
    title: "Classroom 설정",
    description: "교사 권한(누가 수업을 만들 수 있나)·학급 가입 범위",
    url: "https://admin.google.com/ac/managedsettings/397451267717",
    keywords: ["Classroom", "클래스룸", "교사 권한", "수업 만들기", "가입"],
    steps: [
      "Classroom 클릭",
      "일반 설정",
      '교사 권한: "인증된 교사만"이면 classroom_teachers 그룹에 넣어야 수업 생성 가능',
    ],
  },
  {
    id: "drive-sharing",
    title: "드라이브 공유 설정",
    description: "외부 공유 허용 범위",
    url: "https://admin.google.com/ac/managedsettings/55656082996",
    keywords: ["드라이브", "공유", "외부", "링크"],
    steps: ["Drive 및 Docs 클릭", "공유 설정", "OU 선택 후 외부 공유 범위 조정"],
  },
  {
    id: "genai-app",
    title: "Gemini 앱 설정",
    description: "gemini.google.com 앱을 OU별로 켜고 끄기",
    url: "https://admin.google.com/ac/managedsettings/47208553126",
    keywords: ["Gemini", "제미나이", "생성형", "AI"],
    steps: ["왼쪽 메뉴 생성형 AI > Gemini 앱", "OU 선택 후 서비스 상태 켜기/끄기", "미성년 사용자(학생) OU는 별도 정책 확인"],
  },
  {
    id: "genai-workspace",
    title: "Workspace 안의 Gemini",
    description: "문서·Gmail·Meet 안의 Gemini 기능 접근",
    url: "https://admin.google.com/ac/managedsettings/793154499678",
    keywords: ["Gemini", "제미나이", "생성형", "AI"],
    steps: ["왼쪽 메뉴 생성형 AI > Workspace의 Gemini", "기능 액세스에서 OU별로 조정"],
  },
  {
    id: "subscriptions",
    title: "구독·라이선스",
    description: "어떤 에디션을 몇 개 쓰는지",
    url: "https://admin.google.com/ac/billing/subscriptions",
    keywords: ["라이선스", "구독", "결제", "에디션"],
    steps: ["구독 목록에서 Education 항목 확인"],
  },
  {
    id: "license-settings",
    title: "라이선스 자동 배정",
    description: "OU별로 라이선스를 자동 배정",
    url: "https://admin.google.com/ac/billing/licensesettings",
    keywords: ["라이선스", "자동 배정"],
    steps: ["OU 선택", "자동 배정 켜기"],
  },
  {
    id: "audit",
    title: "관리자 감사 로그",
    description: "누가 언제 무엇을 바꿨는지",
    url: "https://admin.google.com/ac/sc/investigation?link=CgQIFRgB&ref=reporting",
    keywords: ["로그", "감사", "기록", "누가"],
    steps: ["날짜·관리자로 필터"],
  },
  {
    id: "password-mgmt",
    title: "비밀번호 정책",
    description: "길이·강도·만료",
    url: "https://admin.google.com/ac/security/passwordmanagement",
    keywords: ["비밀번호", "정책", "강도"],
    steps: ["OU 선택", "최소 길이 등 조정"],
  },
  {
    id: "2sv",
    title: "2단계 인증",
    description: "2단계 인증 강제 여부",
    url: "https://admin.google.com/ac/security/2sv",
    keywords: ["2단계", "인증", "보안"],
    steps: ["OU 선택", "적용 여부"],
  },
  {
    id: "roles",
    title: "관리자 역할",
    description: "학교 담당자에게 위임 관리자 권한 주기",
    url: "https://admin.google.com/ac/roles",
    keywords: ["관리자", "역할", "권한", "위임"],
    steps: ["역할 만들기 또는 선택", "관리자 할당", "OU 범위 지정"],
  },
  {
    id: "devices",
    title: "기기(크롬북)",
    description: "Chrome 기기 관리",
    url: "https://admin.google.com/ac/chrome/devices",
    keywords: ["기기", "크롬북", "Chromebook"],
    steps: ["Chrome 기기"],
  },
  {
    id: "domains",
    title: "도메인",
    description: "도메인 추가·확인",
    url: "https://admin.google.com/ac/domains/manage",
    keywords: ["도메인"],
    steps: ["도메인 추가"],
  },
];

export function settingById(id: string): SettingLink {
  return SETTINGS.find((s) => s.id === id)!;
}

// 어드민 콘솔은 크롬에 여러 계정이 로그인돼 있으면 계정 선택 화면으로 튕긴다.
// authuser=이메일 을 붙이면 로그인한 관리자 계정으로 바로 열린다.
let consoleAccount = "";
export function setConsoleAccount(email: string): void {
  consoleAccount = email;
}
export function consoleUrl(url: string): string {
  if (!consoleAccount) return url;
  return `${url}${url.includes("?") ? "&" : "?"}authuser=${encodeURIComponent(consoleAccount)}`;
}
