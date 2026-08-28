// 「고베 2호점」 탭 — ヒライビル 3F 확정 물건 · 알바 주6일(화 휴무) 체제 손익 (2026-08-28 상담분)
// 기존 수기 탭을 대체: 물건 개요·초기비용은 상담 내용 그대로 이전, 손익은 알바 체제(본점과 동일 근무시간)로 재계산
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '고베 2호점';
const NCOL = 6;

const MARGIN = 0.834197, TICKET = 3300;      // 세후 마진율(소비세 간이 4.55% 포함) · 객단가(본점 8월 실측 3,279)
const RENT = 148500, SHOP = 9000, UTIL = 25000, MKT = 20000;   // 야칭 · 상점가비(쓰레기 포함) · 공과금 가정 · 마케팅
const DAYS = 26;                              // 주6일 (화요일만 휴무) = 4.33주 × 6일
const ALBA_MIN = DAYS * 4800, ALBA_MAX = DAYS * 7200;   // 본점과 동일: 기본 4h=4,800/일 · 최대 6h=7,200/일 (시급 1,200)
const BASE = RENT + SHOP + UTIL + MKT;
const FIXED_MIN = BASE + ALBA_MIN, FIXED_MAX = BASE + ALBA_MAX;
const INIT = 1188000;                         // 초기비용 합계 (견적서 · 첫달 야칭 포함)
const be = f => Math.ceil(f / MARGIN / 1000) * 1000;
const net = (R, f) => Math.round(R * MARGIN - f);
const ppl = R => (R / TICKET / DAYS).toFixed(1);
const payback = n => n > 0 ? (INIT / n).toFixed(1) + '개월' : '—';
const yen = n => n.toLocaleString('ja-JP');

const rows = [];
const push = r => { rows.push(r); return rows.length - 1; };
const blank = () => push([]);

const iTitle = push(['센바미술관 고베 2호점 — ヒライビル 3F']);
const iSub = push(['상담 2026-08-28 (イーアールホームズ·大橋) · 알바 주6일(화 휴무)·본점과 동일 근무시간 기준 · 소비세 4.55% 반영(세후)']);
blank();

const iSec1 = push(['■ 물건 개요·초기비용 (상담 확정치)']);
const h1 = push(['항목', '금액/내용', '', '항목', '금액/내용']);
const o1 = push(['물건', 'ヒライビル 3F (상점가 내 · 3층 · 엘리베이터 없음)', '', '야칭(월)', RENT]);
const o2 = push(['중개', 'イーアールホームズ · 담당 大橋 (LINE)', '', '상점가비(월)', SHOP]);
const o3 = push(['보증금', '445,500 (3개월분)', '', '레이킨', '297,000 (2개월분)']);
const o4 = push(['중개수수료', 148500, '', '보증회사', 148500]);
const o5 = push(['초기비용 합계', INIT, '', '비고', '첫달 야칭 포함 (견적서 1,188,000) · 화재보험 별도']);
const o6 = push(['조건', 'A간판 1곳 가능 · 협상 원칙불가 · 프리렌트는 신청 시 희망 전달', '', '링크', 'https://www.athome.co.jp/rent_store/1191889824/']);
blank();

const iSec2 = push(['■ 운영 전제 — 알바 체제 (2027-03~ 예정)']);
const p1 = push(['영업일', '주6일 (화요일만 휴무) = 월 26일 — 영업일 = 알바 근무일']);
const p2 = push(['알바 근무', '본점과 동일 시간: 기본 4h(13:30~17:30) 4,800/일 · 최대 6h(12:30~18:30) 7,200/일 · 시급 1,200']);
const p3 = push(['공과금(가정)', UTIL, '', '마케팅', MKT]);
const p4 = push(['객단가', TICKET, '', '마진율(세후)', Number(MARGIN.toFixed(6))]);
blank();

const iSec3 = push(['■ 월 고정비']);
const h3 = push(['구분', '알바 기본(4h)', '알바 최대(6h)']);
push(['야칭+상점가비', RENT + SHOP, RENT + SHOP]);
push(['공과금(가정)', UTIL, UTIL]);
push(['마케팅', MKT, MKT]);
push(['알바비 (26일)', ALBA_MIN, ALBA_MAX]);
const t3 = push(['합계', FIXED_MIN, FIXED_MAX]);
blank();

const iSec4 = push(['■ 손익분기']);
const h4 = push(['구분', '알바 기본(4h)', '알바 최대(6h)']);
push(['월 매출', be(FIXED_MIN), be(FIXED_MAX)]);
push(['하루 매출 (26일)', Math.round(be(FIXED_MIN) / DAYS), Math.round(be(FIXED_MAX) / DAYS)]);
const r4ppl = push(['하루 필요 인원', ppl(be(FIXED_MIN)) + '명', ppl(be(FIXED_MAX)) + '명']);
const r4own = push(['(참고) 사장 직접 운영 시', 260000, '주4일(금~월)·알바 0·통근비 포함 — 오픈~2027-02 체제']);
const r4hon = push(['(참고) 본점 손익분기', 518000, '야칭 30만·마케팅 5만·알바 17일 기본 — 고베 알바 체제가 약 ' + Math.round((518000 - be(FIXED_MIN)) / 10000) + '만엔 낮음']);
blank();

const iSec5 = push(['■ 매출별 월 순수익 (세전) · 초기비용 회수']);
const h5 = push(['월 매출', '하루 평균 인원', '순수익 — 알바 기본(4h)', '순수익 — 알바 최대(6h)', '초기 118.8만 회수 (기본)']);
const refStart = rows.length;
for (const R of [300000, 400000, 450000, 500000, 600000, 700000, 800000, 900000, 1000000])
  push([R, ppl(R) + '명', net(R, FIXED_MIN), net(R, FIXED_MAX), payback(net(R, FIXED_MIN))]);
const refEnd = rows.length;
blank();

const iSec6 = push(['■ 페이즈 플랜 · 체크리스트 (상담분 이전)']);
const h6 = push(['항목', '내용']);
const k1 = push(['오픈~2027-02', '사장 직접 운영(알바 0) · 금토일 3일 시작 → 예약 보며 월요일 추가 (손익분기 약 26만)']);
const k2 = push(['2026-11', '알바 공고 게시(타운워크) — 1~2월 채용 리드타임 확보']);
const k3 = push(['2027-03~', '알바 전환 → 이 탭의 주6일 체제 수치 적용 · 근태봇/시프트 크론 고베 복제']);
const k4 = push(['알바 주6일 체제', '1명 단독이면 병결 시 휴업 — 2명 채용해 분할 권장 (본점과 동일 근태봇으로 관리)']);
const k5 = push(['신청 전 확인', '프리렌트 희망 개월 수 명기 · A간판 설치 위치 실물 확인(1층 노출이 핵심) · 음식 제공 범위 보건소 사전 상담']);
const k6 = push(['계약 조건', '해약 예고 기간 · 원상회복 범위 · 화재보험 견적 확인']);
blank();
const iN = push(['※ 조건 바꿔 계산은 「2호점 시뮬레이션」 탭 (야칭+공과금 182,500 · 주6일 입력) · 이 탭은 senba-kobe2.js 로 재생성']);

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const olds = meta.data.sheets.filter(s => s.properties.title.startsWith(TAB));
  const reqs0 = olds.map(o => ({ deleteSheet: { sheetId: o.properties.sheetId } }));
  reqs0.push({ addSheet: { properties: { title: TAB, index: meta.data.sheets.length - olds.length, gridProperties: { rowCount: rows.length + 5, columnCount: NCOL } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = created.data.replies[olds.length].addSheet.properties.sheetId;

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
  for (const i of [iSec1, iSec2, iSec3, iSec4, iSec5, iSec6]) {
    R.push({ mergeCells: { range: range(i, i + 1), mergeType: 'MERGE_ALL' } });
    cellFmt(range(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  }
  // 물건 개요
  cellFmt(range(h1, h1 + 1, 0, 5), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)');
  cellFmt(range(o1, o6 + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(o1, o6 + 1, 3, 4), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(o1, o6 + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'LEFT', wrapStrategy: 'WRAP', textFormat: { fontSize: 9 } }, 'userEnteredFormat(numberFormat,horizontalAlignment,wrapStrategy,textFormat)');
  cellFmt(range(o1, o6 + 1, 4, 5), { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'LEFT', wrapStrategy: 'WRAP', textFormat: { fontSize: 9 } }, 'userEnteredFormat(numberFormat,horizontalAlignment,wrapStrategy,textFormat)');
  R.push({ updateBorders: { range: range(h1, o6 + 1, 0, 5), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  // 전제
  cellFmt(range(p1, p4 + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(p1, p4 + 1, 3, 4), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(p1, p4 + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '#,##0.######' }, horizontalAlignment: 'LEFT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  for (const i of [p1, p2]) R.push({ mergeCells: { range: range(i, i + 1, 1, NCOL), mergeType: 'MERGE_ALL' } });
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
  table(h3, 4, 3, { totalRow: t3 });
  table(h4, 5, 3);
  cellFmt(range(r4ppl, r4ppl + 1, 1, 3), { horizontalAlignment: 'RIGHT', textFormat: { bold: true } }, 'userEnteredFormat(horizontalAlignment,textFormat.bold)');
  cellFmt(range(h4 + 1, h4 + 2, 0, 3), { backgroundColor: C.gold, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
  for (const rr of [r4own, r4hon]) cellFmt(range(rr, rr + 1, 2, 3), { numberFormat: { type: 'TEXT' }, horizontalAlignment: 'LEFT', textFormat: { fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat)');
  table(h5, refEnd - refStart, 5);
  cellFmt(range(refStart, refEnd, 1, 2), { horizontalAlignment: 'RIGHT' }, 'userEnteredFormat.horizontalAlignment');
  cellFmt(range(refStart, refEnd, 4, 5), { numberFormat: { type: 'TEXT' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  table(h6, 6, 2, { numFrom: 2 });
  cellFmt(range(h6 + 1, h6 + 7, 1, 2), { wrapStrategy: 'WRAP', textFormat: { fontSize: 9 } }, 'userEnteredFormat(wrapStrategy,textFormat)');
  R.push({ mergeCells: { range: range(iN, iN + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iN, iN + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 330 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 2, endIndex: 5 }, properties: { pixelSize: 170 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  console.log('[고베 2호점 탭 완료] 고정비 기본', yen(FIXED_MIN), '최대', yen(FIXED_MAX),
    '| 손익분기 기본', yen(be(FIXED_MIN)), '(' + ppl(be(FIXED_MIN)) + '명/일)',
    '최대', yen(be(FIXED_MAX)), '(' + ppl(be(FIXED_MAX)) + '명/일)');
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
