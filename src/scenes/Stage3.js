import Phaser from 'phaser';
import { FONT, addStageHeader, fadeIn, fadeToScene, addBackground, lightenColor, makeButton } from '../systems/ui.js';
import { playSfx } from '../systems/audio.js';

// Stage 3 — 고무 패팅 + 케이블 타이 (P4, docs/PLAN.md 6장)
// 1부: [고무 패팅 하기] 버튼을 누르면 8구역이 차례로 자동 커버된다 ("팟" 3종 랜덤)
//      (원래 수동 8구역 탭이었으나 사용자 피드백으로 자동 연출로 교체)
// 2부: 화면을 아래로 스와이프해 케이블 타이를 조인다 — 래칫이라 역방향은 잠기고,
//      당길수록 "틱" 간격이 좁아지며, 끝까지 당기면 "지익" + 공이 눌리는 스퀴시
// PLAN 주의사항대로 1부/2부는 독립 구성 (인터랙션 교체가 쉬워야 함)

// ─── 튜닝 상수 (조정 시 변경 전/후 값을 보고할 것 — CLAUDE.md 8.5·8.6) ───
const SECTORS = 8; // 고무 패치 구역 수 (명세 고정)
const CLAY_R = 100; // 속 점토 반지름
const SHELL_R = 128; // 왁스 셸 반지름 (Stage2 4레이어 후 크기 느낌)
const PATCH_R = 132; // 고무 패치 반지름 (셸을 살짝 덮는다)
const AUTO_PAT_GAP_MS = 180; // 자동 패팅 시 패치 간 간격
const TIE_PULL_DIST = 600; // 조임 완료에 필요한 아래 방향 누적 스와이프 거리(px)
const TIE_DRAG_MAX_STEP = 80; // 이벤트당 인정 상한(px) — 순간이동 컷
const TICK_FIRST_AT = 0.03; // 첫 래칫 틱 진행도
const TICK_STEP_MAX = 0.085; // 초반 틱 간격 (진행도 기준)
const TICK_STEP_MIN = 0.022; // 최소 틱 간격 — 끝으로 갈수록 촘촘해진다
const TICK_NARROWING = 0.75; // 간격 좁아지는 정도 (0~1)
const TICKS_PER_EVENT_MAX = 2; // 한 이동 이벤트에서 재생할 최대 틱 수 (뭉개짐 방지)
const PAT_TO_TIE_DELAY = 350; // 8/8 후 2부 시작까지(ms)
const FINISH_TO_NEXT_MS = 950; // 조임 완료 후 Stage4 전환까지(ms)
const CLAY_FALLBACK = 0xd96c5f; // Stage1을 건너뛴 경우 점토색
const RUBBER_COLOR = 0x5c6b73; // 고무 패치색
const RUBBER_EDGE = 0x47555c; // 패치 테두리
const TIE_COLOR = 0xedede6; // 케이블 타이(흰 나일론)

const BALL_X = 360;
const BALL_Y = 590;

export default class Stage3 extends Phaser.Scene {
  constructor() {
    super('Stage3');
  }

  create() {
    fadeIn(this);
    addBackground(this);
    const { width } = this.scale;
    this.phase = 'pat'; // 'pat' → 'tie' → 'done'
    this.covered = new Array(SECTORS).fill(false);
    this.coveredCount = 0;
    this.tieProgress = 0; // 0..1
    this.nextTickAt = TICK_FIRST_AT;
    this.tickCount = 0;
    this.tieDrag = null; // { pointer, pointerId, lastY }
    this.step = (Math.PI * 2) / SECTORS;

    // Stage1·2가 저장한 상태 (없으면 기본값 — 씬 단독 테스트 대비)
    const reg = this.registry.get('clayColors');
    const clayColor = reg && typeof reg.mixed === 'number' ? reg.mixed : CLAY_FALLBACK;
    const waxLayers = typeof this.registry.get('waxLayers') === 'number' ? this.registry.get('waxLayers') : 4;

    // ── 공 그룹: 점토(실에셋/원) + 왁스 셸 + (탭 시) 고무 패치 + 케이블 타이 ──
    // 스퀴시 트윈을 한 덩어리로 먹이기 위해 컨테이너로 묶는다.
    // 구역 안내선은 두지 않는다 — 껍질이 "조각나 보이는" 인상을 피한다.
    const clay = this.textures.exists('ball_core')
      ? this.add.image(0, 0, 'ball_core').setDisplaySize(CLAY_R * 2, CLAY_R * 2).setTint(lightenColor(clayColor, 0.45))
      : this.add.circle(0, 0, CLAY_R, clayColor);
    const shell = this.add.circle(0, 0, SHELL_R, 0xffffff).setAlpha(0.16 + 0.13 * waxLayers);
    const gloss = this.add.ellipse(-40, -48, 62, 40, 0xffffff).setAlpha(0.4);

    // 케이블 타이: 그래픽 링 버전 (이미지 에셋 버전은 조임 연출이 어색해 사용자 피드백으로 롤백)
    this.tieGfx = this.add.graphics();
    this.ballGroup = this.add.container(BALL_X, BALL_Y, [clay, shell, gloss, this.tieGfx]).setDepth(2);

    // ── HUD ──
    addStageHeader(this, 3, 4, '고무 패팅 + 케이블 타이');
    this.counterText = this.add
      .text(width / 2, 122, `고무 덮기 0/${SECTORS}`, { fontFamily: FONT, fontSize: '30px', color: '#A98D80' })
      .setOrigin(0.5)
      .setDepth(8);

    // 1부: 자동 패팅 시작 버튼
    this.patButton = makeButton(this, width / 2, this.scale.height * 0.75, '고무 패팅 하기', () => this.startAutoPat(), {
      fontSize: '40px',
      padX: 56,
      padY: 24,
    });

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this); // 캔버스 밖 릴리즈 대비
  }

  // [고무 패팅 하기]: 8구역이 차례로 착착 덮이는 자동 연출
  startAutoPat() {
    if (this.phase !== 'pat') return;
    this.phase = 'pat-run';
    this.patButton.disableInteractive().setVisible(false);
    if (this.patButton.labelText) this.patButton.labelText.setVisible(false);
    for (let i = 0; i < SECTORS; i++) {
      this.time.delayedCall(AUTO_PAT_GAP_MS * i, () => this.coverSector(i));
    }
  }

  // ─── 입력 ───

  onDown(pointer) {
    if (this.phase === 'tie' && !this.tieDrag) {
      this.tieDrag = { pointer, pointerId: pointer.id, lastY: pointer.y };
    }
  }

  onMove(pointer) {
    if (this.phase !== 'tie') return;
    // 페이즈 전환 전부터 눌려 있던 손가락(8번째 탭을 안 뗀 손, 교대 스와이프의 둘째 손)도
    // 세션으로 채택한다 — pointerdown만 기다리면 그 스와이프가 통째로 씹힌다 (리뷰 확정 결함 수정)
    if (!this.tieDrag && pointer.isDown) {
      this.tieDrag = { pointer, pointerId: pointer.id, lastY: pointer.y };
      return; // 이번 이벤트는 기준점 설정만
    }
    if (!this.tieDrag || this.tieDrag.pointerId !== pointer.id || !pointer.isDown) return;
    const dy = pointer.y - this.tieDrag.lastY;
    this.tieDrag.lastY = pointer.y;
    if (dy <= 0) return; // 래칫: 위로는 되돌아가지 않는다

    this.addTie(Math.min(dy, TIE_DRAG_MAX_STEP) / TIE_PULL_DIST);
  }

  onUp(pointer) {
    if (this.tieDrag && this.tieDrag.pointerId === pointer.id) this.tieDrag = null;
  }

  // ─── 1부: 고무 패팅 ───

  coverSector(idx) {
    this.covered[idx] = true;
    this.coveredCount++;
    this.counterText.setText(`고무 덮기 ${this.coveredCount}/${SECTORS}`);

    // 패치: 구역 무게중심 자리에 "팟" 하고 눌러붙는 팝 연출
    const a0 = idx * this.step;
    const mid = a0 + this.step / 2;
    const half = this.step / 2;
    const d = (2 / 3) * PATCH_R * (Math.sin(half) / half);
    const cdx = Math.cos(mid) * d;
    const cdy = Math.sin(mid) * d;

    let patch;
    if (this.textures.exists('rubber_patch')) {
      // 실에셋 고무 시트를 랜덤 회전으로 얹어 유기적으로 덮는다
      patch = this.add.image(cdx, cdy, 'rubber_patch');
      patch.setDisplaySize(168, (patch.height * 168) / patch.width);
      patch.setRotation(mid + Math.PI / 2 + Phaser.Math.FloatBetween(-0.35, 0.35));
    } else {
      patch = this.add.graphics({ x: cdx, y: cdy });
      patch.fillStyle(RUBBER_COLOR, 0.92);
      patch.slice(-cdx, -cdy, PATCH_R, a0, a0 + this.step);
      patch.fillPath();
    }
    const fx = patch.scaleX;
    const fy = patch.scaleY;
    patch.setScale(fx * 0.55, fy * 0.55).setAlpha(0);
    // 타이보다 아래에 깔리도록 tieGfx 앞에 끼워 넣는다
    this.ballGroup.addAt(patch, this.ballGroup.getIndex(this.tieGfx));
    this.tweens.add({ targets: patch, scaleX: fx, scaleY: fy, alpha: 1, duration: 150, ease: 'Back.easeOut' });

    playSfx('rubber_pat');
    // 빠른 연속 탭으로 스퀴시 트윈이 겹치면 yoyo 복귀값이 오염되어 스케일이 커진 채
    // 남는다 — 항상 기준 스케일에서 새로 시작한다 (리뷰 확정 결함 수정)
    this.tweens.killTweensOf(this.ballGroup);
    this.ballGroup.setScale(1);
    this.tweens.add({ targets: this.ballGroup, scale: 1.025, duration: 60, yoyo: true });

    if (this.coveredCount === SECTORS) {
      this.phase = 'tie-wait';
      console.log(`[Stage3] 고무 패팅 완료 ${SECTORS}/${SECTORS}`);
      this.time.delayedCall(PAT_TO_TIE_DELAY, () => this.startTiePhase());
    }
  }

  // ─── 2부: 케이블 타이 ───

  startTiePhase() {
    this.phase = 'tie';
    this.counterText.setText('케이블 타이');
    this.drawTie(0);

    // 아래로 당기라는 무언(텍스트 없는) 힌트 화살표 — 첫 당김에 사라진다
    this.hintArrow = this.add.graphics({ x: BALL_X, y: 880 }).setDepth(6);
    this.hintArrow.fillStyle(0xb8a093, 0.9);
    this.hintArrow.fillTriangle(-26, 0, 26, 0, 0, 34);
    this.hintArrow.fillRect(-9, -34, 18, 30);
    this.tweens.add({ targets: this.hintArrow, y: 905, alpha: 0.35, duration: 600, yoyo: true, repeat: -1 });
  }

  addTie(amount) {
    if (this.phase !== 'tie') return;
    this.tieProgress = Math.min(1, this.tieProgress + amount);
    this.drawTie(this.tieProgress);

    if (this.hintArrow && this.tieProgress > 0.05) {
      this.tweens.killTweensOf(this.hintArrow);
      this.hintArrow.destroy();
      this.hintArrow = null;
    }

    // 래칫 틱: 진행도가 틱 지점을 넘을 때마다 재생. 갈수록 간격이 좁아지고 피치가 오른다.
    // 한 이벤트에 여러 지점을 넘으면 최대 N개만 즉시 재생하고 나머지는 다음 이벤트에서
    // 이어져 "따다닥" 연속 래칫으로 들린다.
    let played = 0;
    while (this.tieProgress >= this.nextTickAt && this.nextTickAt <= 1 && played < TICKS_PER_EVENT_MAX) {
      playSfx('tie_tick', { rate: 1 + this.nextTickAt * 0.35, volume: 0.9 });
      const step = Math.max(TICK_STEP_MIN, TICK_STEP_MAX * (1 - TICK_NARROWING * this.nextTickAt));
      this.nextTickAt += step;
      this.tickCount++;
      played++;
    }

    if (this.tieProgress >= 1) this.finishTie();
  }

  drawTie(p) {
    const rx = Phaser.Math.Linear(SHELL_R + 30, SHELL_R * 0.62, p);
    const ry = rx * 0.34;
    const g = this.tieGfx;
    g.clear();
    // 링 (공 허리를 감는 밴드)
    g.lineStyle(11, TIE_COLOR, 1);
    g.strokeEllipse(0, 0, rx * 2, ry * 2);
    g.lineStyle(3, 0xc9c9bd, 0.7); // 밴드 음영선
    g.strokeEllipse(0, 0, rx * 2 - 10, ry * 2 - 8);
    // 버클과 꼬리: 당길수록 빠져나온 꼬리가 길어진다
    g.fillStyle(TIE_COLOR, 1);
    g.fillRect(-10, ry - 7, 20, 28);
    g.fillRect(-5, ry + 19, 10, 46 + p * 130);
  }

  finishTie() {
    this.phase = 'done';
    this.tieDrag = null;
    this.counterText.setText('완성!');

    // 빠른 플릭으로 완주하면 이벤트당 상한(TICKS_PER_EVENT_MAX)에 걸려 이월된
    // 종반 밀집 틱이 남는다 — 폐기하지 않고 빠르게 몰아서 재생한 뒤 지익으로 마무리
    // (리뷰 확정 결함 수정: "당길수록 촘촘해지는" 마지막 틱들이 무음으로 사라지던 문제)
    let flushDelay = 0;
    let flushed = 0;
    while (this.nextTickAt <= 1 && flushed < 6) {
      const at = this.nextTickAt;
      flushDelay += 30;
      this.time.delayedCall(flushDelay, () => playSfx('tie_tick', { rate: 1 + at * 0.35, volume: 0.9 }));
      const step = Math.max(TICK_STEP_MIN, TICK_STEP_MAX * (1 - TICK_NARROWING * at));
      this.nextTickAt += step;
      this.tickCount++;
      flushed++;
    }
    console.log(
      `[Stage3] 조임 완료 — 래칫 틱 ${this.tickCount}회(마무리 몰아치기 ${flushed}회 포함), 기준 ${TIE_PULL_DIST}px`
    );

    // 지익 + 스퀴시는 마무리 틱들이 끝난 직후에
    const zipAt = flushDelay + (flushed > 0 ? 40 : 0);
    this.time.delayedCall(zipAt, () => {
      playSfx('tie_zip');
      this.cameras.main.shake(70, 0.0025);
      this.tweens.add({
        targets: this.ballGroup,
        scaleX: 1.14,
        scaleY: 0.85,
        duration: 150,
        yoyo: true,
        repeat: 1,
        ease: 'Sine.easeInOut',
        onComplete: () => this.ballGroup.setScale(1.03, 0.97), // 조여진 느낌으로 아주 살짝 눌린 채 유지
      });
    });

    this.time.delayedCall(zipAt + FINISH_TO_NEXT_MS, () => fadeToScene(this, 'Stage4'));
  }

  // ─── 프레임 루프 ───

  update() {
    // up 이벤트를 놓친 스와이프 세션 자가 복구
    if (this.tieDrag && !this.tieDrag.pointer.isDown) this.tieDrag = null;
  }
}
