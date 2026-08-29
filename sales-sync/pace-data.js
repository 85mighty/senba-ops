/**
 * pace-data.js — 예약 페이스 예측 (v16) 공용 로직
 *
 * 학습(train-pace.js)과 추론(server.js)이 반드시 같은 코드를 쓰게 하려고 분리했다.
 * 예전 시도가 실패한 이유 중 하나가 "학습은 메일 来店人数, 추론은 원장 인원"처럼
 * 세는 대상이 미묘하게 달랐던 것이다(26/8 기준 161명 vs 167명). 그래서 양쪽 다 이 파일만 쓴다.
 *
 * ── 왜 이 모델인가 ────────────────────────────────────────────────
 * 월말 매출을 맞히려면 "지금 얼마나 차 있나"를 알아야 하는데, 시트는 최종 결과만 남아
 * 과거 어느 시점의 예약 상태를 되돌릴 수 없다. 구루나비 알림 메일(2023-04~, 6천여 통)에는
 * 접수 시각·방문일·인원이 그대로 남아 있어, 취소/변경을 시간순으로 재생하면
 * 임의 시점의 예약 잔량을 복원할 수 있다. 그걸 3년치 학습해 "D일 시점 예약 → 월말" 관계를 얻는다.
 *
 * 잔여매출 = a × (이미 잡힌 예약 인원)  +  b × (남은 날 요일 기준선)
 *              ↑ 확정분이 실제로 전환되는 몫      ↑ 아직 안 들어온 예약 (남은 날 수·요일 구성)
 *
 * 단일 배율(잔여 = 예약 × k)로는 안 된다. 잔여매출의 상당 부분은 "아직 존재하지 않는 예약"이라
 * 현재 예약량이 아니라 남은 날의 요일 구성에 비례하기 때문이다. 두 항을 나누자
 * 백테스트 MAPE가 19.0%(기존 v14) → 10.3%로 떨어졌다.
 *
 * 시도했다가 버린 것: 계절지수 항 추가(9.9%→12.3% 악화), 동월 전용 배율(11.8%), 단일 배율(11.1%).
 */

const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
let jpHolidays = null;
try { jpHolidays = require('japanese-holidays'); } catch { /* 없으면 공휴일 보정만 생략 */ }

const WD_ORDER = ['월', '화', '수', '목', '금', '토', '일'];

// ── 날짜 성격 보정 (v16.1) ────────────────────────────────────────
// 요일만 보면 두 가지를 놓친다.
//  ① 공휴일: 山の日(8/11 화) 같은 날은 화요일이 아니라 주말처럼 팔린다.
//  ② 특수 연휴 구간: 오봉(8/11~16)은 과거 3년 일평균이 평시의 1.48/1.58/1.75배였다.
//     2026년은 이 6일이 통째로 남아 있는데 요일 기준선만으론 평범한 화~일로 계산된다.
// 그래서 하루의 기대값을 [요일 기준선] × [구간 계수]로 쪼갠다. 계수는 과거 실적에서 학습한다.
const ALL_WINDOWS = [
  { name: '오봉',     test: (m, d) => m === 8 && d >= 11 && d <= 16 },
  { name: '연말연시', test: (m, d) => (m === 12 && d >= 28) || (m === 1 && d <= 3) },
  { name: 'GW',       test: (m, d) => (m === 4 && d >= 29) || (m === 5 && d <= 5) },
];
// 어떤 구간을 쓸지는 .env PACE_SPECIAL로 켜고 끈다 (빈 값 = 구간 보정 없이 공휴일 처리만).
// 백테스트로 실제 도움이 되는 구간만 남기기 위한 스위치다 — 그럴듯하다고 다 넣으면 오히려 나빠진다.
const SPECIAL_WINDOWS = (() => {
  const raw = process.env.PACE_SPECIAL;
  if (raw == null) return ALL_WINDOWS;
  const on = raw.split(',').map(s => s.trim()).filter(Boolean);
  return ALL_WINDOWS.filter(w => on.includes(w.name));
})();
const SPECIAL_MIN_SAMPLES = 6;   // 이보다 적으면 계수를 믿지 않는다
const SPECIAL_FULL_TRUST = 12;   // 표본이 이만큼 쌓여야 계수를 100% 반영 (그 전엔 1쪽으로 수축)
const SPECIAL_CLAMP = [0.7, 2.5];

const isHolidayYMD = (y, m, d) => !!(jpHolidays && jpHolidays.isHoliday(new Date(y, m - 1, d)));
const specialOf = (m, d) => SPECIAL_WINDOWS.find(w => w.test(m, d))?.name || null;

// 2023-09 이전은 구 요금제(1인당 ¥1,425~2,781 → 이후 ¥3,300~4,050)라 학습에서 뺀다.
// 남겨두면 객단가 환산이 통째로 어긋난다.
const MIN_TRAIN_KEY = 2023 * 12 + 9;

const TICKET_FALLBACK = 3600;   // 객단가 추정 불가 시 (엔/인)
// 예약 유입 속도를 보는 창(일). 0이면 3항을 끄고 검증된 2항만 쓴다.
const INFLOW_DAYS = Number(process.env.PACE_INFLOW_DAYS ?? 14);
const MIN_SAMPLES = 6;          // 회귀 최소 표본(개월)
const WD_WINDOW = 6;            // 요일 기준선 창(개월)

const pad = (n, w = 2) => String(n).padStart(w, '0');
const monthKey = (y, m) => y * 12 + m;
// JST 그날 끝 = UTC 14:59:59.999Z
const eodUTC = (y, m, d) => `${y}-${pad(m)}-${pad(d)}T14:59:59.999Z`;
// JST 기준 이번 달 key — 이 값 이상인 달은 아직 안 끝났다
function currentMonthKey() {
  const [y, m] = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }).split('-').map(Number);
  return monthKey(y, m);
}

// ===== 1. 메일 → 이벤트 =====
const SUBJECT_TYPE = s => {
  if (/予約が確定しました|リクエスト予約を確定しました/.test(s)) return 'confirm';
  if (/キャンセルされました|予約をキャンセルしました|予約をお断りしました/.test(s)) return 'cancel';
  if (/予約内容を変更しました/.test(s)) return 'change';
  return null; // 메시지 알림·안내 메일 등은 예약 상태와 무관
};
const RE = {
  no:    /［予約番号］\s*([A-Za-z0-9]+)/,
  state: /［状態］\s*(\S+)/,
  visit: /［来店日時］\s*(\d{4})年(\d{2})月(\d{2})日\([日月火水木金土]\)\s*(\d{1,2})時(\d{2})分/,
  ppl:   /［来店人数］\s*(\d+)\s*名/,
};

function parseMail(subject, text, date, uid) {
  const type = SUBJECT_TYPE(subject);
  if (!type) return null;
  const no = RE.no.exec(text)?.[1];
  const v = RE.visit.exec(text);
  const ppl = RE.ppl.exec(text);
  if (!no || !v || !ppl) return null;
  return {
    uid, type, ts: date?.toISOString(), no,
    state: RE.state.exec(text)?.[1] || null,
    visit: `${v[1]}-${v[2]}-${v[3]}`,
    people: Number(ppl[1]),
  };
}

/**
 * IMAP에서 예약 메일을 가져와 이벤트로 파싱한다.
 * since를 주면 그 날짜 이후만 (증분 동기화 — 6천 통을 매번 다시 읽지 않는다).
 * IMAP SINCE는 날짜 단위라 하루 겹쳐 받고, 중복은 uid로 제거한다.
 */
async function fetchEvents({ user, pass, from, since = null, onProgress = null }) {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user, pass }, logger: false,
  });
  await client.connect();
  const out = [];
  const lock = await client.getMailboxLock('INBOX');
  try {
    const query = { from };
    if (since) query.since = new Date(Date.parse(since) - 24 * 3600 * 1000); // 하루 여유
    const uids = await client.search(query, { uid: true });
    if (uids.length) {
      let n = 0;
      for await (const msg of client.fetch({ uid: uids.join(',') }, { source: true, envelope: true, uid: true })) {
        n++;
        if (onProgress && n % 500 === 0) onProgress(n, uids.length);
        const subject = String(msg.envelope?.subject || '');
        if (!SUBJECT_TYPE(subject)) continue;
        try {
          const p = await simpleParser(msg.source);
          const ev = parseMail(subject, String(p.text || ''), p.date || msg.envelope?.date, msg.uid);
          if (ev && ev.ts) out.push(ev);
        } catch { /* 개별 메일 파싱 실패는 건너뛴다 — 한 통 때문에 전체가 죽으면 안 된다 */ }
      }
    }
  } finally {
    lock.release();
  }
  await client.logout();
  return out;
}

// ===== 2. 이벤트 저장/병합 =====
function loadEvents(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(raw?.events) ? raw.events : [];
  } catch {
    return [];
  }
}

function saveEvents(file, events) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), events }));
  return events;
}

/** uid 기준 중복 제거 후 ts 오름차순 — 재생 순서가 곧 상태 변화 순서다 */
function mergeEvents(a, b) {
  const seen = new Map();
  for (const e of [...a, ...b]) if (e?.uid != null && e.ts) seen.set(e.uid, e);
  return [...seen.values()].sort((x, y) => (x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : 0));
}

// ===== 3. 시점 복원 =====
/** cutoff(ISO) 시점에 살아있던 예약 목록. events는 ts 오름차순이어야 한다. */
function activeAt(events, cutoff) {
  const st = new Map();
  for (const e of events) {
    if (!e.ts || e.ts > cutoff) break;
    if (e.type === 'cancel') { st.delete(e.no); continue; }
    st.set(e.no, { visit: e.visit, people: e.people }); // confirm·change 모두 최신 내용으로 덮어쓴다
  }
  return [...st.values()];
}

/** 월 (y,m)의 d일 시점 — 그때까지 방문 확정된 인원 / 그 이후로 잡혀 있는 인원 */
function monthSnapshot(events, y, m, d) {
  const pre = `${y}-${pad(m)}`;
  const act = activeAt(events, eodUTC(y, m, d)).filter(r => r.visit.startsWith(pre));
  const dayOf = r => Number(r.visit.slice(8, 10));
  return {
    realized: act.filter(r => dayOf(r) <= d).reduce((s, r) => s + r.people, 0),
    ahead:    act.filter(r => dayOf(r) >  d).reduce((s, r) => s + r.people, 0),
  };
}

function monthFinalPeople(events, y, m) {
  const pre = `${y}-${pad(m)}`;
  return activeAt(events, eodUTC(y, m, 31)).filter(r => r.visit.startsWith(pre))
    .reduce((s, r) => s + r.people, 0);
}

// ===== 4. 특징량 =====
const cumYen = (mo, d) => mo.days.filter(x => x.day <= d).reduce((s, x) => s + x.amount, 0);

/**
 * 직전 WD_WINDOW개월 요일별 일평균(엔). 휴무(¥0)일도 포함해야 과대추정을 막는다.
 * 공휴일은 별도 '주말' 풀로 뺀다 — 공휴일을 원래 요일에 섞으면 그 요일 평균이 부풀고,
 * 정작 공휴일 자체는 평일로 계산돼 양쪽 다 틀린다.
 * 특수 구간(오봉 등)도 뺀다 — 그 날들은 아래 구간 계수가 따로 책임진다(이중 계상 방지).
 */
function weekdayBaseline(pastMonths) {
  const win = pastMonths.slice(-WD_WINDOW);
  const sum = {}, cnt = {};
  for (const wd of WD_ORDER) { sum[wd] = 0; cnt[wd] = 0; }
  sum.주말 = 0; cnt.주말 = 0;
  for (const mo of win) for (const x of mo.days) {
    if (!(x.wd in sum)) continue;
    if (specialOf(mo.month, x.day)) continue;
    const hol = isHolidayYMD(mo.year, mo.month, x.day);
    if (hol) { sum.주말 += x.amount; cnt.주말++; continue; }
    sum[x.wd] += x.amount; cnt[x.wd]++;
    if (x.wd === '토' || x.wd === '일') { sum.주말 += x.amount; cnt.주말++; }
  }
  const avg = {};
  for (const wd of WD_ORDER) avg[wd] = cnt[wd] ? sum[wd] / cnt[wd] : 0;
  avg.주말 = cnt.주말 ? sum.주말 / cnt.주말 : (avg.토 + avg.일) / 2;
  return avg;
}

/**
 * 특수 구간 계수 — 그 구간 실적이 요일 기준선 대비 몇 배였는지 과거 전체에서 학습.
 * 표본이 적으면 1쪽으로 수축시켜 근거 없는 증폭을 막는다.
 */
function learnSpecialFactors(allMonths, uptoKey = null) {
  const lim = Math.min(uptoKey ?? Infinity, currentMonthKey());
  const pool = allMonths.filter(m => m.total > 0 && m.key >= MIN_TRAIN_KEY && m.key < lim);
  const buckets = {};
  for (const mo of pool) {
    const past = allMonths.filter(p => p.key < mo.key && p.total > 0);
    if (past.length < WD_WINDOW) continue;
    const base = weekdayBaseline(past);
    for (const x of mo.days) {
      const name = specialOf(mo.month, x.day);
      if (!name) continue;
      const exp = isHolidayYMD(mo.year, mo.month, x.day) ? base.주말 : (base[x.wd] || 0);
      if (!(exp > 0)) continue;
      (buckets[name] ||= []).push(x.amount / exp);
    }
  }
  const out = {};
  for (const [name, ratios] of Object.entries(buckets)) {
    if (ratios.length < SPECIAL_MIN_SAMPLES) continue;
    const raw = Math.min(SPECIAL_CLAMP[1], Math.max(SPECIAL_CLAMP[0], quantile(ratios, 0.5)));
    const trust = Math.min(1, ratios.length / SPECIAL_FULL_TRUST);
    out[name] = { factor: Number((1 + (raw - 1) * trust).toFixed(4)), raw: Number(raw.toFixed(4)), n: ratios.length };
  }
  return out;
}

/** 하루의 기대 매출(엔) = 요일 기준선(공휴일=주말) × 특수 구간 계수 */
function dayValue(year, month, day, wd, base, special) {
  const hol = isHolidayYMD(year, month, day);
  const v = hol ? base.주말 : (base[wd] || 0);
  const name = specialOf(month, day);
  return v * (name && special?.[name] ? special[name].factor : 1);
}

/** 최근 객단가(엔/인) — 요일 기준선(엔)을 인원 단위로 바꾸는 환산율 */
function recentTicket(events, pastMonths) {
  const win = pastMonths.filter(p => p.key >= MIN_TRAIN_KEY).slice(-WD_WINDOW);
  let yen = 0, ppl = 0;
  for (const p of win) { yen += p.total; ppl += monthFinalPeople(events, p.year, p.month); }
  return ppl > 0 ? yen / ppl : TICKET_FALLBACK;
}

/** d일 이후 남은 날들의 기대 매출 합(공휴일·특수구간 보정 포함)을 '인원'으로 환산 */
function remainWeightPeople(mo, d, wdAvg, ticket, special = null) {
  const yen = mo.days.filter(x => x.day > d)
    .reduce((s, x) => s + dayValue(mo.year, mo.month, x.day, x.wd, wdAvg, special), 0);
  return ticket > 0 ? yen / ticket : 0;
}

/**
 * as-of 직전 INFLOW_DAYS일간 새로 들어온 예약 인원 (취소 차감한 순증).
 * 방문일이 아니라 '접수 시각' 기준 — 지금 수요가 얼마나 뜨거운지를 보는 항이다.
 * x1(잡힌 예약)은 이미 들어온 결과, x2(남은 날)는 달력 사정만 볼 뿐 둘 다 '속도'를 못 본다.
 * 이 항을 넣자 백테스트 MAPE가 10.5% → 10.0%, 특히 d=15가 12.4% → 10.0%로 좋아졌다.
 */
function inflowPeople(events, y, m, d, days = INFLOW_DAYS) {
  if (!(days > 0)) return 0;
  const to = eodUTC(y, m, d);
  const from = new Date(Date.parse(to) - days * 86400000).toISOString();
  let net = 0;
  for (const e of events) {
    if (!e.ts || e.ts > to) break;
    if (e.ts < from) continue;
    if (e.type === 'confirm') net += e.people;
    else if (e.type === 'cancel') net -= e.people;
  }
  return Math.max(0, net);
}

// ===== 5. 학습 =====
/** y = a·x1 + b·x2 최소제곱(절편 없음). 계수가 음수면 그 항을 빼고 단순회귀 — 외삽 폭주 방지. */
function fitTwoTerm(S) {
  let s11 = 0, s12 = 0, s22 = 0, s1y = 0, s2y = 0;
  for (const t of S) {
    s11 += t.x1 * t.x1; s12 += t.x1 * t.x2; s22 += t.x2 * t.x2;
    s1y += t.x1 * t.y;  s2y += t.x2 * t.y;
  }
  const det = s11 * s22 - s12 * s12;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  let a = (s1y * s22 - s2y * s12) / det;
  let b = (s11 * s2y - s12 * s1y) / det;
  if (a < 0 || b < 0) {
    if (a < 0) { a = 0; b = s22 ? s2y / s22 : 0; }
    else       { b = 0; a = s11 ? s1y / s11 : 0; }
  }
  return (Number.isFinite(a) && Number.isFinite(b)) ? { a, b } : null;
}

/**
 * y = a·x1 + b·x2 + c·x3 최소제곱(절편 없음). 가우스 소거.
 * 계수가 하나라도 음수면 null — 3항이 불안정하다는 뜻이므로 호출자가 2항으로 내려간다.
 * (음수 계수는 "예약이 늘수록 매출이 준다" 같은 헛소리를 만들고 외삽에서 폭주한다)
 */
function fitThreeTerm(S) {
  const K = 3, keys = ['x1', 'x2', 'x3'];
  const M = Array.from({ length: K }, () => new Array(K + 1).fill(0));
  for (const t of S) {
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < K; j++) M[i][j] += t[keys[i]] * t[keys[j]];
      M[i][K] += t[keys[i]] * t.y;
    }
  }
  for (let i = 0; i < K; i++) {
    let p = i;
    for (let r = i + 1; r < K; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-9) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < K; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let k = i; k <= K; k++) M[r][k] -= f * M[i][k];
    }
  }
  const co = [0, 1, 2].map(i => M[i][K] / M[i][i]);
  if (co.some(c => !Number.isFinite(c) || c < 0)) return null;
  return { a: co[0], b: co[1], c: co[2] };
}

function quantile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/**
 * as-of d일 표본 하나: 그 달 d일 시점 예약 상태 → 남은 인원
 * 요일 기준선·객단가는 '그 달 이전'만 써서 만든다 (추론 시점과 같은 조건).
 */
function sampleAt(events, months, mo, d, special) {
  const past = months.filter(p => p.key < mo.key && p.total > 0);
  if (past.length < WD_WINDOW) return null;
  const snap = monthSnapshot(events, mo.year, mo.month, d);
  const finalP = monthFinalPeople(events, mo.year, mo.month);
  const y = finalP - snap.realized;
  if (!(y > 0) || !(snap.realized > 0)) return null;
  const ticket = cumYen(mo, d) / snap.realized;
  return {
    x1: snap.ahead,
    x2: remainWeightPeople(mo, d, weekdayBaseline(past), recentTicket(events, past), special),
    x3: inflowPeople(events, mo.year, mo.month, d),
    y,
    // 남은 날의 1인 단가 ÷ 월초~d일 1인 단가. 월초 객단가를 그대로 잔여에 쓰면 살짝 어긋난다.
    tRatio: (ticket > 0 && Number.isFinite(ticket)) ? ((mo.total - cumYen(mo, d)) / y) / ticket : 1,
  };
}

/** 1~31일 각각에 대해 계수와 잔차분포를 학습 → pace-model.json 내용 */
function trainModel(events, months, { upto = null } = {}) {
  // 진행 중인 달(이번 달·미래 달)은 절대 학습에 넣지 않는다.
  // 그 달의 '최종 인원'은 아직 확정이 아니라 지금까지 잡힌 수라서,
  // 표본으로 들어가면 "잔여는 이만큼 적다"를 학습해 예측이 구조적으로 낮아진다.
  // (백테스트는 upto를 넘겨 자연히 걸러졌기 때문에 이 오염이 오래 안 보였다)
  const limit = Math.min(upto ?? Infinity, currentMonthKey());
  const usable = months.filter(m => m.total > 0 && m.key >= MIN_TRAIN_KEY && m.key < limit);
  const special = learnSpecialFactors(months, limit);
  const byDay = {};
  for (let d = 1; d <= 31; d++) {
    const S = usable.map(mo => sampleAt(events, months, mo, d, special)).filter(Boolean);
    if (S.length < MIN_SAMPLES) continue;
    // 3항(유입 속도 포함)을 먼저 시도하고, 계수가 음수로 나오면 검증된 2항으로 내려간다.
    const three = INFLOW_DAYS > 0 ? fitThreeTerm(S) : null;
    const co = three || fitTwoTerm(S);
    if (!co) continue;
    const c = co.c || 0;
    // 잔차비 = 실제 남은인원 ÷ 모델 예측 남은인원. 중앙값(k)이 기본 보정, p15/p85가 보수/낙관 밴드.
    // 중앙값보다 평균이 백테스트에서 근소하게 나았다 (MAPE 9.74 → 9.66).
    const resid = S.map(t => t.y / (co.a * t.x1 + co.b * t.x2 + c * (t.x3 || 0) || 1)).filter(Number.isFinite);
    const trs = S.map(t => t.tRatio).filter(v => Number.isFinite(v) && v > 0 && v < 3);
    const avg = resid.length ? resid.reduce((s2, v) => s2 + v, 0) / resid.length : 1;
    byDay[d] = {
      a: Number(co.a.toFixed(6)), b: Number(co.b.toFixed(6)), c: Number(c.toFixed(6)),
      terms: three ? 3 : 2, n: S.length,
      k: Number(avg.toFixed(4)),
      tRatio: Number((quantile(trs, 0.5) ?? 1).toFixed(4)),
      p15: Number((quantile(resid, 0.15) ?? 1).toFixed(4)),
      p50: Number((quantile(resid, 0.50) ?? 1).toFixed(4)),
      p85: Number((quantile(resid, 0.85) ?? 1).toFixed(4)),
    };
  }
  return {
    trainedAt: new Date().toISOString(),
    events: events.length,
    months: usable.length,
    minTrainKey: MIN_TRAIN_KEY,
    special,
    byDay,
  };
}

// ===== 6. 추론 =====
/**
 * 이번 달 월말 예상.
 * cur       : parseMonthTab 결과 (year, month, key, days[], total)
 * asOfDay   : 오늘(JST) 일
 * months    : 전 월 탭 (cur 포함)
 * model     : trainModel 결과
 * 반환 null = 모델·표본 부족 (호출자가 기존 방식으로 폴백해야 한다)
 */
function forecastMonth({ events, months, cur, asOfDay, model }) {
  const m = model?.byDay?.[asOfDay] || model?.byDay?.[String(asOfDay)];
  if (!m) return null;

  const snap = monthSnapshot(events, cur.year, cur.month, asOfDay);
  const mtd = cumYen(cur, asOfDay);
  // 실현 인원이 0이면 객단가를 못 뽑는다 (월초·휴점 직후). 이땐 예측하지 않는다.
  if (!(snap.realized > 0) || !(mtd > 0)) return null;

  const past = months.filter(p => p.key < cur.key && p.total > 0);
  if (past.length < WD_WINDOW) return null;

  const ticket = mtd / snap.realized;                    // 이번 달 실측 객단가
  const x1 = snap.ahead;
  const special = model.special || null;
  const x2 = remainWeightPeople(cur, asOfDay, weekdayBaseline(past), recentTicket(events, past), special);
  const x3 = (m.terms === 3) ? inflowPeople(events, cur.year, cur.month, asOfDay) : 0;
  const remainPeople = m.a * x1 + m.b * x2 + (m.c || 0) * x3;
  if (!Number.isFinite(remainPeople) || remainPeople < 0) return null;

  // 남은 기간에 걸린 특수 구간 (화면 설명용)
  const windows = [...new Set(cur.days.filter(x => x.day > asOfDay)
    .map(x => specialOf(cur.month, x.day)).filter(Boolean))]
    .map(name => ({ name, factor: special?.[name]?.factor ?? 1 }));
  const holidays = cur.days.filter(x => x.day > asOfDay && isHolidayYMD(cur.year, cur.month, x.day))
    .map(x => `${x.day}일(${x.wd})`);

  const tr = m.tRatio || 1;                              // 잔여 구간의 객단가 보정
  const remainYen = remainPeople * ticket * tr;
  // 이미 잡힌 예약은 최소한 들어온다 → 보수 시나리오의 하한
  const bookedFloor = mtd + cumYen({ days: cur.days.filter(x => x.day > asOfDay) }, 31);

  return {
    base: mtd + remainYen * (m.k ?? m.p50),
    low:  Math.max(bookedFloor, mtd + remainYen * m.p15),
    high: mtd + remainYen * m.p85,
    mtd,
    bookedFloor,
    realizedPeople: snap.realized,
    aheadPeople: snap.ahead,
    remainPeople,
    ticket,
    coef: { a: m.a, b: m.b, c: m.c || 0, terms: m.terms || 2, n: m.n, k: m.k ?? m.p50, tRatio: tr },
    inflowPeople: x3,
    inflowDays: INFLOW_DAYS,
    windows,
    holidays,
    remainDays: cur.days.filter(x => x.day > asOfDay).length,
    remainWeekend: cur.days.filter(x => x.day > asOfDay &&
      (x.wd === '토' || x.wd === '일' || isHolidayYMD(cur.year, cur.month, x.day))).length,
  };
}

module.exports = {
  WD_ORDER, MIN_TRAIN_KEY, MIN_SAMPLES,
  parseMail, fetchEvents, loadEvents, saveEvents, mergeEvents,
  activeAt, monthSnapshot, monthFinalPeople,
  cumYen, weekdayBaseline, recentTicket, remainWeightPeople,
  fitTwoTerm, fitThreeTerm, inflowPeople, quantile, sampleAt, trainModel, forecastMonth, currentMonthKey,
  SPECIAL_WINDOWS, isHolidayYMD, specialOf, learnSpecialFactors, dayValue,
};
