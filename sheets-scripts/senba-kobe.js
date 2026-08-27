// 「고베 산노미야점 후보」 탭 — 특정 물건 손익 검토 (정적)
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '고베 산노미야점 후보';
const NCOL = 6;

const MARGIN = 0.834197, TICKET = 3300; // 세후 마진율 (소비세 간이·서비스업 4.55% 차감 포함)
const RENT = 200000;           // 야칭 15만 + 전기·수도 등 ≈ 20만
const MKT = 35000;             // 가정: 구루나비 2만 + 인스타 1.5만 (MOGU 시 +2만)
const DAYS = 26;               // 주6일 (하루만 휴무)
const ALBA_MIN = DAYS * 4800, ALBA_MAX = DAYS * 7200;
const FIXED_MIN = RENT + MKT + ALBA_MIN, FIXED_MAX = RENT + MKT + ALBA_MAX;
const be = f => Math.ceil(f / MARGIN / 1000) * 1000;
const net = (R, f) => Math.round(R * MARGIN - f);
const ppl = R => (R / TICKET / DAYS).toFixed(1);
const yen = n => n.toLocaleString('ja-JP');

// 본점 비교 (9~12월 평균: 알바 17일 기본, 야칭공과금 30만 + 마케팅 5만)
const HONTEN_FIXED = 300000 + 50000 + 17 * 4800;
const HONTEN_BE = be(HONTEN_FIXED);

const rows = [];
const push = r => { rows.push(r); return rows.length - 1; };
const blank = () => push([]);

const iTitle = push(['센바미술관 고베 산노미야점 후보 검토']);
const iSub = push(['산노미야 근처 쇼텐가이 건물 3층(엘리베이터 없음) · 본점과 동일 수익 공식 · 소비세 4.55% 반영(세후) · 2026-08-24']);
blank();

const iSec1 = push(['■ 물건 조건·전제']);
const p1 = push(['야칭', 150000, '', '전기·수도 포함 월 부담', RENT]);
const p2 = push(['알바 운영', '주6일(하루 휴무) = 월 26일 · 기본 4h 4,800/일 · 최대 6h 7,200/일']);
const p3 = push(['마케팅(가정)', MKT, '', '비고', '구루나비 2만 + 인스타 1.5만 · MOGU 추가 시 +15,000']);
const p4 = push(['객단가', TICKET, '', '마진율(세후)', Number(MARGIN.toFixed(6))]);
blank();

const iSec2 = push(['■ 월 고정비']);
const h2 = push(['구분', '알바 기본(4h)', '알바 최대(6h)']);
push(['야칭·공과금', RENT, RENT]);
push(['마케팅', MKT, MKT]);
push(['알바비 (26일)', ALBA_MIN, ALBA_MAX]);
const t2 = push(['합계', FIXED_MIN, FIXED_MAX]);
blank();

const iSec3 = push(['■ 손익분기']);
const h3 = push(['구분', '알바 기본(4h)', '알바 최대(6h)']);
push(['월 매출', be(FIXED_MIN), be(FIXED_MAX)]);
push(['하루 매출 (26일)', Math.round(be(FIXED_MIN) / DAYS), Math.round(be(FIXED_MAX) / DAYS)]);
const r3ppl = push(['하루 필요 인원', ppl(be(FIXED_MIN)) + '명', ppl(be(FIXED_MAX)) + '명']);
const r3mogu = push(['MOGU 추가 시 월 매출', be(FIXED_MIN + 15000), be(FIXED_MAX + 15000)]);
const r3hon = push(['(참고) 본점 손익분기', HONTEN_BE, '야칭 30만·마케팅 5만·알바 17일 기본 — 고베가 약 ' + Math.round((HONTEN_BE - be(FIXED_MIN)) / 10000) + '만엔 낮음']);
blank();

const iSec4 = push(['■ 매출별 월 순수익 (세전)']);
const h4 = push(['월 매출', '하루 평균 인원', '순수익 — 알바 기본(4h)', '순수익 — 알바 최대(6h)']);
const refStart = rows.length;
for (const R of [300000, 400000, 450000, 500000, 600000, 700000, 800000, 900000, 1000000])
  push([R, ppl(R) + '명', net(R, FIXED_MIN), net(R, FIXED_MAX)]);
const refEnd = rows.length;
blank();

const iSec5 = push(['■ 리스크·체크포인트 (계약 전 확인)']);
const h5 = push(['항목', '내용']);
const k1 = push(['3층·엘리베이터 없음', '고객 접근성 감점 + 석고·캔버스 재료 운반 부담. 1층 입간판·아케이드 유도 사인 허가를 임대인에게 반드시 확인']);
const k2 = push(['쇼텐가이 입지', '평일 유동인구 확보에 유리. 산노미야 관광객 → MOGU·인스타 외국인 집객과 궁합 좋음']);
const k3 = push(['손익분기 하루 5.0명', '3층 감점을 감안해도 본점 겨울 주말 수준(토 8명·일 12명)이면 평일 2~3명으로도 커버 가능한 구조']);
const k4 = push(['계약 조건', '보증금·시키킹 유무, 원상복구 범위, 간판 설치 가능 여부, 소음·물사용(석고) 제한 확인']);
const k5 = push(['알바 주6일 체제', '1명 단독이면 병결 시 휴업 — 2명 채용해 분할 권장. 오픈 초기 1~2개월은 사장 상주 필요']);
const k6 = push(['오픈 시기', '1~2월 오픈 → 2~3월 성수기(본점 작년 2월 100만·3월 147만)를 바로 타는 흐름이 안전']);
blank();
const iN = push(['※ 조건을 바꿔 계산하려면 「2호점 시뮬레이션」 탭 사용 (야칭공과금 20만·주6일 입력)']);

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
  for (const i of [iSec1, iSec2, iSec3, iSec4, iSec5]) {
    R.push({ mergeCells: { range: range(i, i + 1), mergeType: 'MERGE_ALL' } });
    cellFmt(range(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  }
  // 전제
  cellFmt(range(p1, p4 + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(p1, p4 + 1, 3, 4), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(p1, p4 + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '#,##0.######' }, horizontalAlignment: 'LEFT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(p1, p1 + 1, 4, 5), { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'LEFT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  for (const i of [p2]) R.push({ mergeCells: { range: range(i, i + 1, 1, NCOL), mergeType: 'MERGE_ALL' } });
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
  table(h2, 3, 3, { totalRow: t2 });
  table(h3, 4, 3);
  cellFmt(range(r3ppl, r3ppl + 1, 1, 3), { horizontalAlignment: 'RIGHT', textFormat: { bold: true } }, 'userEnteredFormat(horizontalAlignment,textFormat.bold)');
  cellFmt(range(h3 + 1, h3 + 2, 0, 3), { backgroundColor: C.gold, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
  cellFmt(range(r3hon, r3hon + 1, 2, 3), { numberFormat: { type: 'TEXT' }, horizontalAlignment: 'LEFT', textFormat: { fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat)');
  table(h4, refEnd - refStart, 4);
  cellFmt(range(refStart, refEnd, 1, 2), { horizontalAlignment: 'RIGHT' }, 'userEnteredFormat.horizontalAlignment');
  table(h5, 6, 2, { numFrom: 2 });
  cellFmt(range(h5 + 1, h5 + 7, 1, 2), { wrapStrategy: 'WRAP', textFormat: { fontSize: 9 } }, 'userEnteredFormat(wrapStrategy,textFormat)');
  R.push({ mergeCells: { range: range(iN, iN + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iN, iN + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 400 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 2, endIndex: 4 }, properties: { pixelSize: 170 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  console.log('[고베 탭 완료] 고정비 기본', yen(FIXED_MIN), '최대', yen(FIXED_MAX),
    '| 손익분기 기본', yen(be(FIXED_MIN)), '(' + ppl(be(FIXED_MIN)) + '명/일)',
    '최대', yen(be(FIXED_MAX)), '(' + ppl(be(FIXED_MAX)) + '명/일)',
    '| 본점 참고', yen(HONTEN_BE));
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
