// 「저금 시나리오 v3 (유모차 20만)」 탭 메모 칸 #ERROR! 수정 (2026-11-27)
// '= ...' 로 시작하는 설명 문구가 수식으로 해석된 9칸만 RAW 텍스트로 다시 씀 — 사장님이 고친 노란 칸(①·②·③)은 건드리지 않음
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '저금 시나리오 v3 (유모차 20만)';
const FIX = {   // 셀 → [A열에 있어야 할 라벨, 새 메모]
  C27: ['세후 마진율', '계산: 마진율 − 소비세 (매출 중 손에 남는 비율)'],
  C32: ['본점 손익분기 매출', '계산: 고정비 ÷ 마진율'],
  C40: ['고베 손익분기 매출 (알바)', '계산: 알바 체제 고정비 ÷ 마진율'],
  C51: ['본점 순이익', '계산: 본점 매출 × 마진율 − 본점 고정비'],
  C53: ['고베 순이익', '계산: 고베 매출 × 마진율 − 고베 고정비 (미오픈이면 0)'],
  C54: ['사업이익 합계', '계산: 본점 + 고베 + 유모차'],
  C55: ['소득세·주민세 적립', '계산: 사업이익 × 적립률 (적자면 0)'],
  C58: ['★ 월 저금액', '계산: 사업이익 − 소득세 적립 − 가계 지출 − 초기비용 월할'],
  C59: ['★ 연간 저금액', '계산: 월 저금액 × 12'],
};

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  // 행이 밀려 있으면 엉뚱한 칸을 덮어쓰지 않도록 A열 라벨을 먼저 확인
  const labels = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A1:A80` });
  const col = (labels.data.values || []).map(r => r[0] || '');
  const data = [], skipped = [];
  for (const [cell, [label, memo]] of Object.entries(FIX)) {
    const row = Number(cell.slice(1));
    if (col[row - 1] === label) data.push({ range: `'${TAB}'!${cell}`, values: [[memo]] });
    else skipped.push(`${cell}(A열 '${col[row - 1]}' ≠ '${label}')`);
  }
  if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: 'RAW', data } });
  console.log(`[메모 수정 완료] ${data.length}칸${skipped.length ? ' · 건너뜀: ' + skipped.join(', ') : ''}`);
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
