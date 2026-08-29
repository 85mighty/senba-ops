// 통합 예약 간트 뷰 v3 — 캘린더(🎨ぐるなび·🟦Square·📞수동) 방5 자동배정 + 수동 예약 등록/수정/삭제 (2026-08-29)
// http://<서버IP>:3017/?key=...&date=YYYY-MM-DD  · pm2: senba-booking-view
// v3: 반응형 — PC/태블릿은 화면 폭에 꽉 차게(% 배치), 모바일은 가로 스크롤 + 방 라벨 고정, 현재 시각선
require('dns').setDefaultResultOrder('ipv4first');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const envOf = f => { try { return Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])); } catch { return {}; } };
const E = envOf('/opt/senba-sales-sync/.env');
const CAL_ID = E.CALENDAR_ID || '';
const KEY = E.VIEW_KEY || '';
const SA_KEY = '/opt/senba-sales-sync/service-account.json';
const PORT = Number(E.VIEW_PORT || 3017);
const ROOMS = 5, RESET = 15;
const OPEN = 10, CLOSE = 19;
const T = (CLOSE - OPEN) * 60;        // 표시 구간(분)

let gtok = { v: null, exp: 0 };
async function gToken() {
  if (Date.now() < gtok.exp - 60e3) return gtok.v;
  const sa = JSON.parse(fs.readFileSync(SA_KEY, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/calendar', aud: sa.token_uri, iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const r = await fetch(sa.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + unsigned + '.' + sig });
  const j = await r.json(); if (!j.access_token) throw new Error('gauth: ' + JSON.stringify(j));
  gtok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}
async function gcal(method, path, body) {
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(CAL_ID) + path, {
    method, headers: { Authorization: 'Bearer ' + await gToken(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return {};
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j;
}

const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const pct = m => ((m - OPEN * 60) / T * 100).toFixed(3) + '%';
const wpct = min => (min / T * 100).toFixed(3) + '%';

async function dayEvents(ymd) {
  const min = encodeURIComponent(ymd + 'T00:00:00+09:00'), max = encodeURIComponent(ymd + 'T23:59:59+09:00');
  const j = await gcal('GET', `/events?singleEvents=true&orderBy=startTime&maxResults=100&timeMin=${min}&timeMax=${max}`);
  return (j.items || []).filter(ev => ev.status !== 'cancelled' && /🎨|🟦|📞/.test(ev.summary || '') && ev.start?.dateTime)
    .map(ev => {
      const s = new Date(ev.start.dateTime), e = new Date(ev.end.dateTime);
      const tm = d => Math.round((d.getTime() + 9 * 3600e3) / 60000) % 1440;
      const sum = ev.summary || '';
      const P = ev.extendedProperties?.private || {};
      return {
        id: ev.id,
        src: sum.includes('🟦') ? 'sq' : sum.includes('📞') ? 'man' : 'gn',
        title: sum.replace(/🎨|🟦|📞/g, '').trim(),
        desc: ev.description || '',
        s: tm(s), e: tm(e),
        ppl: Number((sum.match(/(\d+)\s*[명名]/) || [])[1] || P.pp || 0),
        meta: { nm: P.nm || '', ph: P.ph || '', pp: P.pp || '', co: P.co || '', ch: P.ch || '' },
      };
    }).sort((a, b) => a.s - b.s || a.e - b.e);
}
function assignRooms(evs) {
  const ends = Array(ROOMS).fill(-9999);
  for (const ev of evs) {
    ev.room = -1;
    for (let i = 0; i < ROOMS; i++) if (ends[i] + RESET <= ev.s) { ev.room = i; ends[i] = ev.e; break; }
  }
  return evs;
}
function maxConcurrent(evs) {
  const pts = [];
  for (const ev of evs) pts.push([ev.s, 1], [ev.e, -1]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, max = 0;
  for (const [, d] of pts) { cur += d; if (cur > max) max = cur; }
  return max;
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(ymd, evs) {
  const dow = '日月火水木金土'[new Date(ymd + 'T12:00:00').getDay()];
  const ppl = evs.reduce((s, e) => s + e.ppl, 0);
  const mc = maxConcurrent(evs);
  const over = evs.filter(e => e.room < 0);
  const nav = d => { const t = new Date(ymd + 'T12:00:00'); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); };
  const q = d => `/?key=${encodeURIComponent(KEY)}&date=${d}`;
  const nowJ = new Date(Date.now() + 9 * 3600e3);
  const todayYmd = nowJ.toISOString().slice(0, 10);
  const nowMin = nowJ.getUTCHours() * 60 + nowJ.getUTCMinutes();
  const nowLine = (ymd === todayYmd && nowMin > OPEN * 60 && nowMin < CLOSE * 60) ? `<div class="now" style="left:${pct(nowMin)}"></div>` : '';
  const block = ev =>
    `<div class="bk ${ev.src}" style="left:${pct(ev.s)};width:${wpct(ev.e - ev.s)}"` +
    ` data-id="${esc(ev.id)}" data-src="${ev.src}" data-s="${hm(ev.s)}" data-dur="${ev.e - ev.s}"` +
    ` data-nm="${esc(ev.meta.nm || ev.title)}" data-ph="${esc(ev.meta.ph)}" data-pp="${esc(ev.meta.pp || ev.ppl)}" data-co="${esc(ev.meta.co)}" data-ch="${esc(ev.meta.ch)}"` +
    ` title="${esc(ev.title + '\n' + hm(ev.s) + '–' + hm(ev.e) + '\n' + ev.desc)}">` +
    `<b>${hm(ev.s)}–${hm(ev.e)} · ${ev.ppl || '?'}명</b><span>${esc(ev.title.replace(/\s*\d+\s*[명名].*$/, ''))}</span></div>`;
  let hoursCells = '';
  for (let h = OPEN; h < CLOSE; h++) hoursCells += `<i style="left:${pct(h * 60)}">${h}:00</i>`;
  let rows = `<div class="row hd"><div class="rl"></div><div class="tlh">${hoursCells}</div></div>`;
  for (let i = 0; i < ROOMS; i++)
    rows += `<div class="row"><div class="rl">room#${i + 1}</div><div class="tl" data-row="1">${nowLine}${evs.filter(e => e.room === i).map(block).join('')}</div></div>`;
  if (over.length)
    rows += `<div class="row ov"><div class="rl">⚠️ 초과</div><div class="tl">${over.map(block).join('')}</div></div>`;
  let startOpts = '';
  for (let m = OPEN * 60; m <= CLOSE * 60 - 60; m += 15) startOpts += `<option>${hm(m)}</option>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>센바 예약 ${ymd}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,'Noto Sans KR',sans-serif;background:#f4f3ef;color:#26251f;font-size:14px}
header{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 14px;background:#1f2d3d;color:#fff}
header b{font-size:17px}header a{color:#fff;text-decoration:none;background:#3a4b5f;border-radius:8px;padding:6px 14px;font-size:14px}
.stats{margin-left:auto;font-size:13px;opacity:.92}
.wrap{overflow-x:auto;padding:12px 14px 4px;-webkit-overflow-scrolling:touch}
.grid{width:100%;min-width:860px}
.row{display:flex;align-items:stretch;margin-bottom:8px}
.row.hd{margin-bottom:2px}
.rl{width:84px;flex-shrink:0;font-weight:700;font-size:13px;display:flex;align-items:center;color:#555;position:sticky;left:0;background:#f4f3ef;z-index:3;padding-right:6px}
.tlh{position:relative;flex:1;height:18px}
.tlh i{position:absolute;font-style:normal;font-size:11.5px;color:#999;transform:translateX(-2px)}
.tl{position:relative;flex:1;height:54px;background:repeating-linear-gradient(to right,#e6e3da 0 1px,transparent 1px calc(100%/${CLOSE - OPEN})),#fbfaf7;border-radius:6px;cursor:copy}
.bk{position:absolute;top:4px;bottom:4px;min-width:58px;border-radius:7px;padding:5px 8px;font-size:12.5px;overflow:hidden;color:#fff;line-height:1.35;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.18)}
.bk b{display:block;font-size:11px;opacity:.85;white-space:nowrap}
.bk span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.gn{background:#b8433a}.sq{background:#2d6bc4}.man{background:#1a7f3c}
.ov .tl{background:#fdecea;cursor:default}
.now{position:absolute;top:-2px;bottom:-2px;width:2px;background:#e02020;z-index:2}
.now::after{content:'';position:absolute;top:-4px;left:-3px;width:8px;height:8px;border-radius:50%;background:#e02020}
.legend{padding:4px 16px 16px;font-size:12px;color:#777}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 12px;vertical-align:-1px}
form.nav{display:inline}input[type=date]{border:0;border-radius:8px;padding:6px 8px;font-size:14px}
@media(min-width:1100px){.tl{height:62px}.bk{font-size:13.5px;padding:7px 10px}.bk b{font-size:11.5px}.rl{font-size:14px;width:96px}body{font-size:15px}}
@media(max-width:600px){
  header{padding:8px 10px}header b{font-size:15px}header a{padding:8px 12px}
  .stats{width:100%;margin-left:0;order:9}
  .grid{min-width:760px}.rl{width:64px;font-size:11.5px}
  .tl{height:58px}.bk{font-size:12px}
}
#modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:flex-end;justify-content:center;z-index:10}
@media(min-width:600px){#modal{align-items:center}}
#modal .card{background:#fff;border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:380px;max-height:88vh;overflow-y:auto}
@media(min-width:600px){#modal .card{border-radius:14px}}
#modal h3{margin:0 0 12px;font-size:16px}
#modal label{display:block;font-size:12px;color:#666;margin:10px 0 3px}
#modal input,#modal select{width:100%;padding:11px;border:1px solid #ccc;border-radius:8px;font-size:16px}
#modal .btns{display:flex;gap:8px;margin-top:18px}
#modal button{flex:1;padding:13px;border:0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer}
#save{background:#1a7f3c;color:#fff}#del{background:#fdecea;color:#b8433a}#close{background:#eee}
#roinfo{font-size:12px;color:#888;margin-top:8px}
.half{display:flex;gap:8px}.half>div{flex:1}
</style></head><body>
<header><b>船場美術館 ${ymd.slice(5).replace('-', '/')} (${dow})</b>
<a href="${q(nav(-1))}">◀</a>
<form class="nav" method="get"><input type="hidden" name="key" value="${esc(KEY)}"><input type="date" name="date" value="${ymd}" onchange="this.form.submit()"></form>
<a href="${q(nav(1))}">▶</a><a href="${q(todayYmd)}">오늘</a>
<span class="stats">${evs.length}조 · ${ppl}명 · 최대 동시 ${mc}조${mc >= ROOMS ? ' 🔴만석' : ''}</span></header>
<div class="wrap"><div class="grid">${rows}</div></div>
<div class="legend">빈 칸 탭 = 수동 예약 추가 · 📞수동 탭 = 수정/삭제 · 🎨🟦는 조회만(台帳·Square에서 수정) · 정리 ${RESET}분<i style="background:#b8433a"></i>ぐるなび<i style="background:#2d6bc4"></i>Square<i style="background:#1a7f3c"></i>수동(전화·현장)</div>
<div id="modal"><div class="card">
<h3 id="mtitle">수동 예약 추가</h3>
<div class="half"><div><label>시작 시각</label><select id="f_s">${startOpts}</select></div>
<div><label>시간</label><select id="f_d"><option value="120">2시간</option><option value="180">3시간</option><option value="90">1.5시간</option><option value="60">1시간</option></select></div></div>
<label>이름</label><input id="f_nm" placeholder="예약자 이름">
<label>전화번호</label><input id="f_ph" inputmode="tel" placeholder="090-...">
<div class="half"><div><label>인원</label><select id="f_pp"><option>1</option><option selected>2</option><option>3</option><option>4</option></select></div>
<div><label>경로</label><select id="f_ch"><option>전화</option><option>현장(워크인)</option><option>인스타DM</option><option>기타</option></select></div></div>
<label>코스</label><select id="f_co"><option>캔버스 2h</option><option>캔버스 3h</option><option>고양이 석고</option><option>기타</option></select>
<div id="roinfo" hidden>🎨/🟦 예약은 여기서 수정할 수 없습니다 — ぐるなび台帳 / Square 앱에서 변경하세요.</div>
<div class="btns"><button id="save">저장</button><button id="del" hidden>삭제</button><button id="close">닫기</button></div>
</div></div>
<script>
var KEY=${JSON.stringify(KEY)}, DATE=${JSON.stringify(ymd)}, OPEN=${OPEN}, T=${T};
var editId=null;
var M=document.getElementById('modal');
function $(i){return document.getElementById(i)}
function openNew(startHM){editId=null;$('mtitle').textContent='수동 예약 추가';$('f_s').value=startHM;$('f_d').value='120';$('f_nm').value='';$('f_ph').value='';$('f_pp').value='2';$('f_co').selectedIndex=0;$('f_ch').selectedIndex=0;$('del').hidden=true;$('roinfo').hidden=true;setRO(false);M.style.display='flex'}
function openEdit(b){editId=b.dataset.id;$('mtitle').textContent='예약 수정 (📞수동)';$('f_s').value=b.dataset.s;$('f_d').value=b.dataset.dur;$('f_nm').value=b.dataset.nm;$('f_ph').value=b.dataset.ph;$('f_pp').value=b.dataset.pp||'2';$('f_co').value=b.dataset.co||'캔버스 2h';$('f_ch').value=b.dataset.ch||'전화';$('del').hidden=false;$('roinfo').hidden=true;setRO(false);M.style.display='flex'}
function openRO(b){editId=null;$('mtitle').textContent=b.dataset.src==='gn'?'ぐるなび 예약 (조회만)':'Square 예약 (조회만)';$('f_s').value=b.dataset.s;$('f_d').value=b.dataset.dur;$('f_nm').value=b.dataset.nm;$('f_ph').value='';$('f_pp').value=b.dataset.pp||'2';$('roinfo').hidden=false;$('del').hidden=true;setRO(true);M.style.display='flex'}
function setRO(ro){['f_s','f_d','f_nm','f_ph','f_pp','f_co','f_ch'].forEach(function(i){$(i).disabled=ro});$('save').style.display=ro?'none':''}
document.querySelectorAll('.tl[data-row]').forEach(function(tl){tl.addEventListener('click',function(e){
  if(e.target!==tl)return;
  var m=OPEN*60+Math.floor((e.offsetX/tl.clientWidth)*T/15)*15;
  openNew(String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'));
})});
document.querySelectorAll('.bk').forEach(function(b){b.addEventListener('click',function(e){
  e.stopPropagation();
  if(b.dataset.src==='man')openEdit(b);else openRO(b);
})});
$('close').onclick=function(){M.style.display='none'};
M.addEventListener('click',function(e){if(e.target===M)M.style.display='none'});
$('save').onclick=function(){
  if(!$('f_nm').value.trim()){alert('이름을 입력하세요');return}
  fetch('/api/save?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    id:editId,date:DATE,start:$('f_s').value,dur:Number($('f_d').value),nm:$('f_nm').value.trim(),ph:$('f_ph').value.trim(),pp:$('f_pp').value,co:$('f_co').value,ch:$('f_ch').value
  })}).then(function(r){return r.json()}).then(function(j){if(j.ok)location.reload();else alert(j.error||'실패')}).catch(function(e){alert(e)});
};
$('del').onclick=function(){
  if(!editId||!confirm('이 예약을 삭제할까요?'))return;
  fetch('/api/del?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:editId})})
  .then(function(r){return r.json()}).then(function(j){if(j.ok)location.reload();else alert(j.error||'실패')});
};
setTimeout(function(){location.reload()},300000);
</script></body></html>`;
}

async function readBody(req) {
  let b = ''; for await (const c of req) { b += c; if (b.length > 1e5) throw new Error('too big'); }
  return JSON.parse(b || '{}');
}
async function apiSave(p) {
  if (!p.date || !/^\d{2}:\d{2}$/.test(p.start || '') || !p.dur || !p.nm) throw new Error('입력값 부족');
  const s = toMin(p.start), e = s + Number(p.dur);
  const evs = (await dayEvents(p.date)).filter(ev => ev.id !== p.id);
  const overlapping = evs.filter(ev => ev.s < e && s < ev.e);
  if (overlapping.length >= ROOMS) throw new Error(`그 시간대 이미 ${overlapping.length}조 — 동시 ${ROOMS}조 초과라 등록 불가`);
  if (p.id) {
    const cur = await gcal('GET', '/events/' + encodeURIComponent(p.id));
    if (cur.extendedProperties?.private?.src !== 'manual') throw new Error('수동 예약만 수정할 수 있습니다');
  }
  const ev = {
    summary: `📞 ${p.nm} ${p.pp || '?'}명 (${Number(p.dur) / 60}h)`,
    description: [`경로: ${p.ch || '전화'}`, `코스: ${p.co || ''}`, p.ph ? `전화: ${p.ph}` : null, '수동 등록 (간트 뷰)'].filter(Boolean).join('\n'),
    start: { dateTime: `${p.date}T${p.start}:00`, timeZone: 'Asia/Tokyo' },
    end: { dateTime: `${p.date}T${hm(Math.min(e, 1439))}:00`, timeZone: 'Asia/Tokyo' },
    extendedProperties: { private: { src: 'manual', nm: p.nm, ph: p.ph || '', pp: String(p.pp || ''), co: p.co || '', ch: p.ch || '' } },
  };
  if (p.id) await gcal('PATCH', '/events/' + encodeURIComponent(p.id), ev);
  else await gcal('POST', '/events', ev);
}
async function apiDel(p) {
  const cur = await gcal('GET', '/events/' + encodeURIComponent(p.id));
  if (cur.extendedProperties?.private?.src !== 'manual') throw new Error('수동 예약만 삭제할 수 있습니다');
  await gcal('DELETE', '/events/' + encodeURIComponent(p.id));
}

http.createServer(async (req, res) => {
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  try {
    const u = new URL(req.url, 'http://x');
    if (KEY && u.searchParams.get('key') !== KEY) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('key가 필요합니다: /?key=...'); }
    if (req.method === 'POST' && u.pathname === '/api/save') { try { await apiSave(await readBody(req)); return json(200, { ok: 1 }); } catch (e) { return json(400, { error: e.message }); } }
    if (req.method === 'POST' && u.pathname === '/api/del') { try { await apiDel(await readBody(req)); return json(200, { ok: 1 }); } catch (e) { return json(400, { error: e.message }); } }
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('date') || '') ? u.searchParams.get('date') : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const evs = assignRooms(await dayEvents(ymd));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(render(ymd, evs));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('오류: ' + e.message);
  }
}).listen(PORT, '0.0.0.0', () => console.log(`[booking-view v3] :${PORT} cal=${CAL_ID ? 'ok' : '미설정!'}`));
