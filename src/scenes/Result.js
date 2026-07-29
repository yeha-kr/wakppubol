import Phaser from 'phaser';
import { addSceneLabel, addNextButton } from '../systems/ui.js';

// 결과 씬 (P5에서 "완성!"·소요 시간·다시 만들기 버튼 구현 예정)
export default class Result extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create() {
    addSceneLabel(this, 'Result');
    addNextButton(this, () => this.scene.start('Credits'));
  }
}
