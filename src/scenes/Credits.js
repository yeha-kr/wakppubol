import Phaser from 'phaser';
import { addSceneLabel, addNextButton, fadeIn, fadeToScene } from '../systems/ui.js';

// 개발자 정보 씬 (P6에서 구현 예정, 규칙은 CLAUDE.md 7장)
// P5: Title/Result의 [개발자 정보] 버튼으로 진입하고, [다음]으로 Title에 돌아간다.
export default class Credits extends Phaser.Scene {
  constructor() {
    super('Credits');
  }

  create() {
    fadeIn(this);
    addSceneLabel(this, 'Credits');
    addNextButton(this, () => fadeToScene(this, 'Title'));
  }
}
