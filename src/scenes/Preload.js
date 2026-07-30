import Phaser from 'phaser';
import { addSceneLabel, FONT, fadeIn, fadeToScene } from '../systems/ui.js';
import { loadSfx } from '../systems/audio.js';

// 프리로드 씬
// - 모든 에셋 로드·디코딩은 이 씬에서 끝낸다 (터치 후 50ms 내 발음 목표 — CLAUDE.md 5장)
// - iOS 오디오 정책: 사용자 제스처("탭하여 시작" 첫 터치) 안에서 AudioContext를
//   resume해야 이후 사운드 재생이 가능하다. 언락 전에는 어떤 사운드도 재생하지 않는다.
export default class Preload extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  async create() {
    fadeIn(this);
    addSceneLabel(this, 'Preload');

    const { width, height } = this.scale;

    // SFX 준비: 파일이 있으면 로드, 없으면 합성 대체 (실패해도 진행 — 내부에서 처리)
    const status = this.add
      .text(width / 2, height / 2, '사운드 준비 중…', {
        fontFamily: FONT,
        fontSize: '40px',
        color: '#A98D80',
      })
      .setOrigin(0.5);
    await loadSfx(this);
    status.destroy();

    // "탭하여 시작" 전체 화면 오버레이 — 이 씬에서는 이 탭이 [다음] 버튼 역할을 겸한다
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.35);
    const hint = this.add
      .text(width / 2, height / 2, '탭하여 시작', {
        fontFamily: FONT,
        fontSize: '56px',
        fontStyle: 'bold',
        color: '#FFFFFF',
      })
      .setOrigin(0.5);
    this.tweens.add({ targets: hint, alpha: 0.25, duration: 600, yoyo: true, repeat: -1 });

    // 첫 터치(pointerdown = 사용자 제스처)에서 오디오 언락 후 Title로 이동
    this.input.once('pointerdown', () => this.unlockAudioAndStart());
  }

  unlockAudioAndStart() {
    const soundManager = this.sound;
    // NoAudio·HTML5Audio 매니저는 context가 없을 수 있으므로 방어적으로 접근
    const ctx = soundManager ? soundManager.context : null;

    if (ctx && ctx.state === 'suspended') {
      // iOS: 반드시 사용자 제스처 핸들러 안에서 resume을 호출해야 언락된다
      ctx
        .resume()
        .then(() => console.log('[오디오] AudioContext 언락 완료. state =', ctx.state))
        .catch((err) => console.warn('[오디오] AudioContext resume 실패:', err));
    } else {
      console.log('[오디오] 언락 불필요. state =', ctx ? ctx.state : '(WebAudio 아님)');
    }

    fadeToScene(this, 'Title');
  }
}
