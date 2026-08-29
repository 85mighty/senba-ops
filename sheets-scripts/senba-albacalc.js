// 「알바비 계산」 탭 — 날짜별 출퇴근 15분 드롭다운 수동 입력 + 근태봇('알바근태' 탭) 자동기록 월별 합산 (2026-08-28)
// 6~8월 실적 9건 시드 입력済. 9/1부터는 텔레그램 근태봇이 '알바근태' 탭에 자동 기록 → 월별 집계에서 합산됨.
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '알바비 계산';
const BOT_TAB = '알바근태';
const NCOL = 6;
const WAGE = 1200;
const DATA_ROWS = 60;   // 수동 입력 행 수

const SEEDS = [
  ['2026/06/27', '12:30', '16:00'], ['2026/07/03', '13:00', '16:00'], ['2026/07/05', '13:00', '16:15'],
  ['2026/07/20', '12:00', '18:15'], ['2026/08/23', '12:30', '18:15'], ['2026/08/24', '12:30', '18:15'],
  ['2026/08/28', '12:30', '17:45'], ['2026/08/30', '12:30', '18:15'], ['2026/08/31', '12:45', '17:30'],
];
const MONTHS = [[2026, 6], [2026, 7], [2026, 8], [2026, 9], [2026, 10], [2026, 11], [2026, 12], [2027, 1], [2027, 2], [2027, 3]];
const TIMES = [];
for (let m = 10 * 60; m <= 21 * 60; m += 15) TIMES.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));

const rows = [];
const push = r => { rows.push(r); return rows.length - 1; };
const blank = () => push([]);

const iTitle = push(['알바비 계산 — 수동 입력 + 근태봇 자동 합산']);
const iSub = push([`시급 ${WAGE.toLocaleString()}엔 · 출근/퇴근은 15분 단위 드롭다운 · 9/1부터 텔레그램 근태봇 기록('${BOT_TAB}' 탭)이 월별 집계에 자동 합산`]);
blank();

const iSec1 = push(['■ 일별 수동 입력 (과거분·봇 미사용 날 보정용)']);
const h1 = push(['날짜', '출근', '퇴근', '시간(h)', '알바비(¥)', '비고']);
const d0 = rows.length;                       // 첫 데이터 행 index (0-based)
for (let i = 0; i < DATA_ROWS; i++) {
  const r = d0 + i + 1;                       // 시트 행번호 (1-based)
  push([
    SEEDS[i] ? SEEDS[i][0] : '',
    '', '',                                   // 출근/퇴근은 RAW로 별도 기입 (텍스트 유지)
    `=IF(OR(B${r}="",C${r}=""),"",ROUND((TIMEVALUE(C${r})-TIMEVALUE(B${r}))*24,2))`,
    `=IF(D${r}="","",ROUND(D${r}*${WAGE},0))`,
    '',
  ]);
}
const d1 = rows.length;                       // 데이터 끝(비포함)
blank();

const iSec2 = push(['■ 월별 집계 — 이 탭(수동) + 근태봇 자동기록 합산']);
const h2 = push(['월', '시간 합계(h)', '수동입력(¥)', `자동기록 ${BOT_TAB}(¥)`, '★ 합계(¥)']);
const m0 = rows.length;
for (const [y, m] of MONTHS) {
  const r = m0 + rows.length - m0 + 1;        // 현재 행번호 (1-based) = rows.length+1
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  const [y2, mm2] = m === 12 ? [y + 1, 1] : [y, m + 1];
  push([
    ym,
    `=ROUND(SUMIFS($D$${d0 + 1}:$D$${d1},$A$${d0 + 1}:$A$${d1},">="&DATE(${y},${m},1),$A$${d0 + 1}:$A$${d1},"<"&DATE(${y2},${mm2},1))+SUMPRODUCT((LEFT('${BOT_TAB}'!$A$2:$A$500&"",7)="${ym}")*N('${BOT_TAB}'!$I$2:$I$500))/60,2)`,
    `=SUMIFS($E$${d0 + 1}:$E$${d1},$A$${d0 + 1}:$A$${d1},">="&DATE(${y},${m},1),$A$${d0 + 1}:$A$${d1},"<"&DATE(${y2},${mm2},1))`,
    `=SUMPRODUCT((LEFT('${BOT_TAB}'!$A$2:$A$500&"",7)="${ym}")*N('${BOT_TAB}'!$J$2:$J$500))`,
    `=C${rows.length + 1}+D${rows.length + 1}`,
  ]);
}
const m1 = rows.length;
const tTot = push(['합계', `=ROUND(SUM(B${m0 + 1}:B${m1}),2)`, `=SUM(C${m0 + 1}:C${m1})`, `=SUM(D${m0 + 1}:D${m1})`, `=SUM(E${m0 + 1}:E${m1})`]);
blank();
const iN = push(['※ 같은 날을 수동+봇 양쪽에 넣으면 이중 계산되니 한쪽에만 · 봇 기록 정정은 텔레그램 /수정 명령 · 시급 변경 시 이 탭 재생성 필요 (senba-albacalc.js)']);

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });

  // 근태봇 탭이 아직 없으면 헤더와 함께 생성 (집계 수식 #REF 방지)
  if (!meta.data.sheets.some(s => s.properties.title === BOT_TAB)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: BOT_TAB } } }] } });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `'${BOT_TAB}'!A1:K1`, valueInputOption: 'RAW',
      requestBody: { values: [['날짜', '요일', '이름', '출근누름', '퇴근누름', '인정출근', '인정퇴근', '근무시간', '분', '일급(¥)', '비고']] },
    });
  }

  const old = meta.data.sheets.find(s => s.properties.title === TAB);
  const reqs0 = [];
  if (old) reqs0.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  reqs0.push({ addSheet: { properties: { title: TAB, index: meta.data.sheets.length - (old ? 1 : 0), gridProperties: { rowCount: rows.length + 5, columnCount: NCOL } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = created.data.replies[old ? 1 : 0].addSheet.properties.sheetId;

  // 값: 날짜·수식은 USER_ENTERED, 출퇴근 시각은 RAW(텍스트 유지)로 두 번에 나눠 기입
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'USER_ENTERED', requestBody: { values: rows },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `'${TAB}'!B${d0 + 1}:C${d0 + SEEDS.length}`, valueInputOption: 'RAW',
    requestBody: { values: SEEDS.map(s => [s[1], s[2]]) },
  });

  const C = {
    dark: { red: 0.122, green: 0.286, blue: 0.475 }, hdr: { red: 0.267, green: 0.447, blue: 0.769 },
    sec: { red: 0.851, green: 0.882, blue: 0.949 }, band: { red: 0.955, green: 0.960, blue: 0.975 },
    total: { red: 1, green: 0.949, blue: 0.8 }, gold: { red: 1, green: 0.898, blue: 0.6 },
    input: { red: 0.851, green: 0.918, blue: 0.827 },
    white: { red: 1, green: 1, blue: 1 }, note: { red: 0.45, green: 0.45, blue: 0.45 },
  };
  const R = [];
  const range = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const cellFmt = (rng, format, fields) => R.push({ repeatCell: { range: rng, cell: { userEnteredFormat: format }, fields } });
  const gb = { style: 'SOLID', color: { red: 0.6, green: 0.6, blue: 0.6 } };
  const ib = { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } };

  R.push({ mergeCells: { range: range(iTitle, iTitle + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iTitle, iTitle + 1), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 13, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: iTitle, endIndex: iTitle + 1 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } });
  R.push({ mergeCells: { range: range(iSub, iSub + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iSub, iSub + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(textFormat,horizontalAlignment)');
  for (const i of [iSec1, iSec2]) {
    R.push({ mergeCells: { range: range(i, i + 1), mergeType: 'MERGE_ALL' } });
    cellFmt(range(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  }
  // 일별 입력 표
  cellFmt(range(h1, h1 + 1), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)');
  cellFmt(range(d0, d1, 0, 1), { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd (ddd)' }, backgroundColor: C.input }, 'userEnteredFormat(numberFormat,backgroundColor)');
  cellFmt(range(d0, d1, 1, 3), { numberFormat: { type: 'TEXT' }, horizontalAlignment: 'CENTER', backgroundColor: C.input }, 'userEnteredFormat(numberFormat,horizontalAlignment,backgroundColor)');
  cellFmt(range(d0, d1, 3, 4), { numberFormat: { type: 'NUMBER', pattern: '0.00' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(d0, d1, 4, 5), { numberFormat: { type: 'NUMBER', pattern: '¥#,##0' }, horizontalAlignment: 'RIGHT', textFormat: { bold: true } }, 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat.bold)');
  cellFmt(range(d0, d1, 5, 6), { backgroundColor: C.input }, 'userEnteredFormat.backgroundColor');
  R.push({ updateBorders: { range: range(h1, d1), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  // 출퇴근 15분 드롭다운
  R.push({ setDataValidation: { range: range(d0, d1, 1, 3), rule: { condition: { type: 'ONE_OF_LIST', values: TIMES.map(t => ({ userEnteredValue: t })) }, showCustomUi: true, strict: false } } });
  // 월별 집계 표
  cellFmt(range(h2, h2 + 1, 0, 5), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,wrapStrategy)');
  for (let r = m0; r < m1; r += 2) cellFmt(range(r, r + 1, 0, 5), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor');
  cellFmt(range(m0, tTot + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(m0, tTot + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '0.00' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(m0, tTot + 1, 2, 5), { numberFormat: { type: 'NUMBER', pattern: '¥#,##0' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(m0, tTot + 1, 4, 5), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(tTot, tTot + 1, 0, 5), { backgroundColor: C.total, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
  R.push({ updateBorders: { range: range(h2, tTot + 1, 0, 5), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  R.push({ mergeCells: { range: range(iN, iN + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iN, iN + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: 5 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  console.log(`[알바비 계산 탭 완료] 시드 ${SEEDS.length}건 (6월 4,200 / 7월 15,000 / 8월 32,700 = 51,900엔) · '${BOT_TAB}' 탭 자동 합산 연결`);
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
