import { defineConfig } from 'vite';

// assets/ 를 그대로 정적 서빙 → /models/*.glb, /photos/* 로 접근 (HTML↔GLB 경로 불일치 재발 방지)
// base './' 로 빌드하면 dist/ 를 python3 -m http.server 로도 열 수 있다.
export default defineConfig({
  base: './',
  publicDir: 'assets',
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    outDir: 'app',          // 빌드 결과(app/)는 저장소에 포함 → Node 없이 python3 -m http.server 로 열 수 있다
    emptyOutDir: true,
    copyPublicDir: false,   // 모델은 복사하지 않고 ../assets/models 를 직접 참조
  },
});
