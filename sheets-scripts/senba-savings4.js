// 「저금 시나리오 v3 (유모차 20만)」 탭 — 본점 + 고베(아이미짱식 알바 1인 체제) + 오사카 유모차 대여 부업, 세금 적립·고베 초기비용까지 반영 (2026-11-27)
// 전제는 현재 실적 기준: 본점 고정비 = 야칭·공과금 30만 + 마케팅 6.5만 + 알바 13만(1인 체제) · 고베 = 「고베 2호점」 탭(2026-11-10 개정)과 동일
// 가계 지출 = 경영 대시보드 생활비(고정 410,489 + 생활예산 150,000) · 시뮬레이터는 드롭다운으로 즉시 재계산(수식)
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '저금 시나리오 v3 (유모차 20만)';
const NCOL = 10;
const LIST_COL = 11;                          // 드롭다운 보조 목록 시작 열(L) — 숨김 처리
const steps = (a, b, d) => Array.from({ length: Math.round((b - a) / d) + 1 }, (_, i) => a + i * d);

const M = 0.834197;                           // 세후 마진율 (소비세 간이 4.55% · 종이·박스 · 잡재료 4% 차감)
const H_FIX = 300000 + 65000 + 130000;        // 본점: 야칭·공과금 + 마케팅(구루나비·메타·인스타·MOGU) + 알바 1인 체제(1,200엔)
const K_BASE = 157500 + 25000 + 20000;        // 고베: 야칭+상점가비 + 공과금(가정) + 마케팅
const K_FIX = { alba: K_BASE + 130000, own: K_BASE + 780 * 22, none: 0 };   // 알바 1인 체제 332,500 · 사장 직접(통근 22일) 219,660 · 미오픈 0
const K_LABEL = { alba: '알바 1인 체제', own: '사장 직접', none: '미오픈' };
const K_INIT = 1188000, K_INIT_M = Math.round(K_INIT / 12);   // 고베 초기비용 → 첫 1년 월할 99,000
const STROLLER = 200000;                      // 오사카 유모차 대여 순수익 (비용 뺀 뒤 손에 남는 돈)
const HOUSE = 410489 + 150000;                // 가계 지출 560,489 (대시보드: 고정 410,489 + 생활예산 150,000)
const TAX = 0.15;                             // 소득세·주민세 적립률 (사업이익+부업 합계에 대해 · 가정)

const hn = S => Math.round(S * M - H_FIX);
const kn = (S, sys) => sys === 'none' ? 0 : Math.round(S * M - K_FIX[sys]);
const calc = (h, k, sys = 'alba', side = STROLLER, tax = TAX) => {
  const H = hn(h), K = kn(k, sys), biz = H + K + side, T = Math.round(Math.max(biz, 0) * tax);
  const save = biz - T - HOUSE;
  return { H, K, side, biz, T, save, saveInit: sys === 'none' ? save : save - K_INIT_M };
};
const be = f => Math.round(f / M);
const man = n => (n / 10000).toFixed(1) + '만';
const yen = n => Math.round(n).toLocaleString('ja-JP');

const LISTS = [   // 시뮬레이터 드롭다운 목록 (순서 = 입력 칸 sIn1~sIn6)
  steps(600000, 1200000, 50000),
  steps(0, 1000000, 50000),
  [K_LABEL.alba, K_LABEL.own, K_LABEL.none],
  [0, 50000, 100000, 150000, 200000, 250000, 300000],
  [0, 0.1, 0.15, 0.2],
  ['첫 1년 월할 포함', '제외(2년차 이후)'],
];
const rows = [];
const push = r => { rows.push(r); return rows.length - 1; };
const blank = () => push([]);

const goal = calc(900000, 700000);
const iTitle = push(['저금 시나리오 v3 — 본점 + 고베 + 유모차 대여 20만']);
const iSub = push([`본점 90만 · 고베 70만 · 유모차 20만이면 사업이익 ${man(goal.biz)} → 세금 적립 ${man(goal.T)} · 생활비 ${man(HOUSE)} 빼고 월 저금 ${man(goal.save)} (고베 초기비용 월할 포함 첫 1년 ${man(goal.saveInit)}) · 2026-11-27`]);
blank();

const iSec1 = push(['■ 전제 (모두 월 기준 · 세전 영업이익 기준)']);
const p1 = push(['본점 순이익', `매출 × ${M} − ${yen(H_FIX)} (야칭·공과금 300,000 + 마케팅 65,000 + 알바 1인 체제 130,000) → 손익분기 약 ${man(be(H_FIX))}`]);
const p2 = push(['고베 순이익', `매출 × ${M} − 고정비 · 알바 1인 체제 ${yen(K_FIX.alba)}(손익분기 ${man(be(K_FIX.alba))}) / 사장 직접 ${yen(K_FIX.own)}(손익분기 ${man(be(K_FIX.own))}) — 「고베 2호점」 탭과 동일`]);
const p3 = push(['유모차 대여', `순수익 ${yen(STROLLER)} 고정 (차량·보관·소모품 등 비용 뺀 뒤 금액으로 입력) — 사장님이 고베에 상주하지 않는 알바 체제 전제`]);
const p4 = push(['세금 적립', `(본점 + 고베 + 유모차) 이익의 ${TAX * 100}% — 소득세·주민세 가정치. 青色申告65만·기초공제·사회보험료공제 반영 시 실효 13~17% 수준 (세무사 확인 권장)`]);
const p5 = push(['가계 지출', `${yen(HOUSE)} = 경영 대시보드 생활비 (고정 410,489: 라쿠텐·메루카리·보험·연금·관리비 등 + 생활예산 150,000)`]);
const p6 = push(['고베 초기비용', `${yen(K_INIT)} (보증금·레이킨·중개·보증회사·첫달 야칭) → 첫 1년은 월 ${yen(K_INIT_M)}씩 갚는다고 보고 별도 열로 표시`]);
const p7 = push(['저금액', '본점 + 고베 + 유모차 − 세금 적립 − 가계 지출 (첫 1년은 고베 초기비용 월할 추가 차감)']);
blank();

const iSim = push(['★ 시뮬레이터 — 노란 칸을 드롭다운으로 골라보세요 (저금액 즉시 재계산)']);
const sIn1 = push(['본점 매출', 900000, '드롭다운: 60만~120만 (5만 단위) · 올해 1~11월 평균 약 99만, 작년 평균 약 91만']);
const sIn2 = push(['고베 매출', 700000, '드롭다운: 0~100만 (5만 단위) · 70만 = 22일 영업 하루 약 9.6명']);
const sIn3 = push(['고베 체제', K_LABEL.alba, '드롭다운: 알바 1인 체제 / 사장 직접 / 미오픈']);
const sIn4 = push(['유모차 순수익', STROLLER, '드롭다운: 0 / 5만 / 10만 / 15만 / 20만 / 25만 / 30만']);
const sIn5 = push(['세금 적립률', TAX, '드롭다운: 0% / 10% / 15% / 20%']);
const sIn6 = push(['고베 초기비용', '첫 1년 월할 포함', '드롭다운: 첫 1년 월할 포함 / 제외(2년차 이후)']);
const sR1 = push(['본점 순이익', '', `= 본점 매출 × ${M} − ${yen(H_FIX)}`]);
const sKf = push(['고베 고정비', '', `체제에 따라 자동 (알바 ${yen(K_FIX.alba)} / 사장 ${yen(K_FIX.own)} / 미오픈 0)`]);
const sR2 = push(['고베 순이익', '', '= 고베 매출 × 0.834197 − 고베 고정비 (미오픈이면 0)']);
const sBiz = push(['사업이익 합계', '', '= 본점 + 고베 + 유모차']);
const sTax = push(['세금 적립', '', '= 사업이익 × 적립률 (적자면 0)']);
const sHouse = push(['가계 지출', -HOUSE, '대시보드 생활비 (고정 + 생활예산)']);
const sInit = push(['고베 초기비용 월할', '', `첫 1년 포함 시 −${yen(K_INIT_M)} (미오픈이면 0)`]);
const sSave = push(['★ 월 저금액', '', '= 사업이익 − 세금 − 가계 지출 − 초기비용 월할']);
const sYear = push(['★ 연간 저금액', '', '= 월 저금액 × 12']);
blank();

const iSec2 = push(['■ 단계별 시나리오 — 유모차 20만 · 세금 15% · 고베 알바 1인 체제']);
const h2 = push(['단계', '본점 매출', '고베 매출', '본점 순이익', '고베 순이익', '유모차', '세금 적립', '가계 지출', '★ 월 저금 (2년차~)', '★ 월 저금 (첫 1년)']);
const SC = [
  ['지금 (고베 미오픈)', 900000, 0, 'none'],
  ['보수 (본점 부진·고베 초기)', 750000, 400000, 'alba'],
  ['고베 오픈 초기', 900000, 400000, 'alba'],
  ['고베 정착', 900000, 550000, 'alba'],
  ['★ 목표 (본90·고70)', 900000, 700000, 'alba'],
  ['낙관', 1000000, 700000, 'alba'],
  ['최상', 1100000, 800000, 'alba'],
  ['(참고) 목표 · 고베 사장 직접', 900000, 700000, 'own'],
];
const scStart = rows.length;
for (const [name, h, k, sys] of SC) { const c = calc(h, k, sys); push([name, h, sys === 'none' ? '미오픈' : k, c.H, c.K, c.side, -c.T, -HOUSE, c.save, c.saveInit]); }
const scEnd = rows.length;
const scNote = push(['※ 사장 직접 운영은 고베 상주라 유모차 20만 병행이 어려움 — 같은 조건이면 알바 체제 + 유모차가 저금이 더 큼 · 세금은 이익이 커질수록 같이 늘어남']);
blank();

const iSec3 = push(['■ 매트릭스 — 월 저금액 (2년차~) · 유모차 20만 · 세금 15% · 고베 알바 1인 체제']);
const KS = [0, 300000, 400000, 500000, 600000, 700000, 800000];
const h3 = push(['본점 ↓ / 고베 →', '미오픈', ...KS.slice(1)]);
const mxStart = rows.length;
for (const h of [700000, 800000, 900000, 1000000, 1100000]) push([h, ...KS.map(k => calc(h, k, k ? 'alba' : 'none').save)]);
const mxEnd = rows.length;
const mxNote = push([`※ 첫 1년은 고베 오픈 칸에서 초기비용 월할 ${yen(K_INIT_M)}를 더 뺌 · 고베 손익분기 ${man(be(K_FIX.alba))} 밑(30만 칸)이면 미오픈보다 저금이 적음`]);
blank();

const iSec4 = push(['■ 유모차 순수익별 — 본점 90만 · 고베 70만 · 세금 15% (2년차~ / 첫 1년)']);
const h4 = push(['유모차 순수익', '사업이익', '세금 적립', '★ 월 저금 (2년차~)', '★ 월 저금 (첫 1년)', '연간 (2년차~)']);
const stStart = rows.length;
for (const s of [0, 100000, 150000, 200000, 300000]) { const c = calc(900000, 700000, 'alba', s); push([s, c.biz, -c.T, c.save, c.saveInit, c.save * 12]); }
const stEnd = rows.length;
blank();

const iSec5 = push(['■ 읽는 법·주의']);
const h5 = push(['항목', '내용']);
const notes = [
  ['결론', `본90·고70·유모차20이면 월 ${man(goal.save)}(연 ${Math.round(goal.save * 12 / 10000)}만) 저금 가능 — 첫 1년은 고베 초기비용 때문에 월 ${man(goal.saveInit)}`],
  ['고베 없이', `지금 상태(본90·유모차20)면 월 ${man(calc(900000, 0, 'none').save)} — 고베 매출이 ${man(be(K_FIX.alba))}을 넘어야 '안 여는 것'보다 나아짐`],
  ['유모차가 핵심', `유모차 0이면 목표 매출에서도 월 ${man(calc(900000, 700000, 'alba', 0).save)} — 유모차 10만마다 저금 약 ${man(100000 * (1 - TAX))}씩 늘어남`],
  ['국민건강보험', '소득 연동이라 이익이 늘면 보험료도 오름 (지금 월 41,000 → 최대 월 4~5만 추가 가능) — 위 세금 15%에는 미포함'],
  ['미반영', '고베 집기·간판·재료 초기 재고 · 차량 교체 · 연말 일시 지출(에어컨·가구 등) · 소비세 본과세 전환(매출 1천만 초과 2년 후)'],
  ['고베 70만의 무게', '22일 영업 하루 약 9.6명 — 본점 비수기(11~1월·6월)는 60만 전후였으니, 고베도 비수기엔 50만 수준을 예상하는 게 안전'],
];
const nStart = rows.length;
for (const n of notes) push(n);
blank();
const iN = push(['※ 전제가 바뀌면 senba-savings4.js 상수만 수정 후 재실행 · 이전 「저금 시나리오 v2 (고베 20만)」 탭은 구전제(알바 4h·주4/6일·생활비 39.9만) 참고용']);

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const old = meta.data.sheets.find(s => s.properties.title === TAB);
  const reqs0 = [];
  if (old) reqs0.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  reqs0.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 5, columnCount: LIST_COL + 6 } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = created.data.replies[old ? 1 : 0].addSheet.properties.sheetId;

  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });
  const maxLen = Math.max(...LISTS.map(l => l.length));
  const listRows = Array.from({ length: maxLen }, (_, i) => LISTS.map(l => l[i] ?? ''));
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${TAB}'!${String.fromCharCode(65 + LIST_COL)}1`, valueInputOption: 'RAW', requestBody: { values: listRows } });
  const F = r => r + 1, B = r => `B${F(r)}`;
  const isNone = `${B(sIn3)}="${K_LABEL.none}"`;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `'${TAB}'!${B(sR1)}`, values: [[`=ROUND(${B(sIn1)}*${M}-${H_FIX},0)`]] },
        { range: `'${TAB}'!${B(sKf)}`, values: [[`=IF(${isNone},0,IF(${B(sIn3)}="${K_LABEL.own}",${K_FIX.own},${K_FIX.alba}))`]] },
        { range: `'${TAB}'!${B(sR2)}`, values: [[`=IF(${isNone},0,ROUND(${B(sIn2)}*${M}-${B(sKf)},0))`]] },
        { range: `'${TAB}'!${B(sBiz)}`, values: [[`=${B(sR1)}+${B(sR2)}+${B(sIn4)}`]] },
        { range: `'${TAB}'!${B(sTax)}`, values: [[`=-ROUND(MAX(${B(sBiz)},0)*${B(sIn5)},0)`]] },
        { range: `'${TAB}'!${B(sInit)}`, values: [[`=IF(OR(${isNone},${B(sIn6)}<>"첫 1년 월할 포함"),0,-${K_INIT_M})`]] },
        { range: `'${TAB}'!${B(sSave)}`, values: [[`=${B(sBiz)}+${B(sTax)}+${B(sHouse)}+${B(sInit)}`]] },
        { range: `'${TAB}'!${B(sYear)}`, values: [[`=${B(sSave)}*12`]] },
      ],
    },
  });

  const C = {
    dark: { red: 0.122, green: 0.286, blue: 0.475 }, hdr: { red: 0.267, green: 0.447, blue: 0.769 },
    sec: { red: 0.851, green: 0.882, blue: 0.949 }, gold: { red: 1, green: 0.898, blue: 0.6 },
    band: { red: 0.955, green: 0.960, blue: 0.975 }, white: { red: 1, green: 1, blue: 1 }, note: { red: 0.45, green: 0.45, blue: 0.45 },
    sim: { red: 1, green: 0.97, blue: 0.85 }, goal: { red: 0.85, green: 0.94, blue: 0.83 },
  };
  const R = [];
  const range = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const cellFmt = (rng, format, fields) => R.push({ repeatCell: { range: rng, cell: { userEnteredFormat: format }, fields } });
  const gb = { style: 'SOLID', color: { red: 0.6, green: 0.6, blue: 0.6 } };
  const ib = { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } };
  const NUM = { numberFormat: { type: 'NUMBER', pattern: '¥#,##0;[Red]-¥#,##0' }, horizontalAlignment: 'RIGHT' };
  const merge = (r0, r1, c0 = 0, c1 = NCOL) => R.push({ mergeCells: { range: range(r0, r1, c0, c1), mergeType: 'MERGE_ALL' } });

  merge(iTitle, iTitle + 1);
  cellFmt(range(iTitle, iTitle + 1), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 13, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: iTitle, endIndex: iTitle + 1 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } });
  merge(iSub, iSub + 1);
  cellFmt(range(iSub, iSub + 1), { backgroundColor: C.goal, textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,wrapStrategy)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: iSub, endIndex: iSub + 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } });
  for (const i of [iSec1, iSim, iSec2, iSec3, iSec4, iSec5]) {
    merge(i, i + 1);
    cellFmt(range(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  }
  cellFmt(range(p1, p7 + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  for (let i = p1; i <= p7; i++) merge(i, i + 1, 1, NCOL);
  cellFmt(range(p1, p7 + 1, 1, NCOL), { wrapStrategy: 'WRAP', textFormat: { fontSize: 9 } }, 'userEnteredFormat(wrapStrategy,textFormat)');

  // 시뮬레이터
  cellFmt(range(sIn1, sYear + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(sIn1, sYear + 1, 1, 2), NUM, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(sIn1, sIn6 + 1, 1, 2), { backgroundColor: C.sim, numberFormat: NUM.numberFormat, horizontalAlignment: 'RIGHT', textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,numberFormat,horizontalAlignment,textFormat.bold)');
  cellFmt(range(sIn5, sIn5 + 1, 1, 2), { numberFormat: { type: 'PERCENT', pattern: '0%' } }, 'userEnteredFormat.numberFormat');
  for (const r of [sIn3, sIn6]) cellFmt(range(r, r + 1, 1, 2), { numberFormat: { type: 'TEXT' } }, 'userEnteredFormat.numberFormat');
  for (const r of [sSave, sYear]) cellFmt(range(r, r + 1, 0, 2), { backgroundColor: C.gold, textFormat: { bold: true, fontSize: 12 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  for (let i = sIn1; i <= sYear; i++) merge(i, i + 1, 2, NCOL);
  cellFmt(range(sIn1, sYear + 1, 2, NCOL), { textFormat: { fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  R.push({ updateBorders: { range: range(sIn1, sYear + 1, 0, 2), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  const COLL = c => String.fromCharCode(65 + c);
  const dd = (row, k) => R.push({ setDataValidation: { range: range(row, row + 1, 1, 2), rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `='${TAB}'!${COLL(LIST_COL + k)}1:${COLL(LIST_COL + k)}${LISTS[k].length}` }] }, strict: true, showCustomUi: true } } });
  LISTS.forEach((_, k) => dd([sIn1, sIn2, sIn3, sIn4, sIn5, sIn6][k], k));
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: LIST_COL, endIndex: LIST_COL + LISTS.length }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });

  const table = (hRow, nData, cols, { numFrom = 1 } = {}) => {
    const d0 = hRow + 1, d1 = hRow + 1 + nData;
    cellFmt(range(hRow, hRow + 1, 0, cols), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)');
    for (let r = d0; r < d1; r += 2) cellFmt(range(r, r + 1, 0, cols), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor');
    cellFmt(range(d0, d1, 0, 1), { textFormat: { bold: true }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat.bold,verticalAlignment,wrapStrategy)');
    cellFmt(range(d0, d1, numFrom, cols), NUM, 'userEnteredFormat(numberFormat,horizontalAlignment)');
    R.push({ updateBorders: { range: range(hRow, d1, 0, cols), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  };
  // 단계별 시나리오 — 저금 두 열 골드, 목표 행 초록
  table(h2, scEnd - scStart, 10);
  cellFmt(range(scStart, scEnd, 8, 10), { backgroundColor: C.gold, textFormat: { bold: true }, numberFormat: NUM.numberFormat, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat.bold,numberFormat,horizontalAlignment)');
  const goalRow = scStart + SC.findIndex(s => s[0].startsWith('★'));
  cellFmt(range(goalRow, goalRow + 1, 0, 8), { backgroundColor: C.goal, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
  cellFmt(range(scStart, scStart + 1, 2, 3), { horizontalAlignment: 'CENTER' }, 'userEnteredFormat.horizontalAlignment');
  merge(scNote, scNote + 1);
  cellFmt(range(scNote, scNote + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat,wrapStrategy)');
  // 매트릭스 — 본90·고70 셀 강조
  table(h3, mxEnd - mxStart, 8, { numFrom: 0 });
  cellFmt(range(h3, h3 + 1, 2, 8), { numberFormat: { type: 'NUMBER', pattern: '¥#,##0' } }, 'userEnteredFormat.numberFormat');
  cellFmt(range(mxStart, mxEnd, 0, 1), { numberFormat: { type: 'NUMBER', pattern: '¥#,##0' }, textFormat: { bold: true } }, 'userEnteredFormat(numberFormat,textFormat.bold)');
  const gr = mxStart + [700000, 800000, 900000, 1000000, 1100000].indexOf(900000), gc = 1 + KS.indexOf(700000);
  cellFmt(range(gr, gr + 1, gc, gc + 1), { backgroundColor: C.goal, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
  merge(mxNote, mxNote + 1);
  cellFmt(range(mxNote, mxNote + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat,wrapStrategy)');
  // 유모차별
  table(h4, stEnd - stStart, 6, { numFrom: 0 });
  cellFmt(range(stStart, stEnd, 3, 5), { backgroundColor: C.gold, textFormat: { bold: true }, numberFormat: NUM.numberFormat, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat.bold,numberFormat,horizontalAlignment)');
  const sr = stStart + [0, 100000, 150000, 200000, 300000].indexOf(STROLLER);
  cellFmt(range(sr, sr + 1, 0, 3), { backgroundColor: C.goal, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
  // 읽는 법
  table(h5, notes.length, 2, { numFrom: 2 });
  for (let i = nStart; i < nStart + notes.length; i++) merge(i, i + 1, 1, NCOL);
  cellFmt(range(nStart, nStart + notes.length, 1, NCOL), { wrapStrategy: 'WRAP', textFormat: { fontSize: 9 } }, 'userEnteredFormat(wrapStrategy,textFormat)');
  merge(iN, iN + 1);
  cellFmt(range(iN, iN + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: NCOL }, properties: { pixelSize: 112 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  console.log(`[저금 시나리오 v3 완료] 목표(본90·고70·유모차20): 사업이익 ${yen(goal.biz)} 세금 ${yen(goal.T)} 저금 ${yen(goal.save)} (첫 1년 ${yen(goal.saveInit)})`);
  for (const [name, h, k, sys] of SC) { const c = calc(h, k, sys); console.log(`${name}: 본 ${yen(c.H)} 고 ${yen(c.K)} 세금 ${yen(c.T)} → 저금 ${yen(c.save)} / 첫 1년 ${yen(c.saveInit)}`); }
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
