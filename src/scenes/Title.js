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

    // 장식: 마스코트 일러스트 카드 (실에셋) / 없으면 임시 미리보기 공
    if (this.textures.exists('title_mascot')) {
      const cy = height * 0.47;
      const card = this.add.image(width / 2, cy, 'title_mascot').setDisplaySize(464, 464);
      const m = this.make.graphics({ x: 0, y: 0 }, false);
      m.fillStyle(0xffffff, 1);
      m.fillRoundedRect(width / 2 - 228, cy - 228, 456, 456, 32);
      card.setMask(m.createGeometryMask());
      const frame = this.add.graphics();
      frame.lineStyle(8, 0xffffff, 1);
      frame.strokeRoundedRect(width / 2 - 228, cy - 228, 456, 456, 32);
      // 프레임 안에서 살짝 숨쉬는 줌
      this.tweens.add({
        targets: card,
        scaleX: card.scaleX * 1.04,
        scaleY: card.scaleY * 1.04,
        duration: 1800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
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
    }

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
