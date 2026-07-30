import Phaser from 'phaser';
import { FONT, makeButton, fadeIn, fadeToScene, addBackground, lightenColor } from '../systems/ui.js';

// 결과 씬 (P5) — "완성!" + 소요 시간 + 코팅 레이어 수 + [다시 만들기]/[개발자 정보]
const CLAY_FALLBACK = 0xd96c5f;

export default class Result extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create() {
    fadeIn(this);
    addBackground(this);
    const { width, height } = this.scale;

    const reg = this.registry.get('clayColors');
    const clayColor = reg && typeof reg.mixed === 'number' ? reg.mixed : CLAY_FALLBACK;
    const layers = this.registry.get('waxLayers');
    const startTime = this.registry.get('startTime');
    const elapsedMs = typeof startTime === 'number' ? Date.now() - startTime : null;
    const timeText = formatElapsed(elapsedMs);
    const layerText = typeof layers === 'number' ? `${layers}겹` : '—';
    console.log(`[Result] 소요 시간 ${timeText}, 코팅 ${layerText}`);

    // 배경 위 가독성용 배너
    const banner = this.add.graphics().setDepth(1);
    banner.fillStyle(0xffffff, 0.6);
    banner.fillRoundedRect(width / 2 - 250, 190, 500, 120, 30);
    banner.fillRoundedRect(width / 2 - 250, 722, 500, 130, 30);

    this.add
      .text(width / 2, 250, '완성!', { fontFamily: FONT, fontSize: '96px', fontStyle: 'bold', color: '#6D5147' })
      .setOrigin(0.5)
      .setDepth(2);

    // 부수고 나온 속 점토 공 — 내가 고른 색이 그대로 보인다
    const ballNode = this.textures.exists('ball_core')
      ? this.add.image(0, 0, 'ball_core').setDisplaySize(240, 240).setTint(lightenColor(clayColor, 0.45))
      : this.add.circle(0, 0, 118, clayColor);
    const wrap = this.add.container(width / 2, height * 0.44, [ballNode]).setScale(0.5).setDepth(2);
    this.tweens.add({ targets: wrap, scale: 1, duration: 450, ease: 'Back.easeOut' });

    this.add
      .text(width / 2, 760, `걸린 시간  ${timeText}`, { fontFamily: FONT, fontSize: '36px', fontStyle: 'bold', color: '#6D5147' })
      .setOrigin(0.5)
      .setDepth(2);
    this.add
      .text(width / 2, 816, `왁스 코팅  ${layerText}`, { fontFamily: FONT, fontSize: '36px', fontStyle: 'bold', color: '#6D5147' })
      .setOrigin(0.5)
      .setDepth(2);

    makeButton(this, width / 2, height * 0.74, '다시 만들기', () => {
      // registry를 깨끗이 비우고 새 판 시작 (완료 기준: 상태 초기화)
      this.registry.remove('clayColors');
      this.registry.remove('waxLayers');
      this.registry.set('startTime', Date.now());
      fadeToScene(this, 'Stage1');
    });
    makeButton(this, width / 2, height * 0.74 + 126, '개발자 정보', () => fadeToScene(this, 'Credits'), {
      fontSize: '32px',
      padX: 44,
      padY: 18,
    });
  }
}

function formatElapsed(ms) {
  if (typeof ms !== 'number' || ms < 0) return '—';
  const s = ms / 1000;
  if (s < 59.95) return `${s.toFixed(1)}초`; // 59.95↑는 toFixed가 '60.0초'로 만들므로 분 표기로 (리뷰 확정)
  const total = Math.round(s); // 초를 먼저 반올림 — '1분 60초' 표기 방지 (리뷰 확정 결함 수정)
  return `${Math.floor(total / 60)}분 ${total % 60}초`;
}
