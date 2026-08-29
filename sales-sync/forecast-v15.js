/**
 * forecast-v15.js — 월말 매출 예측 (요일 분위수 + 예약 기반) 순수 로직
 *
 * ⚠️ 아직 server.js에 연결하지 않았다 (2026-08-09). 백테스트에서 게이트(±10%)를 통과하지 못했다.
 *    7월 백테스트 오차: as-of 7/5 −36.3% / 7/15 −23.7% / 7/25 −9.3%.
 *    12개월 스윕 MAPE는 기존 v14 18.3% → 14.5%로 나아지지만 목표에는 못 미친다.
 *    원인은 요일 표본 부족이 아니라 (1) 전월비 ±30~69%로 튀는 월 단위 변동성,
 *    (2) 8주 창의 절반이 직전 달이라 레벨 시프트를 못 따라가는 점,
 *    (3) max(booked, p50)가 하한만 잡아 추가 유입(D-1 실측 1.68배)을 못 더하는 점이다.
 *    예약 스냅샷이 몇 달 쌓여 리드타임 보정이 실효를 갖게 되면 재검증한다.
 *
 * server.js(v15)와 백테스트 스크립트가 같은 코드를 쓰도록 I/O 없이 분리했다.
 * 시트/원장에서 읽는 일은 호출자가 하고, 여기서는 숫자만 다룬다.
 *
 * 핵심 아이디어 (v14의 '요일평균 × 추세 × 시나리오배율' 교체):
 *   남은 하루하루를 따로 본다. 그 날 이미 잡힌 예약(booked)과
 *   같은 요일의 최근 8주 일매출 분포(p25/p50/p75)를 비교해 큰 쪽을 쓴다.
 *     기대값 = max(booked, p50) / 보수 = max(booked, p25) / 낙관 = max(booked, p75)
 *   월 예상 = 이번달 1일~오늘 확정 + Σ 남은 날 기대값.
 *
 * 왜 max인가: booked는 '최소한 이만큼은 들어온다'는 하한이고,
 * 분위수는 '보통 이 요일엔 이만큼 찬다'는 기준선이다. 둘 중 낮은 쪽을 쓰면
 * 이미 만석인 날을 과소평가하거나(booked 무시) 텅 빈 날을 과소평가한다(당일 유입 무시).
 */

const WD_ORDER = ['월', '화', '수', '목', '금', '토', '일'];
const WEEKEND_WD = ['토', '일'];

// 요일 분포 기본 창(주). 부족하면 FALLBACK_WEEKS까지 넓히고, 그래도 모자라면 전체 평균으로 떨어진다.
const DIST_WEEKS = 8;
const DIST_WEEKS_FALLBACK = 16;
const DIST_MIN_SAMPLES = 4;

// 리드타임 보정 안전장치 — 배율이 1.2 미만이면 미적용, 3.0 초과는 이상치로 보고 자른다.
const LEAD_MIN_FACTOR = 1.2;
const LEAD_MAX_FACTOR = 3.0;
const LEAD_MIN_SAMPLES = 5;
const LEAD_WEEKS = 4;

const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

// type-7 분위수 (R/numpy 기본과 동일). 표본 1개면 그 값을 그대로 돌려준다.
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 월 탭 목록 → 일자별 평탄화 이력
 * months: [{ year, month, days:[{day, wd, amount}] }]
 * → [{ date:'YYYY-MM-DD', wd, amount }] (날짜 오름차순)
 */
function flattenHistory(months) {
  const out = [];
  for (const mo of months) {
    for (const d of mo.days) out.push({ date: ymd(mo.year, mo.month, d.day), wd: d.wd, amount: d.amount });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * asOf(포함) 이전 실적만으로 요일별 분위수 표를 만든다.
 *
 * 그룹핑 규칙: 공휴일은 요일과 무관하게 '주말' 그룹으로 넣는다 (해양의날 화요일 ≠ 보통 화요일).
 * 휴무일(closed)은 표본에서 뺀다 — 문 닫아서 0인 날을 '장사가 안 된 날'로 세면 분포가 통째로 내려앉는다.
 * 반대로 문은 열었는데 예약이 0인 날은 그대로 남긴다. 그게 실제로 일어나는 일이라 분포에 들어가야 한다.
 */
function buildWeekdayDist(history, asOfDate, opts = {}) {
  const { isHoliday = () => false, closed = new Set() } = opts;
  const asOfNum = dayNum(asOfDate);

  const pools = {};
  for (const wd of WD_ORDER) pools[wd] = [];
  pools.주말 = [];

  // 최신순으로 훑으며 그룹별로 필요한 주수만큼만 담는다
  const past = history.filter(h => dayNum(h.date) <= asOfNum && !closed.has(h.date)).reverse();
  for (const h of past) {
    const group = isHoliday(h.date) ? '주말' : h.wd;
    if (!(group in pools)) continue;
    pools[group].push(h.amount);
    if (group === '주말') continue;
    if (WEEKEND_WD.includes(h.wd)) pools.주말.push(h.amount); // 주말 풀 = 토+일+공휴일 (표본 2배)
  }

  const allVals = past.map(h => h.amount);
  const table = {};
  for (const key of [...WD_ORDER, '주말']) {
    const perWeek = key === '주말' ? 3 : 1; // 주말 풀은 주당 표본이 대략 2~3개
    let vals = pools[key].slice(0, DIST_WEEKS * perWeek);
    let weeks = DIST_WEEKS;
    if (vals.length < DIST_MIN_SAMPLES) {
      vals = pools[key].slice(0, DIST_WEEKS_FALLBACK * perWeek);
      weeks = DIST_WEEKS_FALLBACK;
    }
    const sorted = [...vals].sort((a, b) => a - b);
    const short = sorted.length < DIST_MIN_SAMPLES;
    const fb = allVals.slice(0, 56).sort((a, b) => a - b); // 표본이 아예 없을 때의 전체 폴백
    const src = short && fb.length ? fb : sorted;
    table[key] = {
      n: sorted.length,
      weeks,
      short,                                   // 표본 부족 — 진단에 그대로 노출한다
      p25: quantile(src, 0.25),
      p50: quantile(src, 0.50),
      p75: quantile(src, 0.75),
    };
  }
  return table;
}

/**
 * 리드타임 보정 배율 — "D-n일 시점 예약액이 최종 일매출의 몇 배가 되는가"
 * snapshots: [{ date, n, booked, final }] (최근 LEAD_WEEKS주, booked > 0인 날만)
 * 반환: n → 배율 (1.2 미만이거나 표본 부족이면 1)
 */
function buildLeadFactors(snapshots, asOfDate) {
  const from = dayNum(asOfDate) - LEAD_WEEKS * 7;
  const byN = {};
  for (const s of snapshots) {
    if (dayNum(s.date) < from || dayNum(s.date) > dayNum(asOfDate)) continue;
    if (!(s.booked > 0)) continue;
    (byN[s.n] ||= []).push(s.final / s.booked);
  }
  const out = {};
  for (const [n, ratios] of Object.entries(byN)) {
    if (ratios.length < LEAD_MIN_SAMPLES) continue;
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    if (mean < LEAD_MIN_FACTOR) continue;              // 1.2배 미만 → 보정하지 않는다 (스펙)
    out[n] = { factor: Math.min(mean, LEAD_MAX_FACTOR), n: ratios.length };
  }
  return out;
}

/**
 * 월말 예상 계산
 *
 * cur      : { year, month, days:[{day, wd, amount}] } — 이번(대상) 달 시트 탭
 * asOfDay  : 확정 경계일 (이 날까지 시트 누적 = 확정)
 * history  : flattenHistory(...) 결과 — 대상 달 asOfDay 이후 날은 호출자가 넣지 않아야 한다
 * booked   : { [day]: amount } — 남은 날짜의 이미 잡힌 예약액 (없으면 cur.days 금액을 쓴다)
 * closed   : Set('YYYY-MM-DD') — 휴무일 (0 처리 + 분포 표본 제외)
 * leadFactors : buildLeadFactors 결과 (선택)
 */
function computeMonthForecast({ cur, asOfDay, history, booked = null, closed = new Set(), leadFactors = {}, isHoliday = () => false }) {
  const asOfDate = ymd(cur.year, cur.month, asOfDay);
  const dist = buildWeekdayDist(history, asOfDate, { isHoliday, closed });

  let confirmed = 0, bookedRemain = 0;
  const perDay = [];
  const remain = { cons: 0, base: 0, opt: 0 };

  for (const d of cur.days) {
    const date = ymd(cur.year, cur.month, d.day);
    if (d.day <= asOfDay) { confirmed += d.amount; continue; }

    if (closed.has(date)) {
      perDay.push({ day: d.day, wd: d.wd, closed: true, booked: 0, cons: 0, base: 0, opt: 0 });
      continue;
    }

    const bk = booked ? (booked[d.day] || 0) : d.amount;
    bookedRemain += bk;

    const hol = isHoliday(date);
    const key = hol ? '주말' : d.wd;
    const q = dist[key];

    // 리드타임 보정: D-n 시점 예약이 최종 일매출의 평균 몇 배가 되는지를 booked에 곱한다
    const n = d.day - asOfDay;
    const lead = leadFactors[n]?.factor || 1;
    const bkAdj = bk * lead;

    const cons = Math.max(bkAdj, q.p25);
    const base = Math.max(bkAdj, q.p50);
    const opt = Math.max(bkAdj, q.p75);
    remain.cons += cons; remain.base += base; remain.opt += opt;
    perDay.push({
      day: d.day, wd: d.wd, holiday: hol, closed: false,
      booked: bk, lead, bookedAdj: Math.round(bkAdj),
      p25: Math.round(q.p25), p50: Math.round(q.p50), p75: Math.round(q.p75),
      samples: q.n, shortSample: q.short,
      cons: Math.round(cons), base: Math.round(base), opt: Math.round(opt),
    });
  }

  const shortDays = perDay.filter(p => p.shortSample).map(p => `${p.day}${p.wd}`);
  return {
    confirmed,
    bookedRemain,
    cons: confirmed + remain.cons,
    base: confirmed + remain.base,
    opt: confirmed + remain.opt,
    remain,
    perDay,
    dist,
    diag: {
      shortSampleDays: shortDays,
      leadApplied: Object.keys(leadFactors).length ? leadFactors : null,
      closedDays: [...closed].filter(x => x.startsWith(`${cur.year}-${String(cur.month).padStart(2, '0')}`)),
    },
  };
}

module.exports = {
  WD_ORDER, WEEKEND_WD, DIST_WEEKS, DIST_MIN_SAMPLES,
  LEAD_MIN_FACTOR, LEAD_MAX_FACTOR, LEAD_WEEKS, LEAD_MIN_SAMPLES,
  ymd, dayNum, quantile, flattenHistory, buildWeekdayDist, buildLeadFactors, computeMonthForecast,
};
