import { defineConfig } from 'vite';

// GitHub Pages 배포용 base (P8) — 미설정 시 배포 후 에셋 404가 나는 흔한 문제.
// dev/preview/build 모두 같은 경로를 쓰므로 로컬 접속 URL도 /wakppubol/ 이다.
export default defineConfig({
  base: '/wakppubol/',
});
