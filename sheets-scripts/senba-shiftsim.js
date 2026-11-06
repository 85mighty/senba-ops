// 「인건비 시뮬」 탭 — 1인 체제 근무 규칙(booking-view/shift-rules.js)을 실제 예약에 적용했을 때 월 인건비 (2026-11-06)
// 데이터: 매출 시트 「예약관리」 탭 (취소 제외, 코스에서 시간 추출, 없으면 2시간) · 2026-09 (확정) / 2026-10 / 2026-11 (접수분 기준) + 11월 예상
// 시나리오:
//  ① 현행(1,200): 아이미짱만 금토일월 (12:45~13:45 출근, 17:00~18:15 퇴근) — 화수목·주말 오전은 사장님
//  ② 1인 체제(1,300): 아이미짱 토일월화목, 예약 있으면 첫 예약 15분 전(주말 10:45~, 평일 12:45~), 없으면 13:30-16:30, 마감 18:15 · 수금 휴무
//  ③ ②와 같은 근무를 1,200엔으로 (인상분이 얼마인지)
//  ④ ②에서 주말 오전 미영업 (주말도 12:45 이후 출근, 1,300)
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));
process.env.SHIFT_WAGE = '1300';
const SHIFT = require(path.join(__dirname, '..', 'booking-view', 'shift-rules.js'));

const LEDGER_ID = '1sUXyrXxYzl_n6n5T4dV_flQ6Ocli3c0B-Ggbwzw5YC4';
const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '인건비 시뮬';
const RULE_TAG = '규칙v6 1인체제(아이미 토일월화목·주말 10:45·시급 1,300)';
const PREV_2P = { '2026-09': 174000, '2026-10': 174000, '2026-11': 171600 };   // 참고: 직전 2인안(마미+아이미, 1,200) 결과
const MONTHS = ['2026-09', '2026-10', '2026-11'];
const PROJ = { month: '2026-11', base: '2026-10' };   // 11월 예상 = 10월 요일별 평균 일당 × 11월 요일 수
const HOLI = { '2026-11-03': '文化の日', '2026-11-23': '勤労感謝の日' };
const W_NEW = 1300, W_OLD = 1200;
const WD = '日月火水木金土';
const NCOL = 9;

const courseHours = c => { const m = String(c || '').match(/(\d+)\s*(時間|시간|h)/i); const h = m ? Number(m[1]) : 2; return h >= 1 && h <= 8 ? h : 2; };
const dow = ds => new Date(ds + 'T12:00:00Z').getUTCDay();
const payAt = (s, e, w) => Math.round(Math.ceil((e - s) / 15) * 15 / 60 * w);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const daysIn = ym => { const [y, m] = ym.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`); };
const yen = n => Math.round(n).toLocaleString('ja-JP');

// ① 현행 아이미짱 단독 (금토일월, 공휴일 무관, 1,200)
function current(ymd, bk) {
  const d = dow(ymd);
  if (!(d === 0 || d === 1 || d === 5 || d === 6)) return 0;
  const lastEnd = bk.length ? Math.max(...bk.map(b => b.e)) : null;
  const s = bk.length ? clamp(bk[0].s - 15, 12 * 60 + 45, 13 * 60 + 45) : 12 * 60 + 45;
  const e = lastEnd === null ? 17 * 60 : clamp(lastEnd + 15, 17 * 60, 18 * 60 + 15);
  return payAt(s, e, W_OLD);
}

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const g = await sheets.spreadsheets.values.get({ spreadsheetId: LEDGER_ID, range: `'예약관리'!A2:R`, valueRenderOption: 'FORMATTED_VALUE' });
  const byDay = {};
  for (const r of g.data.values || []) {
    const status = String(r[1] || '');
    const dm = String(r[4] || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    const tm = String(r[5] || '').match(/(\d{1,2}):(\d{2})/);
    if (!dm || !tm || status.includes('취소')) continue;
    const date = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
    const s = Number(tm[1]) * 60 + Number(tm[2]);
    (byDay[date] = byDay[date] || []).push({ s, e: s + courseHours(r[8]) * 60 });
  }

  const rows = [], titles = [], hdrIdx = [], bandRanges = [], noteIdx = [];
  const push = r => { rows.push(r); return rows.length - 1; };
  const monthSummary = {}, wdCost = {};
  for (const ym of MONTHS) {
    const tot = { cur: 0, fix: 0, old: 0, noMorn: 0, hours: 0, days: 0, cleanDays: 0, longDays: 0, bookings: 0 };
    const byWd = Array.from({ length: 7 }, () => ({ days: 0, work: 0, hours: 0, pay: 0, old: 0, noMorn: 0 }));
    const dayRows = [];
    for (const ymd of daysIn(ym)) {
      const bk = (byDay[ymd] || []).sort((a, b) => a.s - b.s);
      const p = SHIFT.plan(ymd, bk), pn = SHIFT.plan(ymd, bk, { noMorning: true });
      const sh = p.aimi, shn = pn.aimi;
      const pay = sh ? sh.pay : 0, old = sh ? payAt(sh.start, sh.end, W_OLD) : 0, noMorn = shn ? shn.pay : 0, hours = sh ? sh.hours : 0;
      const cur = current(ymd, bk);
      tot.cur += cur; tot.fix += pay; tot.old += old; tot.noMorn += noMorn; tot.hours += hours; tot.bookings += bk.length;
      if (sh) { tot.days++; if (sh.cleanOnly) tot.cleanDays++; if (sh.breakReq) tot.longDays++; }
      const w = byWd[dow(ymd)]; w.days++; if (sh) w.work++; w.hours += hours; w.pay += pay; w.old += old; w.noMorn += noMorn;
      const wc = ((wdCost[ym] = wdCost[ym] || {})[dow(ymd)] = wdCost[ym][dow(ymd)] || { cost: 0, days: 0 }); wc.cost += pay; wc.days++;
      dayRows.push([ymd.slice(5).replace('-', '/') + '(' + WD[dow(ymd)] + ')' + (HOLI[ymd] ? '祝' : ''), bk.length, p.closed ? '휴무' : sh ? `${SHIFT.hm(sh.start)}-${SHIFT.hm(sh.end)}${sh.cleanOnly ? '(청소)' : ''}${sh.breakReq ? '(휴게45)' : ''}` : '', hours || '', pay || '', old || '', noMorn || '', cur, p.warns.length ? p.warns[0].ko : '']);
    }
    monthSummary[ym] = tot;
    const label = (ym >= '2026-10' ? ym + ' (접수분 기준)' : ym) + ' ' + RULE_TAG;
    titles.push(push([`${label} — ①현행(1,200) ${yen(tot.cur)}엔 → ②1인 체제(1,300) ${yen(tot.fix)}엔 (${tot.days}일 ${tot.hours}h · 예약없는날 ${tot.cleanDays}일 · 6h초과 ${tot.longDays}일) | ③같은 근무 1,200 ${yen(tot.old)}엔 (인상분 ${yen(tot.fix - tot.old)}) | ④주말 오전 미영업 ${yen(tot.noMorn)}엔 | 참고 2인안 ${yen(PREV_2P[ym])}엔`]));
    hdrIdx.push(push(['요일', '일수', '출근일', '시간(h)', '급여 1,300', '같은 근무 1,200', '주말오전 미영업', '', '']));
    const b0 = rows.length;
    for (const d of [1, 2, 3, 4, 5, 6, 0]) { const w = byWd[d]; push([WD[d], w.days, w.work, w.hours, w.pay, w.old, w.noMorn, '', '']); }
    bandRanges.push([b0, rows.length]);
    push([]);
    hdrIdx.push(push(['날짜', '예약', '아이미짱', '시간(h)', '급여 1,300', '같은 근무 1,200', '주말오전 미영업', '①현행', '비고']));
    const d0 = rows.length; for (const r of dayRows) push(r); bandRanges.push([d0, rows.length]);
    push([]);
  }
  {   // 11월 예상 (10월 요일별 평균 일당 기준)
    const base = wdCost[PROJ.base] || {}; let est = 0; const byD = Array.from({ length: 7 }, () => 0);
    for (const ymd of daysIn(PROJ.month)) { const d = dow(ymd); const avg = base[d] ? base[d].cost / base[d].days : 0; est += avg; byD[d] += avg; }
    const parts = [1, 2, 3, 4, 5, 6, 0].map(d => WD[d] + ' ' + yen(byD[d]));
    titles.push(push([`${PROJ.month} 예상 인건비 약 ${yen(est)}엔 (10월 요일별 평균 일당 × 11월 요일 수 · ${parts.join(' / ')}) | 현재 접수분만 적용 시 ${yen(monthSummary[PROJ.month].fix)}엔 | 공휴일 ${Object.entries(HOLI).map(([k, v]) => k.slice(5) + ' ' + v).join(', ')}`]));
    monthSummary.proj = est;
  }
  noteIdx.push(push(['※ 코스 시간은 예약관리의 코스명에서 추출(없으면 2시간) · 15분 단위 올림 · ①현행 = 아이미짱만 금토일월 1,200엔(화수목·주말 오전은 사장님) · 6시간 초과 근무일은 45분 휴게 법정 의무(급여에서 미차감 가정) · 10·11월은 접수 중인 예약이라 실제치는 더 늘어남']));

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const old = meta.data.sheets.find(s => s.properties.title === TAB);
  const reqs0 = [];
  if (old) reqs0.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  reqs0.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 5, columnCount: NCOL } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = created.data.replies[old ? 1 : 0].addSheet.properties.sheetId;
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });

  const C = { dark: { red: 0.122, green: 0.286, blue: 0.475 }, hdr: { red: 0.267, green: 0.447, blue: 0.769 }, band: { red: 0.955, green: 0.960, blue: 0.975 }, white: { red: 1, green: 1, blue: 1 }, note: { red: 0.45, green: 0.45, blue: 0.45 } };
  const R = [];
  const rng = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const fmt = (range, format, fields) => R.push({ repeatCell: { range, cell: { userEnteredFormat: format }, fields } });
  for (const i of [...titles, ...noteIdx]) R.push({ mergeCells: { range: rng(i, i + 1), mergeType: 'MERGE_ALL' } });
  for (const i of titles) fmt(rng(i, i + 1), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 11, foregroundColor: C.white }, wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy)');
  for (const i of hdrIdx) fmt(rng(i, i + 1), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)');
  for (const [a, b] of bandRanges) { for (let r = a; r < b; r += 2) fmt(rng(r, r + 1), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor'); fmt(rng(a, b, 4, 8), { numberFormat: { type: 'NUMBER', pattern: '#,##0' } }, 'userEnteredFormat.numberFormat'); }
  for (const i of noteIdx) fmt(rng(i, i + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat,wrapStrategy)');
  for (const i of titles) R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: 48 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: NCOL }, properties: { pixelSize: 115 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 300 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  console.log(`[인건비 시뮬 완료] ${RULE_TAG}`);
  console.log(`${PROJ.month} 예상: 약 ${yen(monthSummary.proj)}엔`);
  for (const ym of MONTHS) { const t = monthSummary[ym]; console.log(`${ym}: 예약 ${t.bookings}건 출근 ${t.days}일 ${t.hours}h | ①현행 ${yen(t.cur)} | ②1인 1,300 ${yen(t.fix)} | ③1,200 ${yen(t.old)} | ④주말오전 미영업 ${yen(t.noMorn)} | 2인안 ${yen(PREV_2P[ym])}`); }
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
