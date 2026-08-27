// 센바 알바 근태 봇 v1 — 텔레그램 출근/퇴근 버튼 → 근무시간·일급 계산 → 자산현황 '알바근태' 탭 (2026-08-27)
// 알바용 별도 봇(ATTEND_BOT_TOKEN)으로 롱폴링 동작. pm2: senba-attend-bot
//
// 인정 규칙 (사용자 확정):
//   출근: 기준출근(12:30/13:30, shift-cron-v1 과 동일 판정을 당일 예약으로 계산) 이전에 눌러도 기준출근부터
//         예) 12:30 출근일에 12:26 도착 → 12:30부터 계산
//   퇴근: 기준퇴근(18:30) 이전에 누르면 분단위 그대로 (18:25 퇴근 → 18:25, 정리 늦어 18:20 → 18:20)
//         기준퇴근 이후에 누르면 기준퇴근으로 절사 (18:32 → 18:30)
//         단, 마지막 예약 종료+정리 ATTEND_CLEANUP_MIN(30)분이 18:30을 넘는 날은 그 시각까지 분단위 인정
//   그 외 예외는 /수정 HH:MM HH:MM 으로 입력한 값 그대로 기록
//
// 매일 ATTEND_POST_HOUR(10)시 JST에 오늘 출근시간 + [出勤] 버튼 메시지 발송, 21시에 퇴근 미기록 리마인드.
// 시트 기록: 자산현황 스프레드시트 '알바근태' 탭 (없으면 자동 생성), 같은 날짜 행은 덮어씀.
require('dns').setDefaultResultOrder('ipv4first');
const fs = require('fs');
const crypto = require('crypto');

const envOf = f => { try { return Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])); } catch { return {}; } };
const A = envOf('/opt/senba-attend/.env');          // 근태 봇 설정
const SQ = envOf('/opt/senba-square/.env');         // Square (기준출근·마지막 예약 판정)
const OWN = envOf('/opt/senba-sales-sync/.env');    // 사장님 알림용 기존 봇 (없어도 동작)

const BOT = A.ATTEND_BOT_TOKEN;
const CHAT = String(A.ATTEND_CHAT_ID || '');
const ADMIN_CHAT = String(A.ATTEND_ADMIN_CHAT_ID || '');   // 선택: 사장님이 이 봇과 대화하며 /수정 등을 쓸 채팅
const WAGE = Number(A.ATTEND_WAGE || 1200);
const END_HM = A.ATTEND_END || '18:30';
const CLEANUP = Number(A.ATTEND_CLEANUP_MIN || 30);
const POST_HOUR = Number(A.ATTEND_POST_HOUR || 10);
const SHEET_ID = A.ATTEND_SHEET_ID || '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '알바근태';
const KEYFILE = A.ATTEND_KEYFILE || '/opt/senba-sales-sync/service-account.json';
const STATE_FILE = '/opt/senba-attend/state.json';

// ── 시간 유틸 (JST) ──────────────────────────────────────────────
const jstNow = () => new Date(Date.now() + 9 * 3600e3);   // getUTC* 로 읽으면 JST
const ymdOf = d => d.toISOString().slice(0, 10);
const hmOf = d => d.toISOString().slice(11, 16);
const dayLabel = d => d.toISOString().slice(5, 10).replace('-', '/') + '(' + '日月火水木金土'[d.getUTCDay()] + ')';
const toM = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const toHM = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const fmtDur = min => `${Math.floor(min / 60)}時間${String(min % 60).padStart(2, '0')}分`;
const yen = n => '¥' + Number(n || 0).toLocaleString('ja-JP');
const jstHM = iso => new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });

// ── 상태 파일 ────────────────────────────────────────────────────
const load = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { days: {} }; } };
const save = st => fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 1));

// ── 텔레그램 ─────────────────────────────────────────────────────
const api = async (method, body) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${BOT}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const j = await r.json(); if (!j.ok) console.error(method, 'fail:', j.description); return j;
    } catch (e) {
      if (i >= 2 || method === 'getUpdates') throw e;   // 롱폴링은 poll 루프가 자체 재시도
      console.error(method, 'retry', i + 1, '-', e.cause?.code || e.message);
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
};
const send = (text, rm) => api('sendMessage', { chat_id: CHAT, text, parse_mode: 'HTML', ...(rm ? { reply_markup: rm } : {}) });
const answerCb = (id, text) => api('answerCallbackQuery', { callback_query_id: id, text });
const ownerTg = async text => {
  if (!OWN.TELEGRAM_BOT_TOKEN || !OWN.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${OWN.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: OWN.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }) }).catch(e => console.error('owner tg fail:', e.message));
};
const BTN_IN = '▶️ 出勤 (출근)', BTN_OUT = '⏹ 退勤 (퇴근)';
// 입력창 위 상시 대형 버튼 (그룹에서는 봇이 관리자여야 누른 메시지를 수신함)
// 출근 전엔 [出勤]만 → 출근 후엔 [退勤]만 → 퇴근하면 버튼 제거
const RM_IN = { keyboard: [[{ text: BTN_IN }]], resize_keyboard: true, is_persistent: true };
const RM_OUT = { keyboard: [[{ text: BTN_OUT }]], resize_keyboard: true, is_persistent: true };
const RM_NONE = { remove_keyboard: true };

// ── Square: 오늘 기준출근·예약 정보 (shift-cron-v1 과 동일 규칙) ─
async function todayInfo(ymd) {
  try {
    const r = await fetch(`https://connect.squareup.com/v2/bookings?location_id=${SQ.SQUARE_LOCATION_ID}&start_at_min=${ymd}T00:00:00%2B09:00&start_at_max=${ymd}T23:59:59%2B09:00&limit=100`,
      { headers: { Authorization: 'Bearer ' + SQ.SQUARE_ACCESS_TOKEN, 'Square-Version': '2025-01-23' } });
    const j = await r.json(); if (j.errors?.length) throw new Error(JSON.stringify(j.errors));
    const bs = (j.bookings || []).filter(b => ['ACCEPTED', 'PENDING'].includes(b.status) && b.customer_id !== SQ.SQUARE_BLOCK_CUSTOMER_ID);
    bs.sort((a, b) => a.start_at.localeCompare(b.start_at));
    const first = bs[0] ? jstHM(bs[0].start_at) : null;
    let lastEnd = null;   // 마지막 예약 종료(JST 분)
    for (const b of bs) {
      const end = toM(jstHM(b.start_at)) + (b.appointment_segments?.[0]?.duration_minutes || 60);
      if (lastEnd === null || end > lastEnd) lastEnd = end;
    }
    return { sched: first && first < '13:45' ? '12:30' : '13:30', first, count: bs.length, lastEnd };
  } catch (e) {
    console.error('square fail:', e.message);
    return { sched: '13:30', first: null, count: null, lastEnd: null, err: e.message };
  }
}

// ── Google Sheets (서비스계정 JWT, 의존성 없음) ──────────────────
let gtok = { v: null, exp: 0 };
async function gToken() {
  if (Date.now() < gtok.exp - 60e3) return gtok.v;
  const sa = JSON.parse(fs.readFileSync(KEYFILE, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: sa.token_uri, iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const r = await fetch(sa.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + unsigned + '.' + sig });
  const j = await r.json(); if (!j.access_token) throw new Error('gauth: ' + JSON.stringify(j));
  gtok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return gtok.v;
}
const gs = async (method, path, body) => {
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + path, { method, headers: { Authorization: 'Bearer ' + await gToken(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (j.error) throw new Error('sheets: ' + j.error.message); return j;
};
const HEADER = ['날짜', '요일', '이름', '출근누름', '퇴근누름', '인정출근', '인정퇴근', '근무시간', '분', '일급(¥)', '비고'];
async function ensureTab() {
  const meta = await gs('GET', '?fields=sheets.properties(title)');
  if (meta.sheets?.some(s => s.properties.title === TAB)) return;
  await gs('POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title: TAB } } }] });
  await gs('PUT', '/values/' + encodeURIComponent(`${TAB}!A1:K1`) + '?valueInputOption=RAW', { values: [HEADER] });
}
async function upsertRow(ymd, row) {     // 같은 날짜 행이 있으면 덮어쓰고 없으면 추가
  await ensureTab();
  const col = await gs('GET', '/values/' + encodeURIComponent(`${TAB}!A:A`));
  const idx = (col.values || []).findIndex((v, i) => i > 0 && v[0] === ymd);
  if (idx > 0) await gs('PUT', '/values/' + encodeURIComponent(`${TAB}!A${idx + 1}:K${idx + 1}`) + '?valueInputOption=RAW', { values: [row] });
  else await gs('POST', '/values/' + encodeURIComponent(`${TAB}!A:K`) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { values: [row] });
}
const rowOf = (ymd, rec) => [ymd, '日月火水木金土'[new Date(ymd + 'T00:00:00Z').getUTCDay()], rec.name || '', rec.inAt || '', rec.outAt || '', rec.effIn || '', rec.effOut || '', fmtDur(rec.min || 0), rec.min || 0, rec.wage || 0, rec.note || ''];
async function writeSheet(ymd, rec) {
  try { await upsertRow(ymd, rowOf(ymd, rec)); }
  catch (e) { console.error('sheet fail:', e.message); await ownerTg('⚠️ 알바근태 시트 기록 실패 (' + ymd + '): ' + e.message); }
}

// ── 출근/퇴근 처리 ───────────────────────────────────────────────
async function clockIn(name) {
  const now = jstNow(), ymd = ymdOf(now), hm = hmOf(now);
  const st = load(); const rec = st.days[ymd] ||= {};
  if (rec.outAt) return { err: `오늘은 이미 퇴근 처리됐어요 (${rec.outAt})` };
  if (rec.inAt) return { err: `이미 출근 처리됨 (${rec.inAt} → 인정 ${rec.effIn})` };
  if (!rec.sched) { const info = await todayInfo(ymd); rec.sched = info.sched; rec.first = info.first; rec.count = info.count; }
  rec.inAt = hm;
  rec.effIn = toHM(Math.max(toM(hm), toM(rec.sched)));
  rec.name = name || rec.name || '';
  save(st);
  const text = `🗓 <b>${dayLabel(now)}</b> 基準出勤 ${rec.sched}\n▶️ 出勤 ${hm} → 認定 <b>${rec.effIn}</b>\nお疲れさまです！帰るとき下の [⏹ 退勤] を押してください`;
  return { rec, ymd, text, rm: RM_OUT };
}
async function clockOut() {
  const now = jstNow(), ymd = ymdOf(now), hm = hmOf(now);
  const st = load(); const rec = st.days[ymd];
  if (!rec?.inAt) return { err: '오늘 출근 기록이 없어요. 먼저 [出勤]을 눌러주세요' };
  if (rec.outAt) return { err: `이미 퇴근 처리됨 (${rec.outAt} → 인정 ${rec.effOut})` };
  const info = await todayInfo(ymd);   // 마지막 예약이 늦게 끝나는 날은 종료+정리까지 인정
  const cap = Math.max(toM(END_HM), info.lastEnd ? info.lastEnd + CLEANUP : 0);
  rec.outAt = hm;
  rec.effOut = toHM(Math.min(toM(hm), cap));
  rec.min = Math.max(0, toM(rec.effOut) - toM(rec.effIn));
  rec.wage = Math.round(rec.min * WAGE / 60);
  save(st);
  await writeSheet(ymd, rec);
  await ownerTg(`👷 <b>센바 알바 퇴근</b> ${dayLabel(now)}\n${rec.effIn} → ${rec.effOut} = <b>${fmtDur(rec.min)}</b> · ${yen(rec.wage)} (시급 ${WAGE})\n(누름: 출근 ${rec.inAt} / 퇴근 ${rec.outAt})`);
  const text = `🗓 <b>${dayLabel(now)}</b> 勤務終了 ✅\n▶️ ${rec.inAt} → ⏹ ${rec.outAt}\n認定 ${rec.effIn}〜${rec.effOut} = <b>${fmtDur(rec.min)}</b>\n💴 ${yen(rec.wage)}\nお疲れさまでした！`;
  return { rec, ymd, text, rm: RM_NONE };
}

// ── 명령 처리 ────────────────────────────────────────────────────
async function handleCommand(text, chatId) {
  const now = jstNow();
  if (/^\/(출근|出勤|in\b)/.test(text)) {
    const r = await clockIn('');
    return r.err ? send(r.err) : send(r.text, r.rm);
  }
  if (/^\/(퇴근|退勤|out\b)/.test(text)) {
    const r = await clockOut();
    return r.err ? send(r.err) : send(r.text, r.rm);
  }
  if (/^\/(오늘|今日|today\b)/.test(text)) {
    const rec = load().days[ymdOf(now)];
    if (!rec?.inAt) return send('오늘 출근 기록 없음');
    return send(rec.outAt ? `오늘: ${rec.effIn}〜${rec.effOut} = ${fmtDur(rec.min)} · ${yen(rec.wage)}` : `오늘: ${rec.effIn} 출근, 근무 중`);
  }
  if (/^\/(이번달|今月|month\b)/.test(text)) {
    const ym = ymdOf(now).slice(0, 7);
    const days = Object.entries(load().days).filter(([d, r]) => d.startsWith(ym) && r.min > 0);
    const min = days.reduce((s, [, r]) => s + r.min, 0), pay = days.reduce((s, [, r]) => s + r.wage, 0);
    return send(`📊 <b>${ym}</b> 근무 ${days.length}일\n합계 <b>${fmtDur(min)}</b> · <b>${yen(pay)}</b> (시급 ${WAGE})`);
  }
  const m = text.match(/^\/(수정|修正|fix)(?:\s+(\d{1,2})\/(\d{1,2}))?\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})/);
  if (m) {   // /수정 [M/D] HH:MM HH:MM — 입력값 그대로(절사 없이) 기록
    const d = new Date(now); if (m[2]) { d.setUTCMonth(Number(m[2]) - 1, Number(m[3])); if (d > now) d.setUTCFullYear(d.getUTCFullYear() - 1); }
    const ymd = ymdOf(d);
    const pad = t => t.padStart(5, '0');
    const inHM = pad(m[4]), outHM = pad(m[5]);
    if (toM(outHM) <= toM(inHM)) return send('퇴근이 출근보다 빠릅니다: ' + inHM + ' → ' + outHM);
    const st = load(); const rec = st.days[ymd] ||= {};
    Object.assign(rec, { inAt: inHM, outAt: outHM, effIn: inHM, effOut: outHM, min: toM(outHM) - toM(inHM), note: '수동수정' });
    rec.wage = Math.round(rec.min * WAGE / 60);
    save(st);
    await writeSheet(ymd, rec);
    return send(`✏️ ${ymd} 수정: ${inHM}〜${outHM} = ${fmtDur(rec.min)} · ${yen(rec.wage)}`);
  }
  if (text.startsWith('/')) return send('명령: /출근(/in) /퇴근(/out) /오늘(/today) /이번달(/month) /수정(/fix) [M/D] HH:MM HH:MM');
}

async function handle(u) {
  if (u.callback_query) {   // 예전 메시지의 인라인 버튼 (지금은 하단 대형 버튼이 기본)
    const cq = u.callback_query;
    if (String(cq.message?.chat?.id) !== CHAT) return answerCb(cq.id, '');
    const r = cq.data === 'in' ? await clockIn(cq.from?.first_name) : cq.data === 'out' ? await clockOut() : { err: '?' };
    if (r.err) return answerCb(cq.id, r.err);
    await answerCb(cq.id, cq.data === 'in' ? '출근 기록 완료' : '퇴근 기록 완료');
    await api('editMessageReplyMarkup', { chat_id: CHAT, message_id: cq.message.message_id });   // 누른 인라인 버튼 제거
    await send(r.text, r.rm);
  } else if (u.message?.text) {
    const chatId = String(u.message.chat.id);
    if (chatId !== CHAT && chatId !== ADMIN_CHAT) return;
    const text = u.message.text.trim();
    if (text === BTN_IN || /^▶/.test(text)) {         // 하단 대형 버튼 (출근)
      const r = await clockIn(u.message.from?.first_name);
      return r.err ? send(r.err) : send(r.text, r.rm);
    }
    if (text === BTN_OUT || /^⏹/.test(text)) {        // 하단 대형 버튼 (퇴근)
      const r = await clockOut();
      return r.err ? send(r.err) : send(r.text, r.rm);
    }
    await handleCommand(text, chatId);
  }
}

// ── 매일 아침 출근 안내 + 밤 퇴근 미기록 리마인드 ────────────────
async function postDaily() {
  const now = jstNow(), ymd = ymdOf(now);
  const info = await todayInfo(ymd);
  const st = load(); const rec = st.days[ymd] ||= {};
  Object.assign(rec, { sched: info.sched, first: info.first, count: info.count, posted: true });
  save(st);
  const j = await send(`🗓 <b>${dayLabel(now)}</b> おはようございます\n🕐 出勤 <b>${info.sched}</b>${info.first ? ` (最初の予約 ${info.first} · ${info.count}件)` : info.count === 0 ? ' (予約なし)' : ''}\n👇 着いたら下の <b>[▶️ 出勤]</b> ボタンを押してください`, RM_IN);
  if (j.result?.message_id) await api('pinChatMessage', { chat_id: CHAT, message_id: j.result.message_id, disable_notification: true });   // 봇이 관리자면 상단 고정
}
async function tick() {
  const now = jstNow(), ymd = ymdOf(now), h = now.getUTCHours(), curM = h * 60 + now.getUTCMinutes();
  const st = load(); const rec = st.days[ymd] ||= {};
  if (h === POST_HOUR && !rec.posted) { rec.posted = true; save(st); await postDaily().catch(e => console.error('post fail:', e.message)); }
  // 출근 30분 전 리마인드 (12:30 출근→12:00, 13:30 출근→13:00)
  if (rec.sched && !rec.inAt && !rec.remIn && curM >= toM(rec.sched) - 30 && curM < toM(rec.sched) + 60) {
    rec.remIn = true; save(st);
    await send(`🔔 今日の出勤は <b>${rec.sched}</b> です\n👇 着いたら下の [▶️ 出勤] ボタンを押してください`, RM_IN);
  }
  // 17시: 퇴근 버튼 미리 리마인드
  if (h >= 17 && rec.inAt && !rec.outAt && !rec.remOut) {
    rec.remOut = true; save(st);
    await send('🔔 帰るとき、下の [⏹ 退勤] ボタンを忘れずに押してください！', RM_OUT);
  }
  if (h === 21 && rec.inAt && !rec.outAt && !rec.reminded) {
    rec.reminded = true; save(st);
    await send('⚠️ 退勤ボタンが押されていません！[⏹ 退勤] を押すか /수정 で入力してください', RM_OUT);
    await ownerTg('⚠️ 센바 알바 퇴근 미기록 (' + dayLabel(now) + ', 출근 ' + rec.inAt + ')');
  }
}

// ── 롱폴링 루프 ──────────────────────────────────────────────────
async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const j = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      for (const u of j.result || []) {
        offset = u.update_id + 1;
        try { await handle(u); } catch (e) { console.error('handle fail:', e.message); }
      }
    } catch (e) { console.error('poll fail:', e.message); await new Promise(r => setTimeout(r, 5000)); }
  }
}

(async () => {
  if (process.argv.includes('--chatid')) {   // 봇을 방에 넣고 아무 말이나 보낸 뒤 실행 → chat id 확인
    const j = await api('getUpdates', { timeout: 0 });
    for (const u of j.result || []) console.log('chat:', u.message?.chat?.id, u.message?.chat?.title || u.message?.chat?.first_name, '| text:', u.message?.text);
    return;
  }
  if (!BOT || !CHAT) { console.error('ATTEND_BOT_TOKEN / ATTEND_CHAT_ID 필요 (/opt/senba-attend/.env)'); process.exit(1); }
  if (process.argv.includes('--post')) { await postDaily(); return; }   // 오늘 안내 즉시 발송(테스트)
  console.log(`[attend] start — wage ${WAGE}, end ${END_HM}, post ${POST_HOUR}:00 JST, chat ${CHAT}`);
  setInterval(() => tick().catch(e => console.error('tick fail:', e.message)), 30e3);
  poll();
})().catch(e => { console.error('FAIL:', e.message, e.cause ? '| cause: ' + (e.cause.code || e.cause.message) : ''); process.exit(1); });
