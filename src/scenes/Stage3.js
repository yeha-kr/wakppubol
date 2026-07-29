import Phaser from 'phaser';
import { addSceneLabel, addNextButton } from '../systems/ui.js';

// Stage 3 — 고무 패팅 + 케이블 타이 (P4에서 구현 예정, docs/PLAN.md 6장)
export default class Stage3 extends Phaser.Scene {
  constructor() {
    super('Stage3');
  }

  create() {
    addSceneLabel(this, 'Stage3');
    addNextButton(this, () => this.scene.start('Stage4'));
  }
}
