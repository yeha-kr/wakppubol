import Phaser from 'phaser';
import { addSceneLabel, addNextButton } from '../systems/ui.js';

// 타이틀 씬 (P0 골격)
// P5에서 로고 "왁뿌볼" + [시작]/[개발자 정보] 버튼으로 교체 예정.
export default class Title extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create() {
    addSceneLabel(this, 'Title');
    addNextButton(this, () => this.scene.start('Stage1'));
  }
}
