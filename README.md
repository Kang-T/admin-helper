# Admin Helper — Google Workspace 관리자 도우미

Google Admin Console에서 자주 하는 일을 한국어 버튼 하나로 처리하는 웹앱입니다.
교육청·학교의 관리자(최고관리자가 아니어도 됩니다. 위임 관리자는 자기 권한 범위 안에서 동작합니다)가
콘솔 구조를 새로 배우지 않아도 계정 관리와 "왜 안 되는지" 진단을 할 수 있게 하는 것이 목표입니다.

- **서버·데이터베이스 없음.** 정적 웹페이지 하나. 관리자 본인의 구글 로그인(OAuth)으로 브라우저가 Google API를 직접 호출합니다.
- **토큰은 브라우저 메모리에만.** 탭을 닫으면 사라집니다. 어디에도 저장하지 않습니다.
- **모든 변경은 구글 관리자 감사 로그에 남습니다.** 별도 로그를 만들지 않습니다.
- 가이드(화면 캡처 포함): `public/guide/index.html` — 배포하면 `/guide/`에서 열립니다.

## 할 수 있는 일

| 작업 | 내용 |
|---|---|
| 사용자 찾기·상태 보기 | 계정 상태·소속 OU·그룹·라이선스·클래스룸 교사 여부를 한 장에 |
| 비밀번호 초기화 | 임시 비밀번호 발급, 다음 로그인 때 변경 강제 |
| 계정 정지·해제 | |
| 조직 단위(OU) 이동 | 전출입 처리 |
| 신규 계정 만들기 | |
| 일괄 생성(CSV) | 성·이름·이메일·조직단위 CSV로 최대 500명, 임시 비밀번호 결과 파일 |
| 클래스룸 교사 승인 | `classroom_teachers` 그룹에 추가 |
| 클래스룸 진단 | "왜 수업을 못 만드나"를 5단계로 점검, 고칠 수 있는 건 그 자리에서 |
| 설정 바로가기 | API로 바꿀 수 없는 설정은 콘솔의 정확한 화면 + 단계 안내 |

## 직접 배포하기

이 앱은 **배포하는 사람이 자기 구글 클라우드 프로젝트에 OAuth 클라이언트를 등록**해서 씁니다.
그래야 로그인 화면에 자기 조직 이름이 뜨고, 코드를 누가 바꿨는지 자기가 통제합니다.

1. 구글 클라우드에서 OAuth 클라이언트 만들기 → [SETUP_OAUTH.md](SETUP_OAUTH.md) (초보자용 단계 안내)
2. 설치·실행

```
npm install
cp .env.example .env.local   # VITE_GOOGLE_CLIENT_ID 채우기
npm run dev                  # http://localhost:5173
npm run build                # 타입 검사 + dist/ 생성
```

3. 배포: 정적 호스팅 어디든 됩니다(Vercel·Netlify·Firebase Hosting·학교 서버). 빌드 명령 `npm run build`, 출력 폴더 `dist`,
   환경변수 `VITE_GOOGLE_CLIENT_ID`. 배포 주소를 OAuth 클라이언트의 **승인된 JavaScript 원본**과 **승인된 리디렉션 URI**(끝에 `/`)에 등록합니다.

한 조직 안에서만 쓸 거면 OAuth 동의 화면을 **내부**로 두면 구글 심사 없이 바로 씁니다.
여러 도메인에서 쓰려면 **외부 + 테스트 모드**(테스트 사용자 100명까지)로 시작하고, 그 이상은 구글 앱 심사를 받습니다.

## 환경변수

| 이름 | 설명 |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | OAuth 2.0 클라이언트 ID(웹 애플리케이션). 공개돼도 되는 값. 그 외 키·비밀값은 쓰지 않습니다. |

## 사용하는 Google API와 요청 범위

Admin SDK Directory(사용자·그룹·OU), Enterprise License Manager, Google Classroom(교사 프로필), Cloud Identity Policy(서비스 상태 읽기).
요청 범위: `admin.directory.user`, `admin.directory.group.member`, `admin.directory.group.readonly`, `admin.directory.orgunit.readonly`,
`apps.licensing`, `classroom.rosters.readonly`, `cloud-identity.policies.readonly`, `userinfo.email`.

## 알려진 한계

- 앱 켜기·끄기, Gemini 접근 같은 "설정 변경"은 Cloud Identity Policy API가 읽기 전용이라 자동 실행이 안 됩니다. 바로가기와 단계 안내로 대신합니다.
- 일괄 정지·이동·삭제는 아직 없습니다. 대량·복잡한 작업은 [GAM](https://github.com/GAM-team/GAM)을 권합니다.

## 크롬 확장(사이드 패널)

`extension/` 폴더. 콘솔 옆 사이드 패널에 이 웹앱을 띄우는 껍데기입니다. 사용법은 `extension/README.md`.

## 디자인

`DESIGN.md` — 색·글꼴·간격 기준.

## 라이선스

MIT © 2026 Kang-T
