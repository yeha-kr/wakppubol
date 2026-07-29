// 햅틱 (P1 — CLAUDE.md 2장)
// navigator.vibrate는 Android Chrome 전용이고 iOS 웹에는 진동 API 자체가 없다.
// 반드시 이 모듈을 거쳐 기능 감지 후 호출한다. iOS 보완은 사운드 + 카메라 셰이크.

export const VIB_SMALL = 10; // 탭 크랙: 10ms
export const VIB_BIG = [20, 30, 40]; // 큰 크랙·구역 분리: 패턴

export function vibrate(pattern) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      // 일부 브라우저의 정책 거부(사용자 제스처 밖 호출 등)는 조용히 무시
    }
  }
}
