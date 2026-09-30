// 자산현황 스프레드시트 로케일을 일본(ja_JP)으로 — 날짜 서식의 요일(ddd)이 (토)→(土)로 표시됨 (2026-09-30)
// 「알바비 계산」 탭 날짜 열 등 ddd 패턴 전부에 적용. 데이터·수식은 변경 없음(표시 언어만).
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ updateSpreadsheetProperties: { properties: { locale: 'ja_JP' }, fields: 'locale' } }] },
  });
  console.log('[로케일 ja_JP 완료] 알바비 계산 탭 날짜가 (土)(日) 식으로 표시됩니다');
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
