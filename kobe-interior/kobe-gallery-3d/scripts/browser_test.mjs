// 브라우저 검증 — vite preview 로 dist/ 를 띄우고 Chromium(Playwright)으로 4개 모드 + 토글을 실제 렌더링한다.
// 콘솔 오류·404·JS 예외를 모아 보고하고 screenshots/ 에 모드별 캡처를 남긴다. 실패 시 exit 1.
// 사용: npm run build && npm run test:browser  (app/ 을 python3 http.server 로 띄워 검증)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { console.error('playwright 를 찾을 수 없습니다. (이 테스트는 선택 사항 — 수동으로 Chrome 에서 확인해도 됩니다)'); process.exit(2); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 4192;  // 4190 은 Node fetch "bad port" 목록(ManageSieve)이라 피한다 mkdirSync(path.join(root, 'screenshots'), { recursive: true });
// 사용자와 같은 방식(python3 -m http.server)으로 프로젝트 루트를 서빙하고 app/ 을 연다
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill(); } catch {} } };
process.on('exit', stopServer); process.on('SIGINT', () => { stopServer(); process.exit(130); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('로컬 서버 시작 시간 초과')), 20000); const probe = async () => { try { const r = await fetch(`http://127.0.0.1:${PORT}/app/`); if (r.ok) { clearTimeout(t); res(); return; } } catch {} setTimeout(probe, 300); }; probe(); });

const problems = [];
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } }); page.setDefaultTimeout(90000);
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${PORT}/app/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__viewerReady === true, null, { timeout: 60000 });
  const loaded = await page.evaluate(() => window.__loadedModels); const errs = await page.evaluate(() => window.__viewerErrors);
  console.log('불러온 모델:', loaded); if (errs.length) problems.push(...errs.map((e) => `viewer: ${e}`));
  const modes = ['original', 'cleaned', 'reconstructed', 'interior'];
  for (const m of modes) {
    await page.click(`button[data-mode=${m}]`, { force: true }); await wait(600);
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
  // 북마크마다 ① 원본 / ③ 복원 / ④ A안 캡처 → 사진과 대조용 (screenshots/compare_*.png)
  const bms = await page.$$('#bookmarks button');
  for (const b of bms) {
    const name = (await b.textContent()).replace(/[^가-힣a-zA-Z0-9]/g, '');
    await b.click({ timeout: 90000, force: true }); await wait(800);
    for (const m of ['original', 'reconstructed', 'interior']) { await page.click(`button[data-mode=${m}]`, { force: true }); await wait(500); await page.screenshot({ path: path.join(root, 'screenshots', `compare_${name}_${m}.png`) }); }
  }
  await page.click('button[data-mode=interior]');
  await page.screenshot({ path: path.join(root, 'screenshots', 'interior_column_mirror_env.png') });
  await page.selectOption('#mirrorMode', 'reflector'); await wait(1500);
  await page.screenshot({ path: path.join(root, 'screenshots', 'interior_column_mirror_reflector.png'), timeout: 60000 });
  await page.selectOption('#mirrorMode', 'env'); await wait(800);
  await page.check('[data-layer=furniture]'); await page.check('[data-layer=wine_accent_optional]'); await wait(300);
  await page.screenshot({ path: path.join(root, 'screenshots', 'interior_options_on.png') });
  // 편집기: 번호 선택 → 칠하기/분할/몰딩·액자 끄기, 기둥 실측, 창+커튼, 소품, JSON 내보내기
  await page.check('#editMode'); await page.check('#showLabels'); await wait(300);
  const ed = await page.evaluate(() => {
    const e = window.__editor, s = window.__store; const walls = e.walls(); const w = walls.find((x) => x.length > 4) || walls[0]; const col = e.columns()[0];
    e.select({ kind: 'wall', id: w.id }); s.surface(w.id).splits = 3; s.commit('split'); e.renderChips();
    const seg = e.segmentsOf(w)[1]; e.select({ kind: 'wall', id: w.id, seg: seg.key }); const sf = s.surface(seg.key); sf.paint = '#7a2e2e'; sf.zone = 'upper'; s.commit('paint');
    const other = walls.find((x) => x.id !== w.id); if (other) { const so = s.surface(other.id); so.art = false; so.molding = false; s.commit('art'); }
    e.select({ kind: 'column', id: col.id }); const c = s.column(col.id); c.w = 0.4; c.mirror = true; s.commit('size');
    const wallWithWin = Object.keys(s.design.windows)[0]; const win = s.windowsOf(wallWithWin)[0]; if (win) { win.curtain.on = true; win.curtain.color = '#5a3a22'; s.commit('curtain'); e.select({ kind: 'window', id: win.id, wall: wallWithWin }); }
    s.surface('floor_t1').paint = '#5c3d26'; s.surface('ceiling').paint = '#f2efe9'; s.commit('paint');
    const p = s.addProp({ type: 'easel_canvas', x: 0, z: -2, rot: 0.5, scale: 1, color: null }); s.addProp({ type: 'plant', x: 1, z: -3, rot: 0, scale: 1, color: null }); s.commit('prop'); e.select({ kind: 'prop', id: p.id });
    const before = s.exportJSON().length; s.undo(); const afterUndo = s.exportJSON().length; s.redo(); const afterRedo = s.exportJSON().length;
    if (!(afterUndo !== before && afterRedo === before)) throw new Error('undo/redo 불일치');
    s.saveExplicit(); s.surface('ceiling').paint = '#333333'; s.commit('paint'); s.revertToSaved(); if (s.getSurface('ceiling').paint !== '#f2efe9') throw new Error('저장본 복원 실패');
    const json = s.exportJSON();
    return { items: e.items.length, chips: document.querySelectorAll('#itemChips button').length, overlays: e.overlays.children.length, windows: e.windows.children.length, props: e.props.children.length, labels: e.labels.children.length, jsonLen: json.length, inspector: document.querySelector('#inspector').textContent.slice(0, 40) };
  });
  console.log('편집기:', JSON.stringify(ed));
  if (!ed.overlays || !ed.props || !ed.windows || ed.chips < 10) problems.push('편집기 기능 검증 실패: ' + JSON.stringify(ed));
  await page.click('button[data-mode=interior]', { force: true }); await wait(800);
  await page.evaluate(() => window.__viewer.goBookmark(window.__viewer.bookmarks[0])); await wait(1200);
  await page.screenshot({ path: path.join(root, 'screenshots', 'editor_demo.png') });
  await page.evaluate(() => { window.__store.reset(); });   // 테스트 디자인은 남기지 않음
  const counts = await page.evaluate(() => { const i = window.__interior; const o = {}; for (const k in i.layers) o[k] = i.layers[k].children.length; return o; });
  console.log('인테리어 레이어 객체 수:', counts);
  if (!counts.molding) problems.push('몰딩 프레임이 생성되지 않음'); if (!counts.mirror_4_sides) problems.push('거울이 생성되지 않음 (central_wide_column 확인)');
} finally { await browser.close(); stopServer(); }

if (problems.length) { console.error('\n❌ 문제 발견:'); problems.forEach((p) => console.error(' -', p)); process.exit(1); }
console.log('\n✅ 브라우저 검증 통과: 404/콘솔 오류 없음, 4개 모드 렌더링, 토글·북마크 동작. 캡처: screenshots/');
