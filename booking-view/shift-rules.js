// 근무 안내 규칙 (순수 함수) — 아이미짱(토·일·월·화·목 고정) / 마미짱(금 고정 + 토·일 오전 고정) (2026-10-26 확정)
// 입력: 다음날 날짜 + 그날 예약 [{s,e}] (분 단위, JST) + opts. 출력: 출퇴근 계획 + 한·일 안내문.
// 규칙 (사장님 확정):
//  · 아이미짱 (토·일·월·화·목): 예약 있으면 첫 예약 15분 전 출근 (가장 이른 12:45, 늦어도 13:30). 퇴근 = 마지막 예약 종료 +15분,
//    최소 3시간 보장, 가게 마무리는 18:15 까지. 예약 없으면 13:30 → 16:30 (청소·그림·동영상·SNS)
//  · 마미짱 금: 13:30 고정. 예약 있으면 마지막 종료 +15분(최소 16:30, 최대 18:15), 없으면 16:30 까지 (3시간 보장)
//  · 마미짱 토·일·공휴일: 10:15 → 12:45 고정 (오전 담당, 12:45 에 아이미짱에게 인계)
//  · 수: 정기휴무 (예약이 들어와 있으면 경고만). opts.wedOpen(SHIFT_WED_OPEN=1)이면 금요일과 같이 마미짱 13:30 고정
//  · 금·월 공휴일은 토·일 규칙
//  · 아이미짱 휴무(opts.aimiOff, 보드 URL &aimioff=1): 마미짱이 아이미짱 시간대를 대신 맡음 (주말은 10:15 부터 하루 통째)
const WAGE = 1200;
const MIN_H = 3;                 // 고정 출근 날 최소 보장 시간
const MIN_MIN = MIN_H * 60;
const CLOSE = 18 * 60 + 15;      // 가게 마무리 최종 시각
const HOLIDAYS = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22', '2027-04-29',
  '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23',
  '2027-10-11', '2027-11-03', '2027-11-23'];   // site-i18n/i18n.js 의 JP_HOLIDAYS 와 동일 — 매년 갱신 필요
const NAME = { mami: ['마미짱', 'マミちゃん'], aimi: ['아이미짱', 'アイミちゃん'] };
const WD_KO = '일월화수목금토', WD_JA = '日月火水木金土';
const T = (h, m = 0) => h * 60 + m;

const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const ceil15 = n => Math.ceil(n / 15) * 15;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const dowOf = ymd => new Date(ymd + 'T12:00:00Z').getUTCDay();   // 날짜 문자열 → 요일(타임존 무관)

function kindOf(ymd) {
  const dow = dowOf(ymd), hol = HOLIDAYS.includes(ymd);
  if (dow === 3) return 'wed';
  if (dow === 0 || dow === 6 || hol) return 'weekend';    // 토일 + 금·월 공휴일
  if (dow === 5) return 'fri';                            // 금: 마미짱
  return 'aimi';                                          // 월·화·목: 아이미짱 (공휴일이어도 평일 규칙)
}

function planBase(ymd, bookings, opts = {}) {
  const bk = [...bookings].sort((a, b) => a.s - b.s || a.e - b.e);
  const kind = kindOf(ymd);
  const out = { ymd, kind, bookings: bk, mami: null, aimi: null, closed: false, offNoBooking: null, aimiOff: !!opts.aimiOff, warns: [] };
  const lastEnd = bk.length ? Math.max(...bk.map(b => b.e)) : null;
  const shift = (start, end) => { const mins = ceil15(end - start); return { start, end, hours: mins / 60, pay: Math.round(mins / 60 * WAGE) }; };
  const warn = (ko, ja) => out.warns.push({ ko, ja });
  const early = (limit, who) => {   // limit 전 시작 예약 → 출근 전이라 사장님 대응 경고
    const n = bk.filter(b => b.s < limit).length;
    if (n) warn(`⚠️ ${hm(limit)} 전 시작 예약 ${n}건 — ${who[0]} 출근 전까지 사장님이 손님 맞이`, `⚠️ ${hm(limit)}前の予約 ${n}件 — ${who[1]}出勤前はオーナー対応`);
  };
  if (lastEnd !== null && lastEnd + 15 > CLOSE) warn(`⚠️ ${hm(lastEnd)} 종료 예약 — 마무리가 ${hm(CLOSE)} 를 넘음, 사장님 확인`, `⚠️ ${hm(lastEnd)} 終了の予約 — 片付けが ${hm(CLOSE)} を超える、オーナー確認`);
  const endOf = (start, floor) => lastEnd === null ? floor : Math.min(Math.max(lastEnd + 15, floor), CLOSE);

  if (kind === 'wed' && !opts.wedOpen) {
    out.closed = true;
    if (bk.length) warn(`⚠️ 정기휴무인데 예약 ${bk.length}건 — 사장님 확인 필요`, `⚠️ 定休日に予約 ${bk.length}件 — オーナー確認`);
    return out;
  }
  if (kind === 'wed' || kind === 'fri') {   // 마미짱 13:30 고정
    out.mami = shift(T(13, 30), endOf(T(13, 30), T(16, 30)));
    out.mami.standby = bk.length === 0;
    early(T(13, 45), NAME.mami);
    return out;
  }
  // 아이미짱 출근: 12:45 이후 필요 시점 중 가장 이른 것 (12:45 전 시작 예약이 12:45 넘겨 이어지면 12:45), 없으면 13:30
  const MIN_S = T(12, 45), DEF_S = T(13, 30);
  const needs = bk.map(b => b.s - 15 >= MIN_S ? b.s - 15 : (b.e > MIN_S ? MIN_S : Infinity));
  const aimiStart = needs.length ? clamp(Math.min(...needs), MIN_S, DEF_S) : DEF_S;
  out.aimi = shift(aimiStart, endOf(aimiStart, aimiStart + MIN_MIN));
  out.aimi.cleanOnly = bk.length === 0;
  if (kind === 'weekend') {
    out.mami = shift(T(10, 15), T(12, 45));                       // 오전 고정
    out.mami.standby = !bk.some(b => b.s < T(12, 45));            // 오전 예약 없음 → 청소
    if (bk.some(b => b.s < T(10, 30))) early(T(10, 30), NAME.mami);
  } else early(MIN_S, NAME.aimi);                                 // 월·화·목: 12:45 전 예약은 사장님
  return out;
}

// 아이미짱 휴무일: 아이미짱 몫을 마미짱이 대신 (하루 한 사람)
function plan(ymd, bookings, opts = {}) {
  const out = planBase(ymd, bookings, opts);
  if (!out.aimiOff || !out.aimi) return out;
  const shift = (start, end) => { const mins = ceil15(end - start); return { start, end, hours: mins / 60, pay: Math.round(mins / 60 * WAGE), sub: true }; };
  const start = out.kind === 'weekend' ? T(10, 15) : out.aimi.start;
  const end = out.bookings.length ? Math.max(out.aimi.end, start + MIN_MIN) : start + MIN_MIN;
  out.mami = { ...shift(start, end), standby: out.bookings.length === 0 };
  out.aimi = null;
  out.warns = out.warns.map(w => ({ ko: w.ko.replace(NAME.aimi[0], NAME.mami[0]), ja: w.ja.replace(NAME.aimi[1], NAME.mami[1]) }));
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
  if (p.aimiOff && p.mami && p.mami.sub) lines.push(`🔁 ${NAME.aimi[0]} 휴무 → ${NAME.mami[0]} 대신 출근 / ${NAME.aimi[1]}お休み → ${NAME.mami[1]}が代わりに出勤`);
  if (p.closed) lines.push('🚫 수요일 정기휴무 / 水曜日は定休日');
  if (p.mami) {
    let ko = '', ja = '';
    if (p.kind === 'weekend' && !p.mami.sub) { ko = ' · 오전 담당, 12:45 인계' + (p.mami.standby ? '(오전 예약 없음 — 청소)' : ''); ja = ' · 午前担当、12:45に引き継ぎ' + (p.mami.standby ? '(午前の予約なし — 清掃)' : ''); }
    else if (p.mami.standby) { ko = ` · 예약 없음 — ${hm(p.mami.end)}까지(최소 ${MIN_H}시간, 당일 예약 들어오면 연장)`; ja = ` · 予約なし — ${hm(p.mami.end)}まで(最低${MIN_H}時間、当日予約が入れば延長)`; }
    both(NAME.mami, `출근 ${fmt(p.mami)}${ko}`, `出勤 ${fmt(p.mami)}${ja}`);
  }
  if (p.aimi) both(NAME.aimi,
    `출근 ${fmt(p.aimi)}${p.aimi.cleanOnly ? ` · 예약 없음 — ${hm(p.aimi.end)}까지 청소·그림·SNS 콘텐츠(최소 ${MIN_H}시간)` : ''}`,
    `出勤 ${fmt(p.aimi)}${p.aimi.cleanOnly ? ` · 予約なし — ${hm(p.aimi.end)}まで清掃・制作・SNS(最低${MIN_H}時間)` : ''}`);
  for (const w of p.warns) lines.push(w.ko + '\n   ' + w.ja);
  return lines.join('\n');
}

module.exports = { plan, message, kindOf, HOLIDAYS, NAME, hm, MIN_H };
