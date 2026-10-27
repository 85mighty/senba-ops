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
    const p = s.addProp({ type: 'easel_canvas', x: 0.3, z: -1.2, rot: 2.6, scale: 1, color: null }); s.addProp({ type: 'couple_set', x: -1.2, z: -4.0, rot: 0, scale: 1, color: null }); s.commit('prop'); e.select({ kind: 'prop', id: p.id });
    const before = s.exportJSON().length; s.undo(); const afterUndo = s.exportJSON().length; s.redo(); const afterRedo = s.exportJSON().length;
    if (!(afterUndo !== before && afterRedo === before)) throw new Error('undo/redo 불일치');
    s.saveExplicit(); s.surface('ceiling').paint = '#333333'; s.commit('paint'); s.revertToSaved(); if (s.getSurface('ceiling').paint !== '#f2efe9') throw new Error('저장본 복원 실패');
    // 숨기기/자동 숨김
    e.setHidden(w.id, true); const hiddenOk = (() => { let anyVisible = false; window.__viewer.loaded.reconstructed.traverse((o) => { if (o.isMesh && o.name.startsWith(w.id) && o.visible) anyVisible = true; }); return !anyVisible; })();
    e.setHidden('ceiling', true); const tileOk = !!e.intCeil && !e.intCeil.visible; e.showAll(); if (!e.intCeil.visible) throw new Error('천장 다시 보이기 실패');
    const v = window.__viewer; const ch = window.__viewer.meta.ceiling_height_m; v.camera.position.y = ch + 4; v.updateAutoCeiling(); const clipAbove = v.clipPlane.constant < ch; v.camera.position.y = 1.6; v.updateAutoCeiling(); const clipInside = v.clipPlane.constant > ch + 1;
    if (!clipAbove || !clipInside) throw new Error('위에서 천장 투명 실패 ' + JSON.stringify({ clipAbove, clipInside }));
    if (document.querySelectorAll('#itemChips .chip.ceil').length !== 1) throw new Error('천장 칩은 하나여야 함');
    e.setAutoHide(true); e.runAutoHide(); const auto = e._autoHidden.size; e.setAutoHide(false);
    if (!hiddenOk || !tileOk) throw new Error('숨기기 검증 실패 ' + JSON.stringify({ hiddenOk, tileOk, auto }));
    // 띠/하부 벽/몰딩 전역 옵션 + 전체 바닥 덮어쓰기 + 소품 삭제
    // 벽별 띠·하부 벽: 한 벽만 원목 몰드 → 그 벽만 커스텀 띠, 다른 벽은 GLB 검정 띠 유지
    const tw = walls[0], other2 = walls[1]; const te = s.trimEdit(tw.id); te.rail = { color: '#a98457', style: 'molding' }; te.lower = { paint: '#a98457', style: 'wood_panel' }; te.moldingColor = '#efe6d6'; s.commit('trim');
    const bandSids = new Set(); e.bands.traverse((o) => { if (o.isMesh) bandSids.add(o.userData.surface); });
    let otherGlbBand = false; window.__viewer.loaded.reconstructed.traverse((o) => { if (o.isMesh && o.name === other2.id + '_chairrail' && o.userData.keepVisible !== false) otherGlbBand = true; });
    if (!bandSids.has(tw.id) || bandSids.size !== 1 || !otherGlbBand) throw new Error('벽별 띠 실패 ' + JSON.stringify({ sids: [...bandSids], otherGlbBand }));
    s.applyTrimToAll(tw.id); s.commit('trim'); if (s.hasOwnTrim(tw.id) || s.trimOf(other2.id).rail.color !== '#a98457') throw new Error('모든 벽 적용 실패');
    s.resetAllTrim(); s.commit('trim'); const te2 = s.trimEdit(tw.id); te2.rail = { color: '#a98457', style: 'molding' }; te2.lower = { paint: '#a98457', style: 'wood_panel' }; s.commit('trim');
    s.paintAll('floor', '#866752'); s.commit('paint'); if (s.getSurface('floor_t1').paint) throw new Error('전체 바닥 덮어쓰기 실패');
    const before2 = s.design.props.length; e.deleteProp(s.design.props[0].id); if (s.design.props.length !== before2 - 1) throw new Error('소품 삭제 실패');
    // 바닥 전체 칠 → 스캔 바닥 텍스처 숨김 + 칸 오버레이가 복원 바닥 모양
    s.paintAll('floor', '#5c3d26'); s.commit('paint'); let floorTex = null; window.__viewer.loaded.reconstructed.traverse((o) => { if (o.isMesh && o.name === 'floor_tex') floorTex = o; });
    if (floorTex && floorTex.visible) throw new Error('바닥 전체 칠 후 스캔 바닥 텍스처가 보임');
    if (!e.tiles.every((t) => t.geo)) throw new Error('바닥 칸 형상 누락');
    // 입구 자동문
    if (!e.doors || e.doors.children.length < 1) throw new Error('입구 자동문 없음');
    // 디자인 안 전환: B안 새로 → 바꾸고 → A안으로 돌아가면 A 는 그대로
    const ceilA = s.getSurface('ceiling').paint; window.__switchSlot('B'); s.surface('ceiling').paint = '#1c1c1c'; s.commit('paint'); window.__switchSlot('A');
    if (s.active !== 'A' || s.getSurface('ceiling').paint !== ceilA) throw new Error('안 전환 실패');
    window.__switchSlot('B'); if (s.getSurface('ceiling').paint !== '#1c1c1c') throw new Error('B안 저장 실패'); window.__switchSlot('A');
    if (document.querySelectorAll('#slotBar button').length !== 3) throw new Error('안 버튼 3개 아님');
    const json = s.exportJSON();
    return { items: e.items.length, chips: document.querySelectorAll('#itemChips button').length, overlays: e.overlays.children.length, windows: e.windows.children.length, props: e.props.children.length, labels: e.labels.children.length, jsonLen: json.length, inspector: document.querySelector('#inspector').textContent.slice(0, 40) };
  });
  console.log('편집기:', JSON.stringify(ed));
  if (!ed.overlays || !ed.props || !ed.windows || ed.chips < 10) problems.push('편집기 기능 검증 실패: ' + JSON.stringify(ed));
  await page.click('button[data-mode=interior]', { force: true }); await wait(800);
  await page.evaluate(() => { const v = window.__viewer; v.camera.position.set(0.2, 1.5, 0.8); v.controls.target.set(-0.6, 1.0, -3.2); v.controls.update(); }); await wait(1200);
  await page.screenshot({ path: path.join(root, 'screenshots', 'editor_demo.png') });
  // 위에서 내려다보기: 천장이 투명해야 실내가 보인다
  await page.evaluate(() => { const v = window.__viewer; v.camera.position.set(3.5, 7.5, 5.5); v.controls.target.set(-0.8, 0.5, -1.2); v.controls.update(); }); await wait(1200);
  await page.screenshot({ path: path.join(root, 'screenshots', 'overview_above.png') });
  await page.evaluate(() => { window.__store.reset(); });   // 테스트 디자인은 남기지 않음
  const counts = await page.evaluate(() => { const i = window.__interior; const o = {}; for (const k in i.layers) o[k] = i.layers[k].children.length; return o; });
  console.log('인테리어 레이어 객체 수:', counts);
  if (!counts.molding) problems.push('몰딩 프레임이 생성되지 않음'); if (!counts.mirror_4_sides) problems.push('거울이 생성되지 않음 (central_wide_column 확인)');
} finally { await browser.close(); stopServer(); }

if (problems.length) { console.error('\n❌ 문제 발견:'); problems.forEach((p) => console.error(' -', p)); process.exit(1); }
console.log('\n✅ 브라우저 검증 통과: 404/콘솔 오류 없음, 4개 모드 렌더링, 토글·북마크 동작. 캡처: screenshots/');
