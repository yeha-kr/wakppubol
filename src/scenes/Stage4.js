import Phaser from 'phaser';
import { FONT, addStageHeader, fadeIn, fadeToScene, addBackground, lightenColor } from '../systems/ui.js';
import { playSfx } from '../systems/audio.js';
import { vibrate, VIB_SMALL, VIB_BIG } from '../systems/haptics.js';

// Stage 4 — 왁뿌볼 금내기 (P1 프로토타입 → 사용자 피드백으로 모델 확정)
// 실제 왁뿌볼은 왁스 껍질에 "금만 가는" 것이다 — 껍질이 부서지거나 떨어져 나가지 않는다.
// 금은 RenderTexture 셸에 영구히 새겨지고, 구역이 충분히 갈라지면 굵은 금 클러스터 +
// 미세 부스러기만 살짝 날린다. 12부위 전부 금이 가면 완성.
// 조작: 탭 = small / 연타 = mid 사운드 / 300ms+ 길게 눌렀다 떼기 = big
// 진동은 Android 전용이므로 iOS 보완으로 카메라 셰이크를 함께 쓴다 (CLAUDE.md 2장)

// ─── 튜닝 상수 (조정 시 변경 전/후 값을 보고할 것 — CLAUDE.md 8.5·8.6) ───
const BALL_RATIO = 0.6; // 공 지름 = 화면 폭 × 0.6
const SECTORS = 12; // 셸 구역 수
const SECTOR_HP = 5; // 구역 분리 임계 데미지
const TAP_DAMAGE = 2; // 탭 데미지 (1→2: 완파 시간 절반 — 사용자 피드백)
const HOLD_DAMAGE = 6; // 홀드 릴리즈 데미지 (3→6: 탭의 3배 비율 유지)
const HOLD_MS = 300; // 길게 누르기 판정 기준(ms)
const TOUCH_TOLERANCE = 1.15; // 공 반지름 대비 터치 인정 배율 (살짝 빗나가도 인정)
const RAPID_WINDOW_MS = 900; // 연타 판정 창(ms)
const RAPID_COUNT = 3; // 창 안 탭 수가 이 값 이상이면 연타(mid 사운드)
const SHARD_GRAVITY = 2600; // 부스러기 중력(px/s²)
const FINALE_DELAY_MS = 1000; // 완파 연출 후 Result 전환까지(ms)
const CLAY_FALLBACK = 0xd96c5f; // Stage1 미구현 동안 쓰는 속 점토 기본색

export default class Stage4 extends Phaser.Scene {
  constructor() {
    super('Stage4');
  }

  create() {
    fadeIn(this);
    addBackground(this);
    const { width, height } = this.scale;
    this.cx = width / 2;
    this.cy = height * 0.45;
    this.R = (width * BALL_RATIO) / 2;
    this.step = (Math.PI * 2) / SECTORS;

    this.finished = false;
    this.brokenCount = 0;
    this.hitCount = 0; // 튜닝 근거용 데미지 이벤트 수
    this.flying = []; // 분리되어 낙하 중인 조각 { g, vx, vy, vr }
    this.presses = new Map(); // pointer.id → { pointer, x0, y0, t0 }
    this.tapTimes = []; // 연타 판정용 최근 탭 시각
    this.startedAt = this.time.now;

    // 속 점토 공 — Stage1에서 만든 혼합 색이 노출된다 (registry 연동, P5)
    const regClay = this.registry.get('clayColors');
    const clayColor = regClay && typeof regClay.mixed === 'number' ? regClay.mixed : CLAY_FALLBACK;
    this.clayColor = clayColor;
    this.clayBall = this.textures.exists('ball_core')
      ? this.add
          .image(this.cx, this.cy, 'ball_core')
          .setDisplaySize(this.R * 0.92 * 2, this.R * 0.92 * 2)
          .setTint(lightenColor(clayColor, 0.45))
          .setDepth(0)
      : this.add.circle(this.cx, this.cy, this.R * 0.92, clayColor).setDepth(0);

    // ── 셸: 통짜 반투명 왁스 껍질 (조각선 없음) ──
    // RenderTexture에 한 덩어리로 그려두고, 금(크랙)은 이 텍스처에 영구히 새겨 넣는다.
    // 껍질은 절대 부서지지 않는다 — 금만 쌓인다. 내부 데미지 모델은 12구역 그대로.
    this.rtSize = (this.R + 24) * 2;
    this.shellRT = this.add.renderTexture(this.cx, this.cy, this.rtSize, this.rtSize).setOrigin(0.5).setDepth(1);
    const base = this.add.graphics().setVisible(false);
    base.fillStyle(0xffffff, 0.62);
    base.fillCircle(0, 0, this.R);
    base.lineStyle(6, 0xffffff, 0.5); // 왁스 림 하이라이트
    base.strokeCircle(0, 0, this.R - 4);
    base.fillStyle(0xffffff, 0.55); // 광택
    base.fillEllipse(-this.R * 0.34, -this.R * 0.42, this.R * 0.52, this.R * 0.34);
    this.shellRT.draw(base, this.rtSize / 2, this.rtSize / 2);
    base.destroy();

    // 금이 셸 밖(투명 여백)으로 번지지 않게 원형 마스크로 클립한다
    this.shellMaskG = this.make.graphics({ x: this.cx, y: this.cy }, false);
    this.shellMaskG.fillStyle(0xffffff, 1);
    this.shellMaskG.fillCircle(0, 0, this.R + 3);
    this.shellRT.setMask(this.shellMaskG.createGeometryMask());

    this.sectors = [];
    for (let i = 0; i < SECTORS; i++) {
      this.sectors.push({ dmg: 0, broken: false, mid: i * this.step + this.step / 2 });
    }

    // 홀드 게이지 링 (update에서 매 프레임 다시 그림)
    this.gaugeGfx = this.add.graphics().setDepth(4);

    // HUD (피날레 줌 때 함께 숨길 수 있게 목록으로 관리)
    this.hudItems = addStageHeader(this, 4, 4, '왁뿌볼 금내기');
    this.counterText = this.add
      .text(width / 2, 122, '', { fontFamily: FONT, fontSize: '30px', color: '#A98D80' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(5);
    this.hudItems.push(this.counterText);
    this.updateCounter();
    const bottomHint = this.add
      .text(width / 2, height * 0.87, '탭 · 연타 · 길게 눌렀다 떼기!', {
        fontFamily: FONT,
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#6D5147',
        backgroundColor: 'rgba(255,241,230,0.75)', // 배경 일러스트 위 가독성
        padding: { x: 18, y: 8 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(5);
    this.hudItems.push(bottomHint);

    // FPS 표시 (개발 빌드 전용 — 완료 기준 55fps 확인용)
    if (import.meta.env.DEV) {
      this.fpsText = this.add
        .text(width - 16, 44, '', { fontFamily: FONT, fontSize: '22px', color: '#B08A7A' })
        .setOrigin(1, 0.5)
        .setScrollFactor(0)
        .setDepth(5);
      this.fpsAccum = 0;
      this.hudItems.push(this.fpsText);
    }

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointerup', this.onUp, this);
    // 캔버스 밖(레터박스)에서 릴리즈해도 홀드 크랙이 소실되지 않게 (리뷰 확정 결함 수정)
    this.input.on('pointerupoutside', this.onUp, this);
  }

  // ─── 입력 ───

  onDown(pointer) {
    if (this.finished) return;
    if (!this.inBall(pointer.x, pointer.y)) return; // 공 밖 터치는 무시
    this.presses.set(pointer.id, { pointer, x0: pointer.x, y0: pointer.y, t0: this.time.now });
  }

  onUp(pointer) {
    const st = this.presses.get(pointer.id);
    if (!st) return;
    this.presses.delete(pointer.id);
    if (this.finished) return;

    // 크랙 위치: 릴리즈 지점이 공 안이면 거기, 아니면(드래그 이탈) 누른 지점
    let x = pointer.x;
    let y = pointer.y;
    if (!this.inBall(x, y)) {
      x = st.x0;
      y = st.y0;
    }

    const held = this.time.now - st.t0;
    if (held >= HOLD_MS) {
      // 길게 눌렀다 떼기 = big 크랙
      this.applyDamage(x, y, HOLD_DAMAGE, 'big');
      return;
    }

    // 탭: 연타면 mid 사운드 (PLAN 6장 "빠른 연타 = 중간 크랙")
    const now = this.time.now;
    this.tapTimes = this.tapTimes.filter((t) => now - t < RAPID_WINDOW_MS);
    this.tapTimes.push(now);
    let kind = this.tapTimes.length >= RAPID_COUNT ? 'mid' : 'small';

    // 파괴 진행도가 높을수록 굵은 크랙 사운드 비중을 늘린다 (PLAN 7.2 — 사운드만 승격)
    const progress = this.brokenCount / SECTORS;
    if (kind === 'small' && Math.random() < progress * 0.5) kind = 'mid';
    else if (kind === 'mid' && Math.random() < progress * 0.35) kind = 'big';

    this.applyDamage(x, y, TAP_DAMAGE, kind);
  }

  inBall(x, y) {
    const dx = x - this.cx;
    const dy = y - this.cy;
    return Math.sqrt(dx * dx + dy * dy) <= this.R * TOUCH_TOLERANCE;
  }

  // ─── 데미지 모델 ───

  sectorAt(x, y) {
    const a = Phaser.Math.Angle.Normalize(Math.atan2(y - this.cy, x - this.cx));
    return Math.min(SECTORS - 1, Math.floor(a / this.step));
  }

  // 이미 분리된 구역을 치면 각도상 가장 가까운 성한 구역으로 넘긴다 (빈 곳 탭이 죽은 입력이 되지 않게)
  nearestIntact(fromIdx) {
    const fromAngle = this.sectors[fromIdx].mid;
    let best = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < SECTORS; i++) {
      const s = this.sectors[i];
      if (s.broken) continue;
      const d = Math.abs(Math.atan2(Math.sin(s.mid - fromAngle), Math.cos(s.mid - fromAngle)));
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    return best;
  }

  applyDamage(x, y, dmg, kind) {
    let idx = this.sectorAt(x, y);
    if (this.sectors[idx].broken) {
      idx = this.nearestIntact(idx);
      if (idx < 0) return; // 전 구역 분리(피날레 진행 중)
    }
    const s = this.sectors[idx];
    s.dmg += dmg;
    this.hitCount++;

    this.drawCrack(x, y, kind);
    playSfx(kind === 'big' ? 'crack_big' : kind === 'mid' ? 'crack_mid' : 'crack_small', {
      volume: kind === 'big' ? 1 : kind === 'mid' ? 0.95 : 0.85,
    });
    vibrate(kind === 'big' ? VIB_BIG : VIB_SMALL);
    if (kind === 'big') this.cameras.main.shake(70, 0.003);

    if (!s.broken && s.dmg >= SECTOR_HP) {
      this.separateSector(idx, kind === 'big'); // big으로 깼으면 분리음의 big은 생략(중복 방지)
    }
  }

  // 터치 지점의 지그재그 금을 셸 텍스처에 영구히 새겨 넣는다
  // (오브젝트로 쌓지 않으므로 개수 제한 없이 프레임 비용 0 — 금이 계속 누적된다)
  drawCrack(x, y, kind) {
    const g = this.add.graphics().setVisible(false);
    const baseRot = Math.random() * Math.PI * 2; // 랜덤 회전은 방향에 직접 반영

    const strands =
      kind === 'big' ? Phaser.Math.Between(6, 8) : kind === 'mid' ? Phaser.Math.Between(4, 6) : Phaser.Math.Between(3, 5);
    const lenMin = kind === 'big' ? 85 : kind === 'mid' ? 60 : 45;
    const lenMax = kind === 'big' ? 135 : kind === 'mid' ? 95 : 75;
    const w = kind === 'big' ? 5 : kind === 'mid' ? 4 : 3;

    for (let i = 0; i < strands; i++) {
      const dir = baseRot + (Math.PI * 2 * i) / strands + Phaser.Math.FloatBetween(-0.3, 0.3);
      const len = Phaser.Math.FloatBetween(lenMin, lenMax);
      const segs = Phaser.Math.Between(4, 6);
      const pts = [{ x: 0, y: 0 }];
      for (let si = 1; si <= segs; si++) {
        const r = (len * si) / segs;
        const jitter = Phaser.Math.FloatBetween(-9, 9); // 지그재그 꺾임
        pts.push({
          x: Math.cos(dir) * r - Math.sin(dir) * jitter,
          y: Math.sin(dir) * r + Math.cos(dir) * jitter,
        });
      }
      // 흰 셸 위에서 흰 선만 그리면 안 보여서, 어두운 밑선 + 흰 본선 2겹으로 그린다
      g.lineStyle(w + 3, 0x6b5147, 0.35);
      g.strokePoints(pts, false, false);
      g.lineStyle(w, 0xffffff, 0.95);
      g.strokePoints(pts, false, false);
    }

    this.shellRT.draw(g, this.rtSize / 2 + (x - this.cx), this.rtSize / 2 + (y - this.cy));
    g.destroy();
  }

  // 구역 금내기 완료: 껍질은 그대로 두고 굵은 금 클러스터를 새기고 미세 부스러기만 날린다
  separateSector(idx, skipBigSound) {
    const s = this.sectors[idx];
    s.broken = true;
    this.brokenCount++;
    this.updateCounter();

    // 구역 중심부에 굵은 금 + 잔금을 겹쳐 새긴다 ("쩌적" 하고 크게 갈라진 자리)
    const d = this.R * 0.62;
    const gx = this.cx + Math.cos(s.mid) * d;
    const gy = this.cy + Math.sin(s.mid) * d;
    this.drawCrack(gx, gy, 'big');
    this.drawCrack(
      gx + Phaser.Math.FloatBetween(-34, 34),
      gy + Phaser.Math.FloatBetween(-34, 34),
      'mid'
    );

    this.spawnFlakes(gx, gy, Phaser.Math.Between(4, 6));

    if (!skipBigSound) playSfx('crack_big');
    this.time.delayedCall(Phaser.Math.Between(60, 140), () => playSfx('shard'));
    vibrate(VIB_BIG);
    // force=true: 같은 프레임에 앞선 약한 셰이크가 있어도 굵은 셰이크가 무시되지 않게 (리뷰 확정)
    this.cameras.main.shake(100, 0.005, true);

    if (this.brokenCount === SECTORS) this.finale();
  }

  // 미세 왁스 부스러기 — 금이 갈 때 살짝 떨어지는 가루 느낌 (껍질 조각이 아니다)
  spawnFlakes(x, y, n) {
    for (let i = 0; i < n; i++) {
      const g = this.add
        .graphics({ x: x + Phaser.Math.FloatBetween(-20, 20), y: y + Phaser.Math.FloatBetween(-20, 20) })
        .setDepth(3);
      g.fillStyle(0xffffff, 0.75);
      const r = Phaser.Math.FloatBetween(4, 9);
      g.fillTriangle(-r, r * 0.6, r, r * 0.4, Phaser.Math.FloatBetween(-3, 3), -r);
      this.flying.push({
        g,
        vx: Phaser.Math.FloatBetween(-140, 140),
        vy: Phaser.Math.FloatBetween(-220, -60),
        vr: Phaser.Math.FloatBetween(-6, 6),
        fade: true,
      });
    }
  }

  // 완성: 12부위 전부 금이 갔다 → 클로즈업 + 마지막 "쩌저적" → 1초 뒤 Result
  // (껍질은 끝까지 붙어 있다 — 금으로 뒤덮인 왁뿌볼이 완성품)
  finale() {
    this.finished = true;
    const took = (this.time.now - this.startedAt) / 1000;
    console.log(
      `[Stage4] 금내기 완성 ${took.toFixed(1)}초, 데미지 이벤트 ${this.hitCount}회 ` +
        `(임계값: 구역HP ${SECTOR_HP} × ${SECTORS}구역)`
    );

    this.cameras.main.pan(this.cx, this.cy, 350, 'Sine.easeInOut');
    this.cameras.main.zoomTo(1.18, 350, 'Sine.easeInOut');
    // 줌은 scrollFactor(0)에도 적용되어 HUD가 화면 밖으로 밀린다 — 클로즈업 동안 페이드 아웃 (리뷰 확정)
    this.tweens.add({ targets: this.hudItems, alpha: 0, duration: 200 });
    this.tweens.add({
      targets: [this.clayBall, this.shellRT, this.shellMaskG],
      scaleX: '*=1.08',
      scaleY: '*=1.08',
      duration: 160,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeInOut',
    });
    this.spawnFlakes(this.cx, this.cy - this.R * 0.3, 12);

    // big 1회 + shard 3~5개를 30~80ms 랜덤 간격으로 겹쳐 "와르르" 질감
    playSfx('crack_big');
    const shards = Phaser.Math.Between(3, 5);
    let t = 0;
    for (let i = 0; i < shards; i++) {
      t += Phaser.Math.Between(30, 80);
      this.time.delayedCall(t, () => playSfx('shard'));
    }
    vibrate(VIB_BIG);
    this.cameras.main.shake(200, 0.008, true); // 직전 셰이크가 돌고 있어도 강제 시작 (리뷰 확정)

    this.time.delayedCall(FINALE_DELAY_MS, () => fadeToScene(this, 'Result'));
  }

  updateCounter() {
    this.counterText.setText(`남은 부위 ${SECTORS - this.brokenCount}/${SECTORS}`);
  }

  // ─── 프레임 루프 ───

  update(time, delta) {
    const dt = Math.min(delta, 50) / 1000; // 프레임 스파이크 시 물리 폭주 방지

    // 부스러기 낙하 (서서히 옅어지며 사라진다)
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.vy += SHARD_GRAVITY * dt;
      f.g.x += f.vx * dt;
      f.g.y += f.vy * dt;
      f.g.rotation += f.vr * dt;
      if (f.fade) f.g.alpha -= dt * 1.1;
      if (f.g.alpha <= 0 || f.g.y > this.scale.height + 300) {
        f.g.destroy();
        this.flying.splice(i, 1);
      }
    }

    // 홀드 게이지 링: 진행률 표시, 가득 차면 금색
    this.gaugeGfx.clear();
    if (!this.finished) {
      for (const [id, st] of this.presses) {
        if (!st.pointer.isDown) {
          this.presses.delete(id); // 캔버스 밖 릴리즈 등으로 up을 놓친 경우 자가 복구
          continue;
        }
        const held = this.time.now - st.t0;
        if (held < 80) continue; // 짧은 탭에는 링을 그리지 않는다
        const p = Math.min(held / HOLD_MS, 1);
        const px = st.pointer.x;
        const py = st.pointer.y;
        this.gaugeGfx.lineStyle(9, p >= 1 ? 0xffc95c : 0xffffff, 0.9);
        this.gaugeGfx.beginPath();
        this.gaugeGfx.arc(px, py, 48, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        this.gaugeGfx.strokePath();
        if (p >= 1) {
          // "지금 떼면 big" 준비 완료 표시
          this.gaugeGfx.lineStyle(3, 0xffc95c, 0.35);
          this.gaugeGfx.beginPath();
          this.gaugeGfx.arc(px, py, 58, 0, Math.PI * 2);
          this.gaugeGfx.strokePath();
        }
      }
    }

    // FPS (개발 빌드 전용)
    if (this.fpsText) {
      this.fpsAccum += delta;
      if (this.fpsAccum > 400) {
        this.fpsAccum = 0;
        this.fpsText.setText(`${Math.round(this.game.loop.actualFps)} fps`);
      }
    }
  }
}
