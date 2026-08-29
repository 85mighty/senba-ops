// 통합 예약 간트 뷰 v1 — 구글캘린더(🎨ぐるなび·🟦Square) → 방5개 자동배정 타임라인 (2026-08-29)
// http://<서버IP>:3016/?key=...&date=YYYY-MM-DD  · pm2: senba-booking-view
// 방 배정은 first-fit 자동(참고용) — 실제 방은 台帳 기준. 배정 불가(동시 6조+)는 ⚠️초과 행에 표시.
require('dns').setDefaultResultOrder('ipv4first');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const envOf = f => { try { return Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])); } catch { return {}; } };
const E = envOf('/opt/senba-sales-sync/.env');
const CAL_ID = E.CALENDAR_ID || '';
const KEY = E.VIEW_KEY || '';
const SA_KEY = '/opt/senba-sales-sync/service-account.json';
const PORT = 3016;
const ROOMS = 5, RESET = 15;          // 방 수 · 턴 사이 정리시간(분)
const OPEN = 10, CLOSE = 21;          // 표시 시간대
const PX = 1.5;                       // 1분당 px

let gtok = { v: null, exp: 0 };
async function gToken() {
  if (Date.now() < gtok.exp - 60e3) return gtok.v;
  const sa = JSON.parse(fs.readFileSync(SA_KEY, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/calendar.readonly', aud: sa.token_uri, iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const r = await fetch(sa.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + unsigned + '.' + sig });
  const j = await r.json(); if (!j.access_token) throw new Error('gauth: ' + JSON.stringify(j));
  gtok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

async function dayEvents(ymd) {
  const min = encodeURIComponent(ymd + 'T00:00:00+09:00'), max = encodeURIComponent(ymd + 'T23:59:59+09:00');
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL_ID)}/events?singleEvents=true&orderBy=startTime&maxResults=100&timeMin=${min}&timeMax=${max}`,
    { headers: { Authorization: 'Bearer ' + await gToken() } });
  const j = await r.json(); if (j.error) throw new Error(j.error.message);
  return (j.items || []).filter(ev => ev.status !== 'cancelled' && /🎨|🟦/.test(ev.summary || '') && ev.start?.dateTime)
    .map(ev => {
      const s = new Date(ev.start.dateTime), e = new Date(ev.end.dateTime);
      const toMin = d => Math.round((d.getTime() + 9 * 3600e3) / 60000) % 1440;
      return {
        sq: (ev.summary || '').includes('🟦'),
        title: (ev.summary || '').replace(/🎨|🟦/g, '').trim(),
        desc: ev.description || '',
        s: toMin(s), e: toMin(e),
        ppl: Number(((ev.summary || '').match(/(\d+)\s*[명名]/) || [])[1] || 0),
      };
    }).sort((a, b) => a.s - b.s || a.e - b.e);
}

function assignRooms(evs) {
  const ends = Array(ROOMS).fill(-1);   // 방별 마지막 종료(분)
  for (const ev of evs) {
    ev.room = -1;
    for (let i = 0; i < ROOMS; i++) if (ends[i] + RESET <= ev.s) { ev.room = i; ends[i] = ev.e; break; }
  }
  return evs;
}
function maxConcurrent(evs) {
  const pts = [];
  for (const ev of evs) { pts.push([ev.s, 1], [ev.e, -1]); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, max = 0;
  for (const [, d] of pts) { cur += d; if (cur > max) max = cur; }
  return max;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

function render(ymd, evs) {
  const W = (CLOSE - OPEN) * 60 * PX;
  const x = m => (m - OPEN * 60) * PX;
  const dow = '日月火水木金土'[new Date(ymd + 'T12:00:00').getDay()];
  const ppl = evs.reduce((s, e) => s + e.ppl, 0);
  const mc = maxConcurrent(evs);
  const over = evs.filter(e => e.room < 0);
  const nav = d => { const t = new Date(ymd + 'T12:00:00'); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); };
  const q = d => `/?key=${encodeURIComponent(KEY)}&date=${d}`;
  const block = ev =>
    `<div class="bk ${ev.sq ? 'sq' : 'gn'}" style="left:${x(ev.s)}px;width:${Math.max((ev.e - ev.s) * PX, 60)}px" title="${esc(ev.title + '\n' + hm(ev.s) + '–' + hm(ev.e) + '\n' + ev.desc)}">` +
    `<b>${hm(ev.s)}–${hm(ev.e)}</b> ${esc(ev.title)}</div>`;
  let rows = '';
  for (let i = 0; i < ROOMS; i++)
    rows += `<div class="row"><div class="rl">room#${i + 1}</div><div class="tl" style="width:${W}px">${evs.filter(e => e.room === i).map(block).join('')}</div></div>`;
  if (over.length)
    rows += `<div class="row ov"><div class="rl">⚠️ 초과</div><div class="tl" style="width:${W}px">${over.map(block).join('')}</div></div>`;
  let hours = '';
  for (let h = OPEN; h <= CLOSE; h++) hours += `<i style="left:${x(h * 60)}px">${h}:00</i>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="300"><title>센바 예약 ${ymd}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,'Noto Sans KR',sans-serif;background:#f4f3ef;color:#26251f;font-size:14px}
header{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 16px;background:#1f2d3d;color:#fff}
header b{font-size:17px}header a{color:#fff;text-decoration:none;background:#3a4b5f;border-radius:6px;padding:4px 12px}
.stats{margin-left:auto;font-size:13px;opacity:.9}
.wrap{overflow-x:auto;padding:14px 16px}
.hours{position:relative;height:20px;margin-left:90px}.hours i{position:absolute;font-style:normal;font-size:11px;color:#888;transform:translateX(-14px)}
.row{display:flex;align-items:stretch;margin-bottom:6px}
.rl{width:90px;flex-shrink:0;font-weight:700;font-size:12.5px;padding:14px 6px 0 0;color:#555}
.tl{position:relative;height:46px;background:repeating-linear-gradient(to right,#e6e3da 0 1px,transparent 1px ${60 * PX}px),#fbfaf7;border-radius:6px}
.bk{position:absolute;top:4px;bottom:4px;border-radius:6px;padding:4px 7px;font-size:11.5px;overflow:hidden;white-space:nowrap;color:#fff;line-height:1.3}
.bk b{display:block;font-size:10.5px;opacity:.85}
.gn{background:#b8433a}.sq{background:#2d6bc4}
.ov .tl{background:#fdecea}
.legend{padding:0 16px 16px;font-size:12px;color:#777}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 12px;vertical-align:-1px}
form{display:inline}input[type=date]{border:0;border-radius:6px;padding:4px 8px;font-size:13px}
@media(max-width:600px){.rl{width:64px;font-size:11px}}
</style></head><body>
<header><b>船場美術館 ${ymd.slice(5).replace('-', '/')} (${dow})</b>
<a href="${q(nav(-1))}">◀</a>
<form method="get"><input type="hidden" name="key" value="${esc(KEY)}"><input type="date" name="date" value="${ymd}" onchange="this.form.submit()"></form>
<a href="${q(nav(1))}">▶</a><a href="${q(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10))}">오늘</a>
<span class="stats">${evs.length}조 · ${ppl}명 · 최대 동시 ${mc}조${mc >= ROOMS ? ' 🔴만석' : ''}</span></header>
<div class="wrap"><div class="hours" style="width:${W}px">${hours}</div>${rows || '<p style="color:#888">예약 없음</p>'}</div>
<div class="legend">방 배정은 자동(참고용) — 실제 방은 ぐるなび台帳 기준 · 정리 ${RESET}분 간격 반영 · 5분마다 자동 새로고침<i style="background:#b8433a"></i>ぐるなび<i style="background:#2d6bc4"></i>Square</div>
</body></html>`;
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (KEY && u.searchParams.get('key') !== KEY) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('key가 필요합니다: /?key=...'); }
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('date') || '') ? u.searchParams.get('date') : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const evs = assignRooms(await dayEvents(ymd));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(render(ymd, evs));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('오류: ' + e.message);
  }
}).listen(PORT, '0.0.0.0', () => console.log(`[booking-view] http://0.0.0.0:${PORT} cal=${CAL_ID ? 'ok' : '미설정!'}`));
