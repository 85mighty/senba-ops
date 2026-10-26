// 브라우저 검증 — vite preview 로 dist/ 를 띄우고 Chromium(Playwright)으로 4개 모드 + 토글을 실제 렌더링한다.
// 콘솔 오류·404·JS 예외를 모아 보고하고 screenshots/ 에 모드별 캡처를 남긴다. 실패 시 exit 1.
// 사용: npm run build && npm run test:browser
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { console.error('playwright 를 찾을 수 없습니다. (이 테스트는 선택 사항 — 수동으로 Chrome 에서 확인해도 됩니다)'); process.exit(2); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 4190; mkdirSync(path.join(root, 'screenshots'), { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill(); } catch {} } };
process.on('exit', stopServer); process.on('SIGINT', () => { stopServer(); process.exit(130); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview 시작 시간 초과')), 20000); server.stdout.on('data', (d) => { if (String(d).includes('http://')) { clearTimeout(t); res(); } }); server.stderr.on('data', (d) => process.stderr.write(d)); });

const problems = [];
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__viewerReady === true, null, { timeout: 60000 });
  const loaded = await page.evaluate(() => window.__loadedModels); const errs = await page.evaluate(() => window.__viewerErrors);
  console.log('불러온 모델:', loaded); if (errs.length) problems.push(...errs.map((e) => `viewer: ${e}`));
  const modes = ['original', 'cleaned', 'reconstructed', 'interior'];
  for (const m of modes) {
    await page.click(`button[data-mode=${m}]`); await wait(600);
    const f0 = await page.evaluate(() => window.__viewer.frames); await wait(400); const f1 = await page.evaluate(() => window.__viewer.frames);
    if (f1 <= f0) problems.push(`렌더 루프 정지 (mode=${m})`);
    const cam = await page.evaluate(() => window.__viewer.camera.position.toArray().map((v) => +v.toFixed(3)));
    await page.screenshot({ path: path.join(root, 'screenshots', `mode_${modes.indexOf(m) + 1}_${m}.png`) });
    console.log(`모드 ${m}: 카메라 ${JSON.stringify(cam)} · 프레임 ${f1 - f0}/0.4s`);
  }
  // 토글·북마크·단면
  await page.check('#hideCeiling'); await page.check('#showDims'); await wait(300); await page.screenshot({ path: path.join(root, 'screenshots', 'interior_section_dims.png') });
  await page.uncheck('#hideCeiling');
  // 큰 기둥 북마크로 이동한 뒤 실시간 반사 모드 캡처 (소프트웨어 GL 에선 매우 느리므로 캡처 후 환경맵으로 복귀)
  const bms = await page.$$('#bookmarks button'); for (const b of bms) { await b.click({ timeout: 10000 }); await wait(700); }
  await page.screenshot({ path: path.join(root, 'screenshots', 'interior_column_mirror_env.png') });
  await page.selectOption('#mirrorMode', 'reflector'); await wait(1500);
  await page.screenshot({ path: path.join(root, 'screenshots', 'interior_column_mirror_reflector.png'), timeout: 60000 });
  await page.selectOption('#mirrorMode', 'env'); await wait(800);
  await page.check('[data-layer=furniture]'); await page.check('[data-layer=wine_accent_optional]'); await wait(300);
  await page.screenshot({ path: path.join(root, 'screenshots', 'interior_options_on.png') });
  const counts = await page.evaluate(() => { const i = window.__interior; const o = {}; for (const k in i.layers) o[k] = i.layers[k].children.length; return o; });
  console.log('인테리어 레이어 객체 수:', counts);
  if (!counts.molding) problems.push('몰딩 프레임이 생성되지 않음'); if (!counts.mirror_4_sides) problems.push('거울이 생성되지 않음 (central_wide_column 확인)');
} finally { await browser.close(); stopServer(); }

if (problems.length) { console.error('\n❌ 문제 발견:'); problems.forEach((p) => console.error(' -', p)); process.exit(1); }
console.log('\n✅ 브라우저 검증 통과: 404/콘솔 오류 없음, 4개 모드 렌더링, 토글·북마크 동작. 캡처: screenshots/');
