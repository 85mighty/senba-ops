// 「저금 시나리오 (본점+고베)」 탭 — 본점·고베 2호점·부업 3원 수입 → 가계 지출 차감 후 월 저금액 (2026-08-28)
// 전제: 고베는 알바 주6일 체제(사장은 시스템 구축 후 철수 → 부업 가능). 사장 직접 상주 시 부업 15만 상실이
//       알바비 절약(월 10.4만)보다 커서 알바 체제가 월 +4.6만 유리 — 이 탭은 알바 체제 기준.
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '저금 시나리오 (본점+고베)';
const NCOL = 7;

const M = 0.834197;                         // 세후 마진율 (소비세 간이 4.55% 포함)
const HONTEN_FIX = 365000 + 86400 + 7740;   // 본점: 고정비·마케팅 36.5만 + 알바 18일 기본4h + 사장 수·목 통근 (10월 기준, 월별 ±4천)
const KOBE_FIX = 327300;                    // 고베: 야칭+상점가비 157,500 + 공과금 25,000 + 마케팅 20,000 + 알바 26일 기본4h 124,800
const HOUSE = 100000 + 198745 + 50000;      // 생활비 + 가계 고정비 + 차량 유지비 (저금 계산기 탭과 동일)
const hn = S => Math.round(S * M - HONTEN_FIX);
const kn = S => Math.round(S * M - KOBE_FIX);
const save = (h, k, side) => hn(h) + kn(k) + side - HOUSE;
const man = n => (n / 10000) + '만';

const rows = [];
const push = r => { rows.push(r); return rows.length - 1; };
const blank = () => push([]);

const iTitle = push(['저금 시나리오 — 본점 + 고베 2호점 + 부업']);
const iSub = push(['고베는 알바 주6일 체제(사장 철수 → 부업 가능) · 세후(소비세 4.55%) · 소득세·주민세, 라쿠텐카드 변동지출 미반영 · 2026-08-28']);
blank();

const iSec1 = push(['■ 전제 (모두 월 기준)']);
const p1 = push(['본점 순수익', '매출 × 0.834197 − 459,140 (고정·마케팅 36.5만 + 알바 18일 기본4h + 사장 수·목 통근 · 10월 기준)']);
const p2 = push(['고베 순수익', '매출 × 0.834197 − 327,300 (알바 주6일 기본4h 체제 · 「고베 2호점」 탭과 동일)']);
const p3 = push(['부업', '사장이 고베에 상주하지 않으므로 가능 — 기본 15만 (오사카 유모차 등)']);
const p4 = push(['가계 지출', '생활비 100,000 + 가계 고정비 198,745 + 차량 유지비 50,000 = 348,745']);
const p5 = push(['저금액', '= 본점 순수익 + 고베 순수익 + 부업 − 348,745']);
blank();

const iSec2 = push(['■ 시나리오']);
const h2 = push(['구분', '본점 매출', '고베 매출', '부업', '본점 순수익', '고베 순수익', '★ 월 저금액']);
const scRows = [
  ['보수', 700000, 400000, 100000],
  ['기본', 800000, 500000, 150000],
  ['낙관', 900000, 600000, 150000],
  ['최상', 1000000, 700000, 150000],
];
const scStart = rows.length;
for (const [name, h, k, s] of scRows) push([name, h, k, s, hn(h), kn(k), save(h, k, s)]);
const scEnd = rows.length;
const scRef = push(['(참고) 고베 없음', 800000, 0, 150000, hn(800000), '—', hn(800000) + 150000 - HOUSE]);
blank();

const iSec3 = push(['■ 매트릭스 — 부업 15만 고정, 월 저금액']);
const h3 = push(['본점 매출 ↓ / 고베 매출 →', 400000, 500000, 600000, 700000]);
const mxStart = rows.length;
for (const h of [700000, 800000, 900000]) push([h, ...[400000, 500000, 600000, 700000].map(k => save(h, k, 150000))]);
const mxEnd = rows.length;
blank();

const iSec4 = push(['■ 읽는 법·주의']);
const h4 = push(['항목', '내용']);
const n1 = push(['고베의 기여', '기본 시나리오(본80·고50·부15) 저금 ' + Math.round(save(800000, 500000, 150000) / 1000) + '천엔 — 고베 없음(' + Math.round((hn(800000) + 150000 - HOUSE) / 1000) + '천엔) 대비 고베 50만이 월 +약 9만엔']);
const n2 = push(['고베 손익분기', '알바 체제 39.3만 — 이 밑이면 고베가 저금을 잠식. 사장 직접 phase에서 40만+ 검증 후 알바 전환 권장']);
const n3 = push(['사장 상주의 기회비용', '사장 직접 시 알바비 절약 +10.4만 < 부업 상실 −15만 → 알바 체제가 월 +4.6만 유리 (탭 전제의 근거)']);
const n4 = push(['본점 사수선', '본점 매출 70만 밑으로 떨어지면 고베 50만·부업 15만이어도 저금이 얇아짐 — 본점 80만 사수가 기본']);
const n5 = push(['미반영 항목', '라쿠텐카드 변동지출(월별 상이)은 별도 차감 · 소득세·주민세 별도 적립 · 고베 초기비용 118.8만 회수는 「고베 2호점」 탭']);
blank();
const iN = push(['※ 본점 조건 변경은 「저금 계산기」 탭 · 고베 조건 변경은 「2호점 시뮬레이션」 탭 · 이 탭은 senba-savings2.js 로 재생성']);

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const old = meta.data.sheets.find(s => s.properties.title === TAB);
  const reqs0 = [];
  if (old) reqs0.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  reqs0.push({ addSheet: { properties: { title: TAB, index: meta.data.sheets.length - (old ? 1 : 0), gridProperties: { rowCount: rows.length + 5, columnCount: NCOL } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = created.data.replies[old ? 1 : 0].addSheet.properties.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: rows },
  });

  const C = {
    dark: { red: 0.122, green: 0.286, blue: 0.475 }, hdr: { red: 0.267, green: 0.447, blue: 0.769 },
    sec: { red: 0.851, green: 0.882, blue: 0.949 }, gold: { red: 1, green: 0.898, blue: 0.6 },
    band: { red: 0.955, green: 0.960, blue: 0.975 }, total: { red: 1, green: 0.949, blue: 0.8 },
    white: { red: 1, green: 1, blue: 1 }, note: { red: 0.45, green: 0.45, blue: 0.45 },
  };
  const R = [];
  const range = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const cellFmt = (rng, format, fields) => R.push({ repeatCell: { range: rng, cell: { userEnteredFormat: format }, fields } });
  const gb = { style: 'SOLID', color: { red: 0.6, green: 0.6, blue: 0.6 } };
  const ib = { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } };
  const NUM = { numberFormat: { type: 'NUMBER', pattern: '¥#,##0;[Red]-¥#,##0' }, horizontalAlignment: 'RIGHT' };

  R.push({ mergeCells: { range: range(iTitle, iTitle + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iTitle, iTitle + 1), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 13, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: iTitle, endIndex: iTitle + 1 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } });
  R.push({ mergeCells: { range: range(iSub, iSub + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iSub, iSub + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(textFormat,horizontalAlignment)');
  for (const i of [iSec1, iSec2, iSec3, iSec4]) {
    R.push({ mergeCells: { range: range(i, i + 1), mergeType: 'MERGE_ALL' } });
    cellFmt(range(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  }
  // 전제
  cellFmt(range(p1, p5 + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  for (const i of [p1, p2, p3, p4, p5]) R.push({ mergeCells: { range: range(i, i + 1, 1, NCOL), mergeType: 'MERGE_ALL' } });
  cellFmt(range(p1, p5 + 1, 1, NCOL), { wrapStrategy: 'WRAP', textFormat: { fontSize: 9 } }, 'userEnteredFormat(wrapStrategy,textFormat)');
  // 표 헬퍼
  const table = (hRow, nData, cols, { totalRow = null, numFrom = 1 } = {}) => {
    const d0 = hRow + 1, d1 = hRow + 1 + nData + (totalRow !== null ? 1 : 0);
    cellFmt(range(hRow, hRow + 1, 0, cols), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)');
    for (let r = d0; r < d0 + nData; r += 2) cellFmt(range(r, r + 1, 0, cols), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor');
    cellFmt(range(d0, d1, 0, 1), { textFormat: { bold: true }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat.bold,verticalAlignment,wrapStrategy)');
    cellFmt(range(d0, d1, numFrom, cols), NUM, 'userEnteredFormat(numberFormat,horizontalAlignment)');
    if (totalRow !== null) cellFmt(range(totalRow, totalRow + 1, 0, cols), { backgroundColor: C.total, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
    R.push({ updateBorders: { range: range(hRow, d1, 0, cols), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  };
  // 시나리오 표 (+참고 행)
  table(h2, scEnd - scStart + 1, 7);
  cellFmt(range(scStart, scEnd + 1, 6, 7), { backgroundColor: C.gold, textFormat: { bold: true }, numberFormat: NUM.numberFormat, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat.bold,numberFormat,horizontalAlignment)');
  cellFmt(range(scRef, scRef + 1, 0, 7), { textFormat: { fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  // 매트릭스
  table(h3, mxEnd - mxStart, 5, { numFrom: 0 });
  cellFmt(range(mxStart, mxEnd, 0, 1), { numberFormat: { type: 'NUMBER', pattern: '¥#,##0' }, horizontalAlignment: 'RIGHT', textFormat: { bold: true } }, 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat.bold)');
  cellFmt(range(h3, h3 + 1, 1, 5), { numberFormat: { type: 'NUMBER', pattern: '¥#,##0' } }, 'userEnteredFormat.numberFormat');
  // 읽는 법
  table(h4, 5, 2, { numFrom: 2 });
  cellFmt(range(h4 + 1, h4 + 6, 1, 2), { wrapStrategy: 'WRAP', textFormat: { fontSize: 9 } }, 'userEnteredFormat(wrapStrategy,textFormat)');
  R.push({ mergeCells: { range: range(iN, iN + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iN, iN + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 200 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: NCOL }, properties: { pixelSize: 130 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  console.log('[저금 시나리오 탭 완료]');
  for (const [name, h, k, s] of scRows) console.log(' ', name, '본점', man(h), '고베', man(k), '부업', man(s), '→ 저금', save(h, k, s).toLocaleString('ja-JP'));
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
