import Phaser from 'phaser';
import { addSceneLabel, addNextButton } from '../systems/ui.js';

// 개발자 정보 씬 (P6에서 구현 예정, 규칙은 CLAUDE.md 7장)
// P0에서는 9개 씬 순회를 위해 [다음] → Title로 돌아간다.
// (P5에서 Title/Result의 [개발자 정보] 버튼으로 진입하도록 재구성 예정)
export default class Credits extends Phaser.Scene {
  constructor() {
    super('Credits');
  }

  create() {
    addSceneLabel(this, 'Credits');
    addNextButton(this, () => this.scene.start('Title'));
  }
}
