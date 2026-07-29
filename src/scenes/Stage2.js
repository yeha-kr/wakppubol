import Phaser from 'phaser';
import { FONT } from '../systems/ui.js';
import { playSfx } from '../systems/audio.js';

// Stage 2 — 왁스에 담갔다 빼기 (P3, docs/PLAN.md 6장)
// 공(Stage1에서 만든 색)을 드래그해 냄비에 담그고, 1초 유지 후 "천천히" 빼면 성공.
// 빼는 순간의 드래그 속도가 임계값을 넘으면 얼룩 실패(레이어 무효).
// 왁스는 투명: 레이어가 쌓여도 점토색이 계속 비치고, 반투명 흰 셸의
// 크기·광택·뿌연 느낌만 강해진다 (임시 표현).

// ─── 튜닝 상수 (조정 시 변경 전/후 값을 보고할 것 — CLAUDE.md 8.5·8.6) ───
const FAIL_SPEED = 800; // 빼는 순간 속도(px/s)가 이 값을 넘으면 얼룩 실패 (초안 — 실기기 튜닝 대상)
const SPEED_WINDOW_MS = 100; // 속도 측정 창(ms) — 최근 이 시간의 포인터 이동으로 계산
const DIP_HOLD_MS = 1000; // 냄비 안 유지 시간 → "이제 천천히 빼세요" 신호 (명세 고정)
const MAX_LAYERS = 4; // 코팅 완성 레이어 수 (명세 고정)
const BALL_R = 90; // 점토 공 반지름
const SHELL_GROW = 7; // 레이어당 셸 반지름 증가량(px)
const SURFACE_Y = 930; // 왁스 수면 y — 공 중심이 이보다 아래면 잠김
const POT_HALF_W = 170; // 잠김 판정 반폭 (잠긴 동안 x를 이 안으로 클램프)
const DIP_SOUND_GAP_MS = 250; // 첨벙 사운드 최소 간격 (재잠수 연타 노이즈 방지)
const SPARSE_DT = 0.033; // 유휴 공백 직후 첫 이동 구간에 적용하는 보정 dt(초) ≈ 2프레임
const JANK_KEEP_SPEED = 300; // 공백 직전 속도(px/s)가 이보다 크면 프레임 잭으로 보고 실제 dt 유지
const LONG_GAP_S = 0.5; // 이보다 긴 이벤트 공백은 의도적 정지로 간주 (잭·이벤트 병합은 이보다 짧다)
const CLAY_FALLBACK = 0xd96c5f; // Stage1을 건너뛴 경우의 점토색

const REST_X = 360;
const REST_Y = 420;

export default class Stage2 extends Phaser.Scene {
  constructor() {
    super('Stage2');
  }

  create() {
    const { width } = this.scale;
    this.layers = 0;
    this.completing = false;
    this.dragging = null; // { pointerId, offX, offY }
    this.inPot = false;
    this.ready = false; // 1초 유지 완료 여부
    this.dippedAt = 0;
    this.lastDipSoundAt = -9999;
    this.lastResult = ''; // 'success' | 'fail' | 'early' (검증·디버깅용)
    this.speedSamples = []; // { t, x, y } 최근 포인터 궤적
    this.droplets = []; // 낙하 중인 왁스 방울 { node, vx, vy }

    // Stage1이 저장한 선택 색 (없으면 기본 점토색)
    const reg = this.registry.get('clayColors');
    this.clayColor = reg && typeof reg.mixed === 'number' ? reg.mixed : CLAY_FALLBACK;

    // ── 냄비 ──
    const potBack = this.add.graphics().setDepth(2);
    potBack.fillStyle(0x8a6f5c, 1);
    potBack.fillRoundedRect(width / 2 - 190, SURFACE_Y - 30, 380, 230, { tl: 26, tr: 26, bl: 40, br: 40 });
    potBack.fillStyle(0xf6ead9, 1);
    potBack.fillEllipse(width / 2, SURFACE_Y, 340, 84); // 왁스 수면(뒤)

    // 잠긴 공 위로 겹쳐 보이는 반투명 왁스막 — 공이 뿌옇게 비쳐 "담김"이 읽힌다
    this.surfaceFront = this.add.ellipse(width / 2, SURFACE_Y + 26, 336, 120, 0xf6ead9, 0.55).setDepth(5);
    const potFront = this.add.graphics().setDepth(5);
    potFront.fillStyle(0x8a6f5c, 1);
    potFront.fillRoundedRect(width / 2 - 190, SURFACE_Y + 60, 380, 140, { tl: 6, tr: 6, bl: 40, br: 40 });
    potFront.lineStyle(5, 0x6f584a, 1);
    potFront.strokeEllipse(width / 2, SURFACE_Y, 340, 84); // 냄비 테두리

    // ── 공: 점토(불투명) + 투명 왁스 셸(레이어에 따라 커지고 뿌예짐) + 광택 ──
    this.clayBall = this.add.circle(0, 0, BALL_R, this.clayColor);
    this.shell = this.add.circle(0, 0, BALL_R + 2, 0xffffff).setAlpha(0);
    this.gloss = this.add.ellipse(-30, -36, 48, 32, 0xffffff).setAlpha(0);
    this.ball = this.add.container(REST_X, REST_Y, [this.clayBall, this.shell, this.gloss]).setDepth(4);

    // ── 유지 시간 링 + 안내 ──
    this.ringGfx = this.add.graphics().setDepth(6);
    this.hintText = this.add
      .text(width / 2, 700, '이제 천천히 빼세요', {
        fontFamily: FONT,
        fontSize: '40px',
        fontStyle: 'bold',
        color: '#6D5147',
      })
      .setOrigin(0.5)
      .setDepth(8)
      .setAlpha(0);

    // ── HUD ──
    this.add
      .text(width / 2, 56, 'Stage2 · 왁스 코팅', {
        fontFamily: FONT,
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#6D5147',
      })
      .setOrigin(0.5)
      .setDepth(8);
    this.counterText = this.add
      .text(width / 2, 106, '', { fontFamily: FONT, fontSize: '30px', color: '#A98D80' })
      .setOrigin(0.5)
      .setDepth(8);
    this.updateCounter();

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    // 캔버스 밖에서 손을 떼면 pointerup 대신 이 이벤트가 온다 (드래그 세션 고착 방지)
    this.input.on('pointerupoutside', this.onUp, this);
  }

  updateCounter() {
    this.counterText.setText(`레이어 ${this.layers}/${MAX_LAYERS}`);
  }

  // ─── 입력 ───

  grabRadius() {
    return BALL_R + SHELL_GROW * this.layers + 28;
  }

  onDown(pointer) {
    if (this.completing || this.dragging) return;
    if (Phaser.Math.Distance.Between(pointer.x, pointer.y, this.ball.x, this.ball.y) <= this.grabRadius()) {
      // 복귀 트윈이 살아있으면 드래그와 위치를 놓고 싸운다 (리뷰 확정 결함 수정)
      this.tweens.killTweensOf(this.ball);
      this.ball.setAngle(0);
      this.dragging = {
        pointer,
        pointerId: pointer.id,
        offX: this.ball.x - pointer.x,
        offY: this.ball.y - pointer.y,
      };
      this.speedSamples.length = 0;
      // 잡은 순간을 첫 샘플로 기록 — 재잡기 후 첫 move에서 수면을 넘어도 속도를 잴 수 있다
      this.speedSamples.push({ t: this.time.now, x: pointer.x, y: pointer.y });
    }
  }

  onMove(pointer) {
    if (!this.dragging || this.dragging.pointerId !== pointer.id || !pointer.isDown) return;
    if (this.completing) return;

    // 속도 샘플 기록 (빼는 순간 판정용)
    const now = this.time.now;
    this.speedSamples.push({ t: now, x: pointer.x, y: pointer.y });
    while (this.speedSamples.length > 3 && now - this.speedSamples[0].t > SPEED_WINDOW_MS * 1.6) {
      this.speedSamples.shift(); // 공백 판별용으로 최소 3개(직전 구간 포함)는 남긴다
    }

    // 공은 잡은 지점 오프셋을 유지하며 1:1로 따라온다 (판정 스테이지라 지연 없이 직결)
    let x = Phaser.Math.Clamp(pointer.x + this.dragging.offX, 80, 640);
    let y = Phaser.Math.Clamp(pointer.y + this.dragging.offY, 200, SURFACE_Y + 130);
    if (this.inPot) {
      // 잠긴 동안은 옆으로 빠져나갈 수 없다 (위로만 꺼내는 조작)
      x = Phaser.Math.Clamp(x, 360 - (POT_HALF_W - 12), 360 + (POT_HALF_W - 12));
    }
    this.ball.setPosition(x, y);

    this.checkZone();
  }

  onUp(pointer) {
    if (!this.dragging || this.dragging.pointerId !== pointer.id) return;
    this.dragging = null;
    // 냄비 밖에서 놓으면 제자리로 (잠긴 채 놓으면 그대로 잠겨 있는다 — 유지 시간은 계속 간다)
    if (!this.inPot && !this.completing) {
      this.tweens.add({ targets: this.ball, x: REST_X, y: REST_Y, duration: 420, ease: 'Sine.easeInOut' });
    }
  }

  // ─── 잠김/빼기 판정 ───

  checkZone() {
    const nowIn = this.ball.y > SURFACE_Y && Math.abs(this.ball.x - 360) < POT_HALF_W;
    if (nowIn === this.inPot) return;

    if (nowIn) {
      // 담금: 첨벙 + 수면 출렁 + 유지 타이머 시작
      this.inPot = true;
      this.ready = false;
      this.dippedAt = this.time.now;
      if (this.time.now - this.lastDipSoundAt > DIP_SOUND_GAP_MS) {
        playSfx('wax_dip');
        this.lastDipSoundAt = this.time.now;
      }
      this.tweens.add({ targets: this.surfaceFront, scaleX: 1.06, scaleY: 1.12, duration: 130, yoyo: true });
      this.hideHint();
    } else {
      // 빼기: 유지 완료 여부 + 빼는 순간 속도로 판정
      this.inPot = false;
      this.ringGfx.clear();
      const wasReady = this.ready;
      this.ready = false;
      this.hideHint();

      if (!wasReady) {
        this.lastResult = 'early'; // 1초를 못 채우고 꺼냄 — 레이어 변화 없음
        console.log('[Stage2] 판정: 유지 부족(early) — 레이어 무효');
        this.spawnDroplets(3);
        return;
      }

      const speed = this.measureSpeed();
      if (speed > FAIL_SPEED) {
        this.fail(speed);
      } else {
        this.success(speed);
      }
    }
  }

  // 빼는 순간의 포인터 이동 속도(px/s).
  // 원칙: 최근 SPEED_WINDOW_MS 안의 궤적으로 계산한다. 신선한 샘플이 부족하면(1초 유지처럼
  // 정지 후 첫 이동에 수면을 넘는 경우) 마지막 구간으로 판정하되, 이벤트 공백이 낀 구간은
  // "공백 직전에 이미 움직이고 있었는가"로 프레임 잭(실제 dt 신뢰)과 정지 후 홱(dt 클램프)을
  // 구별한다 — 리뷰 확정 결함(홱 인출이 성공으로 오판) 수정.
  measureSpeed() {
    const now = this.time.now;
    const all = this.speedSamples;
    const fresh = all.filter((s) => now - s.t <= SPEED_WINDOW_MS);
    let a;
    let b;
    if (fresh.length >= 2) {
      a = fresh[0];
      b = fresh[fresh.length - 1];
    } else if (all.length >= 2) {
      a = all[all.length - 2];
      b = all[all.length - 1];
    } else {
      // 측정 불가면 성공을 공짜로 주지 않는다 (onDown이 첫 샘플을 기록하므로 사실상 도달 불가)
      return FAIL_SPEED + 1;
    }

    const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    let dt = (b.t - a.t) / 1000;

    if (dt > SPEED_WINDOW_MS / 1000) {
      // 구간에 이벤트 공백이 포함됨. 두 경우를 구별한다:
      // - 프레임 잭·이벤트 병합(공백이 짧고, 직전까지 움직이고 있었음): 이동이 공백 전체에
      //   걸쳐 일어난 것 → 실제 dt를 신뢰해 느린 인출이 실패로 오판되지 않게 한다
      // - 의도적 정지 후 홱(1초 유지 등 긴 공백, 또는 직전에 정지 상태): 이동은 이벤트 직전
      //   1~2프레임에 일어난 것 → dt를 SPARSE_DT로 클램프해 홱이 성공으로 오판되지 않게 한다
      const idx = all.indexOf(a);
      const prev = idx > 0 ? all[idx - 1] : null;
      const preSpeed = prev
        ? Phaser.Math.Distance.Between(prev.x, prev.y, a.x, a.y) / Math.max((a.t - prev.t) / 1000, 0.016)
        : 0;
      if (dt > LONG_GAP_S || preSpeed < JANK_KEEP_SPEED) dt = Math.min(dt, SPARSE_DT);
    }

    dt = Math.max(dt, 0.016);
    return d / dt;
  }

  success(speed) {
    this.lastResult = 'success';
    this.layers++;
    this.updateCounter();
    this.applyLayerVisual();
    console.log(`[Stage2] 판정: ${Math.round(speed)}px/s ≤ ${FAIL_SPEED} → 성공 (레이어 ${this.layers}/${MAX_LAYERS})`);

    // 왁스 방울 + 드립 사운드
    this.spawnDroplets(9);
    playSfx('wax_drip');
    this.time.delayedCall(Phaser.Math.Between(70, 140), () => playSfx('wax_drip'));
    if (Math.random() < 0.6) this.time.delayedCall(Phaser.Math.Between(160, 240), () => playSfx('wax_drip'));

    // 셸 반짝 피드백
    this.tweens.add({ targets: this.gloss, alpha: Math.min(1, this.gloss.alpha + 0.35), duration: 120, yoyo: true });

    if (this.layers >= MAX_LAYERS) this.finish();
  }

  fail(speed) {
    this.lastResult = 'fail';
    console.log(`[Stage2] 판정: ${Math.round(speed)}px/s > ${FAIL_SPEED} → 얼룩 실패 (레이어 무효)`);
    playSfx('wax_fail');
    this.spawnDroplets(4);

    // 얼룩: 공 위에 탁한 반점들이 생겼다 사라진다
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * BALL_R * 0.6;
      const blob = this.add
        .circle(Math.cos(a) * r, Math.sin(a) * r, Phaser.Math.Between(16, 28), 0x9b8f84)
        .setAlpha(0.55);
      this.ball.add(blob);
      this.tweens.add({
        targets: blob,
        alpha: 0,
        duration: 750,
        delay: 150,
        onComplete: () => blob.destroy(),
      });
    }
    // 움찔 + 살짝 흔들림
    this.tweens.add({ targets: this.ball, angle: 5, duration: 60, yoyo: true, repeat: 3 });
    this.cameras.main.shake(70, 0.003);
  }

  // 레이어 표현: 셸이 조금 커지고(공이 커 보임) 더 뿌옇고 광택이 강해진다.
  // 셸 알파는 1 미만으로 유지해 점토색이 계속 비쳐 보인다 (왁스는 투명 — 명세 3번)
  applyLayerVisual() {
    const L = this.layers;
    this.shell.setScale((BALL_R + 2 + SHELL_GROW * L) / (BALL_R + 2));
    this.shell.setAlpha(0.16 + 0.13 * L); // 최대 0.68 — 점토가 항상 비친다
    this.gloss.setScale(1 + 0.07 * L);
    this.gloss.setAlpha(0.12 + 0.09 * L);
  }

  // 4레이어 완성 → registry 저장 → Stage3
  finish() {
    this.completing = true;
    this.dragging = null;
    this.registry.set('waxLayers', this.layers);
    console.log(`[Stage2] 코팅 완성 — 레이어 ${this.layers}, registry.waxLayers 저장`);

    this.tweens.add({ targets: this.ball, x: 360, y: 560, duration: 500, ease: 'Sine.easeInOut' });
    this.tweens.add({
      targets: this.ball,
      scale: 1.08,
      duration: 180,
      delay: 500,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeInOut',
    });
    this.time.delayedCall(1150, () => this.scene.start('Stage3'));
  }

  // 반투명 흰 왁스 방울 (공 아래쪽에서 떨어짐)
  spawnDroplets(count) {
    for (let i = 0; i < count; i++) {
      const node = this.add
        .circle(
          this.ball.x + Phaser.Math.Between(-60, 60),
          this.ball.y + Phaser.Math.Between(20, 70),
          Phaser.Math.Between(5, 10),
          0xffffff
        )
        .setAlpha(0.55)
        .setDepth(6);
      this.droplets.push({
        node,
        vx: Phaser.Math.FloatBetween(-40, 40),
        vy: Phaser.Math.FloatBetween(60, 220),
      });
    }
  }

  hideHint() {
    this.tweens.killTweensOf(this.hintText);
    this.hintText.setAlpha(0);
  }

  // ─── 프레임 루프 ───

  update(time, delta) {
    const dt = Math.min(delta, 50) / 1000;

    // up 이벤트를 어떤 이유로든 놓친 드래그 세션 자가 복구
    if (this.dragging && !this.dragging.pointer.isDown) this.onUp(this.dragging.pointer);

    // 유지 시간 링 → 1초 채우면 "이제 천천히 빼세요"
    this.ringGfx.clear();
    if (this.inPot && !this.completing) {
      const held = this.time.now - this.dippedAt;
      if (!this.ready && held >= DIP_HOLD_MS) {
        this.ready = true;
        this.hintText.setAlpha(1);
        this.tweens.add({ targets: this.hintText, alpha: 0.45, duration: 500, yoyo: true, repeat: -1 });
      }
      if (!this.ready) {
        const p = Math.min(held / DIP_HOLD_MS, 1);
        this.ringGfx.lineStyle(8, 0xffffff, 0.9);
        this.ringGfx.beginPath();
        this.ringGfx.arc(360, SURFACE_Y - 88, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        this.ringGfx.strokePath();
      }
    }

    // 왁스 방울 낙하
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const d = this.droplets[i];
      d.vy += 1900 * dt;
      d.node.x += d.vx * dt;
      d.node.y += d.vy * dt;
      d.node.alpha -= dt * 0.9;
      if (d.node.alpha <= 0 || d.node.y > 1240) {
        d.node.destroy();
        this.droplets.splice(i, 1);
      }
    }
  }
}
