// Square 웹훅 수신 → 텔레그램 알림 (senba, 2026-08-26)
// nginx https://seido-note.com<SQUARE_WEBHOOK_PATH> → 127.0.0.1:8095
const http = require('http');
require('dns').setDefaultResultOrder('ipv4first');   // api.telegram.org IPv6 timeout 회피
const crypto = require('crypto');
const fs = require('fs');

const env = f => Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const SQ = env('/opt/senba-square/.env');
const TG = env('/opt/senba-sales-sync/.env');
const NOTIF_URL = 'https://seido-note.com' + SQ.SQUARE_WEBHOOK_PATH;

async function tg(text) {
  try {
    await fetch(`https://api.telegram.org/bot${TG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch (e) { console.error('tg fail:', e.message); }
}
const yen = n => '¥' + Number(n || 0).toLocaleString('ja-JP');
const jst = iso => { try { return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', weekday: 'short' }); } catch { return iso; } };

// ── 구글캘린더 동기화 (통합 예약 원장) — /opt/senba-sales-sync/.env 에 GCAL_ID 있을 때만 동작 (2026-08-29)
// ACCEPTED 예약만 기록, 취소·거절 시 삭제. 이벤트는 sqid 확장속성으로 추적(중복·수정 안전).
const GCAL_ID = TG.CALENDAR_ID || TG.GCAL_ID || '';   // sales-sync 와 같은 CALENDAR_ID 사용
const ROOMS = 5;
const SA_KEY = '/opt/senba-sales-sync/service-account.json';
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
  return gtok.v;
}
async function gcal(method, path, body) {
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(GCAL_ID) + path, {
    method, headers: { Authorization: 'Bearer ' + await gToken(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return {};
  const j = await r.json(); if (j.error) throw new Error('gcal: ' + j.error.message); return j;
}
// 시간대 겹침 조수 (캘린더의 🎨구루나비·🟦Square 이벤트만 카운트)
async function overlapCount(startISO, mins) {
  const s = new Date(startISO), e = new Date(new Date(startISO).getTime() + mins * 60000);
  const q = await gcal('GET', '/events?singleEvents=true&maxResults=50&timeMin=' + encodeURIComponent(s.toISOString()) + '&timeMax=' + encodeURIComponent(e.toISOString()));
  return (q.items || []).filter(ev => ev.status !== 'cancelled' && /🎨|🟦/.test(ev.summary || '')).length;
}
async function calSync(b, seg, room) {
  if (!GCAL_ID || !b.id) return;
  try {
    const q = await gcal('GET', '/events?maxResults=2&privateExtendedProperty=' + encodeURIComponent('sqid=' + b.id));
    const ex = (q.items || [])[0];
    const gone = (b.status || '').startsWith('CANCELLED') || b.status === 'DECLINED' || b.status === 'NO_SHOW';
    if (gone) { if (ex) await gcal('DELETE', '/events/' + ex.id); return; }
    if (b.status !== 'ACCEPTED') return;   // PENDING(승인 대기)은 확정 후에만 캘린더에
    const start = new Date(b.start_at);
    const end = new Date(start.getTime() + (seg.duration_minutes || 120) * 60000);
    const ev = {
      summary: `🟦Square ${room}${b.customer_note ? ' · ' + b.customer_note.slice(0, 30) : ''}`,
      description: `Square 예약 ${b.id}\n방: ${room}${b.customer_note ? '\n메모: ' + b.customer_note : ''}`,
      start: { dateTime: start.toISOString(), timeZone: 'Asia/Tokyo' },
      end: { dateTime: end.toISOString(), timeZone: 'Asia/Tokyo' },
      extendedProperties: { private: { src: 'square', sqid: b.id } },
    };
    if (ex) await gcal('PATCH', '/events/' + ex.id, ev);
    else await gcal('POST', '/events', ev);
  } catch (e) { console.error('gcal fail:', e.message); }
}

// 스태프 ID → 방 이름 캐시
let teamCache = {};
async function teamName(id) {
  if (!id) return '?';
  if (teamCache[id]) return teamCache[id];
  try {
    const r = await fetch('https://connect.squareup.com/v2/team-members/' + id, { headers: { Authorization: 'Bearer ' + SQ.SQUARE_ACCESS_TOKEN, 'Square-Version': '2025-01-23' } });
    const j = await r.json();
    const t = j.team_member;
    teamCache[id] = t ? `${t.given_name || ''} ${t.family_name || ''}`.trim() : id;
  } catch { teamCache[id] = id; }
  return teamCache[id];
}

async function handleEvent(ev) {
  const type = ev.type;
  if (type === 'booking.created' || type === 'booking.updated') {
    const b = ev.data?.object?.booking || {};
    const seg = (b.appointment_segments || [])[0] || {};
    const room = await teamName(seg.team_member_id);
    const dur = seg.duration_minutes ? ` ${seg.duration_minutes}분` : '';
    const status = b.status || '';
    // 승인제(리퀘스트) 대응: PENDING=승인 대기 → 台帳 확인 후 수락/거절 안내 (2026-08-28)
    let icon, label, extra = '';
    if (status.startsWith('CANCELLED')) { icon = '❌'; label = '예약 취소'; extra = '\n📒 구루나비 台帳에 넣었던 건이면 삭제하세요'; }
    else if (status === 'PENDING') {
      icon = '🙋'; label = '예약 요청 — 승인 대기';
      extra = '\n👉 구루나비 台帳 확인 → 빈 방 있으면 台帳에 기입 후 Square 앱에서 <b>수락</b>, 없으면 <b>거절</b>';
      if (GCAL_ID) {
        try {
          const n = await overlapCount(b.start_at, seg.duration_minutes || 120);
          const free = ROOMS - n;
          extra = `\n📊 그 시간대 예약 ${n}조 → 빈 방 <b>${free}개</b> ${free > 0 ? '○ 승인 가능' : '✕ 만석 — 거절 권장'}` + extra;
        } catch (e) { console.error('avail fail:', e.message); }
      }
    }
    else if (status === 'DECLINED') { icon = '🚫'; label = '요청 거절 완료'; }
    else if (type === 'booking.updated' && status === 'ACCEPTED') { icon = '✅'; label = '예약 확정·변경'; extra = '\n📒 구루나비 台帳 반영 확인'; }
    else if (type === 'booking.created') { icon = '🆕'; label = '새 예약'; }
    else { icon = '✏️'; label = '예약 변경'; }
    await tg(`${icon} <b>센바 ${label}</b>\n${jst(b.start_at)}${dur}\n방: ${room}${status === 'PENDING' ? '' : '\n상태: ' + status}${b.customer_note ? '\n메모: ' + b.customer_note : ''}${extra}`);
    await calSync(b, seg, room);   // 통합 캘린더 반영 (GCAL_ID 설정 시)
  } else if (type === 'payment.created') {
    const p = ev.data?.object?.payment || {};
    if (p.status === 'COMPLETED' || p.status === 'APPROVED') {
      await tg(`💴 <b>센바 Square 결제</b>\n${yen(p.amount_money?.amount)} · ${p.source_type || ''}\n${jst(p.created_at)}`);
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith(SQ.SQUARE_WEBHOOK_PATH)) { res.writeHead(404); return res.end(); }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    // 서명 검증 (구독 생성 후 SIGNATURE_KEY 저장됨)
    const key = env('/opt/senba-square/.env').SQUARE_WEBHOOK_SIGNATURE_KEY;
    if (key) {
      const sig = req.headers['x-square-hmacsha256-signature'] || '';
      const expect = crypto.createHmac('sha256', key).update(NOTIF_URL + body).digest('base64');
      if (sig !== expect) { console.error('서명 불일치 — 무시'); res.writeHead(403); return res.end(); }
    }
    res.writeHead(200); res.end('ok');   // 즉시 200 (Square 재시도 방지)
    try { await handleEvent(JSON.parse(body)); }
    catch (e) { console.error('handle fail:', e.message); }
  });
});
server.listen(8095, '127.0.0.1', () => console.log('[sq-webhook] listening 127.0.0.1:8095, path=' + SQ.SQUARE_WEBHOOK_PATH));
