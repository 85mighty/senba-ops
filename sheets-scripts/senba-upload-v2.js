// 센바 9-12월 수익계산 탭 v2 — 숫자형 + 음영/정렬/테두리 서식
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '센바 9-12월 수익계산';
const NCOL = 9; // A~I

const FIXED = 300000, MARKETING = 65000, PAPER = 180, BOX = 85, MISC = 0.04, TICKET = 3300;
const MARGIN = 1 - MISC - (PAPER + BOX) / TICKET;
const TAX = 0.0455; // 소비세 간이·서비스업 실효 (대시보드와 동일)
const EFF = MARGIN - TAX; // 세후 마진율
const COMMUTE_RT = 860;

const MONTHS = [
  { name: '9월',  albaDays: 16, wedThu: 9 },
  { name: '10월', albaDays: 18, wedThu: 9 },
  { name: '11월', albaDays: 18, wedThu: 8 },
  { name: '12월', albaDays: 16, wedThu: 10 },
];
for (const m of MONTHS) {
  m.albaMax = m.albaDays * 7200;
  m.albaMin = m.albaDays * 4800;
  m.commute = m.wedThu * COMMUTE_RT;
}
const need = (T, alba, com) => Math.ceil((T + FIXED + MARKETING + alba + com) / EFF / 1000) * 1000;
const net  = (R, alba, com) => Math.round(R * EFF - FIXED - MARKETING - alba - com);

// ── rows + 서식 지시 수집 ──────────────────────────────
const rows = [];
const fmt = { title: [], section: [], theader: [], num: [], bandStart: [], totalRow: [], note: [], merges: [], borders: [] };
const push = r => { rows.push(r); return rows.length - 1; };
const blank = () => push([]);

const iTitle = push(['센바미술관 2026년 9~12월 필요매출 계산 (알바비·통근비·소비세 4.55% 반영)']);
const iSub = push([`공식: 순수익 = 매출 × ${EFF.toFixed(6)}(소비세 4.55% 차감 포함, 세후) − ${(FIXED+MARKETING).toLocaleString('ja-JP')}(고정비+마케팅) − 알바비 − 통근비  |  갱신 2026-08-24`]);
blank();

// 전제
const iSec1 = push(['■ 전제']);
const p0 = push(['고정비(야칭·공과금)', FIXED, '', '마케팅비', MARKETING]);
push(['종이(1인당)', PAPER, '', '박스(1인당)', BOX]);
push(['잡재료', '매출의 4%', '', '객단가', '3,300엔 (8월 실측 3,279)']);
push(['마진율 (세전→세후)', `${MARGIN.toFixed(6)} → ${EFF.toFixed(6)}`, '', '알바 시급', '1,200엔 (기본4h=4,800/일, 최대6h=7,200/일)']);
const pMkt = push(['마케팅 내역', '구루나비 20,000 + 메타인증 4,500 + 인스타그램 홍보 25,500 + MOGU 15,000(1년 계약·총 18만) = 65,000']);
const pCom = push(['통근 왕복', '860엔/일 = (한큐 石橋阪大前→大阪梅田 240 + 미도스지선 梅田→本町 190) × 2, 수·목 출근']);
const pTax = push(['세금', '소비세 간이·서비스업 4.55% 반영(세후). 소득세·주민세는 미반영']);
blank();

// 월별 비용
const iSec2 = push(['■ 월별 비용 (알바: 금토일월 / 사장: 수·목 출근)']);
const h2 = push(['월', '알바 근무일', '알바비(기본4h)', '알바비(최대6h)', '수·목 출근일', '통근비']);
for (const m of MONTHS) push([m.name, m.albaDays, m.albaMin, m.albaMax, m.wedThu, m.commute]);
const t2 = push(['합계',
  MONTHS.reduce((s,m)=>s+m.albaDays,0), MONTHS.reduce((s,m)=>s+m.albaMin,0),
  MONTHS.reduce((s,m)=>s+m.albaMax,0), MONTHS.reduce((s,m)=>s+m.wedThu,0), MONTHS.reduce((s,m)=>s+m.commute,0)]);
blank();

// 필요매출 ×2
const tables = [];
for (const [label, key] of [['알바 최대 근무(매일 6h)', 'albaMax'], ['알바 기본 근무(매일 4h)', 'albaMin']]) {
  const iSec = push([`■ 필요매출 — ${label} + 통근비 포함`]);
  const h = push(['월', '순수익 10만엔', '순수익 15만엔', '순수익 20만엔']);
  for (const m of MONTHS) push([m.name, need(100000, m[key], m.commute), need(150000, m[key], m.commute), need(200000, m[key], m.commute)]);
  tables.push({ iSec, h, n: MONTHS.length, cols: 4 });
  blank();
}

// 조견표
const iSec5 = push(['■ 조견표 — 매출별 예상 순수익 (통근비 포함, 마이너스=적자)']);
const h5 = push(['매출', ...MONTHS.flatMap(m => [`${m.name} 기본`, `${m.name} 최대`])]);
const q0 = rows.length;
for (let R = 500000; R <= 900000; R += 50000)
  push([R, ...MONTHS.flatMap(m => [net(R, m.albaMin, m.commute), net(R, m.albaMax, m.commute)])]);
const q1 = rows.length;
// 저금 시나리오 — 자산현황 2026.9.30 열 기준 가계비
const HOUSE_LIVING = 100000;
const HOUSE_ITEMS = [['집 관리비',65000],['통신비용',15268],['마나짱보험',5650],['장학금',19721],['창희 연금',17510],['마나삐 연금',17510],['전기세',4099],['리오유치원',8500],['건강보험료',41000],['가스비',4487]];
const HOUSE_FIXED = HOUSE_ITEMS.reduce((s,[,v])=>s+v,0); // 173,745
const CAR = 50000;
const iSec6 = push(['■ 시나리오 — 저금 가능액 (센바 순수익 − 생활비 − 가계 고정비 − 차량 유지비)']);
const s1 = push(['생활비(월)', HOUSE_LIVING, '', '가계 고정비 합계', HOUSE_FIXED]);
const sCar = push(['차량 유지비(월)', CAR, '', '내역', '고정주차 10,000 + 보험(예상·가입예정) 10,000 + 코인주차·기름·기타 30,000']);
const sDetail = push(['고정비 내역', HOUSE_ITEMS.map(([n,v])=>n+' '+v.toLocaleString('ja-JP')).join(' + ')]);
const sExcl = push(['미포함 항목', '라쿠텐카드(변동·9월 157,929)는 별도 차감 / 부업수입(월 15만)은 별도 가산 / 세금 미반영']);
const h6 = push(['매출', ...MONTHS.flatMap(m => [`${m.name} 기본`, `${m.name} 최대`])]);
const s0 = rows.length;
let row80 = -1;
for (let R2 = 600000; R2 <= 900000; R2 += 50000) {
  if (R2 === 800000) row80 = rows.length;
  push([R2, ...MONTHS.flatMap(m => [net(R2, m.albaMin, m.commute) - HOUSE_LIVING - HOUSE_FIXED - CAR, net(R2, m.albaMax, m.commute) - HOUSE_LIVING - HOUSE_FIXED - CAR])]);
}
const sEnd = rows.length;
blank();
const iN1 = push(['참고: 8월 실적 — 확정매출 104.4만 / 월말예상 134.95만 / 예상순수익 85.2만 (알바비·통근비·세금 차감 전)']);
const iN2 = push(['주의: 알바 최대치는 모든 근무일 12:30~18:30 근무 가정의 상한. 실제 알바비는 기본~최대 사이']);

// ── 업로드 ─────────────────────────────────────────────
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

  // 색상
  const C = {
    dark:  { red: 0.122, green: 0.286, blue: 0.475 },
    hdr:   { red: 0.267, green: 0.447, blue: 0.769 },
    sec:   { red: 0.851, green: 0.882, blue: 0.949 },
    band:  { red: 0.955, green: 0.960, blue: 0.975 },
    total: { red: 1, green: 0.949, blue: 0.8 },
    white: { red: 1, green: 1, blue: 1 },
    note:  { red: 0.45, green: 0.45, blue: 0.45 },
  };
  const R = [];
  const range = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const cellFmt = (rng, format, fields) => R.push({ repeatCell: { range: rng, cell: { userEnteredFormat: format }, fields } });

  // 제목
  R.push({ mergeCells: { range: range(iTitle, iTitle + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iTitle, iTitle + 1),
    { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 13, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' },
    'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: iTitle, endIndex: iTitle + 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } });
  R.push({ mergeCells: { range: range(iSub, iSub + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iSub, iSub + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(textFormat,horizontalAlignment)');

  // 섹션 헤더 공통
  for (const i of [iSec1, iSec2, tables[0].iSec, tables[1].iSec, iSec5, iSec6]) {
    R.push({ mergeCells: { range: range(i, i + 1), mergeType: 'MERGE_ALL' } });
    cellFmt(range(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  }

  // 전제 블록: 라벨 볼드, 긴 행 머지
  cellFmt(range(p0, pTax + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(p0, pTax + 1, 3, 4), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  for (const i of [pMkt, pCom, pTax]) R.push({ mergeCells: { range: range(i, i + 1, 1, NCOL), mergeType: 'MERGE_ALL' } });
  cellFmt(range(p0, p0 + 4, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '#,##0.######' }, horizontalAlignment: 'LEFT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(p0, p0 + 2, 4, 5), { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'LEFT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(pTax, pTax + 1, 1, NCOL), { textFormat: { bold: true, foregroundColor: { red: 0.8, green: 0.2, blue: 0.2 } } }, 'userEnteredFormat.textFormat');

  // 표 서식 헬퍼: 헤더 + 밴딩 + 숫자 + 테두리
  const table = (hRow, nData, cols, { totalRow = null, negRed = false } = {}) => {
    const d0 = hRow + 1, d1 = hRow + 1 + nData + (totalRow ? 1 : 0);
    cellFmt(range(hRow, hRow + 1, 0, cols),
      { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' },
      'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)');
    for (let r = d0; r < d0 + nData; r += 2)
      cellFmt(range(r, r + 1, 0, cols), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor');
    const pat = negRed ? '#,##0;[Red]-#,##0' : '#,##0';
    cellFmt(range(d0, d1, 1, cols), { numberFormat: { type: 'NUMBER', pattern: pat }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
    cellFmt(range(d0, d1, 0, 1), { horizontalAlignment: 'CENTER', textFormat: { bold: true } }, 'userEnteredFormat(horizontalAlignment,textFormat.bold)');
    if (totalRow !== null) cellFmt(range(totalRow, totalRow + 1, 0, cols), { backgroundColor: C.total, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
    const b = { style: 'SOLID', color: { red: 0.6, green: 0.6, blue: 0.6 } };
    R.push({ updateBorders: { range: range(hRow, d1, 0, cols), top: b, bottom: b, left: b, right: b, innerHorizontal: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } }, innerVertical: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } } } });
  };

  table(h2, MONTHS.length, 6, { totalRow: t2 });
  for (const t of tables) table(t.h, t.n, t.cols);
  table(h5, q1 - q0, NCOL, { negRed: true });
  // 조견표 매출 열도 숫자 포맷
  cellFmt(range(q0, q1, 0, 1), { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'RIGHT', textFormat: { bold: true } }, 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat.bold)');

  // 저금 시나리오 서식
  cellFmt(range(s1, sExcl + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(s1, s1 + 1, 3, 4), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(s1, s1 + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'LEFT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(s1, s1 + 1, 4, 5), { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'LEFT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(sCar, sCar + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'LEFT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  for (const i of [sDetail, sExcl]) R.push({ mergeCells: { range: range(i, i + 1, 1, NCOL), mergeType: 'MERGE_ALL' } });
  cellFmt(range(sDetail, sDetail + 1, 1, NCOL), { textFormat: { fontSize: 9 }, wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat,wrapStrategy)');
  cellFmt(range(sExcl, sExcl + 1, 1, NCOL), { textFormat: { fontSize: 9, foregroundColor: { red: 0.8, green: 0.2, blue: 0.2 } }, wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat,wrapStrategy)');
  table(h6, sEnd - s0, NCOL, { negRed: true });
  cellFmt(range(s0, sEnd, 0, 1), { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'RIGHT', textFormat: { bold: true } }, 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat.bold)');
  cellFmt(range(row80, row80 + 1, 0, NCOL), { backgroundColor: { red: 1, green: 0.949, blue: 0.6 }, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');

  // 하단 노트
  for (const i of [iN1, iN2]) {
    R.push({ mergeCells: { range: range(i, i + 1), mergeType: 'MERGE_ALL' } });
    cellFmt(range(i, i + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  }

  // 열 너비
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: NCOL }, properties: { pixelSize: 100 }, fields: 'pixelSize' } });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });
  console.log('[v2 업로드 완료] 행수:', rows.length, '| 서식 요청:', R.length);
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
