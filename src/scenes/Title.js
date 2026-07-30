import Phaser from 'phaser';
import { FONT, makeButton, fadeIn, fadeToScene } from '../systems/ui.js';

// 타이틀 씬 (P5)
// 임시 로고 텍스트 "왁뿌볼" + [시작]/[개발자 정보].
// 정식 한글 웹폰트 로고·마스코트는 P7(폴리시)에서 교체한다.
const CLAY_PREVIEW = 0xd96c5f; // 미리보기용 점토색

export default class Title extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create() {
    fadeIn(this);
    const { width, height } = this.scale;

    // 장식: 완성형 왁뿌볼 미리보기 (임시 그래픽) — 잔잔하게 떠 있는다
    const clay = this.add.circle(0, 0, 104, CLAY_PREVIEW);
    const shell = this.add.circle(0, 0, 126, 0xffffff).setAlpha(0.55);
    const gloss = this.add.ellipse(-40, -46, 58, 38, 0xffffff).setAlpha(0.5);
    const ball = this.add.container(width / 2, height * 0.47, [clay, shell, gloss]);
    this.tweens.add({
      targets: ball,
      y: ball.y - 14,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // 임시 로고
    this.add
      .text(width / 2, 236, '왁뿌볼', { fontFamily: FONT, fontSize: '124px', fontStyle: 'bold', color: '#6D5147' })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 330, '만들기', { fontFamily: FONT, fontSize: '46px', color: '#A98D80' })
      .setOrigin(0.5);

    makeButton(this, width / 2, height * 0.72, '시작', () => {
      // 새 플레이 준비: 이전 판 상태 제거 + 시작 시각 기록 (CLAUDE.md 4장 registry 키)
      this.registry.remove('clayColors');
      this.registry.remove('waxLayers');
      this.registry.set('startTime', Date.now());
      fadeToScene(this, 'Stage1');
    });
    makeButton(this, width / 2, height * 0.72 + 128, '개발자 정보', () => fadeToScene(this, 'Credits'), {
      fontSize: '32px',
      padX: 44,
      padY: 18,
    });
  }
}
