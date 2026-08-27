// 센바미술관 9~12월 필요매출 계산 → 자산현황 시트 새 탭 업로드
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '센바 9-12월 수익계산';

// ── 전제값 (dashboard profitOf 공식과 동일) ─────────────────────
const FIXED = 300000;          // 야칭·공과금
const MARKETING = 34500;       // 마케팅
const PAPER = 180, BOX = 85;   // 1인당 종이·박스
const MISC = 0.04;             // 잡재료 매출 4%
const TICKET = 3300;           // 객단가 (8월 실측 3,279)
const MARGIN = 1 - MISC - (PAPER + BOX) / TICKET; // 0.879697
const COMMUTE_RT = 860;        // 왕복: 한큐 石橋阪大前→大阪梅田 240 + 메트로 梅田→本町 190, ×2

// 월별: 알바 근무일(금토일월), 알바비 max(6h)/기본(4h), 사장 수·목 출근일
const MONTHS = [
  { name: '9월',  albaDays: 16, wedThu: 9 },
  { name: '10월', albaDays: 18, wedThu: 9 },
  { name: '11월', albaDays: 18, wedThu: 8 },
  { name: '12월', albaDays: 16, wedThu: 10 },
];
for (const m of MONTHS) {
  m.albaMax = m.albaDays * 7200;   // 12:30-18:30 6h
  m.albaMin = m.albaDays * 4800;   // 13:30-17:30 4h
  m.commute = m.wedThu * COMMUTE_RT;
}

// 순수익 T를 만들기 위한 필요매출: R = (T + FIXED + MARKETING + 알바 + 통근) / MARGIN
const need = (T, alba, commute) => Math.ceil((T + FIXED + MARKETING + alba + commute) / MARGIN / 1000) * 1000;
// 매출 R일 때 순수익
const net = (R, alba, commute) => Math.round(R * MARGIN - FIXED - MARKETING - alba - commute);

const yen = n => n.toLocaleString('ja-JP');

// ── 시트 데이터 구성 ────────────────────────────────────────────
const rows = [];
rows.push(['센바미술관 2026년 9~12월 필요매출 계산 (알바비·통근비 반영)']);
rows.push([`작성: 2026-08-22 / 공식: 순수익 = 매출×${MARGIN.toFixed(6)} − 334,500 − 알바비 − 통근비`]);
rows.push([]);
rows.push(['■ 전제']);
rows.push(['고정비(야칭·공과금)', yen(FIXED), '', '마케팅비', yen(MARKETING)]);
rows.push(['종이 180/인 + 박스 85/인', '객단가 3,300엔 기준 (8월 실측 3,279)', '', '잡재료', '매출의 4%']);
rows.push(['마진율', MARGIN.toFixed(6), '', '알바 시급', '1,200엔 (기본 4h=4,800/일, 최대 6h=7,200/일)']);
rows.push(['통근(수·목 출근)', '한큐 石橋阪大前→大阪梅田 240 + 미도스지선 梅田→本町 190 = 편도 430, 왕복 860엔/일']);
rows.push([]);

rows.push(['■ 월별 비용 (알바 금토일월 / 사장 수·목)']);
rows.push(['월', '알바 근무일', '알바비(기본 4h)', '알바비(최대 6h)', '수·목 출근일', '통근비']);
for (const m of MONTHS) {
  rows.push([m.name, m.albaDays, yen(m.albaMin), yen(m.albaMax), m.wedThu, yen(m.commute)]);
}
const totMin = MONTHS.reduce((s,m)=>s+m.albaMin,0), totMax = MONTHS.reduce((s,m)=>s+m.albaMax,0);
const totCom = MONTHS.reduce((s,m)=>s+m.commute,0);
rows.push(['합계', MONTHS.reduce((s,m)=>s+m.albaDays,0), yen(totMin), yen(totMax), MONTHS.reduce((s,m)=>s+m.wedThu,0), yen(totCom)]);
rows.push([]);

for (const [label, key] of [['알바 최대 근무(매일 6h) 기준', 'albaMax'], ['알바 기본 근무(매일 4h) 기준', 'albaMin']]) {
  rows.push([`■ 필요매출 — ${label} + 통근비 포함`]);
  rows.push(['월', '순수익 10만엔', '순수익 15만엔', '순수익 20만엔']);
  for (const m of MONTHS) {
    rows.push([m.name, yen(need(100000, m[key], m.commute)), yen(need(150000, m[key], m.commute)), yen(need(200000, m[key], m.commute))]);
  }
  rows.push([]);
}

rows.push(['■ 조견표 — 매출별 예상 순수익 (알바 기본 4h / 최대 6h, 통근비 포함)']);
rows.push(['매출', ...MONTHS.flatMap(m => [`${m.name} 기본`, `${m.name} 최대`])]);
for (let R = 500000; R <= 900000; R += 50000) {
  rows.push([yen(R), ...MONTHS.flatMap(m => [yen(net(R, m.albaMin, m.commute)), yen(net(R, m.albaMax, m.commute))])]);
}
rows.push([]);
rows.push(['참고: 8월 실적 — 확정매출 104.4만 / 월말예상 134.95만 / 예상순수익 85.2만 (알바비·통근비 차감 전 기준)']);
rows.push(['주의: 알바 최대치는 모든 근무일 12:30~18:30 근무 가정의 상한. 실제는 기본~최대 사이.']);

// 콘솔 미리보기
for (const r of rows) console.log(r.join(' | '));

// ── 업로드 ──────────────────────────────────────────────────────
(async () => {
  const auth = new google.auth.GoogleAuth({
    keyFile: '/opt/senba-sales-sync/service-account.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  let tab = meta.data.sheets.find(s => s.properties.title === TAB);
  if (!tab) {
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: 80, columnCount: 12 } } } }] },
    });
    tab = { properties: res.data.replies[0].addSheet.properties };
    console.log('\n[탭 생성]', TAB);
  } else {
    await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `'${TAB}'` });
    console.log('\n[기존 탭 클리어]', TAB);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${TAB}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  // 서식: 제목 볼드, 섹션 헤더 볼드
  const sheetId = tab.properties.sheetId;
  const boldRows = rows.map((r, i) => ({ r, i })).filter(x => typeof x.r[0] === 'string' && (x.r[0].startsWith('■') || x.i === 0)).map(x => x.i);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [
      ...boldRows.map(i => ({ repeatCell: {
        range: { sheetId, startRowIndex: i, endRowIndex: i + 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      }})),
      { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } },
    ]},
  });
  console.log('[업로드 완료] https://docs.google.com/spreadsheets/d/' + SHEET_ID);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
