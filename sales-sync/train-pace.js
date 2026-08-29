#!/usr/bin/env node
/**
 * train-pace.js — 예약 페이스 모델 학습 (v16)
 *
 *   node train-pace.js            증분 (state/booking-events.json 이후 메일만 추가)
 *   node train-pace.js --full     전량 재수집 (2023-04부터 6천여 통 — 10~20분)
 *   node train-pace.js --backtest 학습 후 백테스트 표까지 출력
 *
 * 산출물
 *   state/booking-events.json  구루나비 알림 메일 → 예약 확정/취소/변경 이벤트 로그
 *   state/pace-model.json      as-of 1~31일별 회귀계수 + 잔차분위수
 *
 * server.js는 이 두 파일만 읽는다(IMAP 재수집 없음). 매월 1일 자동 재학습되고,
 * 새 예약은 server.js가 30분마다 증분 동기화하므로 이 스크립트는 평소 돌릴 일이 없다.
 */

require('dotenv').config();
const path = require('path');
const P = require('./pace-data');

const CFG = {
  IMAP_USER: process.env.IMAP_USER,
  IMAP_PASS: process.env.IMAP_PASS,
  MAIL_FROM_FILTER: (process.env.MAIL_FROM_FILTER || 'plan-reserve@gnavi.co.jp').toLowerCase(),
  SPREADSHEET_ID: process.env.SPREADSHEET_ID,
  SERVICE_ACCOUNT_JSON: process.env.SERVICE_ACCOUNT_JSON || path.join(__dirname, 'service-account.json'),
};
const EVENTS_FILE = path.join(__dirname, 'state', 'booking-events.json');
const MODEL_FILE = path.join(__dirname, 'state', 'pace-model.json');

const full = process.argv.includes('--full');
const backtest = process.argv.includes('--backtest');
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const yen = n => '¥' + Math.round(n).toLocaleString('en-US');

// ===== 월 탭 로드 (server.js의 파싱 규칙과 동일) =====
const DATE_HDR_RE = /(\d+)\s*\/\s*(\d+)\s*\/\s*([월화수목금토일])/;
const parseYen = v => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const normTab = t => String(t).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim();

async function loadMonths() {
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: CFG.SERVICE_ACCOUNT_JSON,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CFG.SPREADSHEET_ID });

  const tabs = [];
  for (const s of meta.data.sheets) {
    const title = s.properties.title;
    if (title.includes('売り上げ')) continue;
    const m = normTab(title).match(/^(\d{2})\/(\d{1,2})$/);
    if (!m) continue;
    const month = Number(m[2]);
    if (month < 1 || month > 12) continue;
    const year = 2000 + Number(m[1]);
    tabs.push({ title, year, month, key: year * 12 + month });
  }
  tabs.sort((a, b) => a.key - b.key);

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: CFG.SPREADSHEET_ID,
    ranges: tabs.map(t => `'${t.title}'!A1:BM6`),
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const out = [];
  tabs.forEach((tab, i) => {
    const rows = res.data.valueRanges[i]?.values || [];
    let hdr = -1;
    for (let r = 0; r < Math.min(4, rows.length); r++) {
      if ((rows[r] || []).filter(c => DATE_HDR_RE.test(String(c || ''))).length >= 3) { hdr = r; break; }
    }
    if (hdr < 0) return;
    const hdrCells = rows[hdr] || [], tot = rows[hdr + 2] || [];
    const days = [];
    for (let c = 1; c < hdrCells.length; c++) {
      const m = DATE_HDR_RE.exec(String(hdrCells[c] || ''));
      if (!m || Number(m[1]) !== tab.month) continue;
      days.push({ day: Number(m[2]), wd: m[3], amount: parseYen(tot[c]) + parseYen(tot[c + 1]) });
    }
    if (days.length) out.push({ ...tab, days, total: days.reduce((s, d) => s + d.amount, 0) });
  });
  return out;
}

(async () => {
  const missing = ['IMAP_USER', 'IMAP_PASS', 'SPREADSHEET_ID'].filter(k => !CFG[k]);
  if (missing.length) { console.error(`❌ .env 누락: ${missing.join(', ')}`); process.exit(1); }

  // 1) 이벤트 수집
  const prev = full ? [] : P.loadEvents(EVENTS_FILE);
  const since = prev.length ? prev[prev.length - 1].ts : null;
  log(full ? '전량 재수집 시작' : `증분 수집 (기존 ${prev.length}건, since=${since || '전체'})`);

  const fetched = await P.fetchEvents({
    user: CFG.IMAP_USER, pass: CFG.IMAP_PASS, from: CFG.MAIL_FROM_FILTER, since,
    onProgress: (n, t) => log(`  ...${n}/${t}`),
  });
  const events = P.mergeEvents(prev, fetched);
  P.saveEvents(EVENTS_FILE, events);
  const byType = {};
  for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;
  log(`이벤트 ${events.length}건 (신규 ${events.length - prev.length}) ${JSON.stringify(byType)}`);
  log(`기간 ${events[0]?.ts?.slice(0, 10)} ~ ${events[events.length - 1]?.ts?.slice(0, 10)}`);

  // 2) 월 탭
  const months = await loadMonths();
  log(`월 탭 ${months.length}개 (${months[0]?.title} ~ ${months[months.length - 1]?.title})`);

  // 3) 학습
  const model = P.trainModel(events, months);
  require('fs').writeFileSync(MODEL_FILE, JSON.stringify(model, null, 1));
  const days = Object.keys(model.byDay).map(Number).sort((a, b) => a - b);
  log(`학습 완료 → ${MODEL_FILE}`);
  log(`  as-of ${days[0]}~${days[days.length - 1]}일 · 학습월 ${model.months}개`);
  for (const d of [5, 10, 15, 20, 25]) {
    const m = model.byDay[d];
    if (m) log(`  d=${String(d).padStart(2)}  a=${m.a.toFixed(3)} b=${m.b.toFixed(3)} (표본 ${m.n}) 잔차 p15/p50/p85 = ${m.p15}/${m.p50}/${m.p85}`);
  }

  // 4) 백테스트 (--backtest) — 대상월보다 앞선 데이터만으로 재학습해 누수를 막는다
  if (backtest) {
    const AS_OF = [5, 10, 15, 20, 25];
    // 끝난 달만 대상 — 진행 중인 이번 달을 넣으면 미완성 실적이 '정답'이 돼 오차가 허수로 부풀린다
    const nowJst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }).split('-').map(Number);
    const curKey = nowJst[0] * 12 + nowJst[1];
    const targets = months.filter(m => m.key >= 2024 * 12 + 7 && m.total > 0 && m.key < curKey);
    const errs = {}, hits = [];
    let over = 0, tot = 0;
    console.log('\n■ 백테스트 (대상월 이전 데이터만 학습)\n');
    console.log('  월       실제         기본예상      오차');
    for (const cur of targets) {
      const mdl = P.trainModel(events, months, { upto: cur.key });
      for (const d of AS_OF) {
        const r = P.forecastMonth({ events, months, cur, asOfDay: d, model: mdl });
        if (!r || !Number.isFinite(r.base)) continue;
        const e = (r.base - cur.total) / cur.total * 100;
        (errs[d] ||= []).push(Math.abs(e));
        hits.push(cur.total >= r.low && cur.total <= r.high ? 1 : 0);
        tot++; if (Math.abs(e) > 10) over++;
        if (d === 10) console.log(`  ${String(cur.year).slice(2)}/${String(cur.month).padStart(2, '0')} ${yen(cur.total).padStart(11)} ${yen(r.base).padStart(13)} ${((e >= 0 ? '+' : '') + e.toFixed(1) + '%').padStart(9)}${Math.abs(e) > 10 ? ' ⚠' : ''}`);
      }
    }
    console.log('\n  as-of  ' + AS_OF.map(d => ('d=' + d).padStart(8)).join(''));
    console.log('  MAPE   ' + AS_OF.map(d => {
      const a = errs[d] || [];
      return (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-').padStart(8);
    }).join(''));
    const all = AS_OF.flatMap(d => errs[d] || []);
    console.log(`\n  전체 MAPE ${(all.reduce((x, y) => x + y, 0) / all.length).toFixed(1)}%  ·  ±10% 초과 ${over}/${tot}  ·  밴드 적중 ${(hits.reduce((a, b) => a + b, 0) / hits.length * 100).toFixed(0)}%`);
  }
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
