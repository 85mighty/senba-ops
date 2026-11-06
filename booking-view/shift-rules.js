// 근무 안내 규칙 (순수 함수) — 아이미짱 1인 체제 (토·일·월·화·목), 수·금 정기휴무 (2026-11-06 확정)
// 입력: 다음날 날짜 + 그날 예약 [{s,e}] (분 단위, JST) + opts. 출력: 출퇴근 계획 + 한·일 안내문.
// 규칙 (사장님 확정):
//  · 아이미짱 (토·일·월·화·목): 예약 있으면 첫 예약 15분 전 출근. 가장 이른 출근은 월·화·목 12:45(13:00 예약), 토·일·공휴일 12:15(12:30 예약), 늦어도 13:30.
//    퇴근 = 마지막 예약 종료 +15분, 최소 3시간 보장, 가게 마무리는 18:15 까지. 예약 없으면 13:30 → 16:30 (청소·그림·동영상·SNS)
//  · 수·금: 정기휴무 (예약이 들어와 있으면 사장님 대응 경고). 사장님이 여는 날은 보드 &owner=1 로 등록
//  · 공휴일은 요일 무관 토·일 규칙
//  · 시급: 근태봇 .env 의 ATTEND_WAGE (기본 1,200)
//  · 아이미짱 휴무(opts.aimiOff, 보드 URL &aimioff=1): 사장님이 같은 시간대를 직접 (급여 표시 없음)
//  · opts.morning: 주말 10:45 출근까지 허용 (주말 오전 영업 시뮬용) · 6시간 초과일은 45분 휴게 추천 시간대 표시
const WAGE = Number(process.env.SHIFT_WAGE) || 1200;
const MIN_H = 3;                 // 최소 보장 시간
const MIN_MIN = MIN_H * 60;
const CLOSE = 18 * 60 + 15;      // 가게 마무리 최종 시각
const HOLIDAYS = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22', '2027-04-29',
  '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23',
  '2027-10-11', '2027-11-03', '2027-11-23'];   // site-i18n/i18n.js 의 JP_HOLIDAYS 와 동일 — 매년 갱신 필요
const NAME = { owner: ['사장님', 'オーナー'], aimi: ['아이미짱', 'アイミちゃん'], mami: ['마미짱', 'マミちゃん'] };
const WD_KO = '일월화수목금토', WD_JA = '日月火水木金土';
const T = (h, m = 0) => h * 60 + m;

const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const ceil15 = n => Math.ceil(n / 15) * 15;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const dowOf = ymd => new Date(ymd + 'T12:00:00Z').getUTCDay();   // 날짜 문자열 → 요일(타임존 무관)

function kindOf(ymd) {
  const dow = dowOf(ymd), hol = HOLIDAYS.includes(ymd);
  if (dow === 0 || dow === 6 || hol) return 'weekend';    // 토일 + 공휴일(수·금 공휴일도 영업)
  if (dow === 3 || dow === 5) return 'closed';            // 수·금 정기휴무
  return 'weekday';                                       // 월·화·목
}

// 휴게 추천: 손님 도착·종료(입퇴실)가 없는 가장 긴 구간 (출근 1시간 후 ~ 퇴근 1시간 전, 12:00~16:30 안에서). 45분 미만이면 '짧음' 표시
function breakSlot(bk, start, end) {
  const lo = Math.max(start + 60, T(12)), hi = Math.min(end - 60, T(16, 30));
  if (hi - lo < 30) return null;
  const ev = [...new Set(bk.flatMap(b => [b.s, b.e]).filter(t => t > lo && t < hi))].sort((a, b) => a - b);
  const pts = [lo, ...ev, hi];
  let best = null;
  for (let i = 0; i + 1 < pts.length; i++) { const len = pts[i + 1] - pts[i]; if (!best || len > best.len) best = { a: pts[i], b: pts[i + 1], len }; }
  if (!best) return null;
  const a = best.a === lo ? lo : best.a + 15;        // 손님 안내 15분 뒤부터, 45분만 쓰고 나머지는 근무
  const b = Math.min(best.b, a + 45);
  return { a, b, short: b - a < 45 };
}

function plan(ymd, bookings, opts = {}) {
  const bk = [...bookings].sort((a, b) => a.s - b.s || a.e - b.e);
  const kind = kindOf(ymd);
  const out = { ymd, kind, bookings: bk, owner: null, aimi: null, closed: false, offNoBooking: null, aimiOff: !!opts.aimiOff, warns: [] };
  const lastEnd = bk.length ? Math.max(...bk.map(b => b.e)) : null;
  const shift = (start, end) => { const mins = ceil15(end - start); return { start, end, hours: mins / 60, pay: Math.round(mins / 60 * WAGE) }; };
  const warn = (ko, ja) => out.warns.push({ ko, ja });

  if (kind === 'closed' && !opts.ownerOpen) {
    out.closed = true;
    if (bk.length) warn(`⚠️ 정기휴무인데 예약 ${bk.length}건 — 사장님 대응 필요`, `⚠️ 定休日に予約 ${bk.length}件 — オーナー対応`);
    return out;
  }
  if (lastEnd !== null && lastEnd + 15 > CLOSE) warn(`⚠️ ${hm(lastEnd)} 종료 예약 — 마무리가 ${hm(CLOSE)} 를 넘음, 사장님 확인`, `⚠️ ${hm(lastEnd)} 終了の予約 — 片付けが ${hm(CLOSE)} を超える、オーナー確認`);
  // 출근: 가장 이른 출근 시각(MIN_S) 이후 필요 시점 중 가장 이른 것 (그 전에 시작해 MIN_S 를 넘겨 이어지는 예약은 MIN_S), 없으면 13:30
  const MIN_S = kind === 'weekend' ? (opts.morning ? T(10, 45) : T(12, 15)) : T(12, 45), DEF_S = T(13, 30);
  const needs = bk.map(b => b.s - 15 >= MIN_S ? b.s - 15 : (b.e > MIN_S ? MIN_S : Infinity));
  const start = needs.length ? clamp(Math.min(...needs), MIN_S, DEF_S) : DEF_S;
  const end = lastEnd === null ? start + MIN_MIN : Math.min(Math.max(lastEnd + 15, start + MIN_MIN), CLOSE);
  const who = (opts.aimiOff || (kind === 'closed' && opts.ownerOpen)) ? 'owner' : 'aimi';   // 아이미짱 휴무·휴무일 영업은 사장님
  out[who] = shift(start, end);
  if (who === 'owner') out[who].pay = 0;
  out[who].cleanOnly = bk.length === 0;
  out[who].sub = who === 'owner' && !!opts.aimiOff;
  out[who].breakReq = end - start > 6 * 60;   // 6시간 초과 → 45분 휴게
  if (out[who].breakReq) out[who].brk = breakSlot(bk, start, end);
  const early = bk.filter(b => b.s < MIN_S + 15).length;
  if (early) warn(`⚠️ ${hm(MIN_S + 15)} 전 시작 예약 ${early}건 — ${NAME[who][0]} 출근 전까지 사장님이 손님 맞이`, `⚠️ ${hm(MIN_S + 15)}前の予約 ${early}件 — ${NAME[who][1]}出勤前はオーナー対応`);
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
  const fmt = s => `${hm(s.start)} → ${hm(s.end)} (${s.hours}h${s.pay ? ' · ¥' + s.pay.toLocaleString('ja-JP') : ''})`;
  const both = (who, ko, ja) => lines.push(`👩 ${who[0]}: ${ko}\n   ${who[1]}: ${ja}`);
  if (p.closed) lines.push('🚫 정기휴무 / 定休日');
  const s = p.aimi || p.owner;
  if (s) {
    const who = p.aimi ? NAME.aimi : NAME.owner;
    if (s.sub) lines.push(`🔁 ${NAME.aimi[0]} 휴무 → ${NAME.owner[0]} 출근 / ${NAME.aimi[1]}お休み → ${NAME.owner[1]}出勤`);
    else if (p.owner) lines.push('🔓 정기휴무일 영업 — 사장님 출근 / 定休日営業 — オーナー出勤');
    const ko = (s.cleanOnly ? ` · 예약 없음 — ${hm(s.end)}까지 청소·그림·SNS 콘텐츠(최소 ${MIN_H}시간)` : '') + (s.breakReq ? (s.brk ? ` · 6시간 초과 → 휴게 ${hm(s.brk.a)}~${hm(s.brk.b)} 추천${s.brk.short ? '(입퇴실 공백 45분 미만 — 손님 작업 중에 교대로)' : '(입퇴실 없음)'}` : ' · 6시간 초과 → 예약 사이에 45분 휴게') : '');
    const ja = (s.cleanOnly ? ` · 予約なし — ${hm(s.end)}まで清掃・制作・SNS(最低${MIN_H}時間)` : '') + (s.breakReq ? (s.brk ? ` · 6時間超 → 休憩 ${hm(s.brk.a)}〜${hm(s.brk.b)} 推奨${s.brk.short ? '(入退室の空きが45分未満 — 作業中に交代で)' : '(入退室なし)'}` : ' · 6時間超 → 予約の合間に45分休憩') : '');
    both(who, `출근 ${fmt(s)}${ko}`, `出勤 ${fmt(s)}${ja}`);
  }
  for (const w of p.warns) lines.push(w.ko + '\n   ' + w.ja);
  return lines.join('\n');
}

module.exports = { plan, message, kindOf, HOLIDAYS, NAME, hm, MIN_H, WAGE };
