// 「앞으로의 방향」 탭 — 2026 하반기 재무 방향 정리
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '앞으로의 방향';
const NCOL = 6;

const MARGIN = 0.834197, HOUSE = 298745, CAR = 50000; // 세후 마진율(소비세 4.55% 차감) · 가계 고정비 198,745 · 차량 5만
const MONTHS = [
  { name: '9월',  albaMin: 76800, commute: 7740 },
  { name: '10월', albaMin: 86400, commute: 7740 },
  { name: '11월', albaMin: 86400, commute: 6880 },
  { name: '12월', albaMin: 76800, commute: 8600 },
];
const net = (R, m) => Math.round(R * MARGIN - 365000 - m.albaMin - m.commute);

const rows = [];
const fmtRows = { sec: [], theaders: [], notes: [] };
const push = r => { rows.push(r); return rows.length - 1; };
const blank = () => push([]);

const iTitle = push(['앞으로의 방향 — 2026 하반기 (9~12월)']);
const iSub = push(['「센바 9-12월 수익계산」·「저금 계산기」 탭 기반 정리 | 2026-08-24 갱신 | 소비세 4.55% 반영(세후)']);
blank();

const iSec1 = push(['■ 결론 한 줄']);
const iConc = push(['세후·MOGU 포함: 매출 80만+부업 10만은 월 −3.1~−4.1만 적자. 저금 0은 매출 84~85만, 월 10만 저금은 매출 96~97만 또는 부업 확대 필요']);
blank();

const iSec2 = push(['■ 목표 3가지']);
const h2 = push(['구분', '목표', '근거·비고']);
const g1 = push(['① 센바미술관', '월 매출 80만엔 사수', '저금 0 경계선 약 84~85만(세후·MOGU 포함·알바 기본·부업 10만). 8월 페이스(월말예상 134.9만)면 여유 있음']);
const g2 = push(['② 부업', '월 10만엔', '저금의 대부분을 부업이 담당하는 구조. 자산현황 9월 계획(15만)보다 보수적으로 설정']);
const g3 = push(['③ 저금', '매출 85만+에서 저금 시작 → 10만(상향)', '80만+부업10만은 4개월 합계 약 −14.3만(적자). 10만/월 저금은 매출 96~97만 필요']);
blank();

const iSec3 = push(['■ 월별 플랜 (매출 80만 + 부업 10만, 알바 기본 4h, 소비세 4.55% 반영 — 이 매출로는 적자)']);
const h3 = push(['월', '센바 순수익(세전)', '− 생활비·가계고정비', '− 차량 유지비', '+ 부업 10만', '= 저금 가능액']);
const planRows = [];
let sum = 0;
for (const m of MONTHS) {
  const n = net(800000, m), save = n - HOUSE - CAR + 100000;
  sum += save;
  planRows.push(push([m.name, n, -HOUSE, -CAR, 100000, save]));
}
const t3 = push(['합계 (4개월)', '', '', '', '', sum]);
blank();

const iSec4 = push(['■ 리스크 관리 — 지킬 것']);
const h4 = push(['항목', '내용']);
const r1 = push(['알바 근무시간', '최대(6h) 근무가 늘면 월 약 −4만엔 → 저금 잠식. 예약 상황 봐서 기본(4h) 중심 운영']);
const r2 = push(['라쿠텐카드 변동지출', '9월 예정 157,929엔은 저금 전액을 지우는 수준. 월 5만엔 이하 관리 권장']);
const rMkt = push(['마케팅 증액', '월 6.5만(구루나비 2만+메타 4,500+인스타 2.55만+MOGU 1.5만). MOGU는 1년 계약(총 18만)이라 고정비 — 외국인 월 5명(매출 1.8만분)이 손익분기, Vercel Analytics 국가별 유입으로 검증']);
const rCar = push(['차량 유지비', '월 5만 반영(주차 1만·보험 예상 1만·코인주차/기름 3만). 보험 실제 가입 시 1만 초과분은 저금 추가 잠식, 기름·코인주차는 사용량 따라 변동']);
const r3 = push(['세금', '소비세는 간이·서비스업 4.55%로 매출 차감 반영済. 소득세·주민세는 미반영이라 별도 적립 필요']);
const r4 = push(['조기 경보선', '센바 매출이 월 83만엔 밑으로 → 저금 0/적자권(세후·알바 기본·부업 10만 포함). 월 중순 페이스로 미리 체크']);
blank();

const iSec5 = push(['■ 상향 시나리오']);
const h5 = push(['시나리오', '저금 가능액', '비고']);
const u1 = push(['매출 90만 + 부업 10만', '월 약 4.3~5.2만엔', '저금 계산기에서 매출 90 선택하면 바로 확인 가능']);
const u2 = push(['부업 10만 → 15만', '저금 +5만엔/월', '블로그 애드센스 승인(seido-note·hakobinavi 심사 준비 중), 네이버 브랜드커넥트(japany2017 일 방문 500+), 어필리에이트 확장']);
const u3 = push(['알바비 절감', '기본 근무 유지 시 최대 대비 월 +3.8~4.3만엔', '13시 예약·18시 당일예약 발생 빈도가 변수']);
blank();
const iN = push(['※ 수치 근거는 「센바 9-12월 수익계산」 탭, 조건 바꿔보기는 「저금 계산기」 탭 사용']);

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
    dark:  { red: 0.122, green: 0.286, blue: 0.475 },
    hdr:   { red: 0.267, green: 0.447, blue: 0.769 },
    sec:   { red: 0.851, green: 0.882, blue: 0.949 },
    gold:  { red: 1, green: 0.898, blue: 0.6 },
    band:  { red: 0.955, green: 0.960, blue: 0.975 },
    total: { red: 1, green: 0.949, blue: 0.8 },
    white: { red: 1, green: 1, blue: 1 },
    note:  { red: 0.45, green: 0.45, blue: 0.45 },
  };
  const R = [];
  const range = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const cellFmt = (rng, format, fields) => R.push({ repeatCell: { range: rng, cell: { userEnteredFormat: format }, fields } });
  const gb = { style: 'SOLID', color: { red: 0.6, green: 0.6, blue: 0.6 } };
  const ib = { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } };

  R.push({ mergeCells: { range: range(iTitle, iTitle + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iTitle, iTitle + 1), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 14, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: iTitle, endIndex: iTitle + 1 }, properties: { pixelSize: 38 }, fields: 'pixelSize' } });
  R.push({ mergeCells: { range: range(iSub, iSub + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iSub, iSub + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(textFormat,horizontalAlignment)');

  for (const i of [iSec1, iSec2, iSec3, iSec4, iSec5]) {
    R.push({ mergeCells: { range: range(i, i + 1), mergeType: 'MERGE_ALL' } });
    cellFmt(range(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  }

  // 결론
  R.push({ mergeCells: { range: range(iConc, iConc + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iConc, iConc + 1), { backgroundColor: C.gold, textFormat: { bold: true, fontSize: 12 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: iConc, endIndex: iConc + 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } });

  // 표 공통 헬퍼
  const table = (hRow, dataRows, cols, { merge = null, numCols = null, totalRow = null } = {}) => {
    cellFmt(range(hRow, hRow + 1, 0, cols), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)');
    const d0 = hRow + 1, d1 = hRow + 1 + dataRows + (totalRow !== null ? 1 : 0);
    for (let r = d0; r < d0 + dataRows; r += 2) cellFmt(range(r, r + 1, 0, cols), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor');
    cellFmt(range(d0, d1, 0, 1), { textFormat: { bold: true }, verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(textFormat.bold,verticalAlignment)');
    cellFmt(range(d0, d1, 0, cols), { wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(wrapStrategy,verticalAlignment)');
    if (numCols) cellFmt(range(d0, d1, numCols[0], numCols[1]), { numberFormat: { type: 'NUMBER', pattern: '¥#,##0;[Red]-¥#,##0' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
    if (totalRow !== null) cellFmt(range(totalRow, totalRow + 1, 0, cols), { backgroundColor: C.total, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
    R.push({ updateBorders: { range: range(hRow, d1, 0, cols), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  };
  table(h2, 3, 3);
  table(h3, 4, 6, { numCols: [1, 6], totalRow: t3 });
  table(h4, 6, 2);
  table(h5, 3, 3);
  // 저금 가능액 열 강조
  cellFmt(range(h3 + 1, t3 + 1, 5, 6), { backgroundColor: C.gold, textFormat: { bold: true }, numberFormat: { type: 'NUMBER', pattern: '¥#,##0;[Red]-¥#,##0' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat.bold,numberFormat,horizontalAlignment)');

  R.push({ mergeCells: { range: range(iN, iN + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iN, iN + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');

  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 170 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 2, endIndex: 5 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 320 }, fields: 'pixelSize' } });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });
  console.log('[앞으로의 방향 탭 생성 완료] 월별 저금:', MONTHS.map(m => net(800000, m) - HOUSE + 100000).join(', '), '| 합계:', sum);
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
