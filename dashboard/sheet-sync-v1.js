// biz-dashboard(:3014) 요약 → 자산현황 시트 '경영 대시보드' 탭 동기화
// 화면과 동일 기준: 센바 매출 소비세 4.55% 차감(간이·서비스업), KRW은 defaultRate로 엔 환산
// cron 매시 실행. 수정 시 대시보드 서버(server.js)는 건드리지 않는다.
const fs = require('fs');
const path = require('path');
const { google } = require(path.join(__dirname, 'node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '경영 대시보드';
const KEYFILE = '/opt/senba-sales-sync/service-account.json';
const TAX_PCT = 4.55; // 화면 선택값과 동일 (간이·서비스업)
const DASH_URL = 'http://127.0.0.1:3014';

function dashKey() {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  return (env.match(/^DASH_KEY=(.+)$/m) || [])[1]?.trim();
}

const exTax = v => Math.round((v || 0) * (1 - TAX_PCT / 100));
const yen = n => Math.round(n);

(async () => {
  const res = await fetch(`${DASH_URL}/api/summary?key=${encodeURIComponent(dashKey())}`);
  if (!res.ok) throw new Error(`summary HTTP ${res.status}`);
  const S = await res.json();
  const rate = S.defaultRate || 9.2;
  const toJPY = e => e.cur === 'KRW' ? Math.round((e.amtKRW || 0) / rate) : (e.amt || 0);

  // 수입 (화면 규칙: 센바(main)만 소비세 차감, countable:false는 합계 제외·표시만)
  const incomeRows = [], incomeTotalParts = [];
  for (const inc of S.incomes) {
    const raw = toJPY(inc);
    const jpy = inc.group === 'main' ? exTax(raw) : raw;
    const inTotal = inc.countable !== false;
    incomeRows.push([inc.name, jpy, inc.status + (inc.group === 'main' ? ` · 소비세 ${TAX_PCT}% 차감` : '') + (inTotal ? '' : ' · 합계 제외(표시용)')]);
    if (inTotal) incomeTotalParts.push(jpy);
  }
  const incomeTotal = incomeTotalParts.reduce((s, v) => s + v, 0);

  // 사업지출 (실지출 그대로, KRW만 환산)
  const expenseRows = S.expenses.map(e => [e.name, toJPY(e), e.status || '']);
  const expenseTotal = expenseRows.reduce((s, r) => s + r[1], 0);

  // 생활비
  const hh = S.household || {};
  const hhFixed = hh.fixed?.amt || 0, hhVar = hh.variable?.amt || 0;
  const livingTotal = hhFixed + hhVar;
  const leftover = incomeTotal - expenseTotal - livingTotal;

  // 本業 예상 (센바만): 예상수입 = 월말예상 세후, 예상지출 = side 아닌 JPY 지출
  const forecast = S.incomes.find(i => i.group === 'main' && Array.isArray(i.range)) || S.incomes.find(i => i.group === 'main' && i.countable !== false);
  const senbaExpense = S.expenses.filter(e => e.group !== 'side' && e.cur !== 'KRW').reduce((s, e) => s + (e.amt || 0), 0);
  const fcNet = forecast ? exTax(forecast.amt) - senbaExpense : null;
  const fcLow = forecast?.range ? exTax(forecast.range[0]) - senbaExpense : null;
  const fcHigh = forecast?.range ? exTax(forecast.range[1]) - senbaExpense : null;
  const confirmed = S.incomes.find(i => i.group === 'main' && i.countable === false);

  const nowJST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);

  // ── 시트 데이터 ──
  const rows = [];
  const push = r => { rows.push(r); return rows.length - 1; };
  const blank = () => push([]);

  const iTitle = push(['帳簿 통합 경영 대시보드 (자동 동기화)']);
  const iSub = push([`기준월 ${S.month} · 갱신 ${nowJST} JST (매시 자동) · 환율 ₩→¥ ${rate} · 소비세 ${TAX_PCT}% 차감 · 원본: http://66.245.217.115:3014/`]);
  blank();
  const iSecFlow = push(['■ 이번 달 돈의 흐름']);
  const iF1 = push(['수입 합계', incomeTotal]);
  const iF2 = push(['(−) 사업지출', expenseTotal]);
  const iF3 = push(['(−) 생활비', livingTotal, `고정 ${hhFixed.toLocaleString('ja-JP')} + 생활예산 ${hhVar.toLocaleString('ja-JP')}`]);
  const iF4 = push(['★ 이번 달 진짜 남는 돈', leftover]);
  blank();
  const iSecSen = push(['■ 本業 — 船場美術館 예상']);
  const senRows = [];
  if (confirmed) senRows.push(push(['확정 매출 (세후)', exTax(confirmed.amt), confirmed.src || '']));
  if (forecast) senRows.push(push(['월말 예상 매출 (세후)', exTax(forecast.amt), forecast.src || '']));
  senRows.push(push(['예상 지출 (센바)', senbaExpense, '야칭·마케팅·종이박스·잡재료']));
  if (fcNet != null) senRows.push(push(['예상 순수익', fcNet, fcLow != null ? `보수 ${fcLow.toLocaleString('ja-JP')} ~ 낙관 ${fcHigh.toLocaleString('ja-JP')}` : '']));
  blank();
  const iSecInc = push(['■ 수입 내역 (엔 환산)']);
  const hInc = push(['항목', '금액', '비고']);
  const incStart = rows.length;
  for (const r of incomeRows) push(r);
  const incEnd = rows.length;
  blank();
  const iSecExp = push(['■ 지출 내역 (엔 환산)']);
  const hExp = push(['항목', '금액', '비고']);
  const expStart = rows.length;
  for (const r of expenseRows) push(r);
  const expEnd = rows.length;
  blank();
  const iSecHH = push(['■ 생활비 내역']);
  const hHH = push(['항목', '금액', '비고']);
  const hhStart = rows.length;
  for (const [n, v] of (hh.fixed?.subs || [])) push([n, v, '고정비']);
  push(['생활 예산 (변동)', hhVar, hh.variable?.src || '']);
  const hhEnd = rows.length;
  blank();
  const iSecSav = push(['■ 저금 잔액']);
  const iSav = push([`${S.savings?.latest?.month || '-'} 기준`, S.savings?.latest?.amount ?? '', 'UFJ 통장 · 월말 직접 입력']);

  // ── 업로드 ──
  const auth = new google.auth.GoogleAuth({ keyFile: KEYFILE, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  let tab = meta.data.sheets.find(s => s.properties.title === TAB);
  if (!tab) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: 100, columnCount: 6 } } } }] },
    });
    tab = { properties: created.data.replies[0].addSheet.properties };
  }
  const sid = tab.properties.sheetId;
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A1:F100` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: rows },
  });

  // 서식 (매 실행 동일 적용 — 멱등)
  const NCOL = 4;
  const C = {
    dark: { red: 0.15, green: 0.15, blue: 0.3 }, sec: { red: 0.851, green: 0.882, blue: 0.949 },
    hdr: { red: 0.267, green: 0.447, blue: 0.769 }, gold: { red: 1, green: 0.898, blue: 0.6 },
    white: { red: 1, green: 1, blue: 1 }, note: { red: 0.45, green: 0.45, blue: 0.45 },
  };
  const R = [];
  const range = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const cellFmt = (rng, format, fields) => R.push({ repeatCell: { range: rng, cell: { userEnteredFormat: format }, fields } });
  // 리셋 후 재서식 (행 구성이 매번 달라질 수 있음)
  cellFmt(range(0, 100, 0, 6), { backgroundColor: C.white, textFormat: { bold: false, fontSize: 10, foregroundColor: { red: 0, green: 0, blue: 0 } } }, 'userEnteredFormat(backgroundColor,textFormat)');
  R.push({ unmergeCells: { range: range(0, 100, 0, 6) } });
  R.push({ mergeCells: { range: range(iTitle, iTitle + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iTitle, iTitle + 1), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 13, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)');
  R.push({ mergeCells: { range: range(iSub, iSub + 1), mergeType: 'MERGE_ALL' } });
  cellFmt(range(iSub, iSub + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(textFormat,horizontalAlignment)');
  for (const i of [iSecFlow, iSecSen, iSecInc, iSecExp, iSecHH, iSecSav]) {
    R.push({ mergeCells: { range: range(i, i + 1), mergeType: 'MERGE_ALL' } });
    cellFmt(range(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  }
  const NUM = { numberFormat: { type: 'NUMBER', pattern: '¥#,##0;[Red]-¥#,##0' }, horizontalAlignment: 'RIGHT' };
  for (const [a, b] of [[iF1, iF4 + 1], [senRows[0], senRows[senRows.length - 1] + 1], [incStart, incEnd], [expStart, expEnd], [hhStart, hhEnd], [iSav, iSav + 1]])
    cellFmt(range(a, b, 1, 2), NUM, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  cellFmt(range(iF1, iF4 + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(senRows[0], senRows[senRows.length - 1] + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  cellFmt(range(iF4, iF4 + 1, 0, 2), { backgroundColor: C.gold, textFormat: { bold: true, fontSize: 12 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  for (const h of [hInc, hExp, hHH])
    cellFmt(range(h, h + 1, 0, NCOL - 1), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)');
  cellFmt(range(0, rows.length, 2, NCOL), { textFormat: { fontSize: 9, foregroundColor: C.note }, wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat,wrapStrategy)');
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 200 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 420 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  console.log(`[sheet-sync] ${nowJST} OK — 수입 ${incomeTotal.toLocaleString()} 지출 ${expenseTotal.toLocaleString()} 생활비 ${livingTotal.toLocaleString()} 남는돈 ${leftover.toLocaleString()} | 센바 예상순수익 ${fcNet?.toLocaleString()}`);
})().catch(e => { console.error('[sheet-sync] ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
