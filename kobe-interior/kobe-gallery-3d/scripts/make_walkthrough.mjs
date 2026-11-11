// 둘러보기 영상 만들기 — 빌드된 app/ 을 Playwright(Chromium, swiftshader)로 열어 src/tour.js 경로대로 프레임을 찍고 ffmpeg 로 mp4 를 만든다.
//   node scripts/make_walkthrough.mjs [--fps 24] [--w 1280] [--h 720] [--out screenshots/walkthrough_E.mp4] [--slot E]
import { spawn, execFileSync } from 'node:child_process'; import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const FPS = +arg('fps', 24), W = +arg('w', 1280), H = +arg('h', 720), LIMIT = +arg('limit', 0), OUT = arg('out', 'screenshots/walkthrough_E.mp4'), SLOT = arg('slot', 'E');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const PORT = 4197 + Math.floor(Math.random() * 100);
const frames = fs.mkdtempSync(path.join(root, 'screenshots', '.frames-')); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore', detached: true });
const cleanup = () => { try { process.kill(-server.pid); } catch {} }; process.on('exit', cleanup); await wait(1200);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 }); page.setDefaultTimeout(180000);
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://127.0.0.1:${PORT}/app/`); await page.waitForFunction(() => window.__viewerReady === true);
await page.addStyleTag({ content: 'header, #panel, #toast, #loading { display: none !important } canvas { cursor: none }' });
await page.evaluate((slot) => { window.__switchSlot(slot); document.querySelector('button[data-mode=interior]').click(); }, SLOT);
await page.waitForFunction(() => !window.__viewer.loadingCount); await wait(800);
await page.evaluate((mirrorPx) => { window.__tourPresentation(true); const V = window.__viewer; V.controls.enableDamping = false; if (window.__editor) { window.__editor.autoHide = false; window.__editor._autoHidden = new Set(); window.__editor.applyHidden(); }
  // 속도: 거울(Reflector)은 장면을 한 번 더 그리므로 반사 해상도를 낮추고, 자동 렌더 루프를 멈춘 뒤 프레임마다 한 번만 그린다
  let n = 0; V.scene.traverse((o) => { if (o.isReflector && o.getRenderTarget) { o.getRenderTarget().setSize(mirrorPx, mirrorPx); n++; } }); V.contextLost = true; V.renderer.setPixelRatio(1); V.resize?.(); window.__mirrors = n; }, +process.env.MIRROR_PX || 256);
console.log('거울(Reflector)', await page.evaluate(() => window.__mirrors), '개 → 반사 해상도 낮춤');
const dur = await page.evaluate(() => window.__tourDuration); const N = LIMIT || Math.ceil(dur * FPS) + FPS;   // 끝에 1초 멈춤 (--limit N: 시험용)
console.log(`길이 ${dur}s × ${FPS}fps = ${N} 프레임, ${W}×${H} → ${OUT}`); const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const t = Math.min(i / FPS, dur); await page.evaluate((t) => { window.__tourAt(t); const V = window.__viewer; V.camera.updateMatrixWorld(); V.renderer.render(V.scene, V.camera); }, t);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  await page.screenshot({ path: path.join(frames, `f${String(i).padStart(5, '0')}.png`), type: 'png' });
  if (i % (FPS * 5) === 0 || LIMIT) console.log(`  ${i}/${N}  t=${t.toFixed(1)}s  (${((Date.now() - t0) / 1000).toFixed(0)}s 경과)`);
}
await browser.close(); cleanup();
fs.mkdirSync(path.dirname(path.join(root, OUT)), { recursive: true });
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-preset', 'medium', '-movflags', '+faststart', path.join(root, OUT)], { stdio: 'inherit' });
fs.rmSync(frames, { recursive: true, force: true }); const mb = (fs.statSync(path.join(root, OUT)).size / 1048576).toFixed(1);
console.log(`✅ ${OUT} (${mb} MB, ${(N / FPS).toFixed(0)}초)`); process.exit(0);
