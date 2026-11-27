// 「저금 시나리오 v3 (유모차 20만)」 탭 — 본점 + 고베(아이미짱식 알바 1인 체제) + 오사카 유모차 대여 부업, 세금 적립·고베 초기비용까지 반영 (2026-11-27)
// v3.1: 가계 지출 항목과 가게 비용을 이 탭 안의 노란 칸으로 두고, 시뮬레이터·시나리오·매트릭스가 모두 그 칸을 수식으로 참조
//       → 금액이 바뀌면 노란 칸만 고치면 탭 전체가 다시 계산됨 (스크립트를 다시 돌리면 아래 초기값으로 덮어써지니 주의)
// 초기값: 가계 = 경영 대시보드 생활비(2026-11) · 본점 = 야칭·공과금 30만 + 마케팅 6.5만 + 알바 13만 · 고베 = 「고베 2호점」 탭(2026-11-10 개정)
// v3.2: 소비세를 간이과세 음식점(제4종, 매출의 약 3.64%)으로 · 소득세·주민세 적립은 별도 선택(기본 0%)
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '저금 시나리오 v3 (유모차 20만)';
const NCOL = 10;
const LIST_COL = 11;                          // 드롭다운 보조 목록 시작 열(L) — 숨김 처리
const steps = (a, b, d) => Array.from({ length: Math.round((b - a) / d) + 1 }, (_, i) => a + i * d);

const HOUSE_ITEMS = [   // 가계 지출 초기값 (경영 대시보드 생활비 내역 2026-11)
  ['라쿠텐 (카드)', 0, '사장님 입력 0 (2026-11-27) — 카드 생활비는 생활예산 안에서 쓴다는 전제. 대시보드 11월 실적 164,356'],
  ['메루카리', 0, '사장님 입력 0 (2026-11-27) — 대시보드 11월 실적 80,460'],
  ['건강보험료', 41000, '소득 연동 — 이익이 늘면 오름'],
  ['관리비', 40900, ''],
  ['맘삐 장학금', 19721, ''],
  ['창삐 연금', 17920, ''],
  ['맘삐 연금', 17920, ''],
  ['도코모', 15562, ''],
  ['리오유치원', 7000, ''],
  ['맘삐 개인보험', 5650, ''],
  ['생활예산 (변동)', 150000, '식비·생활용품 등 매달 정액 예산'],
  ['', '', '← 항목 추가용 빈 칸'],
  ['', '', ''],
  ['', '', ''],
];
const SHOP = {   // 가게 비용 초기값
  margin: 0.879697,                           // 소비세 전 마진율 (종이 180 + 박스 85엔/인 · 잡재료 4% 차감, 객단가 3,300 기준)
  ctax: 0.036364,                             // 소비세 간이과세 제4종(음식점, 간주매입률 60%) = 10/110 × 40% ≈ 3.64% (서비스업 제5종이면 4.55%)
  hRent: 300000, hMkt: 65000, hAlba: 110000,  // 본점: 야칭·공과금 · 마케팅(구루나비·메타·인스타·MOGU) · 알바 1인 체제
  kRent: 157500, kUtil: 25000, kMkt: 20000, kAlba: 130000, kCommute: 780 * 22, kInit: 0,   // 고베
};
const K_LABEL = { alba: '알바 1인 체제', own: '사장 직접', none: '미오픈' };
const LISTS = [   // 시뮬레이터 드롭다운 목록 (순서 = 입력 칸 sIn1~sIn6)
  steps(600000, 1200000, 50000),
  steps(0, 1000000, 50000),
  [K_LABEL.alba, K_LABEL.own, K_LABEL.none],
  [0, 50000, 100000, 150000, 200000, 250000, 300000],
  [0, 0.05, 0.1, 0.15, 0.2],
  ['첫 1년 월할 포함', '제외(2년차 이후)'],
];

const rows = [];
const push = r => { rows.push(r); return rows.length - 1; };
const blank = () => push([]);
const A = r => `$B$${r + 1}`;                 // 같은 탭 B열 절대참조

const iTitle = push(['저금 시나리오 v3 — 본점 + 고베 + 유모차 대여']);
const iSub = push(['']);                      // 요약 (수식 — 맨 아래에서 채움)
const iHow = push(['노란 칸만 고치면 탭 전체가 다시 계산됩니다 — ① 가계 지출 항목 ② 가게 비용 ③ 시뮬레이터 드롭다운']);
blank();

// ① 가계 지출
const iSecH = push(['■ ① 가계 지출 — 항목·금액 직접 수정 (빈 칸에 항목 추가 가능)']);
const hH = push(['항목', '월 금액', '메모']);
const hiStart = rows.length;
for (const [n, v, m] of HOUSE_ITEMS) push([n, v, m]);
const hiEnd = rows.length;
const hTotal = push(['가계 지출 합계', `=SUM(B${hiStart + 1}:B${hiEnd})`, '시뮬레이터·시나리오가 이 합계를 사용']);
blank();

// ② 가게 비용
const iSecS = push(['■ ② 가게 비용 — 금액 직접 수정']);
const hS = push(['항목', '월 금액', '메모']);
const sGross = push(['마진율 (소비세 전)', SHOP.margin, '매출에서 종이 180+박스 85엔/인·잡재료 4%를 뺀 비율']);
const sCtax = push(['소비세 (간이과세)', SHOP.ctax, '음식점 제4종 ≈ 3.64% (매출 대비) — 드로잉 체험이 서비스업 제5종으로 분류되면 4.55%']);
const sMargin = push(['세후 마진율', '', '계산: 마진율 − 소비세 (매출 중 손에 남는 비율)']);
const sHRent = push(['본점 야칭·공과금', SHOP.hRent, '']);
const sHMkt = push(['본점 마케팅', SHOP.hMkt, '구루나비·메타 인증·인스타 홍보·MOGU']);
const sHAlba = push(['본점 알바비', SHOP.hAlba, '아이미짱 1인 체제 — 사장님 입력 110,000 (10월 실측 128,700)']);
const sHFix = push(['본점 고정비 합계', `=${A(sHRent)}+${A(sHMkt)}+${A(sHAlba)}`, '']);
const sHBe = push(['본점 손익분기 매출', '', '계산: 고정비 ÷ 마진율']);
const sKRent = push(['고베 야칭+상점가비', SHOP.kRent, 'ヒライビル 3F 148,500 + 상점가비 9,000']);
const sKUtil = push(['고베 공과금', SHOP.kUtil, '가정치']);
const sKMkt = push(['고베 마케팅', SHOP.kMkt, '']);
const sKAlba = push(['고베 알바비 (1인 체제)', SHOP.kAlba, '본점과 같은 시프트 가정']);
const sKCom = push(['고베 사장 직접 통근비', SHOP.kCommute, '石橋阪大前↔神戸三宮 왕복 780 × 22일']);
const sKFixA = push(['고베 고정비 (알바 1인 체제)', `=${A(sKRent)}+${A(sKUtil)}+${A(sKMkt)}+${A(sKAlba)}`, '']);
const sKFixO = push(['고베 고정비 (사장 직접)', `=${A(sKRent)}+${A(sKUtil)}+${A(sKMkt)}+${A(sKCom)}`, '']);
const sKBe = push(['고베 손익분기 매출 (알바)', '', '계산: 알바 체제 고정비 ÷ 마진율']);
const sKInit = push(['고베 초기비용', SHOP.kInit, '견적 1,188,000 — 이미 지불(자산현황 「고베점 계약」)이라 0으로 입력']);
const sKInitM = push(['고베 초기비용 월할 (첫 1년)', `=ROUND(${A(sKInit)}/12,0)`, '첫 1년 동안 매달 이만큼 갚는다고 보고 차감']);
rows[sMargin][1] = `=${A(sGross)}-${A(sCtax)}`;
rows[sHBe][1] = `=ROUND(${A(sHFix)}/${A(sMargin)},-3)`;
rows[sKBe][1] = `=ROUND(${A(sKFixA)}/${A(sMargin)},-3)`;
blank();

const M = A(sMargin), H_FIX = A(sHFix), K_ALBA = A(sKFixA), K_OWN = A(sKFixO), K_INITM = A(sKInitM), HOUSE = A(hTotal);

// ③ 시뮬레이터
const iSim = push(['★ ③ 시뮬레이터 — 노란 칸을 드롭다운으로 골라보세요 (저금액 즉시 재계산)']);
const sIn1 = push(['본점 매출', 900000, '드롭다운: 60만~120만 (5만 단위) · 올해 1~11월 평균 약 99만, 작년 평균 약 91만']);
const sIn2 = push(['고베 매출', 700000, '드롭다운: 0~100만 (5만 단위) · 70만 = 22일 영업 하루 약 9.6명']);
const sIn3 = push(['고베 체제', K_LABEL.alba, '드롭다운: 알바 1인 체제 / 사장 직접 / 미오픈']);
const sIn4 = push(['유모차 순수익', 200000, '드롭다운: 0~30만 — 차량·보관·소모품 등 비용 뺀 뒤 손에 남는 금액']);
const sIn5 = push(['소득세·주민세 적립률', 0, '드롭다운: 0% / 5% / 10% / 15% / 20% — 소비세(②)와는 별개. 기본 0% = 다른 탭과 같이 소득세 미반영']);
const sIn6 = push(['고베 초기비용', '첫 1년 월할 포함', '드롭다운: 첫 1년 월할 포함 / 제외(2년차 이후)']);
const NONE = `${A(sIn3)}="${K_LABEL.none}"`;
const sR1 = push(['본점 순이익', `=ROUND(${A(sIn1)}*${M}-${H_FIX},0)`, '계산: 본점 매출 × 마진율 − 본점 고정비']);
const sKf = push(['고베 고정비', `=IF(${NONE},0,IF(${A(sIn3)}="${K_LABEL.own}",${K_OWN},${K_ALBA}))`, '체제에 따라 ②의 고베 고정비 (미오픈이면 0)']);
const sR2 = push(['고베 순이익', '', '계산: 고베 매출 × 마진율 − 고베 고정비 (미오픈이면 0)']);
const sBiz = push(['사업이익 합계', '', '계산: 본점 + 고베 + 유모차']);
const sTax = push(['소득세·주민세 적립', '', '계산: 사업이익 × 적립률 (적자면 0)']);
const sHouse = push(['가계 지출', `=-${HOUSE}`, '① 가계 지출 합계']);
const sInit = push(['고베 초기비용 월할', `=IF(OR(${NONE},${A(sIn6)}<>"첫 1년 월할 포함"),0,-${K_INITM})`, '첫 1년 포함 시 ②의 월할 금액 (미오픈이면 0)']);
const sSave = push(['★ 월 저금액', '', '계산: 사업이익 − 세금 − 가계 지출 − 초기비용 월할']);
const sYear = push(['★ 연간 저금액', '', '계산: 월 저금액 × 12']);
rows[sR2][1] = `=IF(${NONE},0,ROUND(${A(sIn2)}*${M}-${A(sKf)},0))`;
rows[sBiz][1] = `=${A(sR1)}+${A(sR2)}+${A(sIn4)}`;
rows[sTax][1] = `=-ROUND(MAX(${A(sBiz)},0)*${A(sIn5)},0)`;
rows[sSave][1] = `=${A(sBiz)}+${A(sTax)}+${A(sHouse)}+${A(sInit)}`;
rows[sYear][1] = `=${A(sSave)}*12`;
blank();

const STROLLER = A(sIn4), TAX = A(sIn5);

// 단계별 시나리오 (유모차·세금률은 시뮬레이터 값)
const iSec2 = push(['■ 단계별 시나리오 — 유모차·소득세 적립률은 시뮬레이터 값 사용 · 고베 알바 1인 체제']);
const h2 = push(['단계', '본점 매출', '고베 매출', '본점 순이익', '고베 순이익', '유모차', '소득세 적립', '가계 지출', '★ 월 저금 (2년차~)', '★ 월 저금 (첫 1년)']);
const SC = [
  ['지금 (고베 미오픈)', 900000, K_LABEL.none, 'alba'],
  ['보수 (본점 부진·고베 초기)', 750000, 400000, 'alba'],
  ['고베 오픈 초기', 900000, 400000, 'alba'],
  ['고베 정착', 900000, 550000, 'alba'],
  ['★ 목표 (본90·고70)', 900000, 700000, 'alba'],
  ['낙관', 1000000, 700000, 'alba'],
  ['최상', 1100000, 800000, 'alba'],
  ['(참고) 목표 · 고베 사장 직접', 900000, 700000, 'own'],
];
const scStart = rows.length;
for (const [name, h, k, sys] of SC) {
  const n = rows.length + 1, KF = sys === 'own' ? K_OWN : K_ALBA;
  push([name, h, k,
    `=ROUND(B${n}*${M}-${H_FIX},0)`,
    `=IF(C${n}="${K_LABEL.none}",0,ROUND(C${n}*${M}-${KF},0))`,
    `=${STROLLER}`,
    `=-ROUND(MAX(D${n}+E${n}+F${n},0)*${TAX},0)`,
    `=-${HOUSE}`,
    `=SUM(D${n}:H${n})`,
    `=I${n}-IF(C${n}="${K_LABEL.none}",0,${K_INITM})`]);
}
const scEnd = rows.length;
const scNote = push(['※ 사장 직접 운영은 고베 상주라 유모차 병행이 어려움 — 같은 조건이면 알바 체제 + 유모차 쪽이 현실적 · 세금은 이익이 커질수록 같이 늘어남']);
blank();

// 매트릭스
const iSec3 = push(['■ 매트릭스 — 월 저금액 (2년차~) · 유모차·소득세 적립률은 시뮬레이터 값 · 고베 알바 1인 체제']);
const KS = [300000, 400000, 500000, 600000, 700000, 800000];
const HS = [700000, 800000, 900000, 1000000, 1100000];
const h3 = push(['본점 ↓ / 고베 →', K_LABEL.none, ...KS]);
const mxStart = rows.length;
const COLL = c => String.fromCharCode(65 + c);
for (const h of HS) {
  const n = rows.length + 1;
  push([h, ...[K_LABEL.none, ...KS].map((_, i) => {
    const col = `${COLL(i + 1)}$${h3 + 1}`;
    return `=LET(b,ROUND($A${n}*${M}-${H_FIX},0)+IF(${col}="${K_LABEL.none}",0,ROUND(${col}*${M}-${K_ALBA},0))+${STROLLER},b-ROUND(MAX(b,0)*${TAX},0)-${HOUSE})`;
  })]);
}
const mxEnd = rows.length;
const mxNote = push(['※ 첫 1년은 고베 오픈 칸에서 초기비용 월할을 더 뺌 · 고베 매출이 손익분기(②) 밑이면 미오픈보다 저금이 적음']);
blank();

// 유모차 순수익별 (본점·고베는 시뮬레이터 값)
const iSec4 = push(['■ 유모차 순수익별 — 본점·고베 매출과 체제·소득세 적립률은 시뮬레이터 값 사용']);
const h4 = push(['유모차 순수익', '사업이익', '소득세 적립', '★ 월 저금 (2년차~)', '★ 월 저금 (첫 1년)', '연간 (2년차~)']);
const stStart = rows.length;
for (const s of [0, 100000, 150000, 200000, 300000]) {
  const n = rows.length + 1;
  push([s, `=${A(sR1)}+${A(sR2)}+A${n}`, `=-ROUND(MAX(B${n},0)*${TAX},0)`, `=B${n}+C${n}-${HOUSE}`, `=D${n}+${A(sInit)}`, `=D${n}*12`]);
}
const stEnd = rows.length;
blank();

const iSec5 = push(['■ 읽는 법·주의']);
const h5 = push(['항목', '내용']);
const notes = [
  ['고치는 법', '금액이 바뀌면 ①·② 노란 칸만 수정 → 시뮬레이터·시나리오·매트릭스가 자동 재계산. 이 탭을 스크립트(senba-savings4.js)로 다시 만들면 초기값으로 돌아가니, 바꾼 금액은 스크립트에도 알려 주세요'],
  ['소비세 vs 소득세', '소비세(②, 매출의 3.64%)는 마진율에 이미 빠져 있음 · 소득세·주민세는 이익에 붙는 별도 세금이라 시뮬레이터 적립률로 따로 선택 (기본 0%) — 이익 월 70만 수준이면 실제로는 월 10만 안팎이 나올 수 있어 연말에 몰아서 나가는 돈으로 대비 필요'],
  ['업종 구분', '간이과세 업종은 매출 내용으로 정해짐 — 드로잉 체험료는 서비스업(제5종 4.55%), 음료·음식 제공분은 음식점(제4종 3.64%)으로 나뉠 수 있음. 세무사에게 확인 후 ②의 소비세 칸만 바꾸면 됨'],
  ['유모차가 핵심', '유모차 순수익 10만이 늘 때마다 저금은 약 (1 − 소득세 적립률) × 10만씩 늘어남'],
  ['고베 손익분기', '고베 매출이 ②의 손익분기 밑이면 고베를 여는 것보다 안 여는 쪽이 저금이 많음 (매트릭스 미오픈 열과 비교)'],
  ['국민건강보험', '소득 연동이라 이익이 늘면 보험료도 오름 — ①의 건강보험료를 올려서 반영'],
  ['미반영', '고베 집기·간판·재료 초기 재고 · 차량 교체 · 연말 일시 지출(에어컨·가구 등) · 소비세 본과세 전환(매출 1천만 초과 2년 후)'],
  ['고베 70만의 무게', '22일 영업 하루 약 9.6명 — 본점 비수기(11~1월·6월)는 60만 전후였으니, 고베도 비수기엔 50만 수준을 예상하는 게 안전'],
];
const nStart = rows.length;
for (const n of notes) push(n);
blank();
const iN = push(['※ 이전 「저금 시나리오 v2 (고베 20만)」 탭은 구전제(알바 4h·주4/6일·생활비 39.9만) 참고용']);

// 요약 줄 (시뮬레이터 결과를 문장으로)
const man = r => `TEXT(${A(r)}/10000,"0.0")&"만"`;
rows[iSub][0] = `="현재 시뮬레이터: 본점 "&TEXT(${A(sIn1)}/10000,"0")&"만 · 고베 "&IF(${NONE},"미오픈",TEXT(${A(sIn2)}/10000,"0")&"만")&" · 유모차 "&TEXT(${A(sIn4)}/10000,"0")&"만 → 사업이익 "&${man(sBiz)}&" · 소득세 적립 "&TEXT(-${A(sTax)}/10000,"0.0")&"만 · 가계 "&TEXT(${HOUSE}/10000,"0.0")&"만 → ★ 월 저금 "&${man(sSave)}&" (연 "&TEXT(${A(sYear)}/10000,"0")&"만)"`;

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const old = meta.data.sheets.find(s => s.properties.title === TAB);
  const reqs0 = [];
  if (old) reqs0.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  reqs0.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 5, columnCount: LIST_COL + LISTS.length } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = created.data.replies[old ? 1 : 0].addSheet.properties.sheetId;

  // 드롭다운 보조 목록 (숫자 그대로) → 본문 (수식 포함, USER_ENTERED)
  const maxLen = Math.max(...LISTS.map(l => l.length));
  const listRows = Array.from({ length: maxLen }, (_, i) => LISTS.map(l => l[i] ?? ''));
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${TAB}'!${COLL(LIST_COL)}1`, valueInputOption: 'RAW', requestBody: { values: listRows } });
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'USER_ENTERED', requestBody: { values: rows } });

  const C = {
    dark: { red: 0.122, green: 0.286, blue: 0.475 }, hdr: { red: 0.267, green: 0.447, blue: 0.769 },
    sec: { red: 0.851, green: 0.882, blue: 0.949 }, gold: { red: 1, green: 0.898, blue: 0.6 },
    band: { red: 0.955, green: 0.960, blue: 0.975 }, white: { red: 1, green: 1, blue: 1 }, note: { red: 0.45, green: 0.45, blue: 0.45 },
    sim: { red: 1, green: 0.97, blue: 0.85 }, goal: { red: 0.85, green: 0.94, blue: 0.83 }, total: { red: 1, green: 0.949, blue: 0.8 },
  };
  const R = [];
  const range = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const cellFmt = (rng, format, fields) => R.push({ repeatCell: { range: rng, cell: { userEnteredFormat: format }, fields } });
  const gb = { style: 'SOLID', color: { red: 0.6, green: 0.6, blue: 0.6 } };
  const ib = { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } };
  const NUM = { numberFormat: { type: 'NUMBER', pattern: '¥#,##0;[Red]-¥#,##0' }, horizontalAlignment: 'RIGHT' };
  const merge = (r0, r1, c0 = 0, c1 = NCOL) => R.push({ mergeCells: { range: range(r0, r1, c0, c1), mergeType: 'MERGE_ALL' } });
  const border = (r0, r1, c0, c1) => R.push({ updateBorders: { range: range(r0, r1, c0, c1), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  const hdr = (r, c1) => cellFmt(range(r, r + 1, 0, c1), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)');
  const yellow = (r0, r1) => cellFmt(range(r0, r1, 1, 2), { backgroundColor: C.sim, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');

  merge(iTitle, iTitle + 1);
  cellFmt(range(iTitle, iTitle + 1), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 13, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: iTitle, endIndex: iTitle + 1 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } });
  merge(iSub, iSub + 1);
  cellFmt(range(iSub, iSub + 1), { backgroundColor: C.goal, textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: iSub, endIndex: iSub + 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } });
  merge(iHow, iHow + 1);
  cellFmt(range(iHow, iHow + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(textFormat,horizontalAlignment)');
  for (const i of [iSecH, iSecS, iSim, iSec2, iSec3, iSec4, iSec5]) {
    merge(i, i + 1);
    cellFmt(range(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  }

  // ① 가계 지출 / ② 가게 비용 — 항목·금액·메모 3열 표, 금액 노란 칸, 합계 행 강조
  const costTable = (hRow, d0, d1, inputRows, totalRows) => {
    hdr(hRow, 3);
    for (let r = hRow + 1; r < d1; r++) merge(r, r + 1, 2, NCOL);
    cellFmt(range(d0, d1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
    cellFmt(range(d0, d1, 1, 2), NUM, 'userEnteredFormat(numberFormat,horizontalAlignment)');
    cellFmt(range(d0, d1, 2, NCOL), { textFormat: { fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
    for (const [a, b] of inputRows) yellow(a, b);
    for (const r of totalRows) cellFmt(range(r, r + 1, 0, 2), { backgroundColor: C.total, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
    border(hRow, d1, 0, 3);
  };
  costTable(hH, hiStart, hTotal + 1, [[hiStart, hiEnd]], [hTotal]);
  cellFmt(range(hiStart, hiEnd, 0, 1), { backgroundColor: C.sim }, 'userEnteredFormat.backgroundColor');   // 항목명도 수정 가능
  cellFmt(range(hTotal, hTotal + 1, 0, 2), { backgroundColor: C.gold, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  costTable(hS, sGross, sKInitM + 1, [[sGross, sMargin], [sHRent, sHFix], [sKRent, sKFixA], [sKInit, sKInit + 1]], [sMargin, sHFix, sHBe, sKFixA, sKFixO, sKBe, sKInitM]);
  for (const r of [sGross, sMargin]) cellFmt(range(r, r + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '0.0000' } }, 'userEnteredFormat.numberFormat');
  cellFmt(range(sCtax, sCtax + 1, 1, 2), { numberFormat: { type: 'PERCENT', pattern: '0.00%' } }, 'userEnteredFormat.numberFormat');

  // ③ 시뮬레이터
  cellFmt(range(sIn1, sYear + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(sIn1, sYear + 1, 1, 2), NUM, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  yellow(sIn1, sIn6 + 1);
  cellFmt(range(sIn5, sIn5 + 1, 1, 2), { numberFormat: { type: 'PERCENT', pattern: '0%' } }, 'userEnteredFormat.numberFormat');
  for (const r of [sIn3, sIn6]) cellFmt(range(r, r + 1, 1, 2), { numberFormat: { type: 'TEXT' } }, 'userEnteredFormat.numberFormat');
  for (const r of [sSave, sYear]) cellFmt(range(r, r + 1, 0, 2), { backgroundColor: C.gold, textFormat: { bold: true, fontSize: 12 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  for (let i = sIn1; i <= sYear; i++) merge(i, i + 1, 2, NCOL);
  cellFmt(range(sIn1, sYear + 1, 2, NCOL), { textFormat: { fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  border(sIn1, sYear + 1, 0, 2);
  const dd = (row, k) => R.push({ setDataValidation: { range: range(row, row + 1, 1, 2), rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `='${TAB}'!${COLL(LIST_COL + k)}1:${COLL(LIST_COL + k)}${LISTS[k].length}` }] }, strict: true, showCustomUi: true } } });
  [sIn1, sIn2, sIn3, sIn4, sIn5, sIn6].forEach((r, k) => dd(r, k));
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: LIST_COL, endIndex: LIST_COL + LISTS.length }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });

  const table = (hRow, nData, cols, { numFrom = 1 } = {}) => {
    const d0 = hRow + 1, d1 = hRow + 1 + nData;
    hdr(hRow, cols);
    for (let r = d0; r < d1; r += 2) cellFmt(range(r, r + 1, 0, cols), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor');
    cellFmt(range(d0, d1, 0, 1), { textFormat: { bold: true }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat.bold,verticalAlignment,wrapStrategy)');
    cellFmt(range(d0, d1, numFrom, cols), NUM, 'userEnteredFormat(numberFormat,horizontalAlignment)');
    border(hRow, d1, 0, cols);
  };
  // 단계별 시나리오 — 매출 칸은 노란색(수정 가능), 저금 두 열 골드, 목표 행 초록
  table(h2, scEnd - scStart, 10);
  cellFmt(range(scStart, scEnd, 1, 3), { backgroundColor: C.sim }, 'userEnteredFormat.backgroundColor');
  cellFmt(range(scStart, scEnd, 8, 10), { backgroundColor: C.gold, textFormat: { bold: true }, numberFormat: NUM.numberFormat, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat.bold,numberFormat,horizontalAlignment)');
  const goalRow = scStart + SC.findIndex(s => s[0].startsWith('★'));
  cellFmt(range(goalRow, goalRow + 1, 0, 1), { backgroundColor: C.goal }, 'userEnteredFormat.backgroundColor');
  cellFmt(range(goalRow, goalRow + 1, 3, 8), { backgroundColor: C.goal, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
  merge(scNote, scNote + 1);
  cellFmt(range(scNote, scNote + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat,wrapStrategy)');
  // 매트릭스 — 본90·고70 셀 강조
  table(h3, mxEnd - mxStart, 8, { numFrom: 0 });
  cellFmt(range(h3, h3 + 1, 2, 8), { numberFormat: { type: 'NUMBER', pattern: '¥#,##0' } }, 'userEnteredFormat.numberFormat');
  cellFmt(range(mxStart, mxEnd, 0, 1), { numberFormat: { type: 'NUMBER', pattern: '¥#,##0' }, textFormat: { bold: true } }, 'userEnteredFormat(numberFormat,textFormat.bold)');
  const gr = mxStart + HS.indexOf(900000), gc = 2 + KS.indexOf(700000);
  cellFmt(range(gr, gr + 1, gc, gc + 1), { backgroundColor: C.goal, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
  merge(mxNote, mxNote + 1);
  cellFmt(range(mxNote, mxNote + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat,wrapStrategy)');
  // 유모차별
  table(h4, stEnd - stStart, 6, { numFrom: 0 });
  cellFmt(range(stStart, stEnd, 3, 5), { backgroundColor: C.gold, textFormat: { bold: true }, numberFormat: NUM.numberFormat, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat.bold,numberFormat,horizontalAlignment)');
  // 읽는 법
  table(h5, notes.length, 2, { numFrom: 2 });
  for (let i = nStart; i < nStart + notes.length; i++) merge(i, i + 1, 1, NCOL);
  cellFmt(range(nStart, nStart + notes.length, 1, NCOL), { wrapStrategy: 'WRAP', textFormat: { fontSize: 9 } }, 'userEnteredFormat(wrapStrategy,textFormat)');
  merge(iN, iN + 1);
  cellFmt(range(iN, iN + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 200 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: NCOL }, properties: { pixelSize: 112 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  // 계산 결과 확인용 출력
  const v = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A${iSub + 1}:B${sYear + 1}` });
  const vals = v.data.values || [];
  console.log(`[저금 시나리오 v3.1 완료] ${vals[0]?.[0] || ''}`);
  console.log(`가계 지출 합계 ${vals[hTotal - iSub]?.[1]} · 본점 고정비 ${vals[sHFix - iSub]?.[1]} · 고베 고정비(알바) ${vals[sKFixA - iSub]?.[1]} · 월 저금 ${vals[sSave - iSub]?.[1]}`);
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
