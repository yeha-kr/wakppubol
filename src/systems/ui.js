// 공용 UI 헬퍼
// - COLOR/FONT: 파스텔 팔레트
// - makeButton/addNextButton: 눌림 상태를 추적하는 버튼 (오터치로 연속 전환 방지)
// - addStageHeader: 단계 표시(1/4 형식) + 제목 (P5)
// - fadeIn/fadeToScene: 300ms 페이드 씬 전환 (CLAUDE.md 4장)

export const COLOR = {
  BG: '#FFF1E6', // 게임 전체 배경 — index.html body 배경과 동일하게 유지할 것
  TEXT: '#6D5147', // 기본 텍스트
  BTN_BG: '#F4A28C', // 버튼 배경
  BTN_TEXT: '#FFFFFF', // 버튼 텍스트
};

export const FONT = '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';

const FADE_MS = 300; // 씬 전환 페이드 시간 (CLAUDE.md 4장 고정)
const FADE_RGB = [255, 241, 230]; // COLOR.BG와 같은 파스텔 톤으로 페이드

// 씬 진입 페이드인. 씬 인스턴스는 재사용되므로 전환 잠금 플래그도 여기서 리셋한다.
export function fadeIn(scene) {
  scene.__fading = false;
  scene.cameras.main.fadeIn(FADE_MS, ...FADE_RGB);
}

// 300ms 페이드아웃 후 씬 전환. 더블탭 등으로 중복 호출되어도 한 번만 전환된다.
export function fadeToScene(scene, key) {
  if (scene.__fading) return;
  scene.__fading = true;
  scene.cameras.main.fadeOut(FADE_MS, ...FADE_RGB);
  scene.cameras.main.once('camerafadeoutcomplete', () => scene.scene.start(key));
}

// 씬 이름 라벨 (골격 씬용 — 남은 곳: Credits)
export function addSceneLabel(scene, name) {
  const { width, height } = scene.scale;
  return scene.add
    .text(width / 2, height * 0.32, name, {
      fontFamily: FONT,
      fontSize: '72px',
      fontStyle: 'bold',
      color: COLOR.TEXT,
    })
    .setOrigin(0.5);
}

// 스테이지 상단 헤더: "n/4" 단계 표시 + 제목 (P5 명세 5번)
// scrollFactor(0): Stage4 피날레처럼 카메라가 움직여도 HUD는 고정되어야 한다
export function addStageHeader(scene, step, total, title) {
  const { width } = scene.scale;
  scene.add
    .text(width / 2, 38, `${step}/${total}`, {
      fontFamily: FONT,
      fontSize: '26px',
      fontStyle: 'bold',
      color: '#F4A28C',
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(8);
  scene.add
    .text(width / 2, 78, title, {
      fontFamily: FONT,
      fontSize: '34px',
      fontStyle: 'bold',
      color: COLOR.TEXT,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(8);
}

// 범용 버튼. pointerup + "이 버튼에서 눌렀을 때만" 발동 (씬 전환 직후 오터치 방지)
export function makeButton(scene, x, y, label, onTap, { fontSize = '48px', padX = 72, padY = 30 } = {}) {
  const btn = scene.add
    .text(x, y, label, {
      fontFamily: FONT,
      fontSize,
      color: COLOR.BTN_TEXT,
      backgroundColor: COLOR.BTN_BG,
      padding: { x: padX, y: padY },
    })
    .setOrigin(0.5)
    .setDepth(8)
    .setInteractive({ useHandCursor: true });

  let pressed = false;

  btn.on('pointerdown', () => {
    pressed = true;
    btn.setAlpha(0.7);
  });
  btn.on('pointerout', () => {
    pressed = false;
    btn.setAlpha(1);
  });
  btn.on('pointerup', () => {
    if (!pressed) return;
    pressed = false;
    btn.setAlpha(1);
    onTap();
  });

  return btn;
}

// [다음] 버튼 (골격 씬용)
export function addNextButton(scene, onTap, label = '다음') {
  const { width, height } = scene.scale;
  return makeButton(scene, width / 2, height * 0.72, label, onTap);
}
