# Admin Helper — 디자인 기준

목표는 한 줄이다. **구글이 만든 도구처럼 보일 것.** 구체적으로는 2025년 이후 구글 제품 사이트,
특히 Antigravity(antigravity.google)의 화면 언어를 따른다. 아래 값은 그 사이트의 실제 CSS에서 뽑았다(2026-10-13).

## 1. 금지 — "클로드 냄새"

아래는 쓰지 않는다. 하나라도 보이면 이 문서 위반이다.

- 베이지·크림·따뜻한 회색 바탕 (`#f5f0e8`, `#faf7f2` 류). 바탕은 **순백 또는 파란기 도는 회색**만.
- 테라코타·주황·갈색 강조색. 강조색은 **구글 블루** 하나.
- 세리프 제목 글꼴. 모든 글자는 산세리프.
- 카드마다 다른 파스텔 배경. 카드는 전부 같은 흰색.
- 장식 이모지, 아이콘 대신 쓰는 이모지.
- Tailwind 기본 인디고(`#6366f1`) 계열, 기본 그림자 남발.
- 글자에 그라데이션 입히기. 그라데이션은 아래 4항에서 허용한 한 곳만.

## 2. 색 — 토큰

CSS 변수로만 쓴다. 값을 코드에 직접 적지 않는다.

```css
:root {
  /* 바탕 (Antigravity grey palette, 파란기 도는 회색) */
  --surface:            #ffffff;   /* 카드·패널 */
  --surface-container:  #f8f9fc;   /* 페이지 바탕 */
  --surface-high:       #eff2f7;   /* 입력창 바탕, 호버 */
  --surface-higher:     #e6eaf0;   /* 눌림, 선택됨 */

  /* 글자 */
  --on-surface:         #121317;   /* 본문·제목. 순검정 금지 */
  --on-surface-variant: #45474d;   /* 설명·보조 */
  --on-surface-muted:   #6a6a71;   /* 비활성·자리표시자 */

  /* 선 */
  --outline:            rgba(33, 34, 38, 0.12);
  --outline-variant:    rgba(33, 34, 38, 0.06);

  /* 강조 (구글 블루 하나) */
  --primary:            #1a73e8;
  --primary-hover:      #1765cc;
  --on-primary:         #ffffff;
  --primary-container:  #e8f0fe;   /* 선택된 카드 배경, 파란 배지 */

  /* 상태 (구글 제품 공통) */
  --ok:        #1e8e3e;  --ok-bg:      #e6f4ea;
  --warn:      #f9ab00;  --warn-bg:    #fef7e0;  --warn-text: #b06000; /* 노랑 글자는 대비가 낮아 글자는 이 값 */
  --error:     #d93025;  --error-bg:   #fce8e6;
  --info:      #1a73e8;  --info-bg:    #e8f0fe;
}
```

쓰임새 규칙

- 페이지 바탕 `--surface-container`, 그 위의 카드·패널 `--surface` + `1px solid var(--outline)`. 그림자는 쓰지 않는다. 떠 있는 요소(모달·드롭다운)만 `0 4px 16px rgba(18,19,23,.12)`.
- 진단 체크리스트의 통과/문제/확인불가/참고는 `--ok`/`--error`/`--warn`/`--info`와 짝 `-bg`를 배지에만 쓴다. 카드 왼쪽 세로선 같은 추가 장식은 하지 않는다.
- 다크 모드는 만들지 않는다 (관리자 업무 화면, 낮에 쓴다).

## 3. 글꼴

```css
@import url('https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,300..800&family=Noto+Sans+KR:wght@400..700&display=swap');

:root {
  --font: "Google Sans Flex", "Google Sans", "Noto Sans KR", -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
}
```

- Google Sans Flex는 한글이 없다. 한글은 자동으로 Noto Sans KR로 떨어진다. 둘의 x높이가 비슷해 섞여도 어색하지 않다.
- 크기와 굵기 (Antigravity: 제목은 크고 가늘게, 본문은 또렷하게)

| 용도 | 크기 | 굵기 | 자간 |
|---|---|---|---|
| 페이지 제목 (앱 이름) | 22px | 500 | 0 |
| 섹션 제목 ("자주 하는 작업") | 18px | 500 | 0 |
| 카드 제목 (작업 버튼) | 16px | 600 | 0 |
| 본문·설명 | 15px | 400 | 0 |
| 보조·메타 (이메일, OU 경로) | 13px | 400 | 0 |
| 배지 | 12px | 600 | 0.02em |

- 줄 간격 본문 1.55, 제목 1.3.
- 이메일·OU 경로는 `"Google Sans Code", "SF Mono", Menlo, monospace` 13px. 임시 비밀번호는 같은 글꼴 18px(받아 적어야 하므로).

## 4. 모양

- **버튼은 알약형.** `border-radius: 9999px`, 높이 40px(큰 버튼 48px), 좌우 안쪽 여백 20px.
  - 주 버튼: 배경 `--primary`, 글자 `--on-primary`. 한 화면에 하나만.
  - 보조 버튼: 배경 `--surface-high`, 글자 `--on-surface`. 호버 시 `--surface-higher`.
  - 윤곽 버튼: 투명 배경 + `1px solid var(--outline)`. "콘솔에서 열기"는 이것.
  - 위험 버튼(정지, 비밀번호 초기화 실행): 배경 `--error`, 글자 흰색. 확인 모달 안에서만 쓴다.
- **카드·패널은 16px 둥글게.** 큰 패널(작업 패널, 모달)은 20px. 입력창은 12px.
- **아이콘 자리는 원형 칩.** 작업 버튼 왼쪽에 40px 원(`--surface-high` 배경) 안에 20px 아이콘. 아이콘은 Material Symbols Rounded(outline) 한 종류만.
  ```html
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400,0,0" />
  ```
  작업별 아이콘: 사용자 찾기 `person_search` · 비밀번호 `key` · 정지/해제 `block` · OU 이동 `move_down` · 신규 계정 `person_add` · 교사 승인 `verified` · 진단 `troubleshoot` · 설정 바로가기 `open_in_new`.
- **허용된 유일한 그라데이션.** 로그인 전 화면의 카드 뒤에만, Antigravity 제품창 뒤의 은은한 무지개 번짐을 쓴다. 한 번만, 흐리게.
  ```css
  .glow { position:absolute; inset:-40px; z-index:-1; filter: blur(60px); opacity:.55;
    background: conic-gradient(from 180deg, #4285f4, #34a853, #fbbc04, #ea4335, #4285f4); }
  ```
  로그인 후 화면에는 쓰지 않는다.

## 5. 간격과 배치

- 기본 단위 8px. 카드 안쪽 여백 20px, 카드 사이 12px, 섹션 사이 32px.
- 본문 최대 폭 960px, 가운데 정렬, 좌우 바깥 여백 16px(모바일)·24px(데스크톱).
- 상단 바: 높이 56px, 왼쪽에 앱 이름(22px/500), 오른쪽에 로그인 이메일(13px, `--on-surface-variant`)과 [로그아웃] 윤곽 버튼. 바탕 `--surface`, 아래 `1px solid var(--outline)`. 어드민 콘솔 상단 바와 같은 리듬.
- 검색창: 높이 48px, 왼쪽에 `search` 아이콘, 바탕 `--surface-high`, 테두리 없음, 포커스 때 `2px solid var(--primary)`. 어드민 콘솔 검색창과 같은 느낌.
- 작업 버튼 그리드: 데스크톱 3열, 태블릿 2열, 모바일 1열. 각 버튼은 왼쪽 원형 아이콘 칩 + 오른쪽 제목/설명 두 줄. 선택된 버튼은 `--primary-container` 배경 + `--primary` 테두리.
- 작업 패널: 선택한 버튼 바로 아래에 전체 폭으로 열린다. 제목 왼쪽, [닫기] 윤곽 버튼 오른쪽.
- 설정 바로가기 목록: 한 줄에 제목·설명 왼쪽, [콘솔에서 열기] 오른쪽. 줄 사이 `--outline-variant` 선. 펼침 안내는 `--surface-container` 배경 블록.

## 6. 동작

- 호버·포커스·눌림은 배경색 단계로만 (`--surface-high` → `--surface-higher`). 확대·그림자 변화 없음.
- 전환은 120ms ease. 그 이상 길게 움직이는 애니메이션 없음.
- 포커스 링: `outline: 2px solid var(--primary); outline-offset: 2px`. 키보드 사용자를 위해 절대 끄지 않는다.
- 로딩: 버튼 안 글자를 "…하는 중"으로 바꾸고 비활성. 스피너 추가 안 함.

## 7. 글

- 존댓말, 짧게. 버튼은 명사형("비밀번호 초기화", "교사로 승인"). 확인 모달은 "○○님의 비밀번호를 초기화합니다." 한 문장.
- 오류는 무엇이 안 됐고 다음에 무엇을 하면 되는지 두 문장 이내. 코드·이메일을 오류 문구에 넣지 않는다.
- 영문 고유명사(Classroom, OU, Gemini)는 그대로. 한글 음차("클래스룸")는 설명문 안에서만.

## 8. 점검표 (화면 하나 만들 때마다)

1. 바탕이 `#ffffff`/`#f8f9fc` 둘 중 하나인가.
2. 강조색이 `#1a73e8` 하나뿐인가.
3. 버튼이 전부 알약형인가. 주 버튼이 화면에 하나뿐인가.
4. 그림자가 모달·드롭다운 외에 있지 않은가.
5. 이모지가 없는가. 아이콘은 Material Symbols Rounded 하나인가.
6. 375px 폭에서 가로 스크롤이 없는가.
7. 글꼴이 Google Sans Flex + Noto Sans KR인가.
