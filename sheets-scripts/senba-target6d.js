// 「Inputs / Workdays / Summary / Compare」 4개 탭 — 2026년 9~12월 목표 매출 역산, 주 6일 운영안 (2026-09-16)
// 근거 문서: senba_2026_target_sales_6days.md — 화요일 휴무, 수·목을 금토일월과 동일하게 알바 출근.
// 전부 수식으로 연결: Inputs 값을 바꾸면 Summary·Compare 가 자동 재계산된다.
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TABS = ['Inputs', 'Workdays', 'Summary', 'Compare'];

// ── Inputs: 행 번호는 Summary/Compare 수식에서 절대참조로 쓰므로 고정
const IN = [
  ['목표 매출 역산 — 입력값 (주 6일 운영안 · 2026년 9~12월)'],                 // 1
  ['항목', '값', '비고'],                                                      // 2
  ['객단가 (세포함)', 3625, '엔'],                                             // 3  $B$3
  ['소비세 간이 세율', 0.0455, ''],                                            // 4  $B$4
  ['1인 재료비', 265, '엔 (종이캔버스·포장)'],                                 // 5  $B$5
  ['고정비: 야칭·공과금', 300000, '엔/월'],                                    // 6  $B$6
  ['고정비: 마케팅 (ぐるなび + Meta)', 44500, '엔/월'],                        // 7  $B$7
  ['시급', 1200, '엔'],                                                        // 8  $B$8
  ['기본 시프트', 4, '시간 (13:30–17:30)'],                                    // 9  $B$9
  ['최대 시프트', 6, '시간 (12:30–18:30)'],                                    // 10 $B$10
  ['목표 순수익', 100000, '엔/월'],                                            // 11 $B$11
  ['1인 공헌이익', '=B3*(1-B4)-B5', '= 객단가×(1−세율) − 재료비 (자동)'],      // 12 $B$12
  [],
  ['※ 9월은 이미 절반 경과 (9/16 기준) — 9월 행은 참고용', '', ''],
  ['※ 값을 바꾸면 Summary·Compare 가 자동 재계산 · 이 4개 탭은 senba-target6d.js 로 재생성', '', ''],
];

// ── Workdays: 2026년 화요일 휴무 기준 (행 2~5 = 9~12월)
const WD = [
  ['월', '금토일월', '수·목', '합계'],
  ['9월', 16, 9, '=B2+C2'],
  ['10월', 18, 9, '=B3+C3'],
  ['11월', 18, 8, '=B4+C4'],
  ['12월', 16, 10, '=B5+C5'],
];

// ── Summary: 월 × (기본4h/최대6h) 8행, 전부 수식
const SM = [['월', '시나리오', '근무일수', '알바비', '필요 객수', '필요 매출(세포함)', '일평균 객수']];
const MONTHS = [['9월', 2], ['10월', 3], ['11월', 4], ['12월', 5]];   // [라벨, Workdays 행]
for (const [mon, wr] of MONTHS) {
  for (const [sc, shiftRef] of [['기본 4h', '$B$9'], ['최대 6h', '$B$10']]) {
    const r = SM.length + 1;   // 이 데이터가 들어갈 시트 행 번호
    SM.push([
      mon, sc,
      `=Workdays!$D$${wr}`,
      `=C${r}*Inputs!${shiftRef}*Inputs!$B$8`,
      `=CEILING((Inputs!$B$6+Inputs!$B$7+D${r}+Inputs!$B$11)/Inputs!$B$12,1)`,
      `=E${r}*Inputs!$B$3`,
      `=E${r}/C${r}`,
    ]);
  }
}

// ── Compare: 금토일월만 운영(기존안) 대비 — 주6일안이 몇 명 더 필요한가
const CP = [['월', '시나리오', '근무일수(금토일월)', '알바비', '필요 객수', '주6일안 필요 객수', '6일안 대비 증가']];
for (let i = 0; i < 8; i++) {
  const [mon, wr] = MONTHS[Math.floor(i / 2)];
  const shiftRef = i % 2 === 0 ? '$B$9' : '$B$10';
  const r = CP.length + 1;
  CP.push([
    mon, i % 2 === 0 ? '기본 4h' : '최대 6h',
    `=Workdays!$B$${wr}`,
    `=C${r}*Inputs!${shiftRef}*Inputs!$B$8`,
    `=CEILING((Inputs!$B$6+Inputs!$B$7+D${r}+Inputs!$B$11)/Inputs!$B$12,1)`,
    `=Summary!E${r}`,
    `=F${r}-E${r}`,
  ]);
}

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });

  // 기존 동명 탭 삭제 후 4개 생성
  const reqs0 = [];
  for (const t of TABS) {
    const old = meta.data.sheets.find(s => s.properties.title === t);
    if (old) reqs0.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  }
  for (const t of TABS) reqs0.push({ addSheet: { properties: { title: t, gridProperties: { rowCount: 20, columnCount: 8 } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = {};
  for (const rep of created.data.replies) if (rep.addSheet) sid[rep.addSheet.properties.title] = rep.addSheet.properties.sheetId;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: "'Inputs'!A1", values: IN },
        { range: "'Workdays'!A1", values: WD },
        { range: "'Summary'!A1", values: SM },
        { range: "'Compare'!A1", values: CP },
      ],
    },
  });

  // ── 서식
  const C = {
    dark: { red: 0.122, green: 0.286, blue: 0.475 }, hdr: { red: 0.267, green: 0.447, blue: 0.769 },
    band: { red: 0.955, green: 0.960, blue: 0.975 }, gold: { red: 1, green: 0.898, blue: 0.6 },
    white: { red: 1, green: 1, blue: 1 }, note: { red: 0.45, green: 0.45, blue: 0.45 },
  };
  const YEN = { numberFormat: { type: 'NUMBER', pattern: '¥#,##0' }, horizontalAlignment: 'RIGHT' };
  const R = [];
  const rng = (t, r0, r1, c0, c1) => ({ sheetId: sid[t], startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const fmt = (range, format, fields) => R.push({ repeatCell: { range, cell: { userEnteredFormat: format }, fields } });
  const gb = { style: 'SOLID', color: { red: 0.6, green: 0.6, blue: 0.6 } };
  const ib = { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } };
  const header = (t, row, nCol) => fmt(rng(t, row, row + 1, 0, nCol), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)');
  const borders = (t, r0, r1, nCol) => R.push({ updateBorders: { range: rng(t, r0, r1, 0, nCol), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  const band = (t, d0, d1, nCol) => { for (let r = d0; r < d1; r += 2) fmt(rng(t, r, r + 1, 0, nCol), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor'); };

  // Inputs
  R.push({ mergeCells: { range: rng('Inputs', 0, 1, 0, 3), mergeType: 'MERGE_ALL' } });
  fmt(rng('Inputs', 0, 1, 0, 3), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 12, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)');
  header('Inputs', 1, 3);
  band('Inputs', 2, 12, 3);
  fmt(rng('Inputs', 2, 12, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  fmt(rng('Inputs', 2, 12, 1, 2), YEN, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  fmt(rng('Inputs', 3, 4, 1, 2), { numberFormat: { type: 'PERCENT', pattern: '0.00%' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  for (const r of [8, 9]) fmt(rng('Inputs', r, r + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '0"h"' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  fmt(rng('Inputs', 11, 12, 0, 3), { backgroundColor: C.gold, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
  fmt(rng('Inputs', 11, 12, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '¥#,##0.00' }, horizontalAlignment: 'RIGHT', backgroundColor: C.gold, textFormat: { bold: true } }, 'userEnteredFormat(numberFormat,horizontalAlignment,backgroundColor,textFormat.bold)');
  fmt(rng('Inputs', 13, 15, 0, 3), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  borders('Inputs', 1, 12, 3);
  R.push({ updateDimensionProperties: { range: { sheetId: sid['Inputs'], dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid['Inputs'], dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 260 }, fields: 'pixelSize' } });

  // Workdays
  header('Workdays', 0, 4);
  band('Workdays', 1, 5, 4);
  fmt(rng('Workdays', 1, 5, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  fmt(rng('Workdays', 1, 5, 3, 4), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  borders('Workdays', 0, 5, 4);

  // Summary / Compare 공통
  for (const t of ['Summary', 'Compare']) {
    header(t, 0, 7);
    band(t, 1, 9, 7);
    fmt(rng(t, 1, 9, 0, 2), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
    fmt(rng(t, 1, 9, 3, 4), YEN, 'userEnteredFormat(numberFormat,horizontalAlignment)');
    borders(t, 0, 9, 7);
    R.push({ updateDimensionProperties: { range: { sheetId: sid[t], dimension: 'COLUMNS', startIndex: 0, endIndex: 7 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } });
  }
  fmt(rng('Summary', 1, 9, 5, 6), YEN, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  fmt(rng('Summary', 1, 9, 6, 7), { numberFormat: { type: 'NUMBER', pattern: '0.0"명"' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  fmt(rng('Summary', 1, 9, 4, 5), { backgroundColor: C.gold, textFormat: { bold: true }, numberFormat: { type: 'NUMBER', pattern: '0"명"' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat.bold,numberFormat,horizontalAlignment)');
  fmt(rng('Compare', 1, 9, 4, 6), { numberFormat: { type: 'NUMBER', pattern: '0"명"' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  fmt(rng('Compare', 1, 9, 6, 7), { backgroundColor: C.gold, textFormat: { bold: true }, numberFormat: { type: 'NUMBER', pattern: '+0"명";-0"명"' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat.bold,numberFormat,horizontalAlignment)');

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  // 검산 로그 (JS 재계산 — 시트 수식과 동일해야 함)
  const CONTRIB = 3625 * (1 - 0.0455) - 265;
  console.log('[목표역산 4개 탭 완료] 공헌이익', CONTRIB.toFixed(2));
  for (const [mon, , wd6] of [['9월', 0, 25], ['10월', 0, 27], ['11월', 0, 26], ['12월', 0, 26]]) {
    for (const [sc, h] of [['기본4h', 4], ['최대6h', 6]]) {
      const alba = wd6 * h * 1200;
      const need = Math.ceil((300000 + 44500 + alba + 100000) / CONTRIB);
      console.log(' ', mon, sc, '알바비', alba.toLocaleString('ja-JP'), '필요객수', need, '매출', (need * 3625).toLocaleString('ja-JP'));
    }
  }
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
