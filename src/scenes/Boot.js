import Phaser from 'phaser';

// 부트 씬 — 즉시 Preload로 넘어간다 (P5에서 골격 버튼 제거).
// 이후 Preload 화면에 쓸 최소 리소스가 생기면 이 씬에서 로드한다.
export default class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    this.scene.start('Preload');
  }
}
