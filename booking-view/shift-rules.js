// 근무 안내 규칙 (순수 함수) — 마미짱(화수목·주말 오전) / 아이미짱(금토일월) (2026-10-15)
// 입력: 다음날 날짜 + 그날 예약 [{s,e}] (분 단위, JST). 출력: 출퇴근 계획 + 한·일 안내문.
// 규칙 (사장님 확정):
//  · 화수목(공휴일 포함): 예약 0건 → 마미짱 휴무(가게 휴업). 예약 있으면 첫 예약 15분 전 ~ 마지막 예약 종료 15분 후
//  · 토·일·공휴일(금·월 공휴일 포함): 14:00 전 시작 예약이 있으면 마미짱 = min(첫 예약 15분 전, 11:45) ~ 14:15
//    (최소 2.5시간 보장), 없으면 마미짱 휴무. 아이미짱은 마미짱이 있으면 14:00 출근, 없으면 예약 기준 12:45~13:45 출근
//  · 금·월: 아이미짱만 (12:45 전 시작 예약이 있으면 사장님 대응 필요 경고)
//  · 아이미짱 퇴근 = 마지막 예약 종료 +15분, 17:00 ~ 18:15 범위
const WAGE = 1200;
const HOLIDAYS = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22', '2027-04-29',
  '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23',
  '2027-10-11', '2027-11-03', '2027-11-23'];   // site-i18n/i18n.js 의 JP_HOLIDAYS 와 동일 — 매년 갱신 필요
const NAME = { mami: ['마미짱', 'マミちゃん'], aimi: ['아이미짱', 'アイミちゃん'] };
const WD_KO = '일월화수목금토', WD_JA = '日月火水木金土';

const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const ceil15 = n => Math.ceil(n / 15) * 15;
const dowOf = ymd => new Date(ymd + 'T12:00:00Z').getUTCDay();   // 날짜 문자열 → 요일(타임존 무관)

function kindOf(ymd) {
  const dow = dowOf(ymd), hol = HOLIDAYS.includes(ymd);
  if ((dow >= 2 && dow <= 4)) return 'weekday3';          // 화수목 (공휴일이어도 평일 규칙)
  if (dow === 0 || dow === 6 || hol) return 'weekend';    // 토일 + 금·월 공휴일
  return 'fm';                                            // 금·월
}

function plan(ymd, bookings) {
  const bk = [...bookings].sort((a, b) => a.s - b.s || a.e - b.e);
  const kind = kindOf(ymd);
  const out = { ymd, kind, bookings: bk, mami: null, aimi: null, warns: [] };
  const lastEnd = bk.length ? Math.max(...bk.map(b => b.e)) : null;
  const shift = (start, end) => { const mins = ceil15(end - start); return { start, end, hours: mins / 60, pay: Math.round(mins / 60 * WAGE) }; };

  if (kind === 'weekday3') {
    if (bk.length) {
      out.mami = shift(bk[0].s - 15, lastEnd + 15);
      let cur = bk[0].e, gap = null;   // 예약 사이 가장 긴 공백 (90분 이상이면 휴게 안내)
      for (const b of bk.slice(1)) { if (b.s - cur >= 90 && (!gap || b.s - cur > gap.len)) gap = { a: cur, b: b.s, len: b.s - cur }; cur = Math.max(cur, b.e); }
      if (gap) out.warns.push({ ko: `ℹ️ 예약 사이 ${gap.len / 60}시간 공백(${hm(gap.a)}~${hm(gap.b)}) — 이 시간은 휴게·청소`, ja: `ℹ️ 予約の間に ${gap.len / 60}時間の空き(${hm(gap.a)}〜${hm(gap.b)}) — 休憩・清掃` });
    }
    return out;
  }
  if (kind === 'weekend') {
    const pre14 = bk.filter(b => b.s < 14 * 60);
    if (pre14.length) {
      out.mami = shift(Math.min(pre14[0].s - 15, 11 * 60 + 45), 14 * 60 + 15);
      out.mami.note = pre14[0].s - 15 > 11 * 60 + 45 ? 'min2.5h' : '';
    }
  }
  // 아이미짱 (금토일월)
  const aimiStart = out.mami ? 14 * 60
    : bk.length ? Math.min(Math.max(bk[0].s - 15, 12 * 60 + 45), 13 * 60 + 45) : 12 * 60 + 45;
  const aimiEnd = lastEnd === null ? 17 * 60 : Math.min(Math.max(lastEnd + 15, 17 * 60), 18 * 60 + 15);
  out.aimi = shift(aimiStart, aimiEnd);
  out.aimi.cleanOnly = bk.length === 0;
  if (kind === 'fm' && bk.some(b => b.s < 12 * 60 + 45)) {
    const n = bk.filter(b => b.s < 12 * 60 + 45).length;
    out.warns.push({ ko: `⚠️ 12:45 전 시작 예약 ${n}건 — 사장님이 아이미짱 출근 전까지 손님 맞이`, ja: `⚠️ 12:45前の予約 ${n}件 — アイミちゃん出勤前はオーナー対応` });
  }
  return out;
}

function message(ymd, p) {
  const [, M, D] = ymd.split('-').map(Number);
  const dow = dowOf(ymd);
  const head = `📅 내일 ${M}/${D}(${WD_KO[dow]}) 근무 안내\n   明日 ${M}/${D}(${WD_JA[dow]}) シフトのお知らせ`;
  const lines = [head];
  const times = p.bookings.map(b => hm(b.s));
  lines.push(p.bookings.length
    ? `🎨 예약 ${p.bookings.length}組 / 予約 ${p.bookings.length}組: ${times.slice(0, 10).join(' · ')}${times.length > 10 ? ' …' : ''}`
    : '🎨 예약 0組 / 予約 0組');
  const fmt = s => `${hm(s.start)} → ${hm(s.end)} (${s.hours}h · ¥${s.pay.toLocaleString('ja-JP')})`;
  if (p.kind === 'weekday3') {
    if (p.mami) lines.push(`👩 ${NAME.mami[0]}: 출근 ${fmt(p.mami)}\n   ${NAME.mami[1]}: 出勤 ${fmt(p.mami)}`);
    else lines.push(`👩 ${NAME.mami[0]}: 내일은 예약이 없어 휴무입니다 🙌\n   ${NAME.mami[1]}: 明日は予約がないためお休みです 🙌`);
  } else {
    if (p.mami) lines.push(`👩 ${NAME.mami[0]}: 출근 ${fmt(p.mami)}${p.mami.note ? ' · 최소 2.5시간 보장' : ''}\n   ${NAME.mami[1]}: 出勤 ${fmt(p.mami)}${p.mami.note ? ' · 最低2.5時間保証' : ''}`);
    else lines.push(`👩 ${NAME.mami[0]}: 내일 휴무 / ${NAME.mami[1]}: 明日はお休み`);
    if (p.aimi) lines.push(`👩 ${NAME.aimi[0]}: 출근 ${fmt(p.aimi)}${p.aimi.cleanOnly ? ' · 예약 없음(청소·SNS)' : ''}\n   ${NAME.aimi[1]}: 出勤 ${fmt(p.aimi)}${p.aimi.cleanOnly ? ' · 予約なし(清掃・SNS)' : ''}`);
  }
  for (const w of p.warns) lines.push(w.ko + '\n   ' + w.ja);
  return lines.join('\n');
}

module.exports = { plan, message, kindOf, HOLIDAYS, hm };
