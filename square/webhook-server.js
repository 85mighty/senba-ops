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
    const icon = status === 'CANCELLED_BY_CUSTOMER' || status === 'CANCELLED_BY_SELLER' ? '❌' : (type === 'booking.created' ? '🆕' : '✏️');
    const label = status.startsWith('CANCELLED') ? '예약 취소' : (type === 'booking.created' ? '새 예약' : '예약 변경');
    await tg(`${icon} <b>센바 ${label}</b>\n${jst(b.start_at)}${dur}\n방: ${room}\n상태: ${status}${b.customer_note ? '\n메모: ' + b.customer_note : ''}`);
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
