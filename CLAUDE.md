# CLAUDE.md — 왁뿌볼 만들기 (모바일 웹 게임)

이 문서는 이 저장소에서 작업하는 모든 세션이 따라야 하는 규칙이다.
상세 게임 명세는 `docs/PLAN.md`에 있다. 두 문서가 충돌하면 **CLAUDE.md가 우선**한다.

## 1. 프로젝트 요약

플래시 쿠킹 게임 감성의 "왁뿌볼 제작 + ASMR 파괴" 모바일 웹 게임.
4단계: 점토 반죽 → 왁스 코팅 → 고무·케이블타이 → 부수기.
게임 가치의 대부분은 Stage 4의 파괴 인터랙션과 크랙 사운드 체감에 있다. 모든 설계 판단에서 이 우선순위를 유지한다.

## 2. 기술 스택 (고정 — 변경 금지)

- Vite + Phaser 3 (3.8x) + **JavaScript**. TypeScript·React 등 다른 스택 도입 금지
- 세로 고정, 기준 해상도 720×1280, Phaser Scale `FIT` + `CENTER_BOTH`
- 오디오: Phaser Sound(Web Audio 기반), **mp3 44.1kHz 단일 포맷** (Safari가 ogg 미지원)
- 햅틱: `navigator.vibrate` — Android Chrome 전용. iOS 웹은 진동 API가 없으므로 호출 전 기능 감지 필수, 보완은 사운드 + 화면 셰이크
- 배포: GitHub Pages (vite `base` 경로 설정 필수 — 미설정 시 에셋 404)

## 3. 폴더 구조

```
index.html
vite.config.js
CLAUDE.md                 ← 이 문서
docs/PLAN.md              ← 상세 설계 명세
public/assets/img/        ← 스프라이트 (투명 PNG)
public/assets/sfx/        ← 효과음 (mp3)
public/assets/dev/        ← 개발자 정보 (photo.png만)
src/main.js
src/scenes/               ← Boot, Preload, Title, Stage1~4, Result, Credits
src/systems/              ← audio.js(공용 사운드), haptics.js
```

## 4. 씬 구조와 상태

- 흐름: Boot → Preload("탭하여 시작") → Title → Stage1 → Stage2 → Stage3 → Stage4 → Result. Credits는 Title/Result에서 진입
- 씬 간 상태는 **Phaser registry로만** 전달: `clayColors`(선택 색), `waxLayers`(코팅 수), `startTime`
- 씬 전환은 300ms 페이드

## 5. 오디오 규칙 (최우선)

- iOS 정책: Preload의 "탭하여 시작" 첫 터치에서 AudioContext를 resume한다. **언락 전에는 어떤 사운드도 재생 시도 금지**
- 모든 SFX는 Preload에서 로드·디코딩 완료. 목표: 터치 후 50ms 이내 발음
- 재생은 반드시 `src/systems/audio.js` 공용 모듈 경유: 샘플 풀 + 라운드로빈(같은 샘플 연속 재생 금지) + playbackRate ±10% + 볼륨 ±20% 랜덤
- sfx 파일이 없으면 에러를 내지 말고 Web Audio 노이즈 버스트 합성으로 자동 대체
- BGM 없음. 크랙 사운드 디테일을 가리는 오디오 요소를 추가하지 않는다

## 6. 에셋 규칙

- 이미지 파일명·규격은 `docs/PLAN.md` 9장 표를 따른다
- 파일이 없으면 임시 Graphics를 유지하고, 누락 파일 목록만 보고한다 (로드 에러로 게임이 죽으면 안 됨)
- 크랙 데칼·파편은 1차로 코드(Phaser Graphics)로 그린다. 이미지 교체는 사용자가 지시할 때만
- **왁스는 투명(무색)이다.** 코팅된 공은 속 점토 색이 비쳐 보여야 한다. 구현: 코팅 공 스프라이트는 무채색(연회색) 베이스로 두고 코드에서 점토 색으로 틴트한다. 광택 하이라이트는 틴트하면 색에 묻히므로(Phaser 틴트는 곱연산 — 흰색 × 점토색 = 점토색) 틴트하지 않는 별도 오버레이(코드 Graphics 권장)로 얹는다. 점토 색 조합별 스프라이트 세트는 만들지 않는다

## 7. 개발자 정보(Credits) 규칙

- 표시 항목: `public/assets/dev/photo.png`(사진), 텍스트 "성균관대학교 전자전기공학부 2학년 신예하", 이메일 — **이 세 가지가 전부다**
- **재학증명서는 표시하지 않는다.** 개인정보 보호를 위한 확정 결정이다. `docs/PLAN.md` 8장·9장에 증명서(cert_masked.png) 관련 서술이 남아 있어도 무시한다
- 사진은 DOM `<img>` 요소 금지 — Phaser 텍스처(캔버스 렌더)로만 표시
- 이메일은 mailto 링크 없이, 문자열을 코드에서 3조각으로 나눠 런타임 조립해 렌더 (크롤링 봇 수집 억제)
- 억제책: 이 씬에서 contextmenu 이벤트 차단, `user-select: none`, `-webkit-touch-callout: none`, 반투명 대각선 워터마크("확인용 · 날짜") 반복 오버레이, `visibilitychange` 탭 이탈 시 블러
- **"완전한 캡처 차단"은 웹에서 기술적으로 불가능하다** (스크린샷은 OS 기능). 위 억제책 외에 캡처 방지 명목의 스크립트·라이브러리를 추가하지 않는다

## 8. 작업 규칙 (반드시 지킬 것)

1. **범위**: 프롬프트에서 요청한 범위 밖의 코드는 건드리지 않는다. 개선점이 보이면 수정하지 말고 목록으로만 보고한다
2. **버그**: 바로 코드를 고치지 않는다. ① 원인 후보 수립 → ② 로그·중단점으로 검증 → ③ 근거와 함께 보고 → ④ 최소 범위 수정안 제안 → ⑤ 사용자 승인 후 적용
3. **게이트**: 각 프롬프트의 "완료 기준"은 사용자가 실기기(폰)로 직접 확인한다. 확인 전에 다음 단계로 진행하지 않는다
4. **커밋**: 각 P 단계 완료·승인 후 git commit 1회. 메시지 형식: `P{n}: 한 줄 요약`
5. **튜닝값 상수화**: 판정·연출 수치(뽑기 실패 속도 800px/s, 구역 데미지 임계값, 홀드 판정 300ms, 파편 낙하 파라미터 등)는 파일 상단 상수로 분리한다
6. **임계값 변경 보고**: 튜닝값을 조정했으면 반드시 변경 전/후 값을 함께 보고한다
7. 주석과 보고는 한국어로 쓴다

## 9. 테스트 기준

- 실기기 우선: iOS Safari, Android Chrome 각 1대 이상. 데스크톱 크롬 모바일 에뮬레이션은 오디오 지연·터치 감도가 달라 참고용으로만
- 성능: 연타 중에도 55fps 이상 유지
- iOS 확인 항목: 첫 탭 후 소리 재생, 무음 스위치 상태에서의 동작, 홈바 스와이프 오작동 없음
- 공통: 화면 확대·스크롤 바운스 없음(`touch-action: none`), 세로 고정
