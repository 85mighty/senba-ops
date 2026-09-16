// 「저금 시나리오 v2 (고베 20만)」 탭 — 고베 고정비 실측 전제(월세·전기·수도 합 20만) 반영판 (2026-09-16)
// 고베 운영 체제 2안: 금토일월(주4일) / 금토일월+수·목(주6일, 화 휴무) — 둘 다 알바 기본 4h 체제(사장 철수 → 부업 15만 가능)
// 저금 목표 10만·20만·30만 역산: 본점 매출별로 고베가 얼마를 벌어야 하는지 표로 제시. 가계 지출 348,745 차감.
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '저금 시나리오 v2 (고베 20만)';
const NCOL = 8;

const M = 0.834197;                           // 세후 마진율 (소비세 간이 4.55% 포함)
const HONTEN_FIX = 459140;                    // 본점: 고정·마케팅 36.5만 + 알바 18일 기본4h + 사장 수·목 통근 (기존 탭과 동일)
const KOBE_BASE = 200000;                     // 고베: 월세+전기+수도 합 (사장님 실측 전제)
const KOBE_MKT = 20000;                       // 고베: 마케팅 가정 (구루나비 등 — 다르면 이 값만 수정)
const ALBA6 = 26 * 4 * 1200;                  // 주6일(화휴): 월 26일 × 4h = 124,800
const ALBA4 = 17 * 4 * 1200;                  // 금토일월: 월평균 17일 × 4h = 81,600
const FIX6 = KOBE_BASE + KOBE_MKT + ALBA6;    // 344,800
const FIX4 = KOBE_BASE + KOBE_MKT + ALBA4;    // 301,600
const SIDE = 150000;                          // 부업 (사장 철수 전제)
const HOUSE = 100000 + 198745 + 50000;        // 가계 지출 348,745 (기존 탭과 동일)

const hn = S => Math.round(S * M - HONTEN_FIX);
const kn = (S, fix) => Math.round(S * M - fix);
const save = (h, k, fix) => hn(h) + kn(k, fix) + SIDE - HOUSE;
const needKobe = (T, h, fix) => Math.round((T + HOUSE - SIDE - hn(h) + fix) / M);   // 목표 저금 T 달성에 필요한 고베 매출
const be = fix => Math.round(fix / M);

const rows = [];
const push = r => { rows.push(r); return rows.length - 1; };
const blank = () => push([]);

const iTitle = push(['저금 시나리오 v2 — 고베 고정비 20만 전제 (주4일 vs 주6일)']);
const iSub = push(['고베: 월세·전기·수도 20만 + 마케팅 2만 + 알바 기본4h(주4일 17일 / 주6일 26일) · 사장 철수 → 부업 15만 · 세후(소비세 4.55%) · 소득세·주민세, 라쿠텐카드 변동지출 미반영 · 2026-09-16']);
blank();

const iSec1 = push(['■ 전제 (모두 월 기준)']);
const p1 = push(['본점 순수익', `매출 × ${M} − 459,140 (기존 「저금 시나리오」 탭과 동일)`]);
const p2 = push(['고베 고정비 (주4일)', `월세·전기·수도 200,000 + 마케팅 20,000 + 알바 17일×4h 81,600 = ${FIX4.toLocaleString('ja-JP')} → 손익분기 매출 약 ${(be(FIX4) / 10000).toFixed(1)}만`]);
const p3 = push(['고베 고정비 (주6일)', `월세·전기·수도 200,000 + 마케팅 20,000 + 알바 26일×4h 124,800 = ${FIX6.toLocaleString('ja-JP')} → 손익분기 매출 약 ${(be(FIX6) / 10000).toFixed(1)}만`]);
const p4 = push(['부업', '사장이 고베에 상주하지 않으므로 가능 — 15만 고정 (오사카 유모차 등)']);
const p5 = push(['가계 지출', '생활비 100,000 + 가계 고정비 198,745 + 차량 유지비 50,000 = 348,745']);
const p6 = push(['저금액', '= 본점 순수익 + 고베 순수익 + 부업 15만 − 348,745']);
blank();

const iSec2 = push(['■ 시나리오 — 고베 체제별']);
const h2 = push(['체제', '구분', '본점 매출', '고베 매출', '본점 순수익', '고베 순수익', '', '★ 월 저금액']);
const SC = [['보수', 700000, 400000], ['기본', 800000, 500000], ['낙관', 900000, 600000], ['최상', 1000000, 700000]];
const scStart = rows.length;
for (const [label, fix] of [['금토일월 (주4일)', FIX4], ['주6일 (화 휴무)', FIX6]]) {
  for (const [name, h, k] of SC) push([label, name, h, k, hn(h), kn(k, fix), '', save(h, k, fix)]);
}
const scEnd = rows.length;
blank();

const iSec3 = push(['■ 목표 저금 역산 — 두 매장 매출이 얼마면 되나 (부업 15만 포함)']);
const h3 = push(['목표 저금', '본점 매출', '필요 고베 매출 (주4일)', '필요 고베 매출 (주6일)', '메모']);
const tgStart = rows.length;
for (const T of [100000, 200000, 300000]) {
  for (const h of [700000, 800000, 900000]) {
    const k4 = needKobe(T, h, FIX4), k6 = needKobe(T, h, FIX6);
    push([T, h, k4, k6, k6 > 700000 ? '△ 고베 70만 초과 — 현실성 낮음' : '']);
  }
}
const tgEnd = rows.length;
blank();

const iSec4 = push(['■ 매트릭스 — 주6일 체제, 부업 15만 고정, 월 저금액']);
const h4 = push(['본점 매출 ↓ / 고베 매출 →', 300000, 400000, 500000, 600000, 700000]);
const mxStart = rows.length;
for (const h of [700000, 800000, 900000]) push([h, ...[300000, 400000, 500000, 600000, 700000].map(k => save(h, k, FIX6))]);
const mxEnd = rows.length;
const mxNote = push([`※ 금토일월(주4일) 체제는 알바비가 월 ${(ALBA6 - ALBA4).toLocaleString('ja-JP')} 적게 들어 각 셀에 +${(ALBA6 - ALBA4).toLocaleString('ja-JP')}`]);
blank();

const iSec5 = push(['■ 읽는 법·주의']);
const h5 = push(['항목', '내용']);
const n1 = push(['고베 손익분기', `주4일 약 ${(be(FIX4) / 10000).toFixed(1)}만 / 주6일 약 ${(be(FIX6) / 10000).toFixed(1)}만 — 이 밑이면 고베가 저금을 잠식`]);
const n2 = push(['주6일 전환 기준', `수·목 이틀의 추가 매출이 월 ${Math.round((ALBA6 - ALBA4) / M / 1000)}천엔(≈수·목 하루 1~2명) 이상이면 주6일이 유리 — 그 밑이면 주4일 유지`]);
const n3 = push(['목표 감각', `기본(본80·고50): 주4일 저금 ${Math.round(save(800000, 500000, FIX4) / 1000)}천엔 / 주6일 ${Math.round(save(800000, 500000, FIX6) / 1000)}천엔 — 저금 10만은 본80이면 고베 ${Math.round(needKobe(100000, 800000, FIX4) / 10000)}만(주4)로 도달`]);
const n4 = push(['저금 20만의 벽', `본점 80만 기준 고베 ${Math.round(needKobe(200000, 800000, FIX4) / 10000)}만(주4)~${Math.round(needKobe(200000, 800000, FIX6) / 10000)}만(주6) 필요 — 본점을 90만으로 올리면 고베 ${Math.round(needKobe(200000, 900000, FIX4) / 10000)}만(주4)이면 충분`]);
const n5 = push(['미반영 항목', '고베 초기비용 회수·상점가비 별도 확인 · 소득세·주민세 별도 적립 · 라쿠텐카드 변동지출은 월별 차감']);
blank();
const iN = push(['※ 마케팅 2만·알바 일수 등 전제가 다르면 senba-savings3.js 상수만 수정 후 재실행 · 기존 「저금 시나리오 (본점+고베)」 탭은 구전제(고정비 32.7만) 참고용']);

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const old = meta.data.sheets.find(s => s.properties.title === TAB);
  const reqs0 = [];
  if (old) reqs0.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  reqs0.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 5, columnCount: NCOL } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = created.data.replies[old ? 1 : 0].addSheet.properties.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: rows },
  });

  const C = {
    dark: { red: 0.122, green: 0.286, blue: 0.475 }, hdr: { red: 0.267, green: 0.447, blue: 0.769 },
    sec: { red: 0.851, green: 0.882, blue: 0.949 }, gold: { red: 1, green: 0.898, blue: 0.6 },
    band: { red: 0.955, green: 0.960, blue: 0.975 }, white: { red: 1, green: 1, blue: 1 }, note: { red: 0.45, green: 0.45, blue: 0.45 },
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
  for (const i of [iSec1, iSec2, iSec3, iSec4, iSec5]) {
    R.push({ mergeCells: { range: range(i, i + 1), mergeType: 'MERGE_ALL' } });
    cellFmt(range(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  }
  cellFmt(range(p1, p6 + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  for (const i of [p1, p2, p3, p4, p5, p6]) R.push({ mergeCells: { range: range(i, i + 1, 1, NCOL), mergeType: 'MERGE_ALL' } });
  cellFmt(range(p1, p6 + 1, 1, NCOL), { wrapStrategy: 'WRAP', textFormat: { fontSize: 9 } }, 'userEnteredFormat(wrapStrategy,textFormat)');

  const table = (hRow, nData, cols, { numFrom = 1 } = {}) => {
    const d0 = hRow + 1, d1 = hRow + 1 + nData;
    cellFmt(range(hRow, hRow + 1, 0, cols), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)');
    for (let r = d0; r < d1; r += 2) cellFmt(range(r, r + 1, 0, cols), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor');
    cellFmt(range(d0, d1, 0, 1), { textFormat: { bold: true }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat.bold,verticalAlignment,wrapStrategy)');
    cellFmt(range(d0, d1, numFrom, cols), NUM, 'userEnteredFormat(numberFormat,horizontalAlignment)');
    R.push({ updateBorders: { range: range(hRow, d1, 0, cols), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  };

  // 시나리오 표 — 체제 4행씩 세로 병합, 저금액 골드
  table(h2, scEnd - scStart, 8, { numFrom: 2 });
  cellFmt(range(scStart, scEnd, 1, 2), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  R.push({ mergeCells: { range: range(scStart, scStart + 4, 0, 1), mergeType: 'MERGE_ALL' } });
  R.push({ mergeCells: { range: range(scStart + 4, scEnd, 0, 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(scStart, scEnd, 7, 8), { backgroundColor: C.gold, textFormat: { bold: true }, numberFormat: NUM.numberFormat, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat.bold,numberFormat,horizontalAlignment)');

  // 목표 역산 표 — 목표 3행씩 세로 병합, 필요 고베 매출 골드
  table(h3, tgEnd - tgStart, 5, { numFrom: 0 });
  for (let t = 0; t < 3; t++) R.push({ mergeCells: { range: range(tgStart + t * 3, tgStart + t * 3 + 3, 0, 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(tgStart, tgEnd, 0, 1), { backgroundColor: C.sec, textFormat: { bold: true }, numberFormat: NUM.numberFormat, horizontalAlignment: 'RIGHT', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(backgroundColor,textFormat.bold,numberFormat,horizontalAlignment,verticalAlignment)');
  cellFmt(range(tgStart, tgEnd, 2, 4), { backgroundColor: C.gold, textFormat: { bold: true }, numberFormat: NUM.numberFormat, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat.bold,numberFormat,horizontalAlignment)');
  cellFmt(range(tgStart, tgEnd, 4, 5), { textFormat: { fontSize: 9, foregroundColor: C.note }, wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat,wrapStrategy)');

  // 매트릭스
  table(h4, mxEnd - mxStart, 6, { numFrom: 0 });
  cellFmt(range(mxStart, mxEnd, 0, 1), { numberFormat: { type: 'NUMBER', pattern: '¥#,##0' }, horizontalAlignment: 'RIGHT', textFormat: { bold: true } }, 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat.bold)');
  cellFmt(range(h4, h4 + 1, 1, 6), { numberFormat: { type: 'NUMBER', pattern: '¥#,##0' } }, 'userEnteredFormat.numberFormat');
  R.push({ mergeCells: { range: range(mxNote, mxNote + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(mxNote, mxNote + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');

  // 읽는 법
  table(h5, 5, 2, { numFrom: 2 });
  cellFmt(range(h5 + 1, h5 + 6, 1, 2), { wrapStrategy: 'WRAP', textFormat: { fontSize: 9 } }, 'userEnteredFormat(wrapStrategy,textFormat)');
  R.push({ mergeCells: { range: range(iN, iN + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iN, iN + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: NCOL }, properties: { pixelSize: 128 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  console.log('[저금 시나리오 v2 탭 완료] 고베 BE 주4', be(FIX4).toLocaleString('ja-JP'), '/ 주6', be(FIX6).toLocaleString('ja-JP'));
  for (const [label, fix] of [['주4', FIX4], ['주6', FIX6]]) for (const [name, h, k] of SC) console.log(' ', label, name, '→ 저금', save(h, k, fix).toLocaleString('ja-JP'));
  for (const T of [100000, 200000]) console.log('  목표', T / 10000 + '만, 본80 → 고베 필요(주4)', needKobe(T, 800000, FIX4).toLocaleString('ja-JP'), '(주6)', needKobe(T, 800000, FIX6).toLocaleString('ja-JP'));
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
