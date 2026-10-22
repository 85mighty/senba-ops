// 근무 안내 규칙 (순수 함수) — 마미짱(화·토·일 오전 고정) / 아이미짱(목·금·토·일·월 고정) (2026-10-22 개정 2)
// 입력: 다음날 날짜 + 그날 예약 [{s,e}] (분 단위, JST). 출력: 출퇴근 계획 + 한·일 안내문.
// 규칙 (사장님 확정):
//  · 화: 마미짱 13:45 고정 출근 (예약은 14:00부터 받음). 예약 있으면 마지막 종료 +15분까지, 없으면 15:45까지 대기 후 퇴근 (2시간 보장)
//  · 수: 정기휴무 (예약이 들어와 있으면 경고만)
//  · 목: 아이미짱 13:45 고정 출근 (예약은 14:00부터). 퇴근은 다른 날과 같이 마지막 종료 +15분, 17:00~18:15. 예약 없으면 청소·SNS
//  · 토·일·공휴일(금·월 공휴일 포함): 마미짱 11:00 고정 출근 (11:15 전 예약이 있으면 그 15분 전, 10:30 예약이면 10:15).
//    예약 없어도 13:00까지 보장. 14:00 전 시작 예약이 있으면 그 종료 +15분까지(최대 14:15).
//    아이미짱은 마미짱 퇴근 15분 전에 출근 (12:45~14:00)
//  · 금·월: 아이미짱만 12:45~13:45 출근 (12:45 전 시작 예약이 있으면 사장님 대응 필요 경고)
//  · 아이미짱 퇴근 = 마지막 예약 종료 +15분, 17:00 ~ 18:15 범위. 예약 없는 날은 청소·SNS
//  · 아이미짱 휴무(opts.aimiOff, 보드 URL &aimioff=1 로 날짜별 등록): 마미짱이 아이미짱 시간대를 대신 맡음.
//    예약 있으면 아이미짱 퇴근 시각까지, 없으면 2시간 대기 후 퇴근
const WAGE = 1200;
const HOLIDAYS = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22', '2027-04-29',
  '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23',
  '2027-10-11', '2027-11-03', '2027-11-23'];   // site-i18n/i18n.js 의 JP_HOLIDAYS 와 동일 — 매년 갱신 필요
const NAME = { mami: ['마미짱', 'マミちゃん'], aimi: ['아이미짱', 'アイミちゃん'] };
const WD_KO = '일월화수목금토', WD_JA = '日月火水木金土';
const T = (h, m = 0) => h * 60 + m;

const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const ceil15 = n => Math.ceil(n / 15) * 15;
const dowOf = ymd => new Date(ymd + 'T12:00:00Z').getUTCDay();   // 날짜 문자열 → 요일(타임존 무관)

function kindOf(ymd) {
  const dow = dowOf(ymd), hol = HOLIDAYS.includes(ymd);
  if (dow === 2) return 'tue';
  if (dow === 3) return 'wed';
  if (dow === 4) return 'thu';                            // 화수목은 공휴일이어도 평일 규칙
  if (dow === 0 || dow === 6 || hol) return 'weekend';    // 토일 + 금·월 공휴일
  return 'fm';                                            // 금·월
}

function planBase(ymd, bookings, opts = {}) {
  const bk = [...bookings].sort((a, b) => a.s - b.s || a.e - b.e);
  const kind = kindOf(ymd);
  // offNoBooking: 예약이 없어서 휴무로 안내되는 사람 (사장님 사전점검 대상) · closed: 가게 휴업
  const out = { ymd, kind, bookings: bk, mami: null, aimi: null, closed: false, offNoBooking: null, aimiOff: !!opts.aimiOff, warns: [] };
  const lastEnd = bk.length ? Math.max(...bk.map(b => b.e)) : null;
  const shift = (start, end) => { const mins = ceil15(end - start); return { start, end, hours: mins / 60, pay: Math.round(mins / 60 * WAGE) }; };
  const warn = (ko, ja) => out.warns.push({ ko, ja });
  const early = (limit, who) => {   // limit 전 시작 예약 → 출근 전이라 사장님 대응 경고
    const n = bk.filter(b => b.s < limit).length;
    if (n) warn(`⚠️ ${hm(limit)} 전 시작 예약 ${n}건 — ${who[0]} 출근 전까지 사장님이 손님 맞이`, `⚠️ ${hm(limit)}前の予約 ${n}件 — ${who[1]}出勤前はオーナー対応`);
  };

  if (kind === 'wed') {
    out.closed = true;
    if (bk.length) warn(`⚠️ 정기휴무인데 예약 ${bk.length}건 — 사장님 확인 필요`, `⚠️ 定休日に予約 ${bk.length}件 — オーナー確認`);
    return out;
  }
  if (kind === 'tue') {
    out.mami = shift(T(13, 45), bk.length ? Math.max(lastEnd + 15, T(15, 45)) : T(15, 45));
    out.mami.standby = bk.length === 0;      // 15:45까지 당일 예약 대기 후 퇴근
    if (bk.length) early(T(14), NAME.mami);
    return out;
  }
  if (kind === 'thu') {
    out.aimi = shift(T(13, 45), lastEnd === null ? T(17) : Math.min(Math.max(lastEnd + 15, T(17)), T(18, 15)));
    out.aimi.cleanOnly = bk.length === 0;
    if (bk.length) early(T(14), NAME.aimi);
    return out;
  }
  if (kind === 'weekend') {
    const pre14 = bk.filter(b => b.s < T(14));
    const start = pre14.length ? Math.min(T(11), pre14[0].s - 15) : T(11);
    const end = pre14.length ? Math.min(Math.max(Math.max(...pre14.map(b => b.e)) + 15, T(13)), T(14, 15)) : T(13);
    out.mami = shift(start, end);
    out.mami.standby = pre14.length === 0;   // 예약 없어도 13:00까지 보장
    if (pre14.length && pre14[0].s - 15 < T(10, 15)) warn(`⚠️ ${hm(pre14[0].s)} 예약 — 10:15 전 출근 필요, 사장님 확인`, `⚠️ ${hm(pre14[0].s)} の予約 — 10:15前の出勤が必要、オーナー確認`);
  }
  // 아이미짱 (금토일월): 주말은 마미짱 퇴근 15분 전, 금월은 예약 기준 12:45~13:45
  const aimiStart = out.mami ? Math.min(Math.max(out.mami.end - 15, T(12, 45)), T(14))
    : bk.length ? Math.min(Math.max(bk[0].s - 15, T(12, 45)), T(13, 45)) : T(12, 45);
  const aimiEnd = lastEnd === null ? T(17) : Math.min(Math.max(lastEnd + 15, T(17)), T(18, 15));
  out.aimi = shift(aimiStart, aimiEnd);
  out.aimi.cleanOnly = bk.length === 0;
  if (kind === 'fm') early(T(12, 45), NAME.aimi);
  return out;
}

// 아이미짱 휴무일: 아이미짱 몫을 마미짱이 대신 (하루 한 사람)
function plan(ymd, bookings, opts = {}) {
  const out = planBase(ymd, bookings, opts);
  if (!out.aimiOff || out.kind === 'wed' || out.kind === 'tue') return out;
  const shift = (start, end) => { const mins = ceil15(end - start); return { start, end, hours: mins / 60, pay: Math.round(mins / 60 * WAGE), sub: true }; };
  if (out.kind === 'thu') {   // 13:45 고정, 예약 없으면 2시간 대기
    out.mami = out.bookings.length ? shift(out.aimi.start, out.aimi.end) : { ...shift(T(13, 45), T(15, 45)), standby: true };
  } else if (out.kind === 'weekend') {
    out.mami = out.bookings.length ? shift(out.mami.start, out.aimi.end) : { ...shift(out.mami.start, out.mami.start + 120), standby: true };
  } else {   // 금·월: 아이미짱 시간대 그대로, 예약 없으면 12:45~14:45 대기
    out.mami = out.bookings.length ? shift(out.aimi.start, out.aimi.end) : { ...shift(out.aimi.start, out.aimi.start + 120), standby: true };
  }
  out.aimi = null;
  return out;
}

function message(ymd, p) {
  const [, M, D] = ymd.split('-').map(Number);
  const dow = dowOf(ymd);
  const lines = [`📅 내일 ${M}/${D}(${WD_KO[dow]}) 근무 안내\n   明日 ${M}/${D}(${WD_JA[dow]}) シフトのお知らせ`];
  const times = p.bookings.map(b => hm(b.s));
  lines.push(p.bookings.length
    ? `🎨 예약 ${p.bookings.length}組 / 予約 ${p.bookings.length}組: ${times.slice(0, 10).join(' · ')}${times.length > 10 ? ' …' : ''}`
    : '🎨 예약 0組 / 予約 0組');
  const fmt = s => `${hm(s.start)} → ${hm(s.end)} (${s.hours}h · ¥${s.pay.toLocaleString('ja-JP')})`;
  const both = (who, ko, ja) => lines.push(`👩 ${who[0]}: ${ko}\n   ${who[1]}: ${ja}`);
  if (p.aimiOff && p.kind !== 'wed' && p.kind !== 'tue') lines.push(`🔁 ${NAME.aimi[0]} 휴무 → ${NAME.mami[0]} 대신 출근 / ${NAME.aimi[1]}お休み → ${NAME.mami[1]}が代わりに出勤`);
  if (p.kind === 'wed') lines.push('🚫 수요일 정기휴무 / 水曜日は定休日');
  if (p.mami) {
    const note = p.mami.standby ? (p.kind === 'weekend' && !p.aimiOff ? ' · 오전 예약 없음 — 13:00까지 보장' : ' · 예약 없음 — 2시간 대기 후 퇴근(당일 예약 들어오면 연장)') : '';
    const noteJa = p.mami.standby ? (p.kind === 'weekend' && !p.aimiOff ? ' · 午前の予約なし — 13:00まで保証' : ' · 予約なし — 2時間待機して退勤(当日予約が入れば延長)') : '';
    both(NAME.mami, `출근 ${fmt(p.mami)}${note}`, `出勤 ${fmt(p.mami)}${noteJa}`);
  }
  if (p.aimi) both(NAME.aimi, `출근 ${fmt(p.aimi)}${p.aimi.cleanOnly ? ' · 예약 없음(청소·SNS)' : ''}`, `出勤 ${fmt(p.aimi)}${p.aimi.cleanOnly ? ' · 予約なし(清掃・SNS)' : ''}`);
  for (const w of p.warns) lines.push(w.ko + '\n   ' + w.ja);
  return lines.join('\n');
}

module.exports = { plan, message, kindOf, HOLIDAYS, NAME, hm };
