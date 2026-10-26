import { defineConfig } from 'vite';
import { rmSync } from 'node:fs';

// assets/ 를 그대로 정적 서빙 → /models/*.glb, /photos/* 로 접근 (HTML↔GLB 경로 불일치 재발 방지)
// base './' 로 빌드하면 dist/ 를 python3 -m http.server 로도 열 수 있다.
export default defineConfig({
  base: './',
  publicDir: 'assets',
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [{
    name: 'drop-original-from-dist',
    closeBundle() { try { rmSync('dist/original', { recursive: true, force: true }); } catch {} },
  }],
});
