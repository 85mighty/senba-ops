// 「예약 리드타임」 탭 — 예약이 방문 전 언제 들어오는지 집계 (2026-10-15)
// 질문: "전날 20시에 마감하고 예약이 없으면 문을 닫는다"면 놓치게 되는 예약(마감 후 접수)이 얼마나 되나
// 데이터: 매출 시트 「예약관리」 탭 — 접수일시(D)·방문일(E)·방문시간(F)·인원(G) · 취소 제외 · 2026-08-01~09-30
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const LEDGER_ID = '1sUXyrXxYzl_n6n5T4dV_flQ6Ocli3c0B-Ggbwzw5YC4';
const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';
const TAB = '예약 리드타임';
const FROM = '2026-08-01', TO = '2026-09-30';
const CUTOFF_HOUR = 20;           // 전날 20시 마감 가정
const CONTRIB = 3195;             // 1인 공헌이익(엔)
const WD = '日月火水木金土';
const NCOL = 8;

const dow = ds => new Date(ds + 'T12:00:00').getDay();
const group = d => { const w = dow(d); return (w === 2 || w === 3 || w === 4) ? '화수목' : (w === 0 || w === 6) ? '토일' : '금월'; };

function parseReceived(s) {   // → 분 단위 절대시각(JST 기준 epoch 분) 또는 null
  const m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = Number(m[4]);
  if (/오후|PM/i.test(s) && h < 12) h += 12;
  if (/오전|AM/i.test(s) && h === 12) h = 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, Number(m[5])) / 60000;
}

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const g = await sheets.spreadsheets.values.get({ spreadsheetId: LEDGER_ID, range: `'예약관리'!A2:R`, valueRenderOption: 'FORMATTED_VALUE' });

  const S = { '화수목': { n: 0, late: 0, ppl: 0, latePpl: 0, same: 0 }, '토일': { n: 0, late: 0, ppl: 0, latePpl: 0, same: 0 }, '금월': { n: 0, late: 0, ppl: 0, latePpl: 0, same: 0 } };
  const dayInfo = {};   // date → {n, late}
  let used = 0, noRecv = 0;
  for (const r of g.data.values || []) {
    const status = String(r[1] || '');
    const dm = String(r[4] || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    const tm = String(r[5] || '').match(/(\d{1,2}):(\d{2})/);
    if (!dm || !tm || status.includes('취소')) continue;
    const date = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
    if (date < FROM || date > TO) continue;
    const recv = parseReceived(r[3]);
    if (recv === null) { noRecv++; continue; }
    const visitDay0 = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])) / 60000;
    const cutoff = visitDay0 - (24 - CUTOFF_HOUR) * 60;     // 방문 전날 20:00
    const late = recv > cutoff;                              // 마감 후 접수(밤 예약 + 당일 예약)
    const same = recv >= visitDay0;                          // 방문 당일 접수
    const ppl = Number(String(r[6] || '').replace(/[^\d]/g, '')) || 0;
    const k = S[group(date)];
    k.n++; k.ppl += ppl; used++;
    if (late) { k.late++; k.latePpl += ppl; }
    if (same) k.same++;
    const di = (dayInfo[date] = dayInfo[date] || { n: 0, late: 0, ppl: 0, latePpl: 0 });
    di.n++; di.ppl += ppl; if (late) { di.late++; di.latePpl += ppl; }
  }
  // "닫았다면 놓쳤을 날": 그날 예약이 전부 마감 후 접수인 날 (화수목 기준)
  const lostDays = { '화수목': { days: 0, ppl: 0 }, '토일': { days: 0, ppl: 0 }, '금월': { days: 0, ppl: 0 } };
  for (const [d, di] of Object.entries(dayInfo)) if (di.n > 0 && di.late === di.n) { const k = lostDays[group(d)]; k.days++; k.ppl += di.ppl; }
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const lostMonth = k => Math.round(S[k].latePpl * CONTRIB / 2);   // 2개월치 → 월 환산

  const rows = [];
  const push = r => { rows.push(r); return rows.length - 1; };
  const iT = push([`화수목 마감후접수 ${S['화수목'].late}/${S['화수목'].n}건(${pct(S['화수목'].late, S['화수목'].n)}%) 놓칠날${lostDays['화수목'].days}일 ${S['화수목'].latePpl}명`]);
  const iS = push([`토일 마감후접수 ${S['토일'].late}/${S['토일'].n}건(${pct(S['토일'].late, S['토일'].n)}%) | 금월 ${S['금월'].late}/${S['금월'].n}건(${pct(S['금월'].late, S['금월'].n)}%)`]);
  push([`※ 마감후접수 = 방문 전날 ${CUTOFF_HOUR}시 이후 들어온 예약(당일 접수 포함) · ${FROM}~${TO} 취소 제외 ${used}건(접수일시 불명 ${noRecv}건 제외)`]);
  push([]);
  const iH = push(['구분', '예약 건수', '인원', '마감 후 접수 건수', '비율', '당일 접수 건수', '마감 후 인원', '월 환산 놓칠 이익(¥)']);
  const d0 = rows.length;
  for (const k of ['화수목', '토일', '금월']) push([k, S[k].n, S[k].ppl, S[k].late, pct(S[k].late, S[k].n) + '%', S[k].same, S[k].latePpl, lostMonth(k)]);
  const d1 = rows.length;
  push([]);
  const iN = push(['※ 놓칠 이익 = 마감 후 접수 인원 × 1인 공헌이익 3,195엔 ÷ 2개월 (그 손님이 전날 마감에 막혀 다른 날로 옮기지 않고 포기한다고 가정한 상한)']);

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const old = meta.data.sheets.find(s => s.properties.title === TAB);
  const reqs0 = [];
  if (old) reqs0.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  reqs0.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 5, columnCount: NCOL } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = created.data.replies[old ? 1 : 0].addSheet.properties.sheetId;
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });

  const C = { dark: { red: 0.122, green: 0.286, blue: 0.475 }, hdr: { red: 0.267, green: 0.447, blue: 0.769 }, band: { red: 0.955, green: 0.960, blue: 0.975 }, gold: { red: 1, green: 0.898, blue: 0.6 }, white: { red: 1, green: 1, blue: 1 }, note: { red: 0.45, green: 0.45, blue: 0.45 } };
  const R = [];
  const rng = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const fmt = (range, format, fields) => R.push({ repeatCell: { range, cell: { userEnteredFormat: format }, fields } });
  const gb = { style: 'SOLID', color: { red: 0.6, green: 0.6, blue: 0.6 } }, ib = { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } };
  for (const i of [iT, iS, iN]) R.push({ mergeCells: { range: rng(i, i + 1), mergeType: 'MERGE_ALL' } });
  R.push({ mergeCells: { range: rng(2, 3), mergeType: 'MERGE_ALL' } });
  fmt(rng(iT, iT + 1), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 11, foregroundColor: C.white }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)');
  fmt(rng(iS, iS + 1), { backgroundColor: C.hdr, textFormat: { bold: true, fontSize: 11, foregroundColor: C.white }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)');
  fmt(rng(2, 3), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  fmt(rng(iN, iN + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  fmt(rng(iH, iH + 1), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,wrapStrategy)');
  for (let r = d0; r < d1; r += 2) fmt(rng(r, r + 1), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor');
  fmt(rng(d0, d1, 0, 1), { textFormat: { bold: true }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(textFormat,horizontalAlignment)');
  fmt(rng(d0, d1, 1, 7), { horizontalAlignment: 'CENTER' }, 'userEnteredFormat.horizontalAlignment');
  fmt(rng(d0, d1, 7, 8), { backgroundColor: C.gold, textFormat: { bold: true }, numberFormat: { type: 'NUMBER', pattern: '¥#,##0' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment)');
  R.push({ updateBorders: { range: rng(iH, d1), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: NCOL }, properties: { pixelSize: 110 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  console.log(`[예약 리드타임 완료] ${FROM}~${TO} ${used}건 (접수일시 불명 ${noRecv}건)`);
  for (const k of ['화수목', '토일', '금월']) console.log(`${k}: 마감후접수 ${S[k].late}/${S[k].n}건(${pct(S[k].late, S[k].n)}%) 당일접수 ${S[k].same}건 | 마감후 인원 ${S[k].latePpl}/${S[k].ppl}명 | 놓칠 날 ${lostDays[k].days}일(${lostDays[k].ppl}명) | 월 환산 이익 약 ${lostMonth(k).toLocaleString('ja-JP')}엔`);
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
