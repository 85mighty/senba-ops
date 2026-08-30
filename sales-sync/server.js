/**
 * senba-sales-sync v16 — 예약 페이스 예측(구루나비 메일 3년치 학습) + /forecast?month= 월별 조회
 * v14 — 예측 3중할인 버그 수정(추세만 0.85~1.10 적용), 공휴일=일요일급 처리 — 포장박스 비용(개당 ¥85), 종이 ¥180, 잡재료 4%
 * 船場美術館 예약 → 매출관리 스프레드시트 실시간 동기화
 *
 * 경로 1: senbaartstudio@gmail.com IMAP IDLE → 구루나비(plan-reserve@gnavi.co.jp) 알림 파싱
 * 경로 2: 텔레그램 봇 자유 텍스트 → 전화/인스타DM 예약 수동 입력
 *
 * upsert 기준: 예약번호 (구루나비 PL..., 수동은 M+timestamp 자동 생성)
 * v10: 텔레그램 /예측 — 요일평균 × 추세 × 계절성 기반 당월 매출 예측
 * v11: /예측에 예상 수익(고정비·종이·잡재료·마케팅 차감) 블록 추가
 * v12: GET /forecast (JSON API, biz-dashboard:3014용) + 텔레그램 /수입·/수입취소 (수동수익 탭)
 * v15: GET /forecast?month=YYYY-MM — 과거 달은 시트 확정치, 미래 달은 예약합계 (대시보드 월별 조회용)
 * v16: 예약 페이스 예측 — 구루나비 메일 3년치 복원으로 'D일 시점 예약 → 월말' 학습 (MAPE 19.0%→10.4%)
 * v15: 예약 스냅샷 수집기 (state/booked-snapshots.json) — 매일 미래 예약 상태를 적재 (예측 재검증용)
 * PM2: senba-sales-sync / PORT 3013
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { google } = require('googleapis');
const axios = require('axios');
const https = require('https');
const express = require('express');
const fs = require('fs');
const path = require('path');
const PACE = require('./pace-data'); // v16 예약 페이스 예측 (train-pace.js와 공유하는 순수 로직)

// ===== IPv4 강제 (VPS 표준 패턴) =====
const httpsAgent = new https.Agent({ family: 4, keepAlive: true });
const ax = axios.create({ httpsAgent, timeout: 60000 });

// ===== 설정 =====
const CFG = {
  PORT: parseInt(process.env.PORT || '3013', 10),
  AUTH_TOKEN: process.env.AUTH_TOKEN || 'mana2024secret',

  IMAP_USER: process.env.IMAP_USER, // senbaartstudio@gmail.com
  IMAP_PASS: process.env.IMAP_PASS, // Gmail 앱 비밀번호 (16자리)
  MAIL_FROM_FILTER: (process.env.MAIL_FROM_FILTER || 'plan-reserve@gnavi.co.jp').toLowerCase(),

  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  CLAUDE_MODEL: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',

  SPREADSHEET_ID: process.env.SPREADSHEET_ID, // 1sUXyrXxYzl_n6n5T4dV_flQ6Ocli3c0B-Ggbwzw5YC4
  SHEET_TAB: process.env.SHEET_TAB || '예약관리',
  INCOME_TAB: process.env.INCOME_TAB || '수동수익', // v12: 텔레그램 /수입 → 수동 수익 기록 탭
  SERVICE_ACCOUNT_JSON: process.env.SERVICE_ACCOUNT_JSON || '/opt/senba-sales-sync/service-account.json',

  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID, // 알림 수신 + 수동입력 허용 chat

  CALENDAR_ID: process.env.CALENDAR_ID || '', // 예: cch1379@gmail.com (비우면 캘린더 기능 off)

  CANVAS_UNIT_COST: Number(process.env.CANVAS_UNIT_COST || 150), // 캔버스 1장 단가(¥)
  FORECAST_TARGET: Number(process.env.FORECAST_TARGET || 600000), // 월 매출 목표(¥) — /예측 대비율 기준

  // 수익 예측용 비용 (/예측 예상 수익 블록)
  FIXED_COST: Number(process.env.FIXED_COST || 300000),        // 야칭 + 공과금 (월 고정비)
  PAPER_UNIT: Number(process.env.PAPER_UNIT || 180),           // 종이캔버스 1장 단가(¥)
  BOX_UNIT: Number(process.env.BOX_UNIT || 85),                // 포장박스 1개 단가(¥) — 손님당 1개
  MISC_RATE: Number(process.env.MISC_RATE || 0.04),            // 물감 등 잡재료 = 매출의 4%
  MARKETING_COST: Number(process.env.MARKETING_COST || 34500), // 예약사이트 30,000 + 메타인증 4,500
  AVG_TICKET_FALLBACK: Number(process.env.AVG_TICKET_FALLBACK || 3300), // 인원 역산 불가 시 객단가

  // 1인당 코스 요금 [2시간, 3시간] — 인원 역산용
  PRICE_WEEKDAY: [3000, 3500],
  PRICE_WEEKEND: [3500, 4000], // 주말·공휴일
};

const STATE_FILE = path.join(__dirname, 'state', 'processed.json');

// ===== 시트 열 구성 (예약관리 탭 = 원장) =====
const HEADER = [
  '예약번호', '상태', '예약경로', '접수일시', '방문일', '방문시간',
  '인원', '드로잉/동반', '코스', '단가(¥)', '예상매출(¥)',
  '예약자명', '전화번호', '이용목적', '비고', '매트릭스셀', '캘린더ID', '최종갱신'
];
const COL_END = 'R'; // HEADER.length = 18 → A~R
const MATRIX_CELL_COL = 15; // 0-based index of 매트릭스셀 (v3 버그 수정: 16→15)
const CAL_EVENT_COL = 16;   // 0-based index of 캘린더ID

// ===== 상태 저장 (중복 처리 방지) =====
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { processedMsgIds: [] }; }
}
function saveState(st) {
  st.processedMsgIds = st.processedMsgIds.slice(-2000);
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
}
let state = loadState();

// ===== 로그 =====
function log(...args) {
  console.log(`[${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}]`, ...args);
}

// ===== Google Sheets =====
let sheetsApi = null;
let calendarApi = null;
let authClient = null;
async function getAuth() {
  if (authClient) return authClient;
  const auth = new google.auth.GoogleAuth({
    keyFile: CFG.SERVICE_ACCOUNT_JSON,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar',
    ],
  });
  authClient = await auth.getClient();
  return authClient;
}
async function getSheets() {
  if (sheetsApi) return sheetsApi;
  sheetsApi = google.sheets({ version: 'v4', auth: await getAuth() });
  return sheetsApi;
}
async function getCalendar() {
  if (calendarApi) return calendarApi;
  calendarApi = google.calendar({ version: 'v3', auth: await getAuth() });
  return calendarApi;
}

// 탭 없으면 생성 + 헤더 삽입 (기존 탭이면 헤더만 최신화)
async function ensureTab() {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CFG.SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === CFG.SHEET_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CFG.SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: CFG.SHEET_TAB, gridProperties: { frozenRowCount: 1 } } } }] },
    });
    log(`✅ 탭 생성: ${CFG.SHEET_TAB}`);
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: CFG.SPREADSHEET_ID,
    range: `${CFG.SHEET_TAB}!A1:${COL_END}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER] },
  });
}

// 예약번호로 행 찾기 (1-based row index 반환, 없으면 null)
async function findRowByReservationNo(no) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CFG.SPREADSHEET_ID,
    range: `${CFG.SHEET_TAB}!A2:A`,
  });
  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][0] || '').trim() === no) return i + 2;
  }
  return null;
}

function toRowValues(r) {
  return [
    r.reservation_no || '', r.status || '', r.channel || '',
    r.received_at || '', r.visit_date || '', r.visit_time || '',
    r.party_size ?? '', r.drawing_split || '', r.course || '',
    r.unit_price ?? '', r.estimated_total ?? '',
    r.name || '', r.phone || '', r.purpose || '', r.notes || '',
    r.matrix_cell || '', r.cal_event_id || '',
    new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
  ];
}

// 원장에서 기존 매트릭스셀 + 캘린더ID 읽기
async function getExistingRefs(rowIdx) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CFG.SPREADSHEET_ID,
    range: `${CFG.SHEET_TAB}!A${rowIdx}:${COL_END}${rowIdx}`,
  });
  const row = res.data.values?.[0] || [];
  return {
    matrixCell: (row[MATRIX_CELL_COL] || '').trim() || null,
    calEventId: (row[CAL_EVENT_COL] || '').trim() || null,
  };
}

// ===== 월별 매트릭스 탭 (26/7 형식) =====
function monthTabName(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return `${String(y).slice(2)}/${m}`;
}

function colLetter(n) { // 1-based → A, B, ... Z, AA, AB ...
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// 방문일 열의 体験 칸 아래 첫 빈 칸에 금액 입력 → 셀 참조 반환
async function writeToMatrix(r) {
  if (!r.visit_date || r.estimated_total == null || r.estimated_total === 0) return null;
  const tab = monthTabName(r.visit_date);
  const sheets = await getSheets();

  const meta = await sheets.spreadsheets.get({ spreadsheetId: CFG.SPREADSHEET_ID });
  if (!meta.data.sheets.some(s => s.properties.title === tab)) {
    await tgSend(`⚠️ 매트릭스 탭 <b>${tab}</b>이 없어 입력을 건너뜁니다. 탭을 만든 후 시트에 수동 입력해주세요.\n(예약: ${r.visit_date} ${r.name || ''} ¥${r.estimated_total})`);
    return null;
  }

  // 2행에서 날짜 열 찾기 ("7/ 6/ 월" 형식, 병합셀이라 값은 体験 열에만 존재)
  const dateRow = await sheets.spreadsheets.values.get({
    spreadsheetId: CFG.SPREADSHEET_ID,
    range: `${tab}!2:2`,
  });
  const cells = dateRow.data.values?.[0] || [];
  const [, month, day] = r.visit_date.split('-').map(Number);
  let colIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    const m = String(cells[i] || '').match(/(\d+)\s*\/\s*(\d+)/);
    if (m && Number(m[1]) === month && Number(m[2]) === day) { colIdx = i + 1; break; }
  }
  if (colIdx < 0) {
    await tgSend(`⚠️ ${tab} 탭에서 ${month}/${day} 날짜 열을 찾지 못했습니다. 수동 입력 필요.\n(예약: ${r.name || ''} ¥${r.estimated_total})`);
    return null;
  }

  // 5행부터 첫 빈 칸 찾기
  const col = colLetter(colIdx);
  const colVals = await sheets.spreadsheets.values.get({
    spreadsheetId: CFG.SPREADSHEET_ID,
    range: `${tab}!${col}5:${col}100`,
  });
  const arr = colVals.data.values || [];
  let row = 5 + arr.length;
  for (let i = 0; i < arr.length; i++) {
    if (!arr[i] || !String(arr[i][0] ?? '').trim()) { row = 5 + i; break; }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: CFG.SPREADSHEET_ID,
    range: `${tab}!${col}${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[r.estimated_total]] },
  });
  log(`📊 매트릭스 입력: ${tab}!${col}${row} = ${r.estimated_total}`);
  return `${tab}!${col}${row}`;
}

// 취소/변경 시 기존 매트릭스 칸 비우기
async function clearMatrixCell(ref) {
  if (!ref) return;
  try {
    const sheets = await getSheets();
    await sheets.spreadsheets.values.update({
      spreadsheetId: CFG.SPREADSHEET_ID,
      range: ref,
      valueInputOption: 'RAW',
      requestBody: { values: [['']] },
    });
    log(`🧹 매트릭스 칸 비움: ${ref}`);
  } catch (e) {
    log(`⚠️ 매트릭스 칸 비우기 실패 (${ref}):`, e.message);
    await tgSend(`⚠️ 매트릭스 칸 <b>${ref}</b> 비우기 실패 — 수동 확인 필요`);
  }
}

// ===== 구글 캘린더 =====
function courseHours(course) {
  const m = String(course || '').match(/(\d+)\s*(時間|시간|h)/i);
  const h = m ? Number(m[1]) : 2; // 기본 2시간
  return (h >= 1 && h <= 8) ? h : 2;
}

async function createCalEvent(r) {
  if (!CFG.CALENDAR_ID || !r.visit_date || !r.visit_time) return null;
  try {
    const cal = await getCalendar();
    const hours = courseHours(r.course);
    const pad = n => String(n).padStart(2, '0');
    const [sh, sm] = r.visit_time.split(':').map(Number);
    const start = `${r.visit_date}T${pad(sh)}:${pad(sm)}:00`;
    let eh = sh + hours, em = sm;
    if (eh >= 24) { eh = 23; em = 59; } // 자정 넘어가면 당일 23:59로 클램프
    const end = `${r.visit_date}T${pad(eh)}:${pad(em)}:00`;
    const res = await cal.events.insert({
      calendarId: CFG.CALENDAR_ID,
      requestBody: {
        summary: `🎨 ${r.name || '예약'} ${r.party_size ?? '?'}명 (${hours}h)`,
        description: [
          r.reservation_no ? `예약번호: ${r.reservation_no}` : null,
          `경로: ${r.channel || '?'}`,
          r.drawing_split ? `드로잉/동반: ${r.drawing_split}` : null,
          r.phone ? `전화: ${r.phone}` : null,
          r.estimated_total != null ? `예상: ¥${r.estimated_total}` : null,
          r.purpose ? `목적: ${r.purpose}` : null,
          r.notes ? `비고: ${r.notes}` : null,
        ].filter(Boolean).join('\n'),
        start: { dateTime: start, timeZone: 'Asia/Tokyo' },
        end: { dateTime: end, timeZone: 'Asia/Tokyo' },
      },
    });
    log(`📆 캘린더 등록: ${res.data.id}`);
    return res.data.id;
  } catch (e) {
    log('⚠️ 캘린더 등록 실패:', e.message);
    await tgSend(`⚠️ 캘린더 등록 실패: ${e.message}`);
    return null;
  }
}

async function deleteCalEvent(eventId) {
  if (!CFG.CALENDAR_ID || !eventId) return;
  try {
    const cal = await getCalendar();
    await cal.events.delete({ calendarId: CFG.CALENDAR_ID, eventId });
    log(`🗑 캘린더 삭제: ${eventId}`);
  } catch (e) {
    if (e.code !== 404 && e.code !== 410) {
      log('⚠️ 캘린더 삭제 실패:', e.message);
      await tgSend(`⚠️ 캘린더 일정 삭제 실패 — 직접 확인 필요 (${eventId})`);
    }
  }
}

// upsert: 있으면 갱신, 없으면 append
async function upsertReservation(r) {
  const sheets = await getSheets();
  await ensureTab();
  const row = r.reservation_no ? await findRowByReservationNo(r.reservation_no) : null;
  if (row) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: CFG.SPREADSHEET_ID,
      range: `${CFG.SHEET_TAB}!A${row}:${COL_END}${row}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [toRowValues(r)] },
    });
    return { action: 'updated', row };
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId: CFG.SPREADSHEET_ID,
    range: `${CFG.SHEET_TAB}!A:${COL_END}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [toRowValues(r)] },
  });
  return { action: 'appended' };
}

// ===== Claude 파싱 =====
const PARSE_SYSTEM = `あなたは大阪のアート体験カフェ「船場美術館」の予約データ抽出システムです。
入力(ぐるなび予約通知メール、または韓国語の手動予約メモ)から予約情報をJSONで抽出します。
必ず以下のJSONのみを出力してください。説明文・マークダウン禁止。

{
  "reservation_no": "予約番号(PL...)。無ければnull",
  "status": "신규 | 변경 | 취소 のいずれか(韓国語で)。新規予約=신규、変更=변경、キャンセル=취소。手動メモでキャンセルの言及が無ければ신규",
  "channel": "ぐるなび | 전화 | 인스타DM | 기타 のいずれか。メールなら'ぐるなび'、手動メモは内容から判断(不明なら'전화')",
  "visit_date": "YYYY-MM-DD",
  "visit_time": "HH:MM (24h)",
  "party_size": 来店人数(数値),
  "drawing_split": "ドローイング人数/付き添い人数 (例 '2/2')。不明ならnull",
  "course": "コース名を短く。無ければnull",
  "unit_price": 1人あたり料金(数値, 円)。無ければnull,
  "estimated_total": 予想売上(数値, 円)。計算規則: unit_price × ドローイング参加人数(drawing_splitの前の数字)。drawing_splitが不明・未回答の場合は unit_price × party_size で暫定計算し、notesに「드로잉 인원 미응답, 전체 인원 기준 잠정 금액」を含める。計算不能ならnull,
  "name": "予約者名(読み仮名があれば括弧で併記)",
  "phone": "電話番号。無ければnull",
  "purpose": "利用目的。無ければnull",
  "notes": "その他重要事項(持ち込み、質問回答、キャンセル理由など)を必ず韓国語で1行。無ければnull"
}

statusが취소の場合、estimated_totalは0にしてください。
今日の日付: {{TODAY}} (JST)。手動メモの「7/15」等は今日以降の直近の日付として解釈。`;

async function parseWithClaude(text, sourceHint) {
  const sys = PARSE_SYSTEM.replace('{{TODAY}}', new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }));
  const res = await ax.post('https://api.anthropic.com/v1/messages', {
    model: CFG.CLAUDE_MODEL,
    max_tokens: 1024,
    system: sys,
    messages: [{ role: 'user', content: `[입력유형: ${sourceHint}]\n\n${text.slice(0, 8000)}` }],
  }, {
    headers: {
      'x-api-key': CFG.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
  });
  const raw = (res.data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  const clean = raw.replace(/```json|```/g, '').trim();
  const jsonStr = clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1);
  return JSON.parse(jsonStr);
}

// ===== 텔레그램 =====
async function tgSend(text, chatId) {
  if (!CFG.TELEGRAM_BOT_TOKEN) return;
  try {
    await ax.post(`https://api.telegram.org/bot${CFG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId || CFG.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
    });
  } catch (e) {
    log('⚠️ 텔레그램 전송 실패:', e.response?.data?.description || e.message);
  }
}

// 요일 계산 (visit_date → '월'~'일')
function weekdayKo(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00Z'); // 날짜만 UTC 고정으로 계산 (서버 TZ 무관)
    return ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
  } catch { return ''; }
}

// 해당 월 탭의 A4 (월 누적 매출) 읽기
async function getMonthTotal(dateStr) {
  try {
    const tab = monthTabName(dateStr);
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: CFG.SPREADSHEET_ID,
      range: `${tab}!A4`,
    });
    return res.data.values?.[0]?.[0] ?? null;
  } catch { return null; }
}

// ===== 캔버스 지출비 (월 탭 A3) — 体験 금액에서 인원 역산 =====
let jpHolidays = null;
try { jpHolidays = require('japanese-holidays'); }
catch { console.log('⚠️ japanese-holidays 미설치 — 공휴일 판정 없이 주말만 적용 (npm install japanese-holidays)'); }

function isWeekendOrHoliday(y, m, d) {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (wd === 0 || wd === 6) return true;
  if (jpHolidays && jpHolidays.isHoliday(new Date(y, m - 1, d))) return true;
  return false;
}

// 금액 → 인원: 2시간 단가부터 나눠떨어지는지 확인, 안 되면 3시간 단가, 그래도 안 되면 반올림
function inferPeople(amount, units) {
  for (const u of units) if (amount % u === 0) return amount / u;
  return Math.max(1, Math.round(amount / units[0]));
}

async function updateCanvasCostA3(dateStr) {
  try {
    const tab = monthTabName(dateStr);
    const [yy, mm] = dateStr.split('-').map(Number);
    const sheets = await getSheets();

    const meta = await sheets.spreadsheets.get({ spreadsheetId: CFG.SPREADSHEET_ID });
    if (!meta.data.sheets.some(sh => sh.properties.title === tab)) return null;

    const dateRow = await sheets.spreadsheets.values.get({
      spreadsheetId: CFG.SPREADSHEET_ID,
      range: `${tab}!2:2`,
    });
    const cells = dateRow.data.values?.[0] || [];

    const grid = await sheets.spreadsheets.values.get({
      spreadsheetId: CFG.SPREADSHEET_ID,
      range: `${tab}!5:100`, // 4행(일별 합계 수식)은 제외, 5행부터 예약 금액
    });
    const rows = grid.data.values || [];

    let totalPeople = 0;
    for (let i = 0; i < cells.length; i++) {
      const m2 = String(cells[i] || '').match(/(\d+)\s*\/\s*(\d+)/);
      if (!m2) continue; // 날짜(体験) 열만 계산, 付き添い 열은 자동 제외
      const month = Number(m2[1]), day = Number(m2[2]);
      if (month !== mm) continue;
      const units = isWeekendOrHoliday(yy, month, day) ? CFG.PRICE_WEEKEND : CFG.PRICE_WEEKDAY;
      for (const row of rows) {
        const v = Number(String(row?.[i] ?? '').replace(/[^\d.-]/g, ''));
        if (v > 0) totalPeople += inferPeople(v, units);
      }
    }

    const cost = totalPeople * CFG.CANVAS_UNIT_COST;
    await sheets.spreadsheets.values.update({
      spreadsheetId: CFG.SPREADSHEET_ID,
      range: `${tab}!A3`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[cost]] },
    });
    log(`🖼 캔버스 지출 갱신: ${tab}!A3 = ${totalPeople}장 × ¥${CFG.CANVAS_UNIT_COST} = ¥${cost}`);
    return { people: totalPeople, cost };
  } catch (e) {
    log('⚠️ 캔버스 지출 계산 실패:', e.message);
    return null;
  }
}

// ===== 매출 예측 + 수익 예측 (v11) =====
// 월별 탭 구조가 시기별로 다름(24/7 이전: 날짜헤더 1행·합계 3행 / 24/8 이후: 2행·4행)이라
// 행 번호를 하드코딩하지 않고 날짜 헤더 행을 탐지한다. 합계 행 = 헤더 행 + 2 (사이는 体験/付き添い 라벨).
// 일별 매출 = 体験 열 + 付き添い 열 (두 열의 합이 A열 월 총매출과 일치)
const FORECAST_CACHE_MS = 30 * 60 * 1000;
const WD_ORDER = ['월', '화', '수', '목', '금', '토', '일'];
const DATE_HDR_RE = /(\d+)\s*\/\s*(\d+)\s*\/\s*([월화수목금토일])/;
const TREND_MIN = 0.85, TREND_MAX = 1.15;   // 하락 반영 가능 (상승 가정 금지)
const SEASON_MIN = 0.8, SEASON_MAX = 1.2;
const SCENARIO_LOW = 0.8, SCENARIO_HIGH = 1.15;

let forecastCache = { at: 0, data: null };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const yen = n => '¥' + Math.round(n).toLocaleString('en-US');

// "¥21,000" → 21000 (빈칸/문자열 → 0)
function parseYen(v) {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// 전각 숫자(24/４) 정규화
function normTab(t) {
  return String(t).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim();
}

// JST 기준 오늘 {y, m, d}
function jstToday() {
  const s = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

// JST 기준 'YYYY-MM-DD' / 시(0~23)
const jstDateStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
const jstHour = () => Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }));
const dateStr = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// "YY/M" 월 탭 목록 (売り上げ·예약관리 등 제외), 오래된 순 정렬
function listMonthTabs(titles) {
  const out = [];
  for (const title of titles) {
    if (title.includes('売り上げ')) continue;
    const m = normTab(title).match(/^(\d{2})\/(\d{1,2})$/);
    if (!m) continue;
    const month = Number(m[2]);
    if (month < 1 || month > 12) continue;
    out.push({ title, year: 2000 + Number(m[1]), month, key: (2000 + Number(m[1])) * 12 + month });
  }
  return out.sort((a, b) => a.key - b.key);
}

// 한 탭의 values → { days:[{day, wd, col, amount}], total, rows, hdrIdx } / 파싱 실패 시 null
// col = 体験 열 index (다음 열이 付き添い). rows/hdrIdx는 이번달 인원 역산(5행 이하 개별 예약)용.
function parseMonthTab(tab, values) {
  const rows = values || [];
  let hdr = -1;
  for (let r = 0; r < Math.min(4, rows.length); r++) {
    const hits = (rows[r] || []).filter(c => DATE_HDR_RE.test(String(c || ''))).length;
    if (hits >= 3) { hdr = r; break; } // 병합셀 얼룩 방지: 날짜 헤더가 3개 이상인 행
  }
  if (hdr < 0) return null;
  const hdrCells = rows[hdr] || [];
  const totCells = rows[hdr + 2] || [];
  if (!totCells.length) return null;

  const days = [];
  for (let c = 1; c < hdrCells.length; c++) {
    const m = DATE_HDR_RE.exec(String(hdrCells[c] || ''));
    if (!m) continue;
    if (Number(m[1]) !== tab.month) continue; // 다른 달 얼룩 열 제외
    // 날짜 헤더는 병합셀(体験+付き添い) → 합계는 두 열을 더해야 월 총매출과 맞음
    days.push({ day: Number(m[2]), wd: m[3], col: c, amount: parseYen(totCells[c]) + parseYen(totCells[c + 1]) });
  }
  if (!days.length) return null;
  return { ...tab, days, total: days.reduce((s, d) => s + d.amount, 0), rows, hdrIdx: hdr };
}

// 전 월 탭을 batchGet 한 번으로 읽기 (탭 40개 이상 → 개별 호출 금지)
// 이번달 탭만 100행까지 (인원 역산은 4행 일별합계가 아니라 5행 이하 개별 예약 금액이 필요 —
// 합계액은 단가로 나눠떨어지지 않아 inferPeople이 무너진다), 나머지는 헤더+합계 6행이면 충분.
async function loadAllMonths() {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CFG.SPREADSHEET_ID });
  const tabs = listMonthTabs(meta.data.sheets.map(s => s.properties.title));
  if (!tabs.length) return [];

  const today = jstToday();
  const curKey = today.y * 12 + today.m;
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: CFG.SPREADSHEET_ID,
    ranges: tabs.map(t => `'${t.title}'!A1:BM${t.key === curKey ? 100 : 6}`), // 31일 × 2열 + A열 = BM 이내
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const out = [];
  for (let i = 0; i < tabs.length; i++) {
    try {
      const parsed = parseMonthTab(tabs[i], res.data.valueRanges[i]?.values);
      if (parsed) out.push(parsed);
      else log(`⚠️ 예측: ${tabs[i].title} 탭 파싱 실패 → 건너뜀`);
    } catch (e) {
      log(`⚠️ 예측: ${tabs[i].title} 탭 오류 (${e.message}) → 건너뜀`);
    }
  }
  return out;
}

// 요일별 평균 매출 — 최근 6개월(이번달 제외). 휴무(¥0)일도 기대값에 포함시켜야 과대추정을 막는다.
function weekdayAverages(recent) {
  const sum = {}, cnt = {};
  for (const wd of WD_ORDER) { sum[wd] = 0; cnt[wd] = 0; }
  let allSum = 0, allCnt = 0;
  for (const mo of recent) {
    for (const d of mo.days) {
      if (!(d.wd in sum)) continue;
      sum[d.wd] += d.amount; cnt[d.wd]++;
      allSum += d.amount; allCnt++;
    }
  }
  const fallback = allCnt ? allSum / allCnt : 0;
  const avg = {};
  for (const wd of WD_ORDER) avg[wd] = cnt[wd] ? sum[wd] / cnt[wd] : fallback;
  return avg;
}

// 추세계수 = 최근 3개월 월평균 ÷ 그 이전 3개월 월평균 (하락 반영, 상승은 1.15 상한)
function trendFactor(past) {
  if (past.length < 6) return 1;
  const mean = arr => arr.reduce((s, m) => s + m.total, 0) / arr.length;
  const recent3 = mean(past.slice(-3));
  const prev3 = mean(past.slice(-6, -3));
  if (!prev3) return 1;
  return clamp(recent3 / prev3, TREND_MIN, TREND_MAX);
}

// 계절성 = 작년 같은 달 ÷ 작년 그 전후 달 평균
function seasonFactor(months, year, month) {
  const at = (y, m) => {
    const k = (y + Math.floor((m - 1) / 12)) * 12 + ((m - 1 + 1200) % 12) + 1;
    return months.find(x => x.key === k && x.total > 0) || null;
  };
  const same = at(year - 1, month);
  if (!same) return { factor: 1, lastYear: null };
  const around = [at(year - 1, month - 1), at(year - 1, month + 1)].filter(Boolean);
  if (!around.length) return { factor: 1, lastYear: same };
  const base = around.reduce((s, m) => s + m.total, 0) / around.length;
  if (!base) return { factor: 1, lastYear: same };
  return { factor: clamp(same.total / base, SEASON_MIN, SEASON_MAX), lastYear: same };
}

// 이번달 개별 예약 금액(体験 열, 5행 이하)에서 인원·대응매출 역산 → 평균 객단가
// updateCanvasCostA3와 같은 방식: 주말/공휴일 단가 세트로 inferPeople
function knownPeopleAndRevenue(mo) {
  let people = 0, revenue = 0;
  const dataStart = mo.hdrIdx + 3; // 헤더 / 体験·付き添い 라벨 / 일별합계 / 개별예약...
  for (const d of mo.days) {
    const units = isWeekendOrHoliday(mo.year, mo.month, d.day) ? CFG.PRICE_WEEKEND : CFG.PRICE_WEEKDAY;
    for (let r = dataStart; r < mo.rows.length; r++) {
      const v = parseYen(mo.rows[r]?.[d.col]); // 体験 열만 (付き添い은 캔버스 미사용)
      if (v > 0) { people += inferPeople(v, units); revenue += v; }
    }
  }
  return { people, revenue };
}

// 시나리오 매출 → 비용 차감 후 순수익
function profitOf(revenue, avgTicket) {
  const people = Math.round(revenue / avgTicket);
  const paper = people * CFG.PAPER_UNIT;
  const box = people * CFG.BOX_UNIT;   // 포장박스 — 손님당 1개
  const misc = revenue * CFG.MISC_RATE;
  return {
    revenue, people, paper, box, misc,
    fixed: CFG.FIXED_COST,
    marketing: CFG.MARKETING_COST,
    net: revenue - CFG.FIXED_COST - paper - box - misc - CFG.MARKETING_COST,
  };
}

async function computeForecast() {
  if (forecastCache.data && Date.now() - forecastCache.at < FORECAST_CACHE_MS) return forecastCache.data;

  const months = await loadAllMonths();
  const today = jstToday();
  const curKey = today.y * 12 + today.m;
  const cur = months.find(m => m.key === curKey);
  if (!cur) throw new Error(`이번달 탭(${String(today.y).slice(2)}/${today.m})을 찾지 못했습니다`);

  // 과거 월: 실적이 있는 달만 (미작성 미래 탭·빈 탭 제외). 23년은 램프업이라 최근 6개월 창에서 자연히 빠짐.
  const past = months.filter(m => m.key < curKey && m.total > 0);
  const recent6 = past.slice(-6);
  if (!recent6.length) throw new Error('과거 실적 데이터가 없습니다');

  const wdAvg = weekdayAverages(recent6);
  const trend = trendFactor(past);
  const { factor: season, lastYear } = seasonFactor(months, today.y, today.m);

  // 요일평균은 '최근 6개월'로 계산돼 하락 추세가 이미 상당 부분 반영돼 있다.
  // 여기에 추세×계절성을 겹으로 곱하면 같은 하락을 3중으로 깎게 되므로(v13까지의 버그),
  // 잔여일 기준선에는 완만한 추세계수(0.85~1.10)만 적용하고 계절성은 참고 표시용으로만 둔다.
  let actual = 0, confirmed = 0, remainBase = 0;
  for (const d of cur.days) {
    if (d.day <= today.d) { actual += d.amount; continue; }
    confirmed += d.amount;
    // 공휴일(해양의날 등)은 요일과 무관하게 일요일급 매출 — 일 평균으로 조회
    const holiday = jpHolidays && jpHolidays.isHoliday(new Date(cur.year, cur.month - 1, d.day));
    const avg = (holiday ? wdAvg['일'] : wdAvg[d.wd]) || 0;
    const base = avg * trend;
    // 확정액이 요일평균의 50% 이상이면 그 날은 이미 차 있는 것 → 당일 추가 유입분(30%)만 더한다
    remainBase += d.amount >= avg * 0.5
      ? d.amount + avg * trend * 0.3
      : Math.max(d.amount, base);
  }

  // v16: 예약 페이스 모델이 우선. 모델·표본이 없거나 월초라 객단가를 못 뽑으면 위 요일평균으로 폴백한다.
  refitPace(months);
  let pace = null;
  try {
    pace = PACE.forecastMonth({
      events: paceState.events, months, cur, asOfDay: today.d, model: paceState.model,
    });
  } catch (e) {
    log('⚠️ 예약페이스 예측 실패 → 요일평균 폴백:', e.message);
  }

  // 시나리오 배율은 불확실한 잔여분에만 적용 (이미 확정된 실적은 흔들지 않음)
  const base = pace ? pace.base : actual + remainBase;
  const low  = pace ? pace.low  : actual + remainBase * SCENARIO_LOW;
  const high = pace ? pace.high : actual + remainBase * SCENARIO_HIGH;
  const method = pace ? 'pace-v16' : 'wdavg-v14';

  // 예상 수익: 이번달 실적+확정예약의 객단가로 시나리오 매출 → 인원 → 종이비 환산
  const known = knownPeopleAndRevenue(cur);
  const avgTicket = known.people > 0 ? known.revenue / known.people : CFG.AVG_TICKET_FALLBACK;
  const profit = {
    avgTicket, known,
    base: profitOf(base, avgTicket),
    low: profitOf(low, avgTicket),
    high: profitOf(high, avgTicket),
  };

  const data = {
    today, cur, actual, confirmed, base, low, high, method, pace,
    wdAvg, trend, season, lastYear, profit,
    lastDay: Math.max(...cur.days.map(d => d.day)),
  };
  forecastCache = { at: Date.now(), data };
  return data;
}

// ===== v15: 월별 조회 (/forecast?month=YYYY-MM) =====
// v14까지 /forecast는 '이번 달'만 계산했다 → 대시보드에서 지난 달을 열면 매출 카드가 통째로 비었고,
// 스냅샷을 미리 찍어두지 않은 달은 영영 복구가 안 됐다. 이제 세 갈래로 나눈다.
//   과거 달(final) : 시트 월 탭 확정 매출만. 예측 안 함 — 이미 끝난 달이라 추정할 게 없다.
//   이번 달(live)  : 1일~오늘 시트 누적(확정) + 월말 예상(보수/기본/낙관)
//   미래 달(booked): 이미 잡힌 예약 합계만. 예측하지 않는다 —
//                    리드타임 중앙값이 3일이라 다음 달 예약은 아직 5%도 안 들어와 있고,
//                    거기에 요일평균을 얹으면 근거 없는 숫자가 확정처럼 보인다.
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const TABS_CACHE_MS = 60 * 60 * 1000;
let tabsCache = { at: 0, tabs: null };

// 월 탭 목록 캐시 — 탭이 50개라 spreadsheets.get을 매 요청마다 때릴 이유가 없다
async function listTabsCached() {
  if (tabsCache.tabs && Date.now() - tabsCache.at < TABS_CACHE_MS) return tabsCache.tabs;
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CFG.SPREADSHEET_ID });
  const tabs = listMonthTabs(meta.data.sheets.map(s => s.properties.title));
  tabsCache = { at: Date.now(), tabs };
  return tabs;
}

// 월 탭 하나만 읽어 파싱 (loadAllMonths는 41개 탭을 통째로 읽어 과거 월 조회엔 과하다)
// 탭이 없거나(아직 안 만든 미래 달) 파싱 실패면 null
async function loadOneMonth(year, month) {
  const tab = (await listTabsCached()).find(t => t.key === year * 12 + month);
  if (!tab) return null;
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CFG.SPREADSHEET_ID,
    range: `'${tab.title}'!A1:BM6`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return parseMonthTab(tab, res.data.values);
}

// 미래 달 예약합계 폴백 — 월 탭을 아직 안 만든 달은 예약관리 원장에서 방문일 기준으로 센다.
// 취소분은 upsert가 예상매출을 0으로 지워두므로 상태 필터 없이 더해도 맞는다.
async function bookedFromLedger(month) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CFG.SPREADSHEET_ID,
    range: `'${CFG.SHEET_TAB}'!A2:${COL_END}`,
    valueRenderOption: 'FORMATTED_VALUE',
  }).catch(() => ({ data: { values: [] } }));

  const byDay = {};
  let total = 0, count = 0;
  for (const row of res.data.values || []) {
    const visit = String(row[4] || '').trim();
    if (!visit.startsWith(month)) continue;
    if (String(row[1] || '').trim() === '취소') continue;
    const amt = parseYen(row[10]) || parseYen(row[9]) * (Number(row[6]) || 0);
    if (!amt) continue;
    const day = Number(visit.split('-')[2]);
    byDay[day] = (byDay[day] || 0) + amt;
    total += amt; count++;
  }
  return { total, count, byDay };
}

// 'YYYY-MM' → 화면에 바로 쓸 수 있는 월별 응답. 캐시는 이번 달만(computeForecast) 걸린다 —
// 과거 달은 시트 한 번 읽는 게 전부라 캐시할 이유가 없고, 오히려 시트 수정이 안 비쳐서 헷갈린다.
async function computeMonthly(month) {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`month 형식이 잘못됐습니다: ${month} (YYYY-MM)`);
  const year = Number(m[1]), mon = Number(m[2]);
  if (mon < 1 || mon > 12) throw new Error(`month 범위 오류: ${month}`);

  const today = jstToday();
  const key = year * 12 + mon;
  const curKey = today.y * 12 + today.m;
  const tabName = `${String(year).slice(2)}/${mon}`;
  const stamp = new Date().toISOString();

  // ---- 이번 달: 기존 예측 로직(v14) 그대로 ----
  if (key === curKey) {
    const f = await computeForecast();
    const p = f.profit;
    // A4 = 월 탭 총매출 셀 (합계행의 A열). 지금 시트에 들어와 있는 돈 전부 —
    // 1일~오늘 실적 + 월말까지 이미 잡힌 예약. 화면의 '확정 매출' 카드가 이 값을 쓴다.
    const a4 = parseYen(f.cur.rows?.[f.cur.hdrIdx + 2]?.[0]);
    return {
      month, type: 'live', tab: tabName,
      asOfDay: f.today.d, lastDay: f.lastDay,
      revenue: {
        // v15에서 의미가 바뀐 필드: confirmed = 1일~오늘 시트 누적(확정).
        // v14의 confirmed(내일~월말 확정예약)는 booked로 이름을 옮겼다.
        confirmed: Math.round(f.actual),
        booked: Math.round(f.confirmed),
        // 시트 A4 그대로. 파싱이 어긋나면 실적+예약으로 되돌린다 (둘은 원래 같은 값이어야 한다).
        sheetTotal: Math.round(a4 || f.actual + f.confirmed),
        low: Math.round(f.low),
        base: Math.round(f.base),
        high: Math.round(f.high),
        actual: Math.round(f.actual), // (구버전 대시보드 호환) confirmed와 같은 값
      },
      costs: {
        fixed: Math.round(p.base.fixed), paper: Math.round(p.base.paper),
        box: Math.round(p.base.box), misc: Math.round(p.base.misc),
        marketing: Math.round(p.base.marketing),
        paperUnit: CFG.PAPER_UNIT, boxUnit: CFG.BOX_UNIT, miscRate: CFG.MISC_RATE,
      },
      profit: { base: Math.round(p.base.net), low: Math.round(p.low.net), high: Math.round(p.high.net) },
      people: p.base.people,
      avgTicket: Math.round(p.avgTicket),
      trend: Number(f.trend.toFixed(3)),
      season: Number(f.season.toFixed(3)),
      // v16: 어떤 방식으로 뽑은 숫자인지 화면에 그대로 드러낸다 (폴백이 조용히 일어나면 안 된다)
      method: f.method,
      pace: f.pace ? {
        realizedPeople: f.pace.realizedPeople,
        aheadPeople: f.pace.aheadPeople,
        remainPeople: Math.round(f.pace.remainPeople),
        ticket: Math.round(f.pace.ticket),
        inflowPeople: f.pace.inflowPeople,
        inflowDays: f.pace.inflowDays,
        remainDays: f.pace.remainDays,
        remainWeekend: f.pace.remainWeekend,
        holidays: f.pace.holidays,
        coef: f.pace.coef,
        trainedAt: paceState.model?.trainedAt || null,
      } : null,
      updatedAt: new Date(forecastCache.at || Date.now()).toISOString(),
    };
  }

  // ---- 과거 달: 시트 확정 매출 ----
  if (key < curKey) {
    const mo = await loadOneMonth(year, mon);
    if (!mo) throw new Error(`${tabName} 탭을 찾지 못했습니다`);
    const groups = Math.round(parseYen(mo.rows?.[0]?.[0])) || null; // A1 = '132組'
    return {
      month, type: 'final', tab: tabName,
      lastDay: Math.max(...mo.days.map(d => d.day)),
      revenue: { confirmed: Math.round(mo.total) },
      days: mo.days.map(d => ({ day: d.day, wd: d.wd, amount: d.amount })),
      groups,
      updatedAt: stamp,
    };
  }

  // ---- 미래 달: 이미 잡힌 예약만 ----
  const mo = await loadOneMonth(year, mon);
  if (mo && mo.total > 0) {
    return {
      month, type: 'booked', tab: tabName,
      lastDay: Math.max(...mo.days.map(d => d.day)),
      revenue: { booked: Math.round(mo.total) },
      days: mo.days.filter(d => d.amount > 0).map(d => ({ day: d.day, wd: d.wd, amount: d.amount })),
      source: 'sheet', updatedAt: stamp,
    };
  }
  const led = await bookedFromLedger(month);
  return {
    month, type: 'booked', tab: tabName,
    lastDay: new Date(Date.UTC(year, mon, 0)).getUTCDate(),
    revenue: { booked: Math.round(led.total) },
    days: Object.entries(led.byDay).map(([day, amount]) => ({ day: Number(day), amount })).sort((a, b) => a.day - b.day),
    reservations: led.count,
    source: mo ? 'sheet(빈 탭) → 예약관리' : '예약관리',
    updatedAt: stamp,
  };
}

// ===== v15: 예약 스냅샷 수집기 (state/booked-snapshots.json) =====
// 왜 필요한가: 예측 알고리즘을 개선하려면 "D-n일 시점에 얼마나 차 있었나 → 최종 얼마가 됐나"를
// 알아야 하는데, 예약관리 원장으로는 이걸 복원할 수 없다.
//   ① 원장에 접수일시는 있어도 '취소된 시각'이 없어 과거 어느 시점의 유효 예약을 되돌릴 수 없고,
//   ② 취소되면 예상매출이 0으로 덮여 그 예약이 살아있던 기간의 금액이 사라진다.
// 그래서 매일 그날의 예약 상태를 그대로 찍어 남긴다. 이건 사후 복원이 불가능해서
// '나중에 필요하면 그때 만들지'가 안 통하는 종류의 데이터다 — 안 찍은 날은 영영 없다.
//
// 구조: { days: { 'YYYY-MM-DD'(찍은 날): { at, booked: { 'YYYY-MM-DD'(방문일): 금액 } } } }
// 찍는 날 이후의 방문일만 담는다 (당일·과거는 이미 확정치라 월 탭에서 언제든 읽힌다).
const BOOKED_SNAP_FILE = path.join(__dirname, 'state', 'booked-snapshots.json');
const BOOKED_SNAP_KEEP = Number(process.env.BOOKED_SNAPSHOT_KEEP || 400);   // 보관 일수
const BOOKED_SNAP_HOUR = Number(process.env.BOOKED_SNAPSHOT_HOUR || 23);    // 확정 스냅샷 시각(JST)
const BOOKED_SNAP_MONTHS = 3;                                              // 이번 달 + 다음 2개월
const BOOKED_SNAP_TICK_MS = 30 * 60 * 1000;

function loadBookedSnapshots() {
  try {
    const raw = JSON.parse(fs.readFileSync(BOOKED_SNAP_FILE, 'utf8'));
    return { days: raw && typeof raw.days === 'object' && raw.days ? raw.days : {} };
  } catch {
    return { days: {} }; // 파일이 없거나 깨졌으면 새로 시작한다 — 수집 실패가 서비스를 막으면 안 된다
  }
}

function saveBookedSnapshots(store) {
  const keys = Object.keys(store.days).sort();
  const keep = keys.slice(-BOOKED_SNAP_KEEP); // 오래된 날부터 버린다
  const days = {};
  for (const k of keep) days[k] = store.days[k];
  fs.mkdirSync(path.dirname(BOOKED_SNAP_FILE), { recursive: true });
  fs.writeFileSync(BOOKED_SNAP_FILE, JSON.stringify({ days }, null, 1));
  return days;
}

// 오늘(JST) 시점의 미래 예약 상태를 읽어온다. 월 탭이 원본이고, 아직 안 만든 달만 원장으로 채운다.
async function readBookedNow(asOf) {
  const [y, m] = asOf.split('-').map(Number);
  const booked = {};
  for (let i = 0; i < BOOKED_SNAP_MONTHS; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const yy = d.getUTCFullYear(), mm = d.getUTCMonth() + 1;
    const mo = await loadOneMonth(yy, mm);
    if (mo) {
      for (const day of mo.days) {
        const date = dateStr(yy, mm, day.day);
        if (date > asOf && day.amount > 0) booked[date] = day.amount;
      }
      continue;
    }
    // 탭이 아직 없는 달 — 예약은 원장에만 있다
    const led = await bookedFromLedger(`${yy}-${String(mm).padStart(2, '0')}`);
    for (const [day, amt] of Object.entries(led.byDay)) {
      const date = dateStr(yy, mm, Number(day));
      if (date > asOf && amt > 0) booked[date] = amt;
    }
  }
  return booked;
}

async function captureBookedSnapshot(reason) {
  const asOf = jstDateStr();
  const booked = await readBookedNow(asOf);
  const store = loadBookedSnapshots();
  store.days[asOf] = {
    at: new Date().toISOString(),
    hourJST: jstHour(),
    reason,
    booked,
  };
  saveBookedSnapshots(store);
  const total = Object.values(booked).reduce((s, v) => s + v, 0);
  log(`📷 예약 스냅샷 ${asOf} (${reason}) — 미래 ${Object.keys(booked).length}일 · ${yen(total)}`);
  return store.days[asOf];
}

// 30분마다 확인. 오늘 스냅샷이 없으면 바로 찍고(재기동·장애로 하루를 통째로 빠뜨리는 걸 막는다),
// BOOKED_SNAP_HOUR를 넘겼는데 그 이전에 찍은 것뿐이면 하루 마감 상태로 덮어쓴다.
async function bookedSnapshotTick() {
  try {
    const asOf = jstDateStr();
    const today = loadBookedSnapshots().days[asOf];
    if (!today) await captureBookedSnapshot('catchup');
    else if (jstHour() >= BOOKED_SNAP_HOUR && (today.hourJST ?? 0) < BOOKED_SNAP_HOUR) {
      await captureBookedSnapshot('eod');
    }
  } catch (e) {
    log('⚠️ 예약 스냅샷 실패:', e.message); // 다음 tick에 다시 시도한다
  }
  // 예약 페이스 이벤트도 같은 주기로 증분 동기화 (둘 다 실패해도 서비스는 살아있어야 한다)
  try {
    await syncPaceEvents();
  } catch (e) {
    log('⚠️ 예약페이스 이벤트 동기화 실패:', e.message);
  }
}

function startBookedSnapshotLoop() {
  bookedSnapshotTick();
  setInterval(bookedSnapshotTick, BOOKED_SNAP_TICK_MS);
  log(`⏰ 예약 스냅샷 수집 시작 — 30분마다 확인, 마감 스냅샷 ${BOOKED_SNAP_HOUR}시 JST, 보관 ${BOOKED_SNAP_KEEP}일`);
}

// ===== v16: 예약 페이스 예측 =====
// 구루나비 알림 메일 3년치(2023-04~, 6천여 통)를 이벤트로 복원해 "D일 시점 예약 → 월말" 관계를 학습한다.
// 학습·추론 로직은 pace-data.js 한 곳에만 있다 (train-pace.js와 공유 — 세는 기준이 갈리면 모델이 무너진다).
// 백테스트 MAPE 19.0%(기존 요일평균) → 10.4%. 모델이나 표본이 없으면 조용히 기존 방식으로 폴백한다.
const EVENTS_FILE = path.join(__dirname, 'state', 'booking-events.json');
const PACE_MODEL_FILE = path.join(__dirname, 'state', 'pace-model.json');
const PACE_REFIT_MS = 24 * 60 * 60 * 1000; // 하루 1회 재적합 (캐시된 이벤트만 쓰므로 IMAP 부하 없음)

let paceState = { events: [], model: null, refitAt: 0, syncedAt: 0 };

function loadPaceState() {
  paceState.events = PACE.loadEvents(EVENTS_FILE);
  try {
    paceState.model = JSON.parse(fs.readFileSync(PACE_MODEL_FILE, 'utf8'));
  } catch {
    paceState.model = null; // 아직 학습 전 — train-pace.js를 한 번 돌려야 한다
  }
  const days = paceState.model ? Object.keys(paceState.model.byDay || {}).length : 0;
  log(`📈 예약페이스: 이벤트 ${paceState.events.length}건 · 모델 ${days ? `${days}일치 (학습 ${paceState.model.trainedAt?.slice(0, 10)})` : '없음 → 기존 요일평균 사용'}`);
}

// 마지막 이벤트 이후 메일만 받아 붙인다. 6천 통 전량 재수집은 train-pace.js --full 담당.
async function syncPaceEvents() {
  if (!CFG.IMAP_USER || !CFG.IMAP_PASS) return 0;
  const since = paceState.events.length ? paceState.events[paceState.events.length - 1].ts : null;
  const fetched = await PACE.fetchEvents({
    user: CFG.IMAP_USER, pass: CFG.IMAP_PASS, from: CFG.MAIL_FROM_FILTER, since,
  });
  const merged = PACE.mergeEvents(paceState.events, fetched);
  const added = merged.length - paceState.events.length;
  if (added > 0) {
    paceState.events = PACE.saveEvents(EVENTS_FILE, merged);
    paceState.refitAt = 0; // 새 예약이 들어왔으니 다음 tick에 다시 적합
    log(`📈 예약페이스 이벤트 +${added}건 (총 ${merged.length})`);
  }
  paceState.syncedAt = Date.now();
  return added;
}

// 캐시된 이벤트 + 월 탭으로 재적합. 시트를 이미 읽은 computeForecast 안에서만 호출한다.
function refitPace(months) {
  if (!paceState.events.length) return;
  if (Date.now() - paceState.refitAt < PACE_REFIT_MS) return;
  try {
    const model = PACE.trainModel(paceState.events, months);
    if (Object.keys(model.byDay).length) {
      fs.writeFileSync(PACE_MODEL_FILE, JSON.stringify(model, null, 1));
      paceState.model = model;
      log(`📈 예약페이스 모델 재적합 — 학습월 ${model.months}개 · as-of ${Object.keys(model.byDay).length}일치`);
    }
    paceState.refitAt = Date.now();
  } catch (e) {
    log('⚠️ 예약페이스 재적합 실패:', e.message); // 기존 모델을 그대로 쓴다
  }
}

/**
 * 수집된 스냅샷 → 리드타임 배율 표 ("D-n 시점 예약액이 최종 일매출의 몇 배가 되는가")
 * 최종 일매출은 월 탭에서 읽는다(finals). 예약이 0이던 날은 배율이 무한대라 제외한다.
 */
function leadTimeStats(store, finals, { weeks = 4, maxN = 21 } = {}) {
  const today = jstDateStr();
  const from = new Date(Date.parse(today) - weeks * 7 * 86400000).toISOString().slice(0, 10);
  const byN = {};
  for (const [asOf, snap] of Object.entries(store.days)) {
    if (asOf < from) continue;
    for (const [visit, bk] of Object.entries(snap.booked || {})) {
      if (visit > today) continue;          // 아직 안 온 날은 최종값이 없다
      const fin = finals[visit];
      if (fin == null || !(bk > 0)) continue;
      const n = Math.round((Date.parse(visit) - Date.parse(asOf)) / 86400000);
      if (n < 1 || n > maxN) continue;
      (byN[n] ||= []).push(fin / bk);
    }
  }
  const out = {};
  for (const [n, ratios] of Object.entries(byN)) {
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    out[n] = { samples: ratios.length, mean: Number(mean.toFixed(3)) };
  }
  return out;
}

function forecastText(f) {
  const { today, lastDay } = f;
  const p = f.profit.base;
  const vsTarget = CFG.FORECAST_TARGET ? Math.round((f.base / CFG.FORECAST_TARGET) * 100) : null;
  const vsLastYear = f.lastYear && f.lastYear.total ? Math.round((f.base / f.lastYear.total) * 100) : null;
  const lyTab = f.lastYear ? f.lastYear.title : null;
  const remainLabel = today.d >= lastDay ? '없음' : `${today.d + 1}일~${lastDay}일`;

  return [
    `📊 <b>${today.m}월 매출 예측</b> (${today.m}/${today.d} 기준)`,
    '━━━━━━━━━',
    `실적: ${yen(f.actual)} (1~${today.d}일)`,
    `확정 예약: ${yen(f.confirmed)} (${remainLabel})`,
    `예측: ${yen(f.low)} ~ ${yen(f.high)}`,
    `기본 시나리오: <b>${yen(f.base)}</b>`,
    '━━━━━━━━━',
    vsTarget != null ? `목표 ${yen(CFG.FORECAST_TARGET)} 대비: ${vsTarget}%` : null,
    vsLastYear != null ? `작년 ${today.m}월(${lyTab}) 대비: ${vsLastYear}%` : `작년 ${today.m}월 데이터 없음`,
    f.pace
      ? `방식: 예약페이스 (잡힌예약 ${f.pace.aheadPeople}명 → 잔여 ${Math.round(f.pace.remainPeople)}명 예상 · 객단가 ${yen(f.pace.ticket)})`
      : `방식: 요일평균 폴백 · 추세 ${f.trend.toFixed(2)} · 계절성 참고 ${f.season.toFixed(2)}`,
    '━━━━━━━━━',
    '💰 <b>예상 수익 (기본)</b>',
    `매출 ${yen(p.revenue)}`,
    `− 야칭·공과금 ${yen(p.fixed)}`,
    `− 종이 ${yen(p.paper)} (${p.people}장×${yen(CFG.PAPER_UNIT)})`,
    `− 포장박스 ${yen(p.box)} (${p.people}개×${yen(CFG.BOX_UNIT)})`,
    `− 잡재료 ${Math.round(CFG.MISC_RATE * 100)}% ${yen(p.misc)}`,
    `− 마케팅 ${yen(p.marketing)}`,
    `= 순수익 <b>${yen(p.net)}</b>`,
    `(보수 ${yen(f.profit.low.net)} ~ 낙관 ${yen(f.profit.high.net)})`,
  ].filter(Boolean).join('\n');
}

// ===== v12: 수동수익 탭 (텔레그램 /수입) =====
// 예약 매출 외의 수입(유모차 렌탈·애드포스트·쿠팡 등)을 한 줄로 기록한다.
// 파싱은 정규식 고정 — Claude API를 태우지 않는다(비용·지연·오파싱 방지).
const INCOME_HEADER = ['입력일시', '대상월', '항목', '금액', '통화'];
const INCOME_COL_END = 'E';

// 통화 접미사가 없을 때의 기본 통화. 한국 서비스에서 들어오는 돈만 KRW.
const KRW_ITEMS = ['유모차', '애드포스트', '쿠팡'];
function defaultCurrency(item) {
  return KRW_ITEMS.some(k => item.includes(k)) ? 'KRW' : 'JPY';
}

// "/수입 유모차 렌탈 1,800,000원" → { item:'유모차 렌탈', amount:1800000, currency:'KRW' }
// 항목명에 공백이 들어갈 수 있으므로 "마지막 숫자 + (선택)통화" 를 뒤에서 앵커링한다.
const INCOME_RE = /^\/수입\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s*(원|엔|krw|jpy|₩|¥)?$/i;

function parseIncomeCmd(text) {
  const m = INCOME_RE.exec(text.trim());
  if (!m) return null;
  const item = m[1].trim();
  const amount = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const suffix = (m[3] || '').toLowerCase();
  const currency = !suffix ? defaultCurrency(item)
    : (suffix === '원' || suffix === 'krw' || suffix === '₩') ? 'KRW' : 'JPY';
  return { item, amount, currency };
}

// JST 기준 이번 달 'YYYY-MM'
function jstMonth() {
  const { y, m } = jstToday();
  return `${y}-${String(m).padStart(2, '0')}`;
}

// 수동수익 탭 보장 → sheetId 반환 (행 삭제(deleteDimension)에 sheetId가 필요)
async function ensureIncomeTab() {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CFG.SPREADSHEET_ID });
  let sheet = meta.data.sheets.find(s => s.properties.title === CFG.INCOME_TAB);
  if (!sheet) {
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CFG.SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: CFG.INCOME_TAB, gridProperties: { frozenRowCount: 1 } } } }],
      },
    });
    sheet = { properties: res.data.replies[0].addSheet.properties };
    await sheets.spreadsheets.values.update({
      spreadsheetId: CFG.SPREADSHEET_ID,
      range: `${CFG.INCOME_TAB}!A1:${INCOME_COL_END}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [INCOME_HEADER] },
    });
    log(`✅ 탭 생성: ${CFG.INCOME_TAB}`);
  }
  return sheet.properties.sheetId;
}

// 헤더 제외 데이터 행 (0-based 시트 행번호 포함)
async function readIncomeRows() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CFG.SPREADSHEET_ID,
    range: `${CFG.INCOME_TAB}!A2:${INCOME_COL_END}`,
  });
  return (res.data.values || []).map((row, i) => ({
    rowIndex: i + 1, // 0-based 시트 행 index (헤더가 0행)
    at: row[0] || '', month: row[1] || '', item: row[2] || '',
    amount: Number(String(row[3] ?? '').replace(/[^\d.-]/g, '')) || 0,
    currency: row[4] || 'JPY',
  }));
}

const curSym = c => (c === 'KRW' ? '₩' : '¥');
const money = (n, c) => curSym(c) + Math.round(n).toLocaleString('en-US');

async function addIncome(p, chatId) {
  await ensureIncomeTab();
  const sheets = await getSheets();
  const month = jstMonth();
  await sheets.spreadsheets.values.append({
    spreadsheetId: CFG.SPREADSHEET_ID,
    range: `${CFG.INCOME_TAB}!A:${INCOME_COL_END}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        month, p.item, p.amount, p.currency,
      ]],
    },
  });
  log(`💵 수동수익 기록: ${month} ${p.item} ${money(p.amount, p.currency)}`);
  await tgSend([
    `💵 <b>수입 기록 완료</b>`,
    `항목: ${p.item}`,
    `금액: <b>${money(p.amount, p.currency)}</b> (${p.currency})`,
    `대상월: ${month}`,
    '',
    '취소하려면 /수입취소',
  ].join('\n'), chatId);
}

async function reportIncome(chatId) {
  await ensureIncomeTab();
  const month = jstMonth();
  const rows = (await readIncomeRows()).filter(r => r.month === month);
  if (!rows.length) {
    await tgSend(`📒 <b>${month} 수동 수입</b>\n입력된 내역이 없습니다.\n\n예) <i>/수입 유모차 렌탈 1,800,000원</i>`, chatId);
    return;
  }
  const byItem = {};
  for (const r of rows) {
    const key = `${r.item}|${r.currency}`;
    byItem[key] = (byItem[key] || 0) + r.amount;
  }
  const lines = [
    `📒 <b>${month} 수동 수입</b> (${rows.length}건)`,
    '━━━━━━━━━',
    ...rows.map(r => `· ${r.item} ${money(r.amount, r.currency)} <i>(${r.at})</i>`),
    '━━━━━━━━━',
    '<b>항목별 합계</b>',
    ...Object.entries(byItem).map(([k, v]) => {
      const [item, cur] = k.split('|');
      return `${item}: <b>${money(v, cur)}</b>`;
    }),
  ];
  await tgSend(lines.join('\n'), chatId);
}

async function cancelLastIncome(chatId) {
  const sheetId = await ensureIncomeTab();
  const rows = await readIncomeRows();
  if (!rows.length) {
    await tgSend('취소할 수입 내역이 없습니다.', chatId);
    return;
  }
  const last = rows[rows.length - 1];
  const sheets = await getSheets();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: CFG.SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: last.rowIndex, endIndex: last.rowIndex + 1 },
        },
      }],
    },
  });
  log(`🗑 수동수익 삭제: ${last.month} ${last.item} ${money(last.amount, last.currency)}`);
  await tgSend([
    '🗑 <b>마지막 수입 내역 삭제</b>',
    `항목: ${last.item}`,
    `금액: ${money(last.amount, last.currency)}`,
    `대상월: ${last.month}`,
    `입력: ${last.at}`,
  ].join('\n'), chatId);
}

function summaryText(r, result, monthTotal) {
  const icon = r.status === '취소' ? '❌' : r.status === '변경' ? '🔄' : '🎨';
  const act = result.action === 'updated' ? `기존 행 갱신 (${result.row}행)` : '새 행 추가';
  const wd = r.visit_date ? weekdayKo(r.visit_date) : '';
  const monthNo = r.visit_date ? Number(r.visit_date.split('-')[1]) : null;
  return [
    `${icon} <b>예약 ${r.status}</b> [${r.channel}]`,
    `📅 ${r.visit_date || '?'}${wd ? `(${wd})` : ''} ${r.visit_time || ''}`,
    `👥 ${r.party_size ?? '?'}명${r.drawing_split ? ` (드로잉 ${r.drawing_split})` : ''}`,
    r.course ? `🎟 ${r.course}` : null,
    r.estimated_total != null ? `💰 예상 ¥${Number(r.estimated_total).toLocaleString()}` : null,
    `🙋 ${r.name || '?'}${r.phone ? ` / ${r.phone}` : ''}`,
    r.notes ? `📝 ${r.notes}` : null,
    `— 원장: ${act}${r.matrix_cell ? ` / 매출표: ${r.matrix_cell}` : ''}${r.cal_event_id ? ' / 📆 캘린더 등록' : ''}`,
    monthTotal != null && monthNo ? `📈 ${monthNo}월 누적: ${monthTotal}` : null,
  ].filter(Boolean).join('\n');
}

// ===== 처리 파이프라인 =====
async function processReservation(text, sourceHint) {
  // 고객 메시지 알림 메일: 본문의 희망·문의("12:30로 변경 가능한가요?")가 확정 변경으로 오파싱되지 않게
  // 확정 정보인 ■予約内容 블록만 파싱에 넘기고, 메시지 원문은 비고로만 남긴다
  let custMsg = null;
  if (/メッセージが届きました/.test(text)) {
    custMsg = ((text.match(/■メッセージ内容([\s\S]*?)(?:■予約内容|$)/) || [])[1] || '').replace(/[━─＿=\-_\s]+/g, ' ').trim().slice(0, 120) || null;
    const i = text.indexOf('■予約内容');
    if (i >= 0) text = '（お客様からのメッセージ通知メール。時間・人数は依頼文ではなく以下の確定予約内容を使うこと）\n' + text.slice(i);
  }
  const r = await parseWithClaude(text, sourceHint);
  if (custMsg) r.notes = `💬 고객 메시지: ${custMsg}` + (r.notes ? ` / ${r.notes}` : '');
  if (!r.reservation_no) r.reservation_no = 'M' + Date.now(); // 수동 입력용 ID
  if (!r.received_at) r.received_at = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  await ensureTab();

  // 기존 예약이면 이전 매트릭스 칸/캘린더 일정 참조 확보
  const existingRow = await findRowByReservationNo(r.reservation_no);
  const refs = existingRow ? await getExistingRefs(existingRow) : { matrixCell: null, calEventId: null };
  if (custMsg && existingRow && r.status !== '취소') r.status = '변경'; // 메시지 메일은 확정 내용 기준으로 원장·캘린더 재동기화

  if (r.status === '취소') {
    await clearMatrixCell(refs.matrixCell);
    await deleteCalEvent(refs.calEventId);
    r.matrix_cell = '';
    r.cal_event_id = '';
    r.estimated_total = 0;
  } else if (r.status === '변경') {
    await clearMatrixCell(refs.matrixCell); // 날짜/금액 바뀔 수 있으니 지우고 다시 입력
    await deleteCalEvent(refs.calEventId);
    r.matrix_cell = await writeToMatrix(r);
    r.cal_event_id = await createCalEvent(r);
  } else {
    r.matrix_cell = refs.matrixCell || await writeToMatrix(r); // 중복 신규 방지
    r.cal_event_id = refs.calEventId || await createCalEvent(r);
  }

  const result = await upsertReservation(r);
  log(`✅ ${r.reservation_no} ${r.status} → ${result.action}${r.matrix_cell ? ` / ${r.matrix_cell}` : ''}`);
  const monthTotal = r.visit_date ? await getMonthTotal(r.visit_date) : null;
  // if (r.visit_date) updateCanvasCostA3(r.visit_date).catch(() => {}); // A3 캔버스 지출 갱신 (알림 미표시)
  await tgSend(summaryText(r, result, monthTotal));
  return { r, result };
}

// ===== IMAP IDLE =====
let imapClient = null;
let imapReconnectDelay = 5000;

async function startImap() {
  imapClient = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: CFG.IMAP_USER, pass: CFG.IMAP_PASS },
    logger: false,
  });

  imapClient.on('error', err => log('⚠️ IMAP 오류:', err.message));
  imapClient.on('close', () => {
    log(`🔌 IMAP 연결 종료 → ${imapReconnectDelay / 1000}초 후 재연결`);
    setTimeout(startImap, imapReconnectDelay);
    imapReconnectDelay = Math.min(imapReconnectDelay * 2, 300000);
  });

  try {
    await imapClient.connect();
    imapReconnectDelay = 5000;
    await imapClient.mailboxOpen('INBOX');
    log(`📬 IMAP 연결 완료: ${CFG.IMAP_USER} (IDLE 대기 중)`);

    // 미처리분 캐치업: 최근 3일 내 대상 메일 확인
    await catchUp();

    imapClient.on('exists', async () => {
      try { await catchUp(); }
      catch (e) { log('⚠️ 신규 메일 처리 오류:', e.message); }
    });

    // ImapFlow는 mailboxOpen 후 자동 IDLE 유지
  } catch (e) {
    log('⚠️ IMAP 연결 실패:', e.message);
  }
}

async function catchUp() {
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  const lock = await imapClient.getMailboxLock('INBOX');
  try {
    const uids = await imapClient.search({ since, from: CFG.MAIL_FROM_FILTER }, { uid: true });
    if (!uids || !uids.length) return;
    for (const uid of uids) {
      const msg = await imapClient.fetchOne(uid, { source: true, envelope: true }, { uid: true });
      if (!msg) continue;
      const msgId = msg.envelope?.messageId || `uid-${uid}`;
      if (state.processedMsgIds.includes(msgId)) continue;

      const parsed = await simpleParser(msg.source);
      const from = (parsed.from?.value?.[0]?.address || '').toLowerCase();
      if (!from.includes(CFG.MAIL_FROM_FILTER)) continue;

      const body = parsed.text || parsed.html || '';
      log(`📨 구루나비 알림 수신: ${parsed.subject || '(제목없음)'}`);
      try {
        await processReservation(body, 'ぐるなび予約通知メール');
        state.processedMsgIds.push(msgId);
        saveState(state);
      } catch (e) {
        log('⚠️ 파싱/기록 실패:', e.message);
        await tgSend(`⚠️ 예약 메일 처리 실패\n제목: ${parsed.subject}\n오류: ${e.message}\n→ 시트에 수동 확인 필요`);
        state.processedMsgIds.push(msgId); // 무한 재시도 방지
        saveState(state);
      }
    }
  } finally {
    lock.release();
  }
}

// ===== 텔레그램 수동 입력 (getUpdates 롱폴링) =====
let tgOffset = 0;
async function tgPollLoop() {
  if (!CFG.TELEGRAM_BOT_TOKEN) return;
  while (true) {
    try {
      const res = await ax.get(`https://api.telegram.org/bot${CFG.TELEGRAM_BOT_TOKEN}/getUpdates`, {
        params: { offset: tgOffset, timeout: 50 }, timeout: 60000,
      });
      for (const u of res.data.result || []) {
        tgOffset = u.update_id + 1;
        const msg = u.message;
        if (!msg || !msg.text) continue;
        if (String(msg.chat.id) !== String(CFG.TELEGRAM_CHAT_ID)) {
          await tgSend('권한이 없는 채팅입니다.', msg.chat.id);
          continue;
        }
        const text = msg.text.trim();
        if (text === '/start' || text === '/help') {
          await tgSend([
            '🎨 <b>센바미술관 예약 입력 봇</b>',
            '',
            '전화/인스타DM 예약을 자유롭게 적어서 보내면 매출시트에 자동 기록됩니다.',
            '예) <i>전화예약 7/15 14시 2명 드로잉2 3500엔 김지수 090-1234-5678</i>',
            '예) <i>인스타 DM 7/20 13시반 4명(드로잉2 동반2) 야마다</i>',
            '취소는 "취소"라고 함께 적어주세요.',
            '',
            '/예측 — 이번달 매출 예측 (/forecast)',
            '',
            '💵 <b>수동 수입</b> (예약 외 수입)',
            '/수입 항목명 금액[원|엔] — 기록 (예: /수입 유모차 렌탈 1,800,000원)',
            '/수입 — 이번 달 내역·항목별 합계',
            '/수입취소 — 마지막 입력 삭제',
            '',
            '/status — 서버 상태 확인',
          ].join('\n'), msg.chat.id);
          continue;
        }
        if (text === '/status') {
          await tgSend(`✅ senba-sales-sync 가동 중\nIMAP: ${imapClient?.usable ? '연결됨' : '재연결 중'}\n처리된 메일: ${state.processedMsgIds.length}건`, msg.chat.id);
          continue;
        }
        if (text === '/예측' || text === '/forecast') {
          try {
            await tgSend('⏳ 매출 예측 계산 중...', msg.chat.id);
            await tgSend(forecastText(await computeForecast()), msg.chat.id);
          } catch (e) {
            log('⚠️ 예측 실패:', e.message);
            await tgSend(`⚠️ 예측 실패: ${e.message}`, msg.chat.id);
          }
          continue;
        }
        // v12: /수입 계열 — 자유 텍스트 예약 파싱보다 먼저 분기 (정규식 고정, Claude 호출 없음)
        if (text === '/수입취소') {
          try { await cancelLastIncome(msg.chat.id); }
          catch (e) {
            log('⚠️ 수입 취소 실패:', e.message);
            await tgSend(`⚠️ 수입 취소 실패: ${e.message}`, msg.chat.id);
          }
          continue;
        }
        if (text === '/수입') {
          try { await reportIncome(msg.chat.id); }
          catch (e) {
            log('⚠️ 수입 조회 실패:', e.message);
            await tgSend(`⚠️ 수입 조회 실패: ${e.message}`, msg.chat.id);
          }
          continue;
        }
        if (text.startsWith('/수입')) {
          const parsed = parseIncomeCmd(text);
          if (!parsed) {
            await tgSend([
              '⚠️ 형식을 인식하지 못했습니다.',
              '',
              '<b>/수입 항목명 금액[원|엔]</b>',
              '예) <i>/수입 유모차 렌탈 1,800,000원</i>',
              '예) <i>/수입 굿즈 판매 12000엔</i>',
              '',
              '통화 생략 시: 유모차·애드포스트·쿠팡 → 원, 그 외 → 엔',
            ].join('\n'), msg.chat.id);
            continue;
          }
          try { await addIncome(parsed, msg.chat.id); }
          catch (e) {
            log('⚠️ 수입 기록 실패:', e.message);
            await tgSend(`⚠️ 수입 기록 실패: ${e.message}`, msg.chat.id);
          }
          continue;
        }
        // 자유 텍스트 → 예약 파싱
        try {
          await tgSend('⏳ 입력 분석 중...', msg.chat.id);
          await processReservation(text, '韓国語の手動予約メモ(電話またはインスタDM)');
        } catch (e) {
          await tgSend(`⚠️ 파싱 실패: ${e.message}\n날짜/시간/인원을 포함해서 다시 보내주세요.`, msg.chat.id);
        }
      }
    } catch (e) {
      log('⚠️ 텔레그램 폴링 오류:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ===== HTTP (헬스체크 + 수동 API) =====
const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({
  ok: true, service: 'senba-sales-sync', version: 'v16',
  imap: imapClient?.usable || false,
  processed: state.processedMsgIds.length,
}));

// v12: 예측 캐시를 JSON으로 노출 (biz-dashboard:3014가 소비)
// v15: ?month=YYYY-MM 지원 — 과거 달(final) / 이번 달(live) / 미래 달(booked)
//      month 생략 시 이번 달. 이번 달 계산은 /예측(텔레그램)과 같은 computeForecast() 30분 캐시를 공유한다.
app.get('/forecast', async (req, res) => {
  if (req.headers['x-auth-token'] !== CFG.AUTH_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  const today = jstToday();
  const month = String(req.query.month || `${today.y}-${String(today.m).padStart(2, '0')}`);
  try {
    res.json(await computeMonthly(month));
  } catch (e) {
    log(`⚠️ /forecast?month=${month} 실패:`, e.message);
    res.status(500).json({ error: e.message, month });
  }
});

// v15: 수집된 예약 스냅샷 조회 — 예측 알고리즘 재검증(백테스트)용.
//   ?days=N     최근 N일치만 (기본 60)
//   ?lead=1     일자별 원본 대신 리드타임 배율 표만 (최근 4주)
app.get('/booked-snapshots', async (req, res) => {
  if (req.headers['x-auth-token'] !== CFG.AUTH_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  try {
    const store = loadBookedSnapshots();
    const all = Object.keys(store.days).sort();

    if (req.query.lead === '1') {
      // 최종 일매출은 이번 달과 지난 달 탭이면 충분하다 (스냅샷 보관 기간과 무관하게 최근 4주만 본다)
      const t = jstToday();
      const finals = {};
      for (const off of [-1, 0]) {
        const d = new Date(Date.UTC(t.y, t.m - 1 + off, 1));
        const mo = await loadOneMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
        if (mo) for (const day of mo.days) finals[dateStr(d.getUTCFullYear(), d.getUTCMonth() + 1, day.day)] = day.amount;
      }
      const weeks = Math.max(1, Math.min(52, Number(req.query.weeks) || 4));
      return res.json({ weeks, days: all.length, lead: leadTimeStats(store, finals, { weeks }) });
    }

    const n = Math.max(1, Math.min(400, Number(req.query.days) || 60));
    const keep = all.slice(-n);
    res.json({
      count: all.length,
      first: all[0] || null,
      last: all[all.length - 1] || null,
      days: Object.fromEntries(keep.map(k => [k, store.days[k]])),
    });
  } catch (e) {
    log('⚠️ /booked-snapshots 실패:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/manual', async (req, res) => {
  if (req.headers['x-auth-token'] !== CFG.AUTH_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const out = await processReservation(text, '手動入力(API)');
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 기동 =====
(async () => {
  const missing = ['IMAP_USER', 'IMAP_PASS', 'ANTHROPIC_API_KEY', 'SPREADSHEET_ID'].filter(k => !CFG[k]);
  if (missing.length) {
    log(`❌ .env 누락: ${missing.join(', ')}`);
    process.exit(1);
  }
  app.listen(CFG.PORT, () => log(`🚀 senba-sales-sync v16 시작 (포트 ${CFG.PORT})`));
  await ensureTab().catch(e => log('⚠️ 시트 초기화 실패:', e.message));
  loadPaceState();
  startImap();
  tgPollLoop();
  startBookedSnapshotLoop();
})();
