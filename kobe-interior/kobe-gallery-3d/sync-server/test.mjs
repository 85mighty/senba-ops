// kobe3d-sync 단위 테스트 — 임시 데이터 폴더로 서버를 띄워 API 를 확인한다. 실행: node test.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(path.join(tmpdir(), 'kobe3d-sync-'));
const PORT = 3918, TOKEN = 'test-token-123456', ORIGIN = 'https://85mighty.github.io';
const srv = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYNC_TOKEN: TOKEN, DATA_DIR: dir, KEEP_HISTORY: '3' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
const base = `http://127.0.0.1:${PORT}/kobe3d-api`;
const call = (p, opt = {}) => fetch(base + p, { ...opt, headers: { Origin: ORIGIN, ...(opt.headers || {}) } });
const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const design = (c) => ({ version: 1, surfaces: { ceiling: { paint: c } }, props: [] });
let ok = 0; const t = async (name, fn) => { await fn(); ok++; console.log('✓', name); };
try {
  await t('health 공개 + CORS', async () => { const r = await call('/health'); assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN); });
  await t('다른 Origin 에는 CORS 헤더 없음', async () => { const r = await fetch(base + '/health', { headers: { Origin: 'https://evil.example' } }); assert.equal(r.headers.get('access-control-allow-origin'), null); });
  await t('preflight', async () => { const r = await call('/designs/A', { method: 'OPTIONS' }); assert.equal(r.status, 204); assert.match(r.headers.get('access-control-allow-methods'), /PUT/); });
  await t('비밀번호 없으면 401', async () => { assert.equal((await call('/designs')).status, 401); assert.equal((await call('/designs', { headers: { Authorization: 'Bearer wrong' } })).status, 401); });
  await t('빈 상태', async () => { const j = await (await call('/designs', { headers: auth })).json(); assert.deepEqual(j.slots, {}); });
  await t('저장 → 읽기', async () => {
    const r = await call('/designs/C', { method: 'PUT', headers: auth, body: JSON.stringify({ design: design('#111111'), editedAt: 1000, device: 'phone' }) }); assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.rev, 1);
    const all = await (await call('/designs', { headers: auth })).json(); assert.equal(all.slots.C.design.surfaces.ceiling.paint, '#111111'); assert.equal(all.slots.C.device, 'phone');
  });
  await t('더 최근 편집으로 덮어쓰기', async () => { const j = await (await call('/designs/C', { method: 'PUT', headers: auth, body: JSON.stringify({ design: design('#222222'), editedAt: 2000 }) })).json(); assert.equal(j.rev, 2); });
  await t('오래된 편집은 409 + 현재값', async () => { const r = await call('/designs/C', { method: 'PUT', headers: auth, body: JSON.stringify({ design: design('#000000'), editedAt: 1500 }) }); assert.equal(r.status, 409); const j = await r.json(); assert.equal(j.current.design.surfaces.ceiling.paint, '#222222'); });
  await t('잘못된 안·형식 거절', async () => { assert.equal((await call('/designs/E', { method: 'PUT', headers: auth, body: '{}' })).status, 404); assert.equal((await call('/designs/A', { method: 'PUT', headers: auth, body: '{"design":{}}' })).status, 400); assert.equal((await call('/designs/A', { method: 'PUT', headers: auth, body: 'nope' })).status, 400); });
  await t('너무 큰 요청 413', async () => { const r = await call('/designs/A', { method: 'PUT', headers: auth, body: JSON.stringify({ design: { surfaces: {}, pad: 'x'.repeat(1_100_000) } }) }).catch(() => ({ status: 413 })); assert.equal(r.status, 413); });
  await t('기록은 최근 3개만', async () => { for (let i = 0; i < 5; i++) await call('/designs/B', { method: 'PUT', headers: auth, body: JSON.stringify({ design: design('#33333' + i), editedAt: 5000 + i }) }); assert.equal(readdirSync(path.join(dir, 'history')).filter((f) => f.startsWith('B-')).length, 3); });
  await t('동시 저장도 rev 순서대로', async () => { await Promise.all([1, 2, 3, 4].map((i) => call('/designs/A', { method: 'PUT', headers: auth, body: JSON.stringify({ design: design('#4444' + i + '0'), editedAt: 9000 + i }) }))); const j = await (await call('/designs/A', { headers: auth })).json(); assert.equal(j.rev, 4); });
  console.log(`\n✅ ${ok}개 통과`);
} catch (e) { console.error('\n❌', e.message); process.exitCode = 1; }
finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
