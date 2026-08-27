// 「2호점 시뮬레이션」 탭 — 드롭다운·직접입력 + 실시간 수식
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '2호점 시뮬레이션';
const NCOL = 6;

const rows = [];
const push = r => { rows.push(r); return rows.length - 1; };
const blank = () => push([]);
const A1 = i => i + 1;

const iTitle = push(['2호점 시뮬레이션 (고베 등 · 큰 캔버스 + 석고 색칠)']);
const iSub = push(['초록색 칸만 바꾸면 자동 계산 · 세전 기준 · 보증금 없음/인테리어 최소 전제']);
blank();

const iSecIn = push(['■ 입력']);
const iRev   = push(['월매출 (만엔)', 40, '← 드롭다운 (10~100만엔)']);
const iRent  = push(['야칭+공과금 (월)', 120000, '← 직접 입력 (야칭 10만 초반 + 공과금)']);
const iWk    = push(['알바 주당 근무일', '주6일', '← 드롭다운 (주4일/주5일/주6일) — 영업일 = 알바 근무일']);
const iHrs   = push(['알바 근무시간', '기본(4h)', '← 드롭다운 (기본 4h=4,800/일, 최대 6h=7,200/일)']);
const iMkt   = push(['마케팅비 (월)', 34500, '← 직접 입력 (구루나비·메타 기준, 오픈 초기는 증액 고려)']);
const iTicket= push(['객단가 (1인)', 3300, '← 직접 입력 (본점 8월 실측 3,279 · 큰 캔버스 코스는 상향 가능)']);
const iTax   = push(['소비세 (간이·서비스업)', '적용(4.55%)', '← 드롭다운 — 적용 시 매출에서 4.55% 차감(세후)']);
blank();

const iSecOut = push(['■ 계산 결과']);
const iODays  = push(['월 영업일 (알바 근무일)', null, '주당일수 × 4.33주 반올림']);
const iOAlba  = push(['알바비 (월)', null]);
const iOFixed = push(['월 고정비 합계', null, '야칭공과금 + 마케팅 + 알바비']);
const iOMargin= push(['마진율', null, '1 − 잡재료4% − (종이180+박스85)÷객단가 − 소비세(적용 시)']);
const iOBE    = push(['★ 손익분기 매출 (월)', null]);
const iOBEppl = push(['★ 손익분기 인원', null, '하루 필요 인원 (영업일 기준)']);
const iONet   = push(['★ 선택 매출의 월 순수익 (세전)', null]);
const iOPpl   = push(['선택 매출의 하루 평균 인원', null]);
blank();

const iSecRef = push(['■ 참고 — 매출별 월 순수익 (위 조건 기준)']);
const hRef = push(['월매출', '순수익 (세전)', '하루 평균 인원']);
const refRows = [];
for (const man of [30, 40, 50, 60, 70, 80]) refRows.push(push([man * 10000, null, null]));
blank();
const iN1 = push(['※ 초기 투자(집기·이젤·석고 재고·간판 등)와 사장 상주 기간 인건비는 별도. 세금 미반영']);
const iN2 = push(['※ 본점 겨울 실적 참고: 토 2.6만~4.2만/일 · 일 3.9만~4.5만/일 · 금 0.6만~1.1만/일 (2025-11~2026-01)']);

// 수식
const B = i => `$B$${A1(i)}`;
rows[iODays][1]  = `=ROUND(VALUE(SUBSTITUTE(SUBSTITUTE(${B(iWk)},"주",""),"일",""))*4.33,0)`;
rows[iOAlba][1]  = `=B${A1(iODays)}*IF(${B(iHrs)}="최대(6h)",7200,4800)`;
rows[iOFixed][1] = `=${B(iRent)}+${B(iMkt)}+B${A1(iOAlba)}`;
rows[iOMargin][1]= `=1-0.04-265/${B(iTicket)}-IF(${B(iTax)}="적용(4.55%)",0.0455,0)`;
rows[iOBE][1]    = `=CEILING(B${A1(iOFixed)}/B${A1(iOMargin)},1000)`;
rows[iOBEppl][1] = `=ROUND(B${A1(iOBE)}/${B(iTicket)}/B${A1(iODays)},1)&"명/일"`;
rows[iONet][1]   = `=ROUND(${B(iRev)}*10000*B${A1(iOMargin)}-B${A1(iOFixed)},0)`;
rows[iOPpl][1]   = `=ROUND(${B(iRev)}*10000/${B(iTicket)}/B${A1(iODays)},1)&"명/일"`;
for (const r of refRows) {
  rows[r][1] = `=ROUND(A${A1(r)}*B${A1(iOMargin)}-B${A1(iOFixed)},0)`;
  rows[r][2] = `=ROUND(A${A1(r)}/${B(iTicket)}/B${A1(iODays)},1)&"명/일"`;
}

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const old = meta.data.sheets.find(s => s.properties.title === TAB);
  const reqs0 = [];
  if (old) reqs0.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  reqs0.push({ addSheet: { properties: { title: TAB, index: meta.data.sheets.length - (old ? 1 : 0), gridProperties: { rowCount: 60, columnCount: 8 } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = created.data.replies[old ? 1 : 0].addSheet.properties.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows.map(r => r.map(v => v === null ? '' : v)) },
  });
  const nums = []; for (let v = 10; v <= 100; v++) nums.push([v]);
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${TAB}'!H1`, valueInputOption: 'RAW', requestBody: { values: nums } });

  const C = {
    dark: { red: 0.122, green: 0.286, blue: 0.475 }, hdr: { red: 0.267, green: 0.447, blue: 0.769 },
    sec: { red: 0.851, green: 0.882, blue: 0.949 }, input: { red: 0.851, green: 0.941, blue: 0.827 },
    save: { red: 1, green: 0.898, blue: 0.6 }, band: { red: 0.955, green: 0.960, blue: 0.975 },
    white: { red: 1, green: 1, blue: 1 }, note: { red: 0.45, green: 0.45, blue: 0.45 },
  };
  const R = [];
  const range = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const cellFmt = (rng, format, fields) => R.push({ repeatCell: { range: rng, cell: { userEnteredFormat: format }, fields } });
  const NUM = { numberFormat: { type: 'NUMBER', pattern: '¥#,##0;[Red]-¥#,##0' }, horizontalAlignment: 'RIGHT' };

  R.push({ mergeCells: { range: range(iTitle, iTitle + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iTitle, iTitle + 1), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 13, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: iTitle, endIndex: iTitle + 1 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } });
  R.push({ mergeCells: { range: range(iSub, iSub + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iSub, iSub + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(textFormat,horizontalAlignment)');
  for (const i of [iSecIn, iSecOut, iSecRef]) {
    R.push({ mergeCells: { range: range(i, i + 1), mergeType: 'MERGE_ALL' } });
    cellFmt(range(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  }
  // 입력 블록
  cellFmt(range(iRev, iTax + 1, 0, 1), { textFormat: { bold: true }, verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(textFormat.bold,verticalAlignment)');
  cellFmt(range(iRev, iTax + 1, 1, 2), { backgroundColor: C.input, horizontalAlignment: 'CENTER', textFormat: { bold: true, fontSize: 11 }, numberFormat: { type: 'NUMBER', pattern: '#,##0' } }, 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat,numberFormat)');
  cellFmt(range(iRev, iTax + 1, 2, NCOL), { textFormat: { fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  const gbI = { style: 'SOLID_MEDIUM', color: { red: 0.3, green: 0.6, blue: 0.3 } };
  R.push({ updateBorders: { range: range(iRev, iTax + 1, 1, 2), top: gbI, bottom: gbI, left: gbI, right: gbI, innerHorizontal: { style: 'SOLID', color: { red: 0.3, green: 0.6, blue: 0.3 } } } });
  // 결과 블록
  cellFmt(range(iODays, iOPpl + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(iODays, iOPpl + 1, 1, 2), NUM, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(iOMargin, iOMargin + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '0.000000' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(iODays, iOPpl + 1, 2, NCOL), { textFormat: { fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  for (const i of [iOBE, iOBEppl, iONet]) cellFmt(range(i, i + 1, 0, 2), { backgroundColor: C.save, textFormat: { bold: true, fontSize: 12 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  const gb = { style: 'SOLID', color: { red: 0.6, green: 0.6, blue: 0.6 } };
  const ib = { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } };
  R.push({ updateBorders: { range: range(iODays, iOPpl + 1, 0, 2), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib } });
  // 참고표
  cellFmt(range(hRef, hRef + 1, 0, 3), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)');
  cellFmt(range(hRef + 1, hRef + 1 + refRows.length, 0, 2), NUM, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(hRef + 1, hRef + 1 + refRows.length, 2, 3), { horizontalAlignment: 'RIGHT' }, 'userEnteredFormat.horizontalAlignment');
  for (let r = hRef + 1; r < hRef + 1 + refRows.length; r += 2) cellFmt(range(r, r + 1, 0, 3), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor');
  R.push({ updateBorders: { range: range(hRef, hRef + 1 + refRows.length, 0, 3), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  for (const i of [iN1, iN2]) {
    R.push({ mergeCells: { range: range(i, i + 1), mergeType: 'MERGE_ALL' } });
    cellFmt(range(i, i + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  }
  // 드롭다운
  const dv = (rowIdx, condition) => R.push({ setDataValidation: { range: range(rowIdx, rowIdx + 1, 1, 2), rule: { condition, strict: true, showCustomUi: true } } });
  dv(iRev, { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `='${TAB}'!$H$1:$H$91` }] });
  dv(iWk,  { type: 'ONE_OF_LIST', values: ['주4일','주5일','주6일'].map(v => ({ userEnteredValue: v })) });
  dv(iHrs, { type: 'ONE_OF_LIST', values: ['기본(4h)','최대(6h)'].map(v => ({ userEnteredValue: v })) });
  dv(iTax, { type: 'ONE_OF_LIST', values: ['적용(4.55%)','미적용(세전)'].map(v => ({ userEnteredValue: v })) });
  // 열 너비 + H열 숨김
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 340 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  const check = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A${A1(iODays)}:B${A1(iOPpl)}`, valueRenderOption: 'UNFORMATTED_VALUE' });
  console.log('[검증 — 매출 40만·야칭공과금 12만·주6일·기본4h·객단가 3,300]');
  for (const row of check.data.values || []) console.log(' ', row[0], '=', row[1]);
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
