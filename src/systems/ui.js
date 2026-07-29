// 씬 골격 공용 UI 헬퍼 (P0)
// 실제 아트 도입 전까지 모든 씬이 공유하는 파스텔 팔레트와 라벨/버튼 생성기.

export const COLOR = {
  BG: '#FFF1E6', // 게임 전체 배경 — index.html body 배경과 동일하게 유지할 것
  TEXT: '#6D5147', // 기본 텍스트
  BTN_BG: '#F4A28C', // 버튼 배경
  BTN_TEXT: '#FFFFFF', // 버튼 텍스트
};

export const FONT = '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';

// 씬 이름 라벨을 화면 위쪽에 표시한다.
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

// [다음] 버튼.
// - pointerup에서 동작시키되, 이 버튼 위에서 pointerdown이 먼저 있었던 경우에만 발동한다.
//   (씬 전환 직후 같은 자리에서 손을 떼거나, 다른 곳을 누른 채 버튼 위에서 떼는
//    오터치로 씬이 연달아 넘어가는 것을 방지)
export function addNextButton(scene, onTap, label = '다음') {
  const { width, height } = scene.scale;
  const btn = scene.add
    .text(width / 2, height * 0.72, label, {
      fontFamily: FONT,
      fontSize: '48px',
      color: COLOR.BTN_TEXT,
      backgroundColor: COLOR.BTN_BG,
      padding: { x: 72, y: 30 },
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });

  let pressed = false;

  btn.on('pointerdown', () => {
    pressed = true;
    btn.setAlpha(0.7); // 눌림 피드백
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
