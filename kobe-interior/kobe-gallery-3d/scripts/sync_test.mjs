// 기기 간 자동 동기화 종단 테스트 — 로컬 sync-server + 빌드된 app/ 을 띄우고 "폰"·"아이패드" 두 브라우저로 확인한다.
// 사용: npm run build && npm run test:sync
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WEB = 4203, APIP = 3920, TOKEN = 'kobe-sync-e2e-1', URL_ = `http://127.0.0.1:${WEB}/app/`, API = `http://127.0.0.1:${APIP}/kobe3d-api`;
const data = mkdtempSync(path.join(tmpdir(), 'kobe3d-e2e-'));
const web = spawn('python3', ['-m', 'http.server', String(WEB), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore', detached: true });
let api; const startApi = () => { api = spawn(process.execPath, [path.join(root, 'sync-server/server.mjs')], { env: { ...process.env, PORT: String(APIP), SYNC_TOKEN: TOKEN, ALLOW_ORIGIN: `http://127.0.0.1:${WEB}`, DATA_DIR: data }, stdio: 'ignore' }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const problems = []; const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) problems.push(msg); };
startApi(); await wait(1500);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const open = async () => { const c = await b.newContext({ viewport: { width: 700, height: 500 } }); const p = await c.newPage(); p.on('pageerror', (e) => problems.push('pageerror: ' + e.message)); await p.goto(URL_); await p.waitForFunction(() => window.__viewerReady, null, { timeout: 120000 }); return p; };
  const settled = (p) => p.waitForFunction(() => { const sy = window.__sync; return sy && ['ok', 'auth', 'offline'].includes(sy.status) && (sy.status !== 'ok' || !['A', 'B', 'C'].some((k) => sy.meta[k]?.dirty)); }, null, { timeout: 90000, polling: 300 });
  const connect = async (p, tok) => { await p.evaluate(({ API, tok }) => { document.querySelector('#syncUrl').value = API; document.querySelector('#syncToken').value = tok; document.querySelector('#syncConnect').click(); }, { API, tok }); await wait(300); await settled(p); };
  const edit = (p, slot, key, val) => p.evaluate(({ slot, key, val }) => { window.__switchSlot(slot); const s = window.__store; s.surface(key).paint = val; s.commit('paint'); }, { slot, key, val });
  const get = (p, slot, key) => p.evaluate(({ slot, key }) => window.__store.getSlot(slot)?.surfaces?.[key]?.paint, { slot, key });

  const phone = await open();
  await edit(phone, 'C', 'ceiling', '#3f5a52');
  await connect(phone, 'wrong-password-x'); check(await phone.evaluate(() => window.__sync.status) === 'auth', '틀린 비밀번호 → "비밀번호 확인" 표시');
  await connect(phone, TOKEN); check(await phone.evaluate(() => window.__sync.status) === 'ok', '폰 연결 → 동기화됨');
  const ipad = await open(); await connect(ipad, TOKEN);
  check(await get(ipad, 'C', 'ceiling') === '#3f5a52', '처음 연결한 아이패드가 폰의 C안을 받음');
  await edit(ipad, 'A', 'floor', '#222222'); await wait(300); await settled(ipad);
  await phone.evaluate(() => window.__sync.pull()); await settled(phone);
  check(await get(phone, 'A', 'floor') === '#222222', '아이패드 A안 수정 → 폰에 반영(보고 있지 않은 안)');
  await edit(ipad, 'C', 'ceiling', '#1c1c1c'); await wait(300); await settled(ipad);
  await phone.evaluate(() => window.__sync.pull()); await settled(phone);
  const pc = await phone.evaluate(() => ({ d: window.__store.design.surfaces.ceiling?.paint, seen: '#' + window.__editor.intCeil.material.color.getHexString() }));
  check(pc.d === '#1c1c1c' && pc.seen === '#1c1c1c', '폰이 보고 있는 C안 화면도 바로 바뀜');
  // 오프라인: 서버가 꺼진 동안 폰에서 수정 → 다시 켜지면 올라감
  api.kill(); await wait(800);
  await edit(phone, 'C', 'ceiling', '#a98457'); await wait(300); await settled(phone);
  check(await phone.evaluate(() => window.__sync.status) === 'offline', '서버 꺼짐 → 오프라인 표시, 기기에 보관');
  startApi(); await wait(1500); await phone.evaluate(() => window.__sync.pull()); await settled(phone);
  await ipad.evaluate(() => window.__sync.pull()); await settled(ipad);
  check(await get(ipad, 'C', 'ceiling') === '#a98457', '서버 복구 → 폰의 오프라인 수정이 올라가 아이패드에 반영');
} finally { await b.close(); try { process.kill(-web.pid); } catch {} api?.kill(); rmSync(data, { recursive: true, force: true }); }
if (problems.length) { console.error('\n❌ ' + problems.join('\n')); process.exit(1); }
console.log('\n✅ 기기 간 동기화 테스트 통과');
