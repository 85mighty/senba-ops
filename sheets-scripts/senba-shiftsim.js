// 「인건비 시뮬」 탭 — 새 근무 규칙(booking-view/shift-rules.js)을 실제 예약에 적용했을 때 월 인건비 (2026-10-22)
// 데이터: 매출 시트 「예약관리」 탭 (취소 제외, 코스에서 시간 추출, 없으면 2시간) · 2026-09 (확정) / 2026-10 (접수분 기준)
// 시나리오:
//  ① 현행: 아이미짱만 금토일월 (12:45~13:45 출근, 17:00~18:15 퇴근) — 화수목·주말 오전은 사장님
//  ② 새 규칙(고정): 화 아이미(예약시) · 수 휴무 · 목 마미 13:45 고정(2h 보장) · 토일 마미 11:00 고정(13:00 보장)+아이미 · 금월 아이미
//  ③ ②에서 보장 제외: 목·토일 예약 없는 날 마미짱 출근 안 함 (보장 비용이 얼마인지)
//  ④ ②에서 금요일도 "예약 있을 때만" 아이미짱 출근
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));
const SHIFT = require(path.join(__dirname, '..', 'booking-view', 'shift-rules.js'));

const LEDGER_ID = '1sUXyrXxYzl_n6n5T4dV_flQ6Ocli3c0B-Ggbwzw5YC4';
const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '인건비 시뮬';
const MONTHS = ['2026-09', '2026-10'];
const WAGE = 1200;
const WD = '日月火水木金土';
const NCOL = 9;

const courseHours = c => { const m = String(c || '').match(/(\d+)\s*(時間|시간|h)/i); const h = m ? Number(m[1]) : 2; return h >= 1 && h <= 8 ? h : 2; };
const dow = ds => new Date(ds + 'T12:00:00Z').getUTCDay();
const pay = (s, e) => Math.round(Math.ceil((e - s) / 15) * 15 / 60 * WAGE);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const daysIn = ym => { const [y, m] = ym.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`); };

// ① 현행 아이미짱 단독 (금토일월, 공휴일 무관)
function current(ymd, bk) {
  const d = dow(ymd);
  if (!(d === 0 || d === 1 || d === 5 || d === 6)) return 0;
  const lastEnd = bk.length ? Math.max(...bk.map(b => b.e)) : null;
  const s = bk.length ? clamp(bk[0].s - 15, 12 * 60 + 45, 13 * 60 + 45) : 12 * 60 + 45;
  const e = lastEnd === null ? 17 * 60 : clamp(lastEnd + 15, 17 * 60, 18 * 60 + 15);
  return pay(s, e);
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

  const rows = [], titles = [];
  const push = r => { rows.push(r); return rows.length - 1; };
  const hdrIdx = [], bandRanges = [], noteIdx = [];
  const monthSummary = {};
  for (const ym of MONTHS) {
    const tot = { cur: 0, fix: 0, noGuar: 0, friOff: 0, mami: 0, aimi: 0, guar: 0, standbyDays: 0, friCleanDays: 0, bookings: 0, openDays: 0 };
    const byWd = Array.from({ length: 7 }, () => ({ days: 0, mami: 0, aimi: 0, mamiDays: 0, aimiDays: 0 }));
    const dayRows = [];
    for (const ymd of daysIn(ym)) {
      const bk = (byDay[ymd] || []).sort((a, b) => a.s - b.s);
      const p = SHIFT.plan(ymd, bk);
      const m = p.mami ? p.mami.pay : 0, a = p.aimi ? p.aimi.pay : 0;
      const standby = p.mami && p.mami.standby ? p.mami.pay : 0;
      const friClean = dow(ymd) === 5 && p.aimi && p.aimi.cleanOnly ? p.aimi.pay : 0;
      const cur = current(ymd, bk);
      tot.cur += cur; tot.fix += m + a; tot.noGuar += m + a - standby; tot.friOff += m + a - friClean;
      tot.mami += m; tot.aimi += a; tot.guar += standby; if (standby) tot.standbyDays++; if (friClean) tot.friCleanDays++;
      tot.bookings += bk.length; if (!p.closed) tot.openDays++;
      const w = byWd[dow(ymd)]; w.days++; w.mami += m; w.aimi += a; if (m) w.mamiDays++; if (a) w.aimiDays++;
      const fmtS = s => s ? `${SHIFT.hm(s.start)}-${SHIFT.hm(s.end)}${s.standby ? '(대기)' : ''}${s.cleanOnly ? '(청소)' : ''}` : '';
      dayRows.push([ymd.slice(5).replace('-', '/') + '(' + WD[dow(ymd)] + ')', bk.length, p.closed ? '휴무' : fmtS(p.mami), m || '', p.closed ? '' : fmtS(p.aimi), a || '', m + a, cur, p.warns.length ? p.warns[0].ko : '']);
    }
    monthSummary[ym] = tot;
    const label = ym === '2026-10' ? ym + ' (접수분 기준)' : ym;
    titles.push(push([`${label} 인건비 — ①현행 ${tot.cur.toLocaleString('ja-JP')}엔 → ②새 규칙(고정) ${tot.fix.toLocaleString('ja-JP')}엔 (마미 ${tot.mami.toLocaleString('ja-JP')} + 아이미 ${tot.aimi.toLocaleString('ja-JP')}) | ③보장 제외 ${tot.noGuar.toLocaleString('ja-JP')}엔 (보장비용 ${tot.guar.toLocaleString('ja-JP')}·${tot.standbyDays}일) | ④금요일 예약시만 ${tot.friOff.toLocaleString('ja-JP')}엔`]));
    hdrIdx.push(push(['요일', '일수', '마미짱 출근일', '마미짱 급여', '아이미짱 출근일', '아이미짱 급여', '합계', '', '']));
    const b0 = rows.length;
    for (const d of [2, 3, 4, 5, 6, 0, 1]) { const w = byWd[d]; push([WD[d], w.days, w.mamiDays, w.mami, w.aimiDays, w.aimi, w.mami + w.aimi, '', '']); }
    bandRanges.push([b0, rows.length]);
    push([]);
    hdrIdx.push(push(['날짜', '예약', '마미짱', '급여', '아이미짱', '급여', '합계(새 규칙)', '①현행', '비고']));
    const d0 = rows.length; for (const r of dayRows) push(r); bandRanges.push([d0, rows.length]);
    push([]);
  }
  noteIdx.push(push(['※ 코스 시간은 예약관리의 코스명에서 추출(없으면 2시간) · 급여 1,200엔/h, 15분 단위 올림 · ①현행 = 아이미짱만 금토일월(화수목·주말 오전은 사장님) · 10월은 아직 접수 중인 예약이라 월말 실제치는 더 늘어남']));

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
  for (const [a, b] of bandRanges) { for (let r = a; r < b; r += 2) fmt(rng(r, r + 1), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor'); fmt(rng(a, b, 3, 4), { numberFormat: { type: 'NUMBER', pattern: '#,##0' } }, 'userEnteredFormat.numberFormat'); fmt(rng(a, b, 5, 8), { numberFormat: { type: 'NUMBER', pattern: '#,##0' } }, 'userEnteredFormat.numberFormat'); }
  for (const i of noteIdx) fmt(rng(i, i + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat,wrapStrategy)');
  for (const i of titles) R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: 48 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: NCOL }, properties: { pixelSize: 115 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 300 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  console.log(`[인건비 시뮬 완료]`);
  for (const ym of MONTHS) { const t = monthSummary[ym]; console.log(`${ym}: 예약 ${t.bookings}건 영업 ${t.openDays}일 | ①현행 ${t.cur.toLocaleString('ja-JP')} | ②고정 ${t.fix.toLocaleString('ja-JP')} (마미 ${t.mami.toLocaleString('ja-JP')} / 아이미 ${t.aimi.toLocaleString('ja-JP')}) | ③보장제외 ${t.noGuar.toLocaleString('ja-JP')} (보장 ${t.guar.toLocaleString('ja-JP')}·${t.standbyDays}일) | ④금요일 예약시만 ${t.friOff.toLocaleString('ja-JP')} (청소만 ${t.friCleanDays}일)`); }
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
