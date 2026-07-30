import Phaser from 'phaser';
import { FONT, addStageHeader, fadeIn, fadeToScene } from '../systems/ui.js';
import { playSfx, startLoop, stopLoop } from '../systems/audio.js';

// Stage 1 — 점토 떼서 섞어 뭉치기 (P2, docs/PLAN.md 6장)
// 임시 그래픽(색 블롭): 하단 점토 3덩이 → 위로 100px 드래그하면 조각이 뜯어져
// 손가락을 따라오고, 중앙 볼에 2~3조각 담은 뒤 문질러 섞는다.
// 게이지는 "누적 이동거리"로만 오르며 탭으로는 오르지 않는다.

// ─── 튜닝 상수 (조정 시 변경 전/후 값을 보고할 것 — CLAUDE.md 8.5·8.6) ───
const TEAR_DIST = 100; // 위로 이만큼 드래그하면 뜯어짐 (명세 고정)
const SOURCE_R = 82; // 원판 점토 덩이 반지름
const PIECE_R = 46; // 뜯긴 조각 반지름
const BOWL_R = 175; // 볼 반지름
const MIN_PIECES = 2; // 섞기 시작 최소 조각 수
const MAX_PIECES = 3; // 볼 최대 조각 수
const GAUGE_FULL_DIST = 9000; // 게이지 100%에 필요한 문지르기 누적 거리(px) → 8~15초 목표
const RUB_MIN_SEG = 3; // 이보다 짧은 이동은 무시 (탭 지터 컷)
const RUB_FRAME_MAX = 60; // 한 이동 이벤트당 인정 상한(px) — 순간이동 컷
const RUB_AREA_RATIO = 1.25; // 볼 반지름 대비 문지르기 인정 범위
const MIX_LOCK_AT = 0.02; // 게이지가 이 이상이면 재료 추가(뜯기) 잠금
const KNEAD_VOL_SPEED = 1100; // 이 문지르기 속도(px/s)에서 반죽 루프 볼륨 최대
const MIX_STAGES = [0.25, 0.5, 0.75, 1.0]; // 혼합 단계 전환 지점 (명세 고정)

// 점토 3색 (임시 팔레트)
const CLAYS = [
  { name: 'red', color: 0xe2574c },
  { name: 'blue', color: 0x4c7be2 },
  { name: 'yellow', color: 0xefc94c },
];

export default class Stage1 extends Phaser.Scene {
  constructor() {
    super('Stage1');
  }

  create() {
    fadeIn(this);
    const { width, height } = this.scale;
    this.bowlX = width / 2;
    this.bowlY = height * 0.457; // 585
    this.completing = false;

    this.gauge = 0; // 0..1
    this.mixStage = 0; // 통과한 혼합 단계 수 (0..4)
    this.bowlPieces = []; // { color, node }
    this.drag = null; // 뜯기/운반 세션 { pointer, src, piece, torn }
    this.rub = null; // 문지르기 세션 { pointerId, lastX, lastY }
    this.rubDistFrame = 0; // 이번 프레임에 누적된 문지르기 거리
    this.rubSpeed = 0; // 평활화된 문지르기 속도(px/s)
    this.loopHandle = null; // 반죽 루프 사운드 핸들
    this.loopVol = 0;
    this.mixStartAt = null; // 문지르기 시작 시각 (완료 기준 8~15초 측정용)
    this.rubTotal = 0; // 문지르기 누적 거리 총합 (로그용)

    // ── 볼 (중앙) ──
    const bowlG = this.add.graphics().setDepth(0);
    bowlG.lineStyle(6, 0xd9bfa8, 1);
    bowlG.strokeCircle(this.bowlX, this.bowlY, BOWL_R + 11);
    bowlG.fillStyle(0xf3e3d3, 1);
    bowlG.fillCircle(this.bowlX, this.bowlY, BOWL_R + 8);
    bowlG.fillStyle(0xfbf1e7, 1);
    bowlG.fillCircle(this.bowlX, this.bowlY, BOWL_R);
    bowlG.fillStyle(0xe8d5c4, 0.45); // 안쪽 아래 그늘로 오목한 느낌
    bowlG.fillEllipse(this.bowlX, this.bowlY + BOWL_R * 0.45, BOWL_R * 1.25, BOWL_R * 0.48);

    // ── 하단 점토 3덩이 ──
    this.sources = CLAYS.map((c, i) => {
      const x = 170 + i * 190;
      const y = height * 0.824; // 1055
      const body = this.add.circle(x, y, SOURCE_R, c.color).setDepth(1);
      const shine = this.add
        .circle(x - SOURCE_R * 0.3, y - SOURCE_R * 0.35, SOURCE_R * 0.3, 0xffffff, 0.28)
        .setDepth(1);
      // 만질 수 있다는 힌트로 잔잔한 숨쉬기 (텍스트 안내 없이 직관 유도)
      this.tweens.add({
        targets: [body, shine],
        scale: 1.04,
        duration: 850 + i * 130,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      return { ...c, x, y, body, shine };
    });

    // ── 뜯기 목 연결부(스트레치 표현)용 Graphics ──
    this.neckGfx = this.add.graphics().setDepth(5);

    // ── 게이지 바 (2조각 이상일 때 표시) ──
    this.gaugeBg = this.add.graphics().setDepth(7).setAlpha(0);
    this.gaugeBg.fillStyle(0xefdccb, 1);
    this.gaugeBg.fillRoundedRect(width / 2 - 210, 800, 420, 24, 12);
    this.gaugeFill = this.add.graphics().setDepth(7).setAlpha(0);

    // ── 안내 텍스트 ("문질러서 섞어요" — 명세 2번. 그 외 안내는 두지 않는다) ──
    this.hintText = this.add
      .text(width / 2, this.bowlY - BOWL_R - 55, '문질러서 섞어요', {
        fontFamily: FONT,
        fontSize: '38px',
        fontStyle: 'bold',
        color: '#6D5147',
      })
      .setOrigin(0.5)
      .setDepth(7)
      .setAlpha(0);

    // ── HUD ──
    addStageHeader(this, 1, 4, '점토 반죽');

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    // 캔버스 밖(FIT 레터박스 등)에서 손을 떼면 pointerup 대신 이 이벤트가 온다 (리뷰 확정 결함 수정)
    this.input.on('pointerupoutside', this.onUp, this);

    // 씬을 떠날 때 루프 사운드가 남지 않게 정리
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => stopLoop('knead_loop'));
  }

  // ─── 입력 ───

  onDown(pointer) {
    if (this.completing) return;

    // 1) 점토 덩이 잡기 (볼이 가득이거나 섞기 시작 후에는 잠금)
    if (!this.drag && this.bowlPieces.length < MAX_PIECES && this.gauge < MIX_LOCK_AT) {
      const src = this.sources.find(
        (s) => Phaser.Math.Distance.Between(pointer.x, pointer.y, s.x, s.y) <= SOURCE_R + 20
      );
      if (src) {
        const piece = this.makeBlob(src.x, src.y, PIECE_R, src.color).setDepth(6);
        // x0/y0: 잡은 지점 — 뜯김 판정은 이 지점 대비 드래그 이동량으로 계산한다
        this.drag = { pointer, pointerId: pointer.id, src, piece, torn: false, x0: pointer.x, y0: pointer.y };
        return;
      }
    }

    // 2) 볼 문지르기 시작 (2조각 이상)
    if (!this.rub && this.bowlPieces.length >= MIN_PIECES && this.inBowl(pointer.x, pointer.y)) {
      this.rub = { pointer, pointerId: pointer.id, lastX: pointer.x, lastY: pointer.y };
      if (!this.loopHandle) {
        this.loopHandle = startLoop('knead_loop', { volume: 0 }); // 언락 전이면 null
      }
    }
  }

  onMove(pointer) {
    if (!pointer.isDown) return;

    // 뜯기/운반 중
    if (this.drag && this.drag.pointerId === pointer.id) {
      const d = this.drag;
      if (!d.torn) {
        const dx = pointer.x - d.src.x;
        const dy = pointer.y - d.src.y;
        // 뜯김/늘어남 진행도는 "잡은 지점" 기준 드래그 이동량 (원판 중심 기준으로 하면
        // 잡은 위치에 따라 임계가 0~200px로 흔들린다 — 리뷰 확정 결함 수정)
        const dragDist = Phaser.Math.Distance.Between(pointer.x, pointer.y, d.x0, d.y0);
        const pull = Math.min(dragDist / TEAR_DIST, 1);

        // 조각은 손가락 쪽으로 절반쯤 끌려오며 드래그 방향으로 늘어난다
        d.piece.x = d.src.x + dx * 0.45;
        d.piece.y = d.src.y + dy * 0.45;
        d.piece.rotation = Math.atan2(dy, dx);
        d.piece.scaleX = 1 + 0.4 * pull;
        d.piece.scaleY = 1 - 0.18 * pull;
        this.drawNeck(d.src, d.piece, 1 - pull * 0.55);

        // 잡은 지점에서 위로 100px을 넘기면 뜯어짐
        if (d.y0 - pointer.y > TEAR_DIST) {
          d.torn = true;
          this.neckGfx.clear();
          playSfx('clay_tear');
          // 늘어났다 "끊기는" 스냅: 조각은 탄성 복원, 원판은 움찔 눌림
          d.piece.rotation = 0;
          this.tweens.add({ targets: d.piece, scaleX: 1, scaleY: 1, duration: 220, ease: 'Back.easeOut' });
          this.tweens.add({
            targets: [d.src.body, d.src.shine],
            scaleX: 1.12,
            scaleY: 0.86,
            duration: 90,
            yoyo: true,
            ease: 'Sine.easeInOut',
          });
        }
      }
      return; // 뜯긴 뒤의 추적은 update()에서 부드럽게 처리
    }

    // 볼 문지르기
    if (this.rub && this.rub.pointerId === pointer.id && !this.completing) {
      const rub = this.rub; // addGauge → complete()가 this.rub을 끊어도 안전하도록 로컬 참조
      const seg = Phaser.Math.Distance.Between(rub.lastX, rub.lastY, pointer.x, pointer.y);
      if (this.inBowl(pointer.x, pointer.y)) {
        // 짧은 세그먼트는 앵커를 그대로 두고 누적한다 — 매 이벤트 앵커를 전진시키면
        // 느린 문지르기(고주사율 기기일수록 이벤트당 이동이 작음)가 전부 버려진다 (리뷰 확정 결함 수정)
        if (seg >= RUB_MIN_SEG) {
          const counted = Math.min(seg, RUB_FRAME_MAX);
          this.rubDistFrame += counted;
          this.rubTotal += counted;
          if (this.mixStartAt === null) this.mixStartAt = this.time.now;
          rub.lastX = pointer.x;
          rub.lastY = pointer.y;
          this.addGauge(counted / GAUGE_FULL_DIST);
        }
      } else {
        // 볼 밖 이동은 적립 없이 앵커만 이동 (재진입 시 볼 밖 거리가 계산되지 않게)
        rub.lastX = pointer.x;
        rub.lastY = pointer.y;
      }
    }
  }

  onUp(pointer) {
    // 문지르기 종료
    if (this.rub && this.rub.pointerId === pointer.id) {
      this.rub = null;
    }

    // 뜯기/운반 종료
    if (this.drag && this.drag.pointerId === pointer.id) {
      const d = this.drag;
      this.drag = null;
      this.neckGfx.clear();

      if (!d.torn) {
        // 덜 뜯긴 채 놓음 → 원판으로 복귀
        this.tweens.add({
          targets: d.piece,
          x: d.src.x,
          y: d.src.y,
          scaleX: 0.6,
          scaleY: 0.6,
          alpha: 0,
          duration: 180,
          ease: 'Sine.easeIn',
          onComplete: () => d.piece.destroy(),
        });
        return;
      }

      const inBowl =
        Phaser.Math.Distance.Between(d.piece.x, d.piece.y, this.bowlX, this.bowlY) <= BOWL_R * 0.85;
      if (inBowl && this.bowlPieces.length < MAX_PIECES && !this.completing && this.gauge < MIX_LOCK_AT) {
        this.dropIntoBowl(d.piece, d.src.color);
      } else {
        // 볼 밖(또는 잠금 상태) → 원판으로 돌아가며 사라짐
        this.tweens.add({
          targets: d.piece,
          x: d.src.x,
          y: d.src.y,
          scale: 0.5,
          alpha: 0,
          duration: 260,
          ease: 'Sine.easeIn',
          onComplete: () => d.piece.destroy(),
        });
      }
    }
  }

  // ─── 볼 담기 / 혼합 ───

  dropIntoBowl(piece, color) {
    const slots = [
      [-48, 8],
      [46, -2],
      [-2, -46],
    ];
    const idx = this.bowlPieces.length;
    this.bowlPieces.push({ color, node: piece });
    piece.setDepth(2);
    this.tweens.add({
      targets: piece,
      x: this.bowlX + slots[idx][0],
      y: this.bowlY + slots[idx][1],
      scale: 1.12,
      duration: 240,
      ease: 'Back.easeOut',
    });

    if (this.bowlPieces.length >= MIN_PIECES) {
      // "문질러서 섞어요" 안내 + 게이지 바 표시 (명세 2번)
      if (this.hintText.alpha === 0) {
        this.tweens.add({ targets: [this.hintText, this.gaugeBg, this.gaugeFill], alpha: 1, duration: 250 });
        this.tweens.add({
          targets: this.hintText,
          alpha: 0.45,
          duration: 650,
          yoyo: true,
          repeat: -1,
          delay: 300,
        });
      }
    }
  }

  addGauge(amount) {
    if (this.completing) return;
    this.gauge = Math.min(1, this.gauge + amount);
    this.redrawGauge();

    // 25/50/75/100% 문턱을 넘을 때마다 혼합 단계 교체 (명세 4번)
    while (this.mixStage < MIX_STAGES.length && this.gauge >= MIX_STAGES[this.mixStage]) {
      this.mixStage++;
      this.applyMixStage(this.mixStage);
    }
  }

  redrawGauge() {
    const { width } = this.scale;
    this.gaugeFill.clear();
    this.gaugeFill.fillStyle(0xf4a28c, 1);
    const w = Math.max(24, 420 * this.gauge);
    this.gaugeFill.fillRoundedRect(width / 2 - 210, 800, w, 24, 12);
  }

  // 혼합 단계 시각 교체: 조각들 → "두 색을 lerp한 원" + 줄어드는 원색 얼룩 (임시 그래픽)
  applyMixStage(stage) {
    const colors = this.bowlPieces.map((p) => p.color);
    const mixed = averageColor(colors);

    if (stage === 1) {
      // 조각 원들을 지우고 혼합 원으로 교체
      for (const p of this.bowlPieces) p.node.destroy();
      this.mixCircle = this.add
        .circle(this.bowlX, this.bowlY, 96 + colors.length * 8, colors[0])
        .setDepth(2);
      this.streaks = [];
      // 섞기 시작 후에는 안내 펄스를 멈추고 서서히 감춘다
      this.tweens.killTweensOf(this.hintText);
      this.tweens.add({ targets: this.hintText, alpha: 0, duration: 400 });
    }

    if (!this.mixCircle) return;
    const t = [0.33, 0.66, 0.85, 1][stage - 1];
    this.mixCircle.setFillStyle(lerpColor(colors[0], mixed, t));

    // 원색 얼룩: 단계가 오를수록 작아지고 옅어지다가 100%에서 사라진다
    for (const s of this.streaks) s.destroy();
    this.streaks = [];
    if (stage < 4) {
      const streakR = [20, 13, 8][stage - 1];
      const streakA = [0.75, 0.5, 0.3][stage - 1];
      for (let i = 1; i < colors.length; i++) {
        for (let k = 0; k < 2; k++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 55;
          this.streaks.push(
            this.add
              .circle(this.bowlX + Math.cos(a) * r, this.bowlY + Math.sin(a) * r, streakR, colors[i], streakA)
              .setDepth(3)
          );
        }
      }
    }

    // 단계 전환 꿀렁 피드백
    this.tweens.add({
      targets: this.mixCircle,
      scale: 1.07,
      duration: 110,
      yoyo: true,
      ease: 'Sine.easeInOut',
    });

    if (stage === MIX_STAGES.length) this.complete(mixed, colors);
  }

  // 100%: 공으로 뭉쳐지는 트윈 → registry 저장 → Stage2 (명세 5번)
  complete(mixed, colors) {
    this.completing = true;
    this.rub = null;

    const mixSecs = this.mixStartAt === null ? 0 : (this.time.now - this.mixStartAt) / 1000;
    console.log(
      `[Stage1] 혼합 완료 — 문지르기 ${mixSecs.toFixed(1)}초, 누적 ${Math.round(this.rubTotal)}px ` +
        `(기준 거리 ${GAUGE_FULL_DIST}px), 색 ${colors.map((c) => '#' + c.toString(16)).join('+')}`
    );

    // 반죽 루프 페이드아웃 후 정지
    if (this.loopHandle) {
      this.tweens.add({
        targets: this.loopHandle,
        volume: 0,
        duration: 350,
        onComplete: () => stopLoop('knead_loop'),
      });
      this.loopHandle = null;
    }

    // 꿀렁꿀렁 → 매끈한 공으로 (뭉치기)
    this.tweens.add({
      targets: this.mixCircle,
      scaleX: 1.16,
      scaleY: 0.84,
      duration: 170,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.tweens.add({
          targets: this.mixCircle,
          scale: 0.88,
          duration: 300,
          ease: 'Back.easeIn',
          onComplete: () => {
            // 선택 색 정보를 registry로 전달 (CLAUDE.md 4장)
            this.registry.set('clayColors', { picked: colors, mixed });
            this.time.delayedCall(200, () => fadeToScene(this, 'Stage2'));
          },
        });
      },
    });
  }

  // ─── 헬퍼 ───

  inBowl(x, y) {
    return Phaser.Math.Distance.Between(x, y, this.bowlX, this.bowlY) <= BOWL_R * RUB_AREA_RATIO;
  }

  // 하이라이트가 달린 블롭(컨테이너) 생성
  makeBlob(x, y, r, color) {
    const body = this.add.circle(0, 0, r, color);
    const shine = this.add.circle(-r * 0.3, -r * 0.35, r * 0.3, 0xffffff, 0.28);
    return this.add.container(x, y, [body, shine]);
  }

  // 원판→조각 사이의 늘어나는 목(점점 가늘어지는 사다리꼴)
  drawNeck(src, piece, thickness) {
    this.neckGfx.clear();
    const dx = piece.x - src.x;
    const dy = piece.y - src.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 4) return;
    const nx = -dy / len;
    const ny = dx / len;
    const wA = 34 * thickness + 6;
    const wB = 13 * thickness + 4;
    this.neckGfx.fillStyle(src.color, 0.95);
    this.neckGfx.fillPoints(
      [
        { x: src.x + nx * wA, y: src.y + ny * wA },
        { x: piece.x + nx * wB, y: piece.y + ny * wB },
        { x: piece.x - nx * wB, y: piece.y - ny * wB },
        { x: src.x - nx * wA, y: src.y - ny * wA },
      ],
      true
    );
  }

  // ─── 프레임 루프 ───

  update(time, delta) {
    const dt = Math.max(delta, 1) / 1000;

    // up 이벤트를 어떤 이유로든 놓친 세션 자가 복구 (Stage4와 동일한 방어)
    if (this.drag && !this.drag.pointer.isDown) this.onUp(this.drag.pointer);
    if (this.rub && !this.rub.pointer.isDown) this.rub = null;

    // 뜯긴 조각은 손가락을 젤리처럼 따라온다
    if (this.drag && this.drag.torn) {
      const p = this.drag.pointer;
      this.drag.piece.x += (p.x - this.drag.piece.x) * 0.38;
      this.drag.piece.y += (p.y - this.drag.piece.y) * 0.38;
    }

    // 반죽 루프 볼륨 = 문지르는 속도에 연동 (명세 4번)
    const instSpeed = this.rubDistFrame / dt;
    this.rubDistFrame = 0;
    this.rubSpeed = this.rubSpeed * 0.85 + instSpeed * 0.15;
    const target =
      this.rub && !this.completing ? Math.min(this.rubSpeed / KNEAD_VOL_SPEED, 1) * 0.85 : 0;
    this.loopVol += (target - this.loopVol) * 0.25;
    if (this.loopHandle) this.loopHandle.setVolume(this.loopVol);
  }
}

// ─── 색 헬퍼 ───

function averageColor(colors) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of colors) {
    r += (c >> 16) & 0xff;
    g += (c >> 8) & 0xff;
    b += c & 0xff;
  }
  const n = colors.length;
  return Phaser.Display.Color.GetColor(Math.round(r / n), Math.round(g / n), Math.round(b / n));
}

function lerpColor(a, b, t) {
  const ca = Phaser.Display.Color.ValueToColor(a);
  const cb = Phaser.Display.Color.ValueToColor(b);
  const o = Phaser.Display.Color.Interpolate.ColorWithColor(ca, cb, 100, Math.round(t * 100));
  return Phaser.Display.Color.GetColor(Math.round(o.r), Math.round(o.g), Math.round(o.b));
}
