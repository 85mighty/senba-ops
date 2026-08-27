// 「저금 계산기」 탭 — 드롭다운 입력 + 실시간 수식
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '저금 계산기';
const NCOL = 6; // A~F 표시영역, H열은 드롭다운 소스(숨김)

const rows = [];
const push = r => { rows.push(r); return rows.length - 1; };
const blank = () => push([]);
const A1 = i => i + 1; // 0-based → 1-based

const iTitle = push(['센바 저금 가능액 계산기']);
const iSub = push(['아래 초록색 칸만 바꾸면 자동 계산됩니다 (세전 기준)']);
blank();

const iSecIn = push(['■ 입력']);
const iRev  = push(['그림방 매출 (만엔)', 80, '← 드롭다운 (40~150만엔)']);
const iMon  = push(['월', '9월', '← 드롭다운 (9월~12월)']);
const iAlba = push(['알바 근무', '기본(4h)', '← 드롭다운 (기본 4h / 최대 6h)']);
const iSide = push(['부업수입', '포함(10만)', '← 드롭다운 (포함(10만) / 미포함 / 직접입력)']);
const iSideAmt = push(['부업수입 직접입력 금액', 100000, '← 「직접입력」 선택 시 이 금액 사용']);
const iRaku = push(['라쿠텐카드 지출', 0, '← 직접 입력 (변동값, 예: 9월 157,929)']);
const iCar  = push(['차량 유지비 (월)', 50000, '← 직접 입력 (주차 1만 + 보험 예상 1만 + 코인주차·기름 등 3만)']);
const iMogu = push(['MOGU 잡지 광고', '계약(+1.5만)', '← 1년 계약済(월 15,000·총 18만). 해지 시 미계약 선택']);
const iTax  = push(['소비세 (간이·서비스업)', '적용(4.55%)', '← 드롭다운 — 적용 시 매출에서 4.55% 차감(세후)']);
blank();

// 내부 계산표를 먼저 아래쪽에 배치할 예정이므로 행 번호를 미리 계산 불가 → 결과/목표 먼저 쌓고 마지막에 표
// 결과 섹션 (수식은 나중에 행번호 확정 후 채움 — placeholder)
const iSecOut = push(['■ 계산 결과']);
const iORev  = push(['그림방 매출 (엔)', null]);
const iONet  = push(['센바 순수익 (소비세 설정 반영)', null, '식: 매출×마진율(소비세 적용 시 0.834197) − 350,000 − MOGU − 알바비 − 통근비']);
const iOLiv  = push(['(−) 생활비', 100000]);
const iOFix  = push(['(−) 가계 고정비', 198745, '집관리비 65,000(인상 반영)·통신·보험·연금·유치원 등']);
const iOCar  = push(['(−) 차량 유지비', null, '고정주차 + 보험(예상) + 코인주차·기름·기타']);
const iOSide = push(['(+) 부업수입', null]);
const iORaku = push(['(−) 라쿠텐카드', null]);
const iOSave = push(['★ 저금 가능액', null]);
blank();

const iSecTgt = push(['■ 목표 저금액 → 필요 매출 (위에서 선택한 월·알바·부업·라쿠텐 기준)']);
const iTgtH = push(['목표 저금액', '필요 매출 (월)']);
const tgtRows = [];
for (const T of [50000, 100000, 150000, 200000]) tgtRows.push(push([T, null]));
blank();

const iSecInt = push(['■ 내부 계산표 (수정 금지)']);
const iIntH = push(['월', '알바 근무일', '수·목 출근일', '알바비', '통근비']);
const MONTHS = [['9월',16,9],['10월',18,9],['11월',18,8],['12월',16,10]];
const mStart = rows.length;
for (const m of MONTHS) push([...m, null, null]);
const iNote = push(['※ 알바비 = 근무일 × (기본 4,800 / 최대 7,200), 통근비 = 수·목 × 860엔(왕복), 세금 미반영']);

// ── 수식 채우기 (행번호 확정 후) ──
const B = i => `$B$${A1(i)}`;
const mRange = `$A$${A1(mStart)}:$C$${A1(mStart + 3)}`;
const albaCost = `VLOOKUP(${B(iMon)},${mRange},2,FALSE)*IF(${B(iAlba)}="최대(6h)",7200,4800)`;
const commute  = `VLOOKUP(${B(iMon)},${mRange},3,FALSE)*860`;
rows[iORev][1]  = `=${B(iRev)}*10000`;
const mogu = `IF(${B(iMogu)}="계약(+1.5만)",15000,0)`;
const marginX = `(0.879697-IF(${B(iTax)}="적용(4.55%)",0.0455,0))`;
rows[iONet][1]  = `=B${A1(iORev)}*${marginX}-350000-${mogu}-${albaCost}-${commute}`;
rows[iOSide][1] = `=IF(${B(iSide)}="포함(10만)",100000,IF(${B(iSide)}="직접입력",${B(iSideAmt)},0))`;
rows[iORaku][1] = `=${B(iRaku)}`;
rows[iOCar][1]  = `=${B(iCar)}`;
rows[iOSave][1] = `=B${A1(iONet)}-B${A1(iOLiv)}-B${A1(iOFix)}-B${A1(iOCar)}+B${A1(iOSide)}-B${A1(iORaku)}`;
for (const r of tgtRows)
  rows[r][1] = `=CEILING((A${A1(r)}+B${A1(iOLiv)}+B${A1(iOFix)}+B${A1(iOCar)}-B${A1(iOSide)}+B${A1(iORaku)}+350000+${mogu}+${albaCost}+${commute})/${marginX},1000)`;
for (let k = 0; k < 4; k++) {
  rows[mStart + k][3] = `=B${A1(mStart + k)}*IF(${B(iAlba)}="최대(6h)",7200,4800)`;
  rows[mStart + k][4] = `=C${A1(mStart + k)}*860`;
}

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const old = meta.data.sheets.find(s => s.properties.title === TAB);
  const reqs0 = [];
  if (old) reqs0.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  reqs0.push({ addSheet: { properties: { title: TAB, index: meta.data.sheets.length - (old ? 1 : 0), gridProperties: { rowCount: 120, columnCount: 8 } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = created.data.replies[old ? 1 : 0].addSheet.properties.sheetId;

  // 값+수식
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows.map(r => r.map(v => v === null ? '' : v)) },
  });
  // 드롭다운 소스 (H열 40~150)
  const nums = []; for (let v = 40; v <= 150; v++) nums.push([v]);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `'${TAB}'!H1`, valueInputOption: 'RAW', requestBody: { values: nums },
  });

  // ── 서식 + 데이터 검증 ──
  const C = {
    dark:  { red: 0.122, green: 0.286, blue: 0.475 },
    hdr:   { red: 0.267, green: 0.447, blue: 0.769 },
    sec:   { red: 0.851, green: 0.882, blue: 0.949 },
    input: { red: 0.851, green: 0.941, blue: 0.827 },
    save:  { red: 1, green: 0.898, blue: 0.6 },
    band:  { red: 0.955, green: 0.960, blue: 0.975 },
    white: { red: 1, green: 1, blue: 1 },
    note:  { red: 0.45, green: 0.45, blue: 0.45 },
  };
  const R = [];
  const range = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const cellFmt = (rng, format, fields) => R.push({ repeatCell: { range: rng, cell: { userEnteredFormat: format }, fields } });
  const NUMFMT = { numberFormat: { type: 'NUMBER', pattern: '¥#,##0;[Red]-¥#,##0' }, horizontalAlignment: 'RIGHT' };

  R.push({ mergeCells: { range: range(iTitle, iTitle + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iTitle, iTitle + 1), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 14, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: iTitle, endIndex: iTitle + 1 }, properties: { pixelSize: 38 }, fields: 'pixelSize' } });
  R.push({ mergeCells: { range: range(iSub, iSub + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iSub, iSub + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(textFormat,horizontalAlignment)');

  for (const i of [iSecIn, iSecOut, iSecTgt, iSecInt]) {
    R.push({ mergeCells: { range: range(i, i + 1), mergeType: 'MERGE_ALL' } });
    cellFmt(range(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  }

  // 입력 블록: 라벨 볼드, 입력칸 초록 배경 + 테두리
  cellFmt(range(iRev, iTax + 1, 0, 1), { textFormat: { bold: true }, verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(textFormat.bold,verticalAlignment)');
  cellFmt(range(iRev, iTax + 1, 1, 2), { backgroundColor: C.input, horizontalAlignment: 'CENTER', textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)');
  cellFmt(range(iRaku, iRaku + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '#,##0' } }, 'userEnteredFormat.numberFormat');
  cellFmt(range(iSideAmt, iSideAmt + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '#,##0' } }, 'userEnteredFormat.numberFormat');
  cellFmt(range(iCar, iCar + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '#,##0' } }, 'userEnteredFormat.numberFormat');
  cellFmt(range(iRev, iTax + 1, 2, NCOL), { textFormat: { fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  const b = { style: 'SOLID_MEDIUM', color: { red: 0.3, green: 0.6, blue: 0.3 } };
  R.push({ updateBorders: { range: range(iRev, iTax + 1, 1, 2), top: b, bottom: b, left: b, right: b, innerHorizontal: { style: 'SOLID', color: { red: 0.3, green: 0.6, blue: 0.3 } } } });

  // 결과 블록
  cellFmt(range(iORev, iOSave + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(iORev, iOSave + 1, 1, 2), NUMFMT, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(iORev, iOSave + 1, 2, NCOL), { textFormat: { fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  cellFmt(range(iOSave, iOSave + 1, 0, 2), { backgroundColor: C.save, textFormat: { bold: true, fontSize: 13 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  const gb = { style: 'SOLID', color: { red: 0.6, green: 0.6, blue: 0.6 } };
  R.push({ updateBorders: { range: range(iORev, iOSave + 1, 0, 2), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } } } });

  // 목표 저금액 표
  cellFmt(range(iTgtH, iTgtH + 1, 0, 2), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)');
  cellFmt(range(iTgtH + 1, iTgtH + 5, 0, 2), NUMFMT, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  for (let r = iTgtH + 1; r < iTgtH + 5; r += 2) cellFmt(range(r, r + 1, 0, 2), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor');
  R.push({ updateBorders: { range: range(iTgtH, iTgtH + 5, 0, 2), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } }, innerVertical: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } } } });

  // 내부 계산표
  cellFmt(range(iIntH, iIntH + 1, 0, 5), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)');
  cellFmt(range(mStart, mStart + 4, 1, 5), { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  R.push({ mergeCells: { range: range(iNote, iNote + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iNote, iNote + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');

  // 데이터 검증 (드롭다운)
  const dv = (rowIdx, condition) => R.push({ setDataValidation: { range: range(rowIdx, rowIdx + 1, 1, 2), rule: { condition, strict: true, showCustomUi: true } } });
  dv(iRev,  { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `='${TAB}'!$H$1:$H$111` }] });
  dv(iMon,  { type: 'ONE_OF_LIST', values: ['9월','10월','11월','12월'].map(v => ({ userEnteredValue: v })) });
  dv(iAlba, { type: 'ONE_OF_LIST', values: ['기본(4h)','최대(6h)'].map(v => ({ userEnteredValue: v })) });
  dv(iSide, { type: 'ONE_OF_LIST', values: ['포함(10만)','미포함','직접입력'].map(v => ({ userEnteredValue: v })) });
  dv(iMogu, { type: 'ONE_OF_LIST', values: ['계약(+1.5만)','미계약'].map(v => ({ userEnteredValue: v })) });
  dv(iTax, { type: 'ONE_OF_LIST', values: ['적용(4.55%)','미적용(세전)'].map(v => ({ userEnteredValue: v })) });

  // 열 너비 + H열 숨김
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 180 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 140 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 280 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  // 계산 검증: 수식 결과 읽기
  const check = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A${A1(iORev)}:B${A1(iOSave)}`, valueRenderOption: 'UNFORMATTED_VALUE' });
  console.log('[계산 검증 — 매출 80만·9월·기본·부업 미포함·라쿠텐 0]');
  for (const row of check.data.values || []) console.log(' ', row[0], '=', row[1]);
  const tgt = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A${A1(iTgtH)+1}:B${A1(iTgtH)+4}`, valueRenderOption: 'UNFORMATTED_VALUE' });
  console.log('[목표 저금액 → 필요매출]');
  for (const row of tgt.data.values || []) console.log(' ', row[0], '→', row[1]);
  console.log('[저금 계산기 탭 생성 완료]');
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
