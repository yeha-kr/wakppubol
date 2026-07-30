import Phaser from 'phaser';
import { COLOR } from './systems/ui.js';
import Boot from './scenes/Boot.js';
import Preload from './scenes/Preload.js';
import Title from './scenes/Title.js';
import Stage1 from './scenes/Stage1.js';
import Stage2 from './scenes/Stage2.js';
import Stage3 from './scenes/Stage3.js';
import Stage4 from './scenes/Stage4.js';
import Result from './scenes/Result.js';
import Credits from './scenes/Credits.js';

// 기준 해상도: 세로 720×1280, FIT + CENTER_BOTH (CLAUDE.md 2장)
const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 720,
  height: 1280,
  backgroundColor: COLOR.BG, // 파스텔톤 단색 배경
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // 두 엄지 연타(멀티터치) 대응: 기본 포인터 수로는 교차 연타가 씹힐 수 있다 (P1)
  input: { activePointers: 3 },
  scene: [Boot, Preload, Title, Stage1, Stage2, Stage3, Stage4, Result, Credits],
};

const game = new Phaser.Game(config);

// 콘솔 디버깅·자동 검증용 핸들 (민감정보 아님 — 개발자도구로 어차피 접근 가능한 객체)
window.__game = game;
