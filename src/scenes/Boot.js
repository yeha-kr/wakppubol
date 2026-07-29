import Phaser from 'phaser';
import { addSceneLabel, addNextButton } from '../systems/ui.js';

// 부트 씬 (P0 골격)
// 게임 시작 시 가장 먼저 실행된다. 이후 Preload 화면에 필요한 최소 리소스
// 준비가 생기면 이 씬에서 처리한다.
export default class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    addSceneLabel(this, 'Boot');
    addNextButton(this, () => this.scene.start('Preload'));
  }
}
