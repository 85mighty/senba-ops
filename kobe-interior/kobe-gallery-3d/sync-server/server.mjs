// kobe3d-sync — 고베 3D 뷰어 디자인(A안·B안·C안) 기기 간 동기화 저장소. 외부 의존성 없음 (Node 18+).
// GET  /kobe3d-api/health                    → { ok }
// GET  /kobe3d-api/designs                   → { slots: { A: { rev, editedAt, updatedAt, design }, ... } }   (인증 필요)
// PUT  /kobe3d-api/designs/:slot  { design, editedAt } → { rev, editedAt, updatedAt }                         (인증 필요)
// 인증: Authorization: Bearer <SYNC_TOKEN>. 충돌은 '나중에 편집한 쪽(editedAt)'이 이긴다 — 더 오래된 편집은 409 로 거절.
// 저장: DATA_DIR/<slot>.json (원자적 쓰기) + DATA_DIR/history/<slot>-<시각>.json (최근 KEEP_HISTORY 개).
import http from 'node:http';
import { readFile, writeFile, rename, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual, createHash } from 'node:crypto';

// .env (KEY=VALUE) — 있으면 읽는다
const envFile = path.join(path.dirname(new URL(import.meta.url).pathname), '.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }

const PORT = +(process.env.PORT || 3018);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
const TOKEN = process.env.SYNC_TOKEN || '';
const ORIGINS = (process.env.ALLOW_ORIGIN || 'https://85mighty.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const PREFIX = (process.env.PATH_PREFIX ?? '/kobe3d-api').replace(/\/$/, '');
const SLOTS = ['A', 'B', 'C'];
const MAX_BODY = 1024 * 1024;
const KEEP_HISTORY = +(process.env.KEEP_HISTORY || 50);

if (TOKEN.length < 8) { console.error('[kobe3d-sync] SYNC_TOKEN 이 없거나 8자 미만입니다. .env 에 설정하세요.'); process.exit(1); }
await mkdir(path.join(DATA_DIR, 'history'), { recursive: true });

const sha = (s) => createHash('sha256').update(s).digest();
const tokenOk = (req) => { const m = (req.headers.authorization || '').match(/^Bearer (.+)$/); return !!m && timingSafeEqual(sha(m[1]), sha(TOKEN)); };
// 인증 실패 제한: IP 당 10분에 20회
const fails = new Map();
const blocked = (ip) => { const f = fails.get(ip); return f && f.n >= 20 && Date.now() - f.t < 600_000; };
const fail = (ip) => { const f = fails.get(ip); if (!f || Date.now() - f.t > 600_000) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; };

const slotFile = (s) => path.join(DATA_DIR, `${s}.json`);
async function readSlot(s) { try { return JSON.parse(await readFile(slotFile(s), 'utf8')); } catch { return null; } }
async function writeSlot(s, rec) {
  const tmp = slotFile(s) + '.tmp'; await writeFile(tmp, JSON.stringify(rec)); await rename(tmp, slotFile(s));
  const stamp = new Date(rec.updatedAt).toISOString().replace(/[:.]/g, '-');
  await writeFile(path.join(DATA_DIR, 'history', `${s}-${stamp}-r${rec.rev}.json`), JSON.stringify(rec));
  const hist = (await readdir(path.join(DATA_DIR, 'history'))).filter((f) => f.startsWith(s + '-')).sort();
  for (const f of hist.slice(0, Math.max(0, hist.length - KEEP_HISTORY))) await unlink(path.join(DATA_DIR, 'history', f)).catch(() => {});
}
// 같은 안에 대한 쓰기를 순서대로
const locks = new Map();
const withLock = (s, fn) => { const prev = locks.get(s) || Promise.resolve(); const next = prev.then(fn, fn); locks.set(s, next.catch(() => {})); return next; };

function send(res, code, body, cors) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors }); res.end(JSON.stringify(body)); }
function readBody(req) {
  return new Promise((resolve, reject) => { let n = 0; const chunks = []; req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(c); }); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject); });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const cors = origin && (ORIGINS.includes('*') || ORIGINS.includes(origin)) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' } : {};
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const url = new URL(req.url, 'http://x'); let p = url.pathname;
  if (PREFIX && p.startsWith(PREFIX)) p = p.slice(PREFIX.length) || '/';
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (p === '/health' && req.method === 'GET') return send(res, 200, { ok: true, slots: SLOTS }, cors);
    if (blocked(ip)) return send(res, 429, { error: '잠시 후 다시 시도하세요' }, cors);
    if (!tokenOk(req)) { fail(ip); return send(res, 401, { error: '동기화 비밀번호가 맞지 않습니다' }, cors); }
    if (p === '/designs' && req.method === 'GET') {
      const slots = {}; for (const s of SLOTS) { const r = await readSlot(s); if (r) slots[s] = r; }
      return send(res, 200, { slots, now: Date.now() }, cors);
    }
    const m = p.match(/^\/designs\/([ABC])$/);
    if (m && req.method === 'GET') { const r = await readSlot(m[1]); return r ? send(res, 200, r, cors) : send(res, 404, { error: '없음' }, cors); }
    if (m && req.method === 'PUT') {
      const body = JSON.parse(await readBody(req));
      if (!body || typeof body.design !== 'object' || !body.design || !body.design.surfaces) return send(res, 400, { error: '디자인 형식이 아닙니다' }, cors);
      const editedAt = Number.isFinite(body.editedAt) ? body.editedAt : Date.now();
      return await withLock(m[1], async () => {
        const cur = await readSlot(m[1]);
        if (cur && cur.editedAt > editedAt) return send(res, 409, { error: '더 최근 편집이 있습니다', current: cur }, cors);
        const rec = { rev: (cur?.rev || 0) + 1, editedAt, updatedAt: Date.now(), device: String(body.device || '').slice(0, 60), design: body.design };
        await writeSlot(m[1], rec);
        return send(res, 200, { rev: rec.rev, editedAt: rec.editedAt, updatedAt: rec.updatedAt }, cors);
      });
    }
    return send(res, 404, { error: 'not found' }, cors);
  } catch (e) {
    if (e.code === 413) return send(res, 413, { error: '너무 큽니다' }, cors);
    if (e instanceof SyntaxError) return send(res, 400, { error: 'JSON 오류' }, cors);
    console.error('[kobe3d-sync]', e); return send(res, 500, { error: '서버 오류' }, cors);
  }
});
server.listen(PORT, HOST, () => console.log(`[kobe3d-sync] http://${HOST}:${PORT}${PREFIX}  data=${DATA_DIR}  origins=${ORIGINS.join(',')}`));
