// 「예약 분포 (요일×시작시각)」 탭 — 8~9월 예약을 요일별·시작시각별로 집계 (2026-10-15)
// 목적: 주말·평일 오전(아이미짱 출근 전) 예약이 얼마나 되는지 확인 → 마미짱 오전 근무 필요성 판단
// 데이터: 매출 시트 「예약관리」 탭 (취소 제외). 기간 2026-08-01 ~ 2026-09-30 (두 달, 원장 완전 구간)
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const LEDGER_ID = '1sUXyrXxYzl_n6n5T4dV_flQ6Ocli3c0B-Ggbwzw5YC4';   // 船場美術館 (예약관리 탭)
const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';    // 자산현황
const TAB = '예약 분포 (요일×시작시각)';
const FROM = '2026-08-01', TO = '2026-09-30';
const WD = '日月火水木金土';
const ORDER = [1, 2, 3, 4, 5, 6, 0];   // 월~일
const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18];
const MORNING_BEFORE = 12 * 60 + 30;   // 12:30 이전 시작 = 아이미짱 출근(12:45) 전에 손님 맞이가 필요한 예약
const NCOL = 14;

const dow = ds => new Date(ds + 'T12:00:00').getDay();

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const g = await sheets.spreadsheets.values.get({ spreadsheetId: LEDGER_ID, range: `'예약관리'!A2:R`, valueRenderOption: 'FORMATTED_VALUE' });
  const cnt = {}, morningDays = {}, perDay = {};   // cnt[w][hour], morningDays[w] = Set(date), perDay[date]=건수
  for (const w of ORDER) { cnt[w] = Object.fromEntries(HOURS.map(h => [h, 0])); morningDays[w] = new Set(); }
  let used = 0;
  for (const r of g.data.values || []) {
    const status = String(r[1] || '');
    const dm = String(r[4] || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    const tm = String(r[5] || '').match(/(\d{1,2}):(\d{2})/);
    if (!dm || !tm || status.includes('취소')) continue;
    const date = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
    if (date < FROM || date > TO) continue;
    const min = Number(tm[1]) * 60 + Number(tm[2]);
    const w = dow(date), h = Number(tm[1]);
    if (cnt[w][h] === undefined) continue;
    cnt[w][h]++; used++;
    perDay[date] = (perDay[date] || 0) + 1;
    if (min < MORNING_BEFORE) morningDays[w].add(date);
  }
  // 기간 내 요일별 일수
  const nDays = Object.fromEntries(ORDER.map(w => [w, 0]));
  for (let d = new Date(FROM + 'T12:00:00'); d <= new Date(TO + 'T12:00:00'); d.setDate(d.getDate() + 1)) nDays[d.getDay()]++;

  const sumW = w => HOURS.reduce((s, h) => s + cnt[w][h], 0);
  // 오전 건수(12:30 전 시작) 정밀 재집계
  const mornCnt = Object.fromEntries(ORDER.map(w => [w, 0]));
  const mornHr = Object.fromEntries(ORDER.map(w => [w, { 10: 0, 11: 0, 12: 0 }]));
  for (const r of g.data.values || []) {
    const status = String(r[1] || '');
    const dm = String(r[4] || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    const tm = String(r[5] || '').match(/(\d{1,2}):(\d{2})/);
    if (!dm || !tm || status.includes('취소')) continue;
    const date = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
    if (date < FROM || date > TO) continue;
    if (Number(tm[1]) * 60 + Number(tm[2]) < MORNING_BEFORE) { mornCnt[dow(date)]++; if (mornHr[dow(date)][Number(tm[1])] !== undefined) mornHr[dow(date)][Number(tm[1])]++; }
  }

  // ── 탭 구성
  const rows = [];
  const push = r => { rows.push(r); return rows.length - 1; };
  const wk = w => `${WD[w]} 오전${mornCnt[w]}건/${nDays[w]}일(${morningDays[w].size}일) 10시${mornHr[w][10]} 11시${mornHr[w][11]} 12시${mornHr[w][12]}`;
  const iTitle = push([wk(0)]);
  const iSub = push([wk(6)]);
  push([`※ 위 두 줄: 요일 오전(12:30전 시작)건수/요일일수(예약있던 날수) 시간대별 | 합계 ${used}건 | ${FROM}~${TO} | 집계 2026-10-15`]);
  push([]);
  const iH1 = push(['■ 요일 × 시작 시각 (건수 합계)']);
  const h1 = push(['요일', '일수', ...HOURS.map(h => `${h}시대`), '합계', '오전(12:30전)', '오전 예약 있던 날']);
  const d0 = rows.length;
  for (const w of ORDER) push([WD[w], nDays[w], ...HOURS.map(h => cnt[w][h]), sumW(w), mornCnt[w], `${morningDays[w].size}일 / ${nDays[w]}일`]);
  const d1 = rows.length;
  push([]);
  const iH2 = push(['■ 하루 평균 건수 (합계 ÷ 요일 일수)']);
  const h2 = push(['요일', '', ...HOURS.map(h => `${h}시대`), '합계', '오전(12:30전)', '']);
  const a0 = rows.length;
  for (const w of ORDER) push([WD[w], '', ...HOURS.map(h => Math.round(cnt[w][h] / nDays[w] * 10) / 10), Math.round(sumW(w) / nDays[w] * 10) / 10, Math.round(mornCnt[w] / nDays[w] * 10) / 10, '']);
  const a1 = rows.length;

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const old = meta.data.sheets.find(s => s.properties.title === TAB);
  const reqs0 = [];
  if (old) reqs0.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  reqs0.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 5, columnCount: NCOL } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = created.data.replies[old ? 1 : 0].addSheet.properties.sheetId;
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });

  const C = {
    dark: { red: 0.122, green: 0.286, blue: 0.475 }, hdr: { red: 0.267, green: 0.447, blue: 0.769 },
    sec: { red: 0.851, green: 0.882, blue: 0.949 }, gold: { red: 1, green: 0.898, blue: 0.6 },
    band: { red: 0.955, green: 0.960, blue: 0.975 }, white: { red: 1, green: 1, blue: 1 }, note: { red: 0.45, green: 0.45, blue: 0.45 },
  };
  const R = [];
  const rng = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const fmt = (range, format, fields) => R.push({ repeatCell: { range, cell: { userEnteredFormat: format }, fields } });
  const gb = { style: 'SOLID', color: { red: 0.6, green: 0.6, blue: 0.6 } }, ib = { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } };
  const merge = (r0, r1) => R.push({ mergeCells: { range: rng(r0, r1), mergeType: 'MERGE_ALL' } });
  merge(iTitle, iTitle + 1);
  fmt(rng(iTitle, iTitle + 1), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 11, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: iTitle, endIndex: iTitle + 1 }, properties: { pixelSize: 44 }, fields: 'pixelSize' } });
  merge(iSub, iSub + 1);
  fmt(rng(iSub, iSub + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(textFormat,horizontalAlignment)');
  for (const i of [iH1, iH2]) { merge(i, i + 1); fmt(rng(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)'); }
  for (const [h, a, b] of [[h1, d0, d1], [h2, a0, a1]]) {
    fmt(rng(h, h + 1), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,wrapStrategy)');
    for (let r = a; r < b; r += 2) fmt(rng(r, r + 1), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor');
    fmt(rng(a, b, 0, 1), { textFormat: { bold: true }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(textFormat,horizontalAlignment)');
    fmt(rng(a, b, 1, NCOL), { horizontalAlignment: 'CENTER' }, 'userEnteredFormat.horizontalAlignment');
    fmt(rng(a, b, 2 + HOURS.length + 1, 2 + HOURS.length + 2), { backgroundColor: C.gold, textFormat: { bold: true }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)');
    R.push({ updateBorders: { range: rng(h, b, 0, NCOL), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  }
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: NCOL }, properties: { pixelSize: 92 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: NCOL - 1, endIndex: NCOL }, properties: { pixelSize: 130 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  console.log(`[예약 분포 완료] ${FROM}~${TO} ${used}건`);
  console.log('오전(12:30전) 요일별: ' + ORDER.map(w => `${WD[w]} ${mornCnt[w]}건/${nDays[w]}일(예약있던 날 ${morningDays[w].size})`).join(' | '));
  console.log('하루 평균: ' + ORDER.map(w => `${WD[w]} ${(sumW(w) / nDays[w]).toFixed(1)}`).join(' / '));
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
