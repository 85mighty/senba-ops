// 통합 예약 간트 뷰 v4 — 台帳 테마 + 상태 관리(来店待ち/ご来店/お帰り) (2026-08-29)
// http://<서버IP>:3017/?key=...&date=YYYY-MM-DD  · pm2: senba-booking-view
// 색 = 상태 (테두리=来店待ち · 파랑=ご来店 · 초록=お帰り), 채널 = 이모지(🎨ぐるなび·🟦Square·📞수동)
// 빈 칸 탭=수동 예약 추가 / 바 탭=상태 변경(전 채널) + 수동은 수정·삭제
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
const T = (CLOSE - OPEN) * 60;

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
  const j = await r.json();
  if (j.error) throw new Error(`${method} ${j.error.message}${j.error.message === 'Forbidden' ? ' — 캘린더 공유 권한을 "일정 변경"으로 올려주세요 (senba-sync@... 서비스계정)' : ''}`);
  return j;
}

const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const pct = m => ((m - OPEN * 60) / T * 100).toFixed(3) + '%';
const wpct = min => (min / T * 100).toFixed(3) + '%';
const EMOJI = { gn: '🎨', sq: '🟦', man: '📞' };

async function dayEvents(ymd) {
  const min = encodeURIComponent(ymd + 'T00:00:00+09:00'), max = encodeURIComponent(ymd + 'T23:59:59+09:00');
  const j = await gcal('GET', `/events?singleEvents=true&orderBy=startTime&maxResults=100&timeMin=${min}&timeMax=${max}`);
  return (j.items || []).filter(ev => ev.status !== 'cancelled' && /🎨|🟦|📞/.test(ev.summary || '') && ev.start?.dateTime)
    .map(ev => {
      const s = new Date(ev.start.dateTime), e = new Date(ev.end.dateTime);
      const tm = d => Math.round((d.getTime() + 9 * 3600e3) / 60000) % 1440;
      const sum = ev.summary || '';
      const P = ev.extendedProperties?.private || {};
      const desc = ev.description || '';
      return {
        id: ev.id,
        src: sum.includes('🟦') ? 'sq' : sum.includes('📞') ? 'man' : 'gn',
        st: ['in', 'out'].includes(P.st) ? P.st : 'wait',
        rm: /^[0-4]$/.test(P.rm || '') ? Number(P.rm) : -1,
        title: sum.replace(/🎨|🟦|📞/g, '').trim(),
        desc,
        s: tm(s), e: tm(e),
        ppl: Number((sum.match(/(\d+)\s*[명名]/) || [])[1] || P.pp || 0),
        meta: {
          nm: P.nm || '', pp: P.pp || '', co: P.co || '', ch: P.ch || '',
          ph: P.ph || (desc.match(/전화[:：]\s*([\d\-+ ]{8,})/) || [])[1] || '',
        },
      };
    }).sort((a, b) => a.s - b.s || a.e - b.e);
}
function assignRooms(evs) {
  const ends = Array(ROOMS).fill(-9999);
  for (const ev of evs) {   // 수동 지정(rm) 우선, 나머지는 first-fit (시간순)
    if (ev.rm >= 0) { ev.room = ev.rm; ends[ev.rm] = Math.max(ends[ev.rm], ev.e); }
  }
  for (const ev of evs) {
    if (ev.rm >= 0) continue;
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
  const isToday = ymd === todayYmd;
  const nowVisible = isToday && nowMin > OPEN * 60 && nowMin < CLOSE * 60;
  const clampP = pct(Math.min(Math.max(nowMin, OPEN * 60), CLOSE * 60));
  const nowLine = isToday ? `<div class="now" style="left:${clampP};display:${nowVisible ? 'block' : 'none'}"></div>` : '';
  const nowChip = isToday ? `<em class="nowchip" style="left:${clampP};display:${nowVisible ? 'flex' : 'none'}">${hm(nowMin)}</em>` : '';
  const block = (ev, lanes = 1) => {
    const laneStyle = lanes > 1 ? `top:calc(${(ev.lane || 0) * (100 / lanes)}% + 4px);height:calc(${100 / lanes}% - 8px);bottom:auto;` : '';
    return `<div class="bk st-${ev.st}" style="left:${pct(ev.s)};width:${wpct(ev.e - ev.s)};${laneStyle}"` +
    ` data-id="${esc(ev.id)}" data-src="${ev.src}" data-st="${ev.st}" data-rm="${ev.rm}" data-s="${hm(ev.s)}" data-dur="${ev.e - ev.s}"` +
    ` data-nm="${esc(ev.meta.nm || ev.title.replace(/\s*\d+\s*[명名].*$/, ''))}" data-ph="${esc(ev.meta.ph)}" data-pp="${esc(ev.meta.pp || ev.ppl)}" data-co="${esc(ev.meta.co)}" data-ch="${esc(ev.meta.ch)}" data-desc="${esc(ev.desc)}"` +
    ` title="${esc(ev.title + '\n' + hm(ev.s) + '–' + hm(ev.e) + '\n' + ev.desc)}">` +
    `<b>${ev.warn ? '⚠️ ' : ''}${hm(ev.s)}–${hm(ev.e)} · ${ev.ppl || '?'}명</b><span>${EMOJI[ev.src]} ${esc(ev.title.replace(/\s*\d+\s*[명名].*$/, ''))}</span></div>`;
  };
  const rst = ev => {
    if (ev.e >= CLOSE * 60) return '';
    const w = Math.min(RESET, CLOSE * 60 - ev.e);
    return `<div class="rst" style="left:${pct(ev.e)};width:${wpct(w)}"></div>`;
  };
  let hoursCells = '';
  for (let h = OPEN; h < CLOSE; h++) hoursCells += `<i style="left:${pct(h * 60)}">${h}:00</i>`;
  let rows = `<div class="row hd"><div class="rl"></div><div class="tlh">${hoursCells}${nowChip}</div></div>`;
  for (let i = 0; i < ROOMS; i++) {
    const rs = evs.filter(e => e.room === i);
    // 같은 방에서 시간이 겹치면 台帳처럼 레인을 나눠 세로로 쌓고 ⚠️ 표시 (방 수동 이동으로 겹친 경우)
    const laneEnds = [];
    for (const ev of rs) {
      let l = laneEnds.findIndex(en => en <= ev.s);
      if (l < 0) { l = laneEnds.length; laneEnds.push(0); }
      ev.lane = l; laneEnds[l] = ev.e;
    }
    const lanes = Math.max(1, laneEnds.length);
    for (const ev of rs) ev.warn = lanes > 1 && rs.some(o => o !== ev && o.s < ev.e && ev.s < o.e);
    const hStyle = lanes > 1 ? ` style="height:${lanes * 66}px"` : '';
    rows += `<div class="row"><div class="rl">room#${i + 1}${lanes > 1 ? ' ⚠️' : ''}</div><div class="tl" data-row="1"${hStyle}>${nowLine}${rs.map(rst).join('')}${rs.map(ev => block(ev, lanes)).join('')}</div></div>`;
  }
  if (over.length)
    rows += `<div class="row ov"><div class="rl">⚠️ 초과</div><div class="tl">${over.map(block).join('')}</div></div>`;
  let startOpts = '';
  for (let m = OPEN * 60; m <= CLOSE * 60 - 60; m += 15) startOpts += `<option>${hm(m)}</option>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>센바 예약 ${ymd}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,'Noto Sans KR',sans-serif;background:#fff;color:#333;font-size:14px}
header{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 14px;background:#45a0cc;color:#fff}
header b{font-size:17px}header a{color:#fff;text-decoration:none;background:#2f86b1;border-radius:8px;padding:6px 14px;font-size:14px}
.stats{margin-left:auto;font-size:13px}
.wrap{overflow-x:auto;padding:12px 14px 4px;-webkit-overflow-scrolling:touch}
.grid,.tl,.bk,.rl,.tlh{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.grid{width:100%;min-width:860px}
.row{display:flex;align-items:stretch;margin-bottom:0;border-bottom:1px solid #dfe3e6}
.row.hd{border-bottom:0;margin-bottom:0}
.rl{width:84px;flex-shrink:0;font-weight:700;font-size:13px;display:flex;align-items:center;color:#555;position:sticky;left:0;background:#fff;z-index:3;padding-right:6px}
.tlh{position:relative;flex:1;height:34px;background:#68727a;overflow:hidden;
  background-image:repeating-linear-gradient(to right,rgba(255,255,255,.35) 0 1px,transparent 1px calc(100%/${CLOSE - OPEN}))}
.tlh i{position:absolute;top:50%;transform:translateY(-50%);font-style:normal;font-size:15px;font-weight:700;color:#fff;padding-left:7px}
.tl{position:relative;flex:1;height:66px;cursor:copy;background:
  repeating-linear-gradient(to right,rgba(0,0,0,.42) 0 2px,transparent 2px calc(100%/${CLOSE - OPEN})),
  repeating-linear-gradient(to right,rgba(0,0,0,.25) 0 1px,transparent 1px calc(100%/${(CLOSE - OPEN) * 2})),
  repeating-linear-gradient(to right,rgba(0,0,0,.10) 0 1px,transparent 1px calc(100%/${(CLOSE - OPEN) * 4})),
  #fff}
.bk{position:absolute;top:6px;bottom:6px;min-width:58px;border-radius:8px;padding:5px 10px;overflow:hidden;line-height:1.35;cursor:pointer}
.bk b{display:block;font-size:14px;white-space:nowrap;font-weight:600;opacity:.85}
.bk span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700;font-size:18px;margin-top:2px}
.st-wait{background:#fff;border:2px solid #3f9dcb;color:#1f78a6;box-shadow:0 1px 2px rgba(0,0,0,.10)}
.st-in{background:#3f9dcb;border:2px solid #3f9dcb;color:#fff}
.st-out{background:#1b8e6f;border:2px solid #1b8e6f;color:#fff}
.bk.drag{opacity:.75;z-index:5;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:grabbing}
.bk[data-src="man"]{touch-action:none}
.rst{position:absolute;top:6px;bottom:6px;background:#e3e6e9;border-radius:0 8px 8px 0;pointer-events:none}
.ov .tl{background:#fdecea;cursor:default}
.now{position:absolute;top:-1px;bottom:-1px;width:2px;background:#e02020;z-index:2}
.nowchip{position:absolute;top:4px;bottom:4px;display:flex;align-items:center;background:#e02020;color:#fff;font-style:normal;font-weight:700;font-size:13px;padding:0 7px;border-radius:5px;transform:translateX(-50%);z-index:3;white-space:nowrap}
.legend{padding:8px 16px 16px;font-size:12px;color:#777;line-height:2}
.lg{display:inline-block;border-radius:3px;margin:0 4px 0 12px;vertical-align:-2px;width:14px;height:14px}
form.nav{display:inline}input[type=date]{border:0;border-radius:8px;padding:6px 8px;font-size:14px}
@media(min-width:1100px){.tl{height:82px}.bk{padding:8px 12px}.bk b{font-size:16px}.bk span{font-size:22px;margin-top:3px}.rl{font-size:16px;width:104px}.tlh i{font-size:16.5px}body{font-size:15px}}
@media(max-width:600px){
  header{padding:8px 10px}header b{font-size:15px}header a{padding:8px 12px}
  .stats{width:100%;margin-left:0;order:9}
  .grid{min-width:760px}.rl{position:static;width:64px;font-size:11.5px}
  .tl{height:62px}.bk b{font-size:12.5px}.bk span{font-size:15.5px;margin-top:1px}.tlh i{font-size:13px}
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
#save{background:#3f9dcb;color:#fff}#del{background:#fdecea;color:#b8433a}#close{background:#eee}
#roinfo{font-size:12px;color:#888;margin-top:8px}
.half{display:flex;gap:8px}.half>div{flex:1}
.strow{display:flex;gap:6px}
.strow button{flex:1;padding:11px 4px;border-radius:9px;font-size:13.5px;font-weight:700;cursor:pointer;border:2px solid #ccc;background:#fff;color:#666}
.strow button[data-st=wait].on{border-color:#3f9dcb;color:#1f78a6}
.strow button[data-st=in].on{background:#3f9dcb;border-color:#3f9dcb;color:#fff}
.strow button[data-st=out].on{background:#1b8e6f;border-color:#1b8e6f;color:#fff}
</style></head><body>
<header><b>船場美術館 ${ymd.slice(5).replace('-', '/')} (${dow})</b>
<a href="${q(nav(-1))}">◀</a>
<form class="nav" method="get"><input type="hidden" name="key" value="${esc(KEY)}"><input type="date" name="date" value="${ymd}" onchange="this.form.submit()"></form>
<a href="${q(nav(1))}">▶</a><a href="${q(todayYmd)}">오늘</a>
<span class="stats">${evs.length}조 · ${ppl}명 · 최대 동시 ${mc}조${mc >= ROOMS ? ' 🔴만석' : ''}</span></header>
<div class="wrap"><div class="grid">${rows}</div></div>
<div class="legend">빈 칸 탭 = 수동 예약 추가 · 바 탭 = 상태·시각 변경(전 채널) · 바 길게 눌러 좌우 드래그 = 시간 이동 · 정리 ${RESET}분
<br>상태: <span class="lg" style="background:#fff;border:2px solid #3f9dcb"></span>来店待ち <span class="lg" style="background:#3f9dcb"></span>ご来店 <span class="lg" style="background:#1b8e6f"></span>お帰り
 · 채널: 🎨ぐるなび 🟦Square 📞수동(전화·현장)</div>
<div id="modal"><div class="card">
<h3 id="mtitle">수동 예약 추가</h3>
<div id="strow_wrap" hidden><label>상태</label><div class="strow" id="strow">
<button data-st="wait">来店待ち</button><button data-st="in">ご来店</button><button data-st="out">お帰り</button>
</div>
<label>방 이동</label><select id="f_rm"><option value="-1">자동 배정</option><option value="0">room#1</option><option value="1">room#2</option><option value="2">room#3</option><option value="3">room#4</option><option value="4">room#5</option></select></div>
<div class="half"><div><label>시작 시각</label><select id="f_s">${startOpts}</select></div>
<div><label>시간</label><select id="f_d"><option value="120">2시간</option><option value="180">3시간</option><option value="90">1.5시간</option><option value="60">1시간</option></select></div></div>
<label>이름</label><input id="f_nm" placeholder="예약자 이름">
<label>전화번호</label><input id="f_ph" inputmode="tel" placeholder="090-...">
<div class="half"><div><label>인원</label><select id="f_pp"><option>1</option><option selected>2</option><option>3</option><option>4</option></select></div>
<div><label>경로</label><select id="f_ch"><option>전화</option><option>현장(워크인)</option><option>인스타DM</option><option>기타</option></select></div></div>
<label>코스</label><select id="f_co"><option>캔버스 2h</option><option>캔버스 3h</option><option>고양이 석고</option><option>기타</option></select>
<div id="rodesc" hidden style="white-space:pre-wrap;font-size:13px;background:#f6f5f1;border-radius:8px;padding:10px;margin-top:10px;max-height:180px;overflow-y:auto"></div>
<div id="roinfo" hidden>🎨/🟦 시간·방 변경은 이 보드(캘린더)에만 반영됩니다 — 실제 예약은 ぐるなび台帳 / Square 앱에서 변경하세요. 이름·인원은 여기서 수정 불가.</div>
<div class="btns"><button id="save">저장</button><button id="del" hidden>삭제</button><button id="close">닫기</button></div>
</div></div>
<script>
var KEY=${JSON.stringify(KEY)}, DATE=${JSON.stringify(ymd)}, OPEN=${OPEN}, T=${T};
var editId=null, curId=null;
var M=document.getElementById('modal');
function $(i){return document.getElementById(i)}
function markSt(st){document.querySelectorAll('#strow button').forEach(function(x){x.classList.toggle('on',x.dataset.st===st)})}
function openNew(startHM){editId=null;curId=null;$('mtitle').textContent='수동 예약 추가';$('f_s').value=startHM;$('f_d').value='120';$('f_nm').value='';$('f_ph').value='';$('f_pp').value='2';$('f_co').selectedIndex=0;$('f_ch').selectedIndex=0;$('del').hidden=true;$('roinfo').hidden=true;$('rodesc').hidden=true;$('strow_wrap').hidden=true;setRO(false);M.style.display='flex'}
function openEdit(b){editId=b.dataset.id;curId=b.dataset.id;$('mtitle').textContent='예약 수정 (📞수동)';$('f_s').value=b.dataset.s;$('f_d').value=b.dataset.dur;$('f_nm').value=b.dataset.nm;$('f_ph').value=b.dataset.ph;$('f_pp').value=b.dataset.pp||'2';$('f_co').value=b.dataset.co||'캔버스 2h';$('f_ch').value=b.dataset.ch||'전화';$('f_rm').value=b.dataset.rm;$('del').hidden=false;$('roinfo').hidden=true;$('rodesc').hidden=true;$('strow_wrap').hidden=false;markSt(b.dataset.st);setRO(false);M.style.display='flex'}
function openRO(b){editId=null;curId=b.dataset.id;$('mtitle').textContent=b.dataset.src==='gn'?'ぐるなび 예약':'Square 예약';$('f_s').value=b.dataset.s;setDurOpt(b.dataset.dur);$('f_nm').value=b.dataset.nm;$('f_ph').value=b.dataset.ph;$('f_pp').value=b.dataset.pp||'2';$('f_rm').value=b.dataset.rm;$('rodesc').textContent=b.dataset.desc||'';$('rodesc').hidden=!b.dataset.desc;$('roinfo').hidden=false;$('del').hidden=true;$('strow_wrap').hidden=false;markSt(b.dataset.st);setRO(true);M.style.display='flex'}
function setRO(ro){['f_nm','f_ph','f_pp','f_co','f_ch'].forEach(function(i){$(i).disabled=ro});$('f_s').disabled=false;$('f_d').disabled=false;$('save').style.display=''}
function setDurOpt(v){var d=$('f_d');d.querySelectorAll('option[data-tmp]').forEach(function(o){o.remove()});d.value=String(v);if(d.value!==String(v)){var o=document.createElement('option');o.value=String(v);o.dataset.tmp='1';o.textContent=(v/60)+'시간';d.appendChild(o);d.value=String(v)}}
document.querySelectorAll('.tl[data-row]').forEach(function(tl){tl.addEventListener('click',function(e){
  if(e.target!==tl)return;
  var m=OPEN*60+Math.floor((e.offsetX/tl.clientWidth)*T/15)*15;
  openNew(String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'));
})});
document.querySelectorAll('.bk').forEach(function(b){b.addEventListener('click',function(e){
  e.stopPropagation();
  if(window.__dragJust){window.__dragJust=false;return}
  if(b.dataset.src==='man')openEdit(b);else openRO(b);
})});
document.querySelectorAll('#strow button').forEach(function(x){x.addEventListener('click',function(){
  if(!curId)return;
  fetch('/api/status?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:curId,st:x.dataset.st})})
  .then(function(r){return r.json()}).then(function(j){if(j.ok)location.reload();else alert(j.error||'실패')});
})});
$('f_rm').addEventListener('change',function(){
  if(!curId)return;
  fetch('/api/room?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:curId,rm:$('f_rm').value})})
  .then(function(r){return r.json()}).then(function(j){if(j.ok)location.reload();else alert(j.error||'실패')});
});
// 길게(0.35초) 누르면 좌우 드래그로 시간 이동 — 전 채널, 15분 스냅 (🎨/🟦는 보드에만 반영)
(function(){
  var dragEl=null,armed=false,sx=0,orig=0,dur=0,tlW=1,newS=null,lpTimer=null;
  document.querySelectorAll('.bk').forEach(function(b){
    b.addEventListener('pointerdown',function(e){
      sx=e.clientX;orig=null;newS=null;armed=false;dragEl=b;
      var p=b.parentElement;tlW=p.clientWidth;dur=Number(b.dataset.dur);
      var hmv=b.dataset.s.split(':');orig=Number(hmv[0])*60+Number(hmv[1]);
      try{b.setPointerCapture(e.pointerId)}catch(_){}
      lpTimer=setTimeout(function(){armed=true;b.classList.add('drag');if(navigator.vibrate)navigator.vibrate(30)},350);
    });
    b.addEventListener('touchmove',function(e){if(armed&&dragEl===b)e.preventDefault()},{passive:false});
  });
  document.addEventListener('pointermove',function(e){
    if(!dragEl)return;
    var dx=e.clientX-sx;
    if(!armed){if(Math.abs(dx)>8){clearTimeout(lpTimer);dragEl=null}return}
    var dm=Math.round(dx/tlW*T/15)*15;
    var s=Math.min(Math.max(orig+dm,OPEN*60),OPEN*60+T-dur);
    newS=s;
    dragEl.style.left=((s-OPEN*60)/T*100)+'%';
    var bEl=dragEl.querySelector('b');
    if(bEl)bEl.textContent=fmtHM(s)+'–'+fmtHM(s+dur)+' · '+(dragEl.dataset.pp||'?')+'명';
  });
  document.addEventListener('pointerup',function(){
    clearTimeout(lpTimer);
    if(dragEl&&armed)window.__dragJust=true;
    if(dragEl&&armed&&newS!==null&&newS!==orig){
      var el=dragEl;
      fetch('/api/move?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:el.dataset.id,start:fmtHM(newS)})})
      .then(function(r){return r.json()}).then(function(j){if(j.ok)location.reload();else{alert(j.error||'실패');location.reload()}});
    }else if(dragEl&&armed){location.reload()}
    if(dragEl)dragEl.classList.remove('drag');
    dragEl=null;armed=false;
  });
  document.addEventListener('pointercancel',function(){
    clearTimeout(lpTimer);
    if(dragEl){dragEl.classList.remove('drag');if(armed)location.reload()}
    dragEl=null;armed=false;
  });
  function fmtHM(m){return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')}
})();
$('close').onclick=function(){M.style.display='none'};
M.addEventListener('click',function(e){if(e.target===M)M.style.display='none'});
$('save').onclick=function(){
  if(!editId&&curId){ // 🎨/🟦: 시각·시간만 보드(캘린더)에 반영
    fetch('/api/move?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:curId,start:$('f_s').value,dur:Number($('f_d').value)||0})})
    .then(function(r){return r.json()}).then(function(j){if(j.ok)location.reload();else alert(j.error||'실패')}).catch(function(e){alert(e)});
    return;
  }
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
var IS_TODAY=${JSON.stringify(ymd === todayYmd)};
function tickNow(){
  if(!IS_TODAY)return;
  var n=new Date(Date.now()+9*3600e3);
  var m=n.getUTCHours()*60+n.getUTCMinutes();
  var vis=m>OPEN*60&&m<OPEN*60+T;
  var left=((Math.min(Math.max(m,OPEN*60),OPEN*60+T)-OPEN*60)/T*100)+'%';
  document.querySelectorAll('.now').forEach(function(el){el.style.left=left;el.style.display=vis?'block':'none'});
  var c=document.querySelector('.nowchip');
  if(c){c.style.left=left;c.style.display=vis?'flex':'none';
    c.textContent=String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')}
}
tickNow();setInterval(tickNow,30000);
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
  let prevSt = 'wait';
  if (p.id) {
    const cur = await gcal('GET', '/events/' + encodeURIComponent(p.id));
    if (cur.extendedProperties?.private?.src !== 'manual') throw new Error('수동 예약만 수정할 수 있습니다');
    prevSt = cur.extendedProperties.private.st || 'wait';
  }
  const ev = {
    summary: `📞 ${p.nm} ${p.pp || '?'}명 (${Number(p.dur) / 60}h)`,
    description: [`경로: ${p.ch || '전화'}`, `코스: ${p.co || ''}`, p.ph ? `전화: ${p.ph}` : null, '수동 등록 (간트 뷰)'].filter(Boolean).join('\n'),
    start: { dateTime: `${p.date}T${p.start}:00`, timeZone: 'Asia/Tokyo' },
    end: { dateTime: `${p.date}T${hm(Math.min(e, 1439))}:00`, timeZone: 'Asia/Tokyo' },
    extendedProperties: { private: { src: 'manual', st: prevSt, nm: p.nm, ph: p.ph || '', pp: String(p.pp || ''), co: p.co || '', ch: p.ch || '' } },
  };
  if (p.id) await gcal('PATCH', '/events/' + encodeURIComponent(p.id), ev);
  else await gcal('POST', '/events', ev);
}
async function apiDel(p) {
  const cur = await gcal('GET', '/events/' + encodeURIComponent(p.id));
  if (cur.extendedProperties?.private?.src !== 'manual') throw new Error('수동 예약만 삭제할 수 있습니다');
  await gcal('DELETE', '/events/' + encodeURIComponent(p.id));
}
async function apiMove(p) {   // 시간 이동 — 전 채널 (🎨/🟦는 이 보드의 캘린더에만 반영, 台帳·Square 원본은 별도 변경 필요)
  if (!p.id || !/^\d{2}:\d{2}$/.test(p.start || '')) throw new Error('입력값 부족');
  const cur = await gcal('GET', '/events/' + encodeURIComponent(p.id));
  const date = (cur.start.dateTime || '').slice(0, 10);
  const durMin = Number(p.dur) > 0 ? Number(p.dur) : Math.round((new Date(cur.end.dateTime) - new Date(cur.start.dateTime)) / 60000);
  const s = toMin(p.start);
  await gcal('PATCH', '/events/' + encodeURIComponent(p.id), {
    start: { dateTime: `${date}T${p.start}:00`, timeZone: 'Asia/Tokyo' },
    end: { dateTime: `${date}T${hm(Math.min(s + durMin, 1439))}:00`, timeZone: 'Asia/Tokyo' },
  });
}
async function apiRoom(p) {   // 방 수동 지정 — 전 채널 (우리 화면의 배정 오버레이)
  if (!p.id || !/^-?[0-4]$|^-1$/.test(String(p.rm))) throw new Error('입력값 부족');
  const cur = await gcal('GET', '/events/' + encodeURIComponent(p.id));
  const priv = { ...(cur.extendedProperties?.private || {}), rm: Number(p.rm) >= 0 ? String(p.rm) : '' };
  await gcal('PATCH', '/events/' + encodeURIComponent(p.id), { extendedProperties: { private: priv } });
}
async function apiStatus(p) {
  if (!p.id || !['wait', 'in', 'out'].includes(p.st)) throw new Error('입력값 부족');
  const cur = await gcal('GET', '/events/' + encodeURIComponent(p.id));
  const priv = { ...(cur.extendedProperties?.private || {}), st: p.st };
  await gcal('PATCH', '/events/' + encodeURIComponent(p.id), { extendedProperties: { private: priv } });
}

http.createServer(async (req, res) => {
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  try {
    const u = new URL(req.url, 'http://x');
    if (KEY && u.searchParams.get('key') !== KEY) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('key가 필요합니다: /?key=...'); }
    if (req.method === 'POST' && u.pathname === '/api/save') { try { await apiSave(await readBody(req)); return json(200, { ok: 1 }); } catch (e) { return json(400, { error: e.message }); } }
    if (req.method === 'POST' && u.pathname === '/api/del') { try { await apiDel(await readBody(req)); return json(200, { ok: 1 }); } catch (e) { return json(400, { error: e.message }); } }
    if (req.method === 'POST' && u.pathname === '/api/status') { try { await apiStatus(await readBody(req)); return json(200, { ok: 1 }); } catch (e) { return json(400, { error: e.message }); } }
    if (req.method === 'POST' && u.pathname === '/api/move') { try { await apiMove(await readBody(req)); return json(200, { ok: 1 }); } catch (e) { return json(400, { error: e.message }); } }
    if (req.method === 'POST' && u.pathname === '/api/room') { try { await apiRoom(await readBody(req)); return json(200, { ok: 1 }); } catch (e) { return json(400, { error: e.message }); } }
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('date') || '') ? u.searchParams.get('date') : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const evs = assignRooms(await dayEvents(ymd));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(render(ymd, evs));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('오류: ' + e.message);
  }
}).listen(PORT, '0.0.0.0', () => console.log(`[booking-view v4] :${PORT} cal=${CAL_ID ? 'ok' : '미설정!'}`));
