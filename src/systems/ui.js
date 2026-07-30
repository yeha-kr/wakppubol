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
  const cam = scene.cameras.main;
  // 진입 페이드인이 아직 진행 중이면 현재 오버레이 알파에서 이어서 어두워지게 한다.
  // (fadeOut은 알파를 0으로 리셋하므로 화면이 한 프레임 번쩍인다 — 리뷰 확정 결함 수정)
  const carry = cam.fadeEffect.isRunning ? cam.fadeEffect.alpha : 0;
  cam.fadeOut(FADE_MS, ...FADE_RGB);
  if (carry > 0) {
    cam.fadeEffect.alpha = carry;
    cam.fadeEffect._elapsed = carry * FADE_MS;
  }
  cam.once('camerafadeoutcomplete', () => scene.scene.start(key));
}

// 배경 일러스트 (실에셋이 있으면) + 톤 안정용 파스텔 워시 (P7)
export function addBackground(scene) {
  if (!scene.textures.exists('bg_workshop')) return;
  const { width, height } = scene.scale;
  scene.add.image(width / 2, height / 2, 'bg_workshop').setDisplaySize(width, height).setDepth(-10);
  scene.add.rectangle(width / 2, height / 2, width, height, 0xfff1e6, 0.22).setDepth(-9);
}

// 색을 흰색 쪽으로 t만큼 섞는다 — 이미지 setTint는 곱셈이라 원색 그대로 쓰면
// 어두워지므로, 밝힌 색으로 틴트해 아트의 명암을 살린다
export function lightenColor(color, t) {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const L = (c) => Math.round(c + (255 - c) * t);
  return (L(r) << 16) | (L(g) << 8) | L(b);
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
  // 배경 일러스트 위에서도 읽히도록 반투명 배너를 깐다 (씬별 카운터 줄까지 커버)
  const banner = scene.add.graphics().setDepth(7.9).setScrollFactor(0);
  banner.fillStyle(0xffffff, 0.55);
  banner.fillRoundedRect(width / 2 - 235, 14, 470, 132, 26);
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
// btn_primary 실에셋이 있으면 캡슐 이미지 버튼, 없으면 텍스트 배경 버튼
export function makeButton(scene, x, y, label, onTap, { fontSize = '48px', padX = 72, padY = 30 } = {}) {
  const useImg = scene.textures.exists('btn_primary');

  const txt = scene.add
    .text(x, y, label, {
      fontFamily: FONT,
      fontSize,
      fontStyle: useImg ? 'bold' : 'normal',
      color: useImg ? '#8A3D33' : COLOR.BTN_TEXT,
      ...(useImg ? {} : { backgroundColor: COLOR.BTN_BG, padding: { x: padX, y: padY } }),
    })
    .setOrigin(0.5)
    .setDepth(8.1);

  let hit = txt;
  const targets = [txt];
  if (useImg) {
    const img = scene.add.image(x, y, 'btn_primary').setDepth(8);
    img.setDisplaySize(Math.max(txt.width + padX * 2, 230), txt.height + padY * 1.8);
    targets.push(img);
    hit = img;
  }
  hit.labelText = txt; // 호출부에서 라벨까지 함께 숨길 수 있게 참조를 남긴다
  hit.setInteractive({ useHandCursor: true });

  let pressed = false;
  hit.on('pointerdown', () => {
    pressed = true;
    targets.forEach((t) => t.setAlpha(0.75));
  });
  hit.on('pointerout', () => {
    pressed = false;
    targets.forEach((t) => t.setAlpha(1));
  });
  hit.on('pointerup', () => {
    if (!pressed) return;
    pressed = false;
    targets.forEach((t) => t.setAlpha(1));
    if (scene.__fading) return; // 전환 중에는 버튼 동작(부작용 포함)을 무시
    onTap();
  });

  return hit;
}

// [다음] 버튼 (골격 씬용)
export function addNextButton(scene, onTap, label = '다음') {
  const { width, height } = scene.scale;
  return makeButton(scene, width / 2, height * 0.72, label, onTap);
}
