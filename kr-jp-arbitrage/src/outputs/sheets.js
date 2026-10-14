// Google Sheets 기록 — daily_picks / review_queue / config_override
import { google } from 'googleapis';
import { features, info, warn } from '../util.js';

const TABS = ['daily_picks', 'review_queue', 'config_override'];

const PICKS_HEADER = [
  '날짜', '브랜드', '상품명', '색상', '한국가(KRW)', '일본가(JPY)', '환율', '순마진(JPY)', '마진율', '등급', '한국URL', '일본URL', '비고',
];
const REVIEW_HEADER = [
  'master_id', '브랜드', '한국 상품명', '일본 상품명', '한국가(KRW)', '일본가(JPY)', '점수/메모', '한국URL', '일본URL', '한국이미지', '일본이미지',
];

let sheetsClient = null;

async function getClient() {
  if (!features().sheets) return null;
  if (!sheetsClient) {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

// 필요한 탭이 없으면 생성
async function ensureTabs(api, spreadsheetId) {
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const existing = new Set(meta.data.sheets.map((s) => s.properties.title));
  const missing = TABS.filter((t) => !existing.has(t));
  if (missing.length) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
    });
    info(`[sheets] 탭 생성: ${missing.join(', ')}`);
    if (missing.includes('config_override')) {
      await api.spreadsheets.values.update({
        spreadsheetId,
        range: 'config_override!A1:C1',
        valueInputOption: 'RAW',
        requestBody: { values: [['key (costs.json 점 표기 경로)', 'value', '설명']] },
      });
    }
  }
}

async function ensureHeader(api, spreadsheetId, tab, header) {
  const res = await api.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:Z1` });
  if (!res.data.values?.length) {
    await api.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [header] },
    });
  }
}

// 통과 상품을 daily_picks에 추가 (rows: topSnapshots 결과)
export async function appendDailyPicks(rows) {
  const api = await getClient();
  if (!api) {
    warn('[sheets] 비활성화 — daily_picks 기록 생략');
    return false;
  }
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  await ensureTabs(api, spreadsheetId);
  await ensureHeader(api, spreadsheetId, 'daily_picks', PICKS_HEADER);
  if (!rows.length) return true;
  const values = rows.map((r) => [
    r.date,
    r.brand,
    r.kr_name || r.jp_name || '',
    r.kr_color || '',
    r.kr_price_krw,
    r.jp_price_jpy,
    r.fx,
    r.net_margin_jpy,
    `${(r.margin_rate * 100).toFixed(1)}%`,
    r.confidence,
    r.kr_url || '',
    r.jp_url || '',
    r.note || '',
  ]);
  await api.spreadsheets.values.append({
    spreadsheetId,
    range: 'daily_picks!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
  info(`[sheets] daily_picks ${values.length}행 기록`);
  return true;
}

// C등급 검토 대기 목록으로 review_queue 탭 전체 갱신
export async function writeReviewQueue(pendings) {
  const api = await getClient();
  if (!api) return false;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  await ensureTabs(api, spreadsheetId);
  const values = [
    REVIEW_HEADER,
    ...pendings.map((p) => [
      p.id,
      p.brand,
      p.kr_name,
      p.jp_name,
      p.sale_price_krw || p.price_krw,
      p.price_jpy,
      p.note || '',
      p.kr_url,
      p.jp_url,
      p.kr_image || '',
      p.jp_image || '',
    ]),
  ];
  await api.spreadsheets.values.clear({ spreadsheetId, range: 'review_queue!A:Z' });
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: 'review_queue!A1',
    valueInputOption: 'RAW',
    requestBody: { values },
  });
  info(`[sheets] review_queue ${pendings.length}건 갱신`);
  return true;
}

// config_override 탭에서 [key, value] 목록 읽기 (시트에서 요율 조정 — 코드 수정 불필요)
export async function readConfigOverride() {
  const api = await getClient();
  if (!api) return [];
  try {
    const res = await api.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'config_override!A2:B100',
    });
    return (res.data.values || []).filter((r) => r[0] && r[1] !== undefined && r[1] !== '');
  } catch {
    return []; // 탭이 아직 없으면 무시
  }
}
