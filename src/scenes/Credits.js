import Phaser from 'phaser';
import { FONT, COLOR, makeButton, fadeIn, fadeToScene } from '../systems/ui.js';

// 개발자 정보 씬 (P6 — 규칙: CLAUDE.md 7장)
//
// 스크린샷은 OS 기능이라 웹에서 차단 불가. 본 조치는 억제책일 뿐.
// - 표시 항목은 사진·소속 텍스트·이메일 세 가지가 전부다 (재학증명서 없음)
// - 사진은 DOM <img> 요소 없이 Phaser 텍스처(캔버스 렌더)로만 표시
// - 캡처 방지 명목의 외부 스크립트·라이브러리는 추가하지 않는다

// 이메일: 크롤링 봇 수집 억제를 위해 3조각으로 나눠 런타임에 조립 (mailto 링크 없음)
const EMAIL_PARTS = ['yehab', '1102', '@gmail.com'];

const PHOTO_W = 340; // 사진 표시 폭 (720 기준)
const PHOTO_RADIUS = 24; // 둥근 모서리

export default class Credits extends Phaser.Scene {
  constructor() {
    super('Credits');
  }

  create() {
    fadeIn(this);
    const { width, height } = this.scale;

    // ── 씬 한정 억제책: 우클릭/롱프레스 메뉴 차단 + 선택·콜아웃 금지 (씬 종료 시 원복) ──
    this.blockCtx = (e) => e.preventDefault();
    document.addEventListener('contextmenu', this.blockCtx);
    const cv = this.game.canvas;
    cv.style.userSelect = 'none';
    cv.style.webkitUserSelect = 'none';
    cv.style.webkitTouchCallout = 'none';

    // 탭 이탈 시 가림/블러, 복귀 시 해제 (visibilitychange)
    this.hiddenNow = false;
    this.onVis = () => (document.hidden ? this.hideContent() : this.showContent());
    document.addEventListener('visibilitychange', this.onVis);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('contextmenu', this.blockCtx);
      document.removeEventListener('visibilitychange', this.onVis);
      this.showContent(); // 블러/가림 잔존 방지
    });

    // ── 헤더 ──
    this.add
      .text(width / 2, 70, '개발자 정보', {
        fontFamily: FONT,
        fontSize: '40px',
        fontStyle: 'bold',
        color: COLOR.TEXT,
      })
      .setOrigin(0.5)
      .setDepth(8);

    // ── 사진 (Phaser 텍스처 — 텍스처가 없으면 자리표시 유지, 로드 실패로 죽지 않는다) ──
    const photoY = 440;
    let photoH = PHOTO_W * 1.4;
    if (this.textures.exists('dev_photo')) {
      const img = this.add.image(width / 2, photoY, 'dev_photo').setDepth(2);
      const scale = PHOTO_W / img.width;
      img.setScale(scale);
      photoH = img.height * scale;

      // 둥근 모서리 마스크 + 테두리
      const maskG = this.make.graphics({ x: 0, y: 0 }, false);
      maskG.fillStyle(0xffffff, 1);
      maskG.fillRoundedRect(width / 2 - PHOTO_W / 2, photoY - photoH / 2, PHOTO_W, photoH, PHOTO_RADIUS);
      img.setMask(maskG.createGeometryMask());
      const frame = this.add.graphics().setDepth(3);
      frame.lineStyle(6, 0xffffff, 1);
      frame.strokeRoundedRect(width / 2 - PHOTO_W / 2, photoY - photoH / 2, PHOTO_W, photoH, PHOTO_RADIUS);
    } else {
      const ph = this.add.graphics().setDepth(2);
      ph.fillStyle(0xe8d5c4, 1);
      ph.fillRoundedRect(width / 2 - PHOTO_W / 2, photoY - photoH / 2, PHOTO_W, photoH, PHOTO_RADIUS);
      this.add
        .text(width / 2, photoY, '사진 준비 중', { fontFamily: FONT, fontSize: '30px', color: '#A98D80' })
        .setOrigin(0.5)
        .setDepth(3);
    }

    // ── 소속·이름 + 이메일 (표시 항목은 여기까지가 전부 — CLAUDE.md 7장) ──
    this.add
      .text(width / 2, photoY + photoH / 2 + 74, '성균관대학교 전자전기공학부 2학년 신예하', {
        fontFamily: FONT,
        fontSize: '33px',
        fontStyle: 'bold',
        color: COLOR.TEXT,
      })
      .setOrigin(0.5)
      .setDepth(8);
    this.add
      .text(width / 2, photoY + photoH / 2 + 130, EMAIL_PARTS.join(''), {
        fontFamily: FONT,
        fontSize: '30px',
        color: '#A98D80',
      })
      .setOrigin(0.5)
      .setDepth(8);

    // ── 워터마크: 반투명 대각선 반복, 항상 사진 위에 겹친다 (depth 9) ──
    const now = new Date();
    const stamp = `확인용 · ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
    this.watermark = this.add.container(0, 0).setDepth(9);
    let row = 0;
    for (let y = -60; y < height + 140; y += 150) {
      const offsetX = row % 2 === 0 ? 0 : -130; // 벽돌식 엇갈림
      for (let x = -140 + offsetX; x < width + 200; x += 265) {
        this.watermark.add(
          this.add
            .text(x, y, stamp, {
              fontFamily: FONT,
              fontSize: '24px',
              color: '#FFFFFF', // 흰 본문 + 갈색 외곽선: 파스텔 배경과 사진 위 모두에서 보인다
              stroke: '#6D5147',
              strokeThickness: 3,
            })
            .setAlpha(0.22)
            .setRotation(-0.5)
        );
      }
      row++;
    }

    // ── 탭 이탈 가림막 (블러 미지원 렌더러에서도 확실히 가리는 기본 수단) ──
    this.privacyCover = this.add
      .rectangle(width / 2, height / 2, width, height, 0xfff1e6, 1)
      .setDepth(10)
      .setVisible(false);

    makeButton(this, width / 2, height * 0.88, '돌아가기', () => fadeToScene(this, 'Title'), {
      fontSize: '36px',
      padX: 56,
      padY: 22,
    });
  }

  // 탭 이탈: 캔버스 자체를 CSS 블러(컴포지터 레벨 — 숨김 중에도 앱 전환기 스냅샷에 반영)하고,
  // 가림막이 켜진 프레임을 수동으로 1회 렌더해 캔버스 버퍼에도 남긴다.
  // visibilitychange 시점에는 브라우저가 RAF를 이미 멈춰 일반 렌더 루프로는 그려지지
  // 않기 때문이다 (리뷰 확정 결함 수정 — 씬 오브젝트만으로는 스냅샷에 사진이 남는다)
  hideContent() {
    this.hiddenNow = true;
    this.privacyCover.setVisible(true);
    const cv = this.game.canvas;
    cv.style.filter = 'blur(28px)';
    cv.style.webkitFilter = 'blur(28px)';
    try {
      this.game.loop.step(window.performance.now()); // 가림막 포함 프레임 즉시 페인트
    } catch (e) {
      /* 수동 스텝이 실패해도 CSS 블러가 가려준다 */
    }
  }

  // 복귀: 해제
  showContent() {
    this.hiddenNow = false;
    if (this.privacyCover) this.privacyCover.setVisible(false);
    const cv = this.game.canvas;
    cv.style.filter = '';
    cv.style.webkitFilter = '';
  }
}
