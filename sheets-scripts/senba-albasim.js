// 「알바 시뮬 (예약일 출근)」 탭 — "예약 있는 날만, 첫 예약 −N분 ~ 마지막 예약 종료 +M분" 시뮬레이션 (2026-10-10)
// 데이터: 매출 시트(船場美術館)의 「예약관리」 탭 = 9월 방문분 (취소 제외, 코스에서 시간 추출, 없으면 2시간)
// 연속안: 하루 한 번 출근해 마지막까지 근무 / 분할안: 예약 사이 공백이 GAP분 이상이면 퇴근 후 재출근 (참고, 값 고정)
// 연속안은 수식(앞·뒤 여유·시급을 바꾸면 재계산). 실제 비교 = 「알바비 계산」 탭 수동입력분(9월)
const path = require('path');
const { google } = require(path.join('/opt/senba-sales-sync/node_modules/googleapis'));

const LEDGER_ID = '1sUXyrXxYzl_n6n5T4dV_flQ6Ocli3c0B-Ggbwzw5YC4';   // 船場美術館 (예약관리 탭)
const SHEET_ID = '1OiQnj_slGsZvQ8BBQBP6a6eK3_j4J35nCReSTT2HRgc';    // 자산현황
const TAB = '알바 시뮬 (예약일 출근)';
const MONTH = '2026-09';
const LEAD = 15, TAIL = 15, WAGE = 1200, GAP = 120;
const NCOL = 11;
const WD = '日月火水木金土';

const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const ceil15 = min => Math.ceil(min / 15) * 15;
const courseHours = c => { const m = String(c || '').match(/(\d+)\s*(時間|시간|h)/i); const h = m ? Number(m[1]) : 2; return h >= 1 && h <= 8 ? h : 2; };

function dayCost(bks, lead, tail, gap, wage = WAGE, minDay = 0) {   // bks: [{s,e}] 분 단위 → 알바비·시간
  const iv = bks.map(b => [b.s - lead, b.e + tail]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const x of iv) {
    const last = merged[merged.length - 1];
    if (last && x[0] - last[1] < gap) last[1] = Math.max(last[1], x[1]); else merged.push([...x]);
  }
  const mins = Math.max(minDay, merged.reduce((s, [a, b]) => s + ceil15(b - a), 0));
  return { mins, pay: Math.round(mins / 60 * wage), shifts: merged.length };
}

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: '/opt/senba-sales-sync/service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  // ── 1) 9월 예약 읽기
  const g = await sheets.spreadsheets.values.get({ spreadsheetId: LEDGER_ID, range: `'예약관리'!A2:R`, valueRenderOption: 'FORMATTED_VALUE' });
  const days = {};
  let used = 0, skipped = 0;
  for (const r of g.data.values || []) {
    const status = String(r[1] || '');
    const dm = String(r[4] || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    const tm = String(r[5] || '').match(/(\d{1,2}):(\d{2})/);
    if (!dm || !tm) { skipped++; continue; }
    const date = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
    if (!date.startsWith(MONTH) || status.includes('취소')) continue;
    const s = Number(tm[1]) * 60 + Number(tm[2]);
    const e = s + courseHours(r[8]) * 60;
    (days[date] = days[date] || []).push({ s, e });
    used++;
  }
  const dates = Object.keys(days).sort();
  if (!dates.length) throw new Error(`${MONTH} 예약을 못 찾음 (예약관리 탭 확인) — 건너뜀 ${skipped}`);

  // ── 2) JS 검산 (시트 수식과 같은 규칙)
  const calc = (lead, tail, gap) => dates.reduce((a, d) => { const c = dayCost(days[d], lead, tail, gap); a.pay += c.pay; a.mins += c.mins; return a; }, { pay: 0, mins: 0 });
  const byWd = {};
  for (const d of dates) {
    const w = WD[new Date(d + 'T12:00:00').getDay()];
    const c = dayCost(days[d], LEAD, TAIL, 99999);
    byWd[w] = byWd[w] || { n: 0, pay: 0 };
    byWd[w].n++; byWd[w].pay += c.pay;
  }
  const A = calc(LEAD, TAIL, 99999), B = calc(LEAD, TAIL, GAP), A45 = calc(45, TAIL, 99999);
  // 금토일월(현행 근무일) vs 화수목(신규) 그룹 비교 + 시급 1,300 시나리오
  const grp = d => ('金土日月'.includes(WD[new Date(d + 'T12:00:00').getDay()]) ? 'FM' : 'TWT');
  const G = (lead, tail, gap, wage, minDay = 0) => { const o = { FM: { n: 0, pay: 0 }, TWT: { n: 0, pay: 0 } }; for (const d of dates) { const c = dayCost(days[d], lead, tail, gap, wage, minDay); const k = o[grp(d)]; k.n++; k.pay += c.pay; } return o; };
  const S1200 = G(LEAD, TAIL, 99999, 1200), S1300 = G(LEAD, TAIL, 99999, 1300), S1300b = G(45, TAIL, 99999, 1300), S1300s = G(LEAD, TAIL, GAP, 1300), S1300m3 = G(LEAD, TAIL, 99999, 1300, 180), S1300m4 = G(LEAD, TAIL, 99999, 1300, 240);
  const mv = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'알바비 계산'!A6:E65`, valueRenderOption: 'FORMATTED_VALUE' });
  const act = { FM: { n: 0, pay: 0 }, TWT: { n: 0, pay: 0 } };
  for (const r of mv.data.values || []) {
    const dm = String(r[0] || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    const pay = Number(String(r[4] || '').replace(/[^\d]/g, '')) || 0;
    if (!dm || !pay) continue;
    const d = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
    if (!d.startsWith(MONTH)) continue;
    const k = act[grp(d)]; k.n++; k.pay += pay;
  }

  // ── 3) 탭 구성
  const rows = [];
  const push = r => { rows.push(r); return rows.length - 1; };
  const sum = o => o.FM.pay + o.TWT.pay;
  const iTitle = push([`9월 알바시뮬 현행${act.FM.pay}(${act.FM.n}일) | 1200안${sum(S1200)} | 1300안${sum(S1300)}(금토일월${S1300.FM.pay}+화수목${S1300.TWT.pay})`]);
  const iSub = push([`최소3h${sum(S1300m3)}(금${S1300m3.FM.pay}+화수${S1300m3.TWT.pay}) 최소4h${sum(S1300m4)} 분할${sum(S1300s)} 앞45분${sum(S1300b)} | 예약일수 금토일월${S1300.FM.n}/화수목${S1300.TWT.n} | 예약관리 탭 ${MONTH} 방문 ${used}건(취소 제외) · 하루 첫 예약 −${LEAD}분 ~ 마지막 예약 종료 +${TAIL}분 · 15분 단위 올림 · 2026-10-10`]);
  push([]);
  const rLead = push(['앞 여유(분)', LEAD, '첫 예약 시작 전 출근 (노란 칸을 바꾸면 연속안 재계산)']);
  const rTail = push(['뒤 여유(분)', TAIL, '마지막 예약 종료 후 정리·퇴근']);
  const rWage = push(['시급(¥)', WAGE, '']);
  push([]);
  const iSum = push(['■ 9월 합계']);
  const rN = push(['예약 있는 날(출근일)', '', '']);
  const rA = push(['연속안 알바비 (하루 1회 출근)', '', '예약 있는 모든 요일(화수목 포함)에 고용했다면']);
  const rB = push([`분할안 알바비 (공백 ${GAP}분↑이면 재출근)`, '', '참고 — 기본값(15/15) 기준 고정값']);
  const rAct = push(['실제 9월 알바비 (알바비 계산 탭)', '', '금토일월 실근무분 수동입력 합계']);
  const rDiff = push(['연속안 − 실제', '', '추가로 들었을 비용']);
  push([]);
  const iDet = push(['■ 일별 상세']);
  const hDet = push(['날짜', '요일', '예약수', '첫 시작', '마지막 종료', '근무 시작', '근무 종료', '시간(h)', '연속안 알바비', '분할안 알바비', '실제(알바비 계산)']);
  const d0 = rows.length;
  for (const d of dates) {
    const bks = days[d];
    const r = rows.length + 1;   // 시트 행 번호(1-기준)
    const first = Math.min(...bks.map(b => b.s)), last = Math.max(...bks.map(b => b.e));
    push([
      d, WD[new Date(d + 'T12:00:00').getDay()], bks.length, hhmm(first), hhmm(last),
      `=D${r}-$B$${rLead + 1}/1440`, `=E${r}+$B$${rTail + 1}/1440`,
      `=CEILING(ROUND((G${r}-F${r})*24*60,0)/60,0.25)`,
      `=H${r}*$B$${rWage + 1}`,
      dayCost(bks, LEAD, TAIL, GAP).pay,
      `=SUMIF('알바비 계산'!$A$6:$A$65,A${r},'알바비 계산'!$E$6:$E$65)`,
    ]);
  }
  const d1 = rows.length;
  const rTot = push(['합계', '', `=SUM(C${d0 + 1}:C${d1})`, '', '', '', '', `=SUM(H${d0 + 1}:H${d1})`, `=SUM(I${d0 + 1}:I${d1})`, `=SUM(J${d0 + 1}:J${d1})`, `=SUM(K${d0 + 1}:K${d1})`]);
  push([]);
  const iWd = push(['■ 요일별 (연속안, 앞/뒤 15분 기준 고정값)']);
  const hWd = push(['요일', '출근일', '알바비', '1일 평균']);
  const w0 = rows.length;
  for (const w of '月火水木金土日') if (byWd[w]) push([w, byWd[w].n, byWd[w].pay, Math.round(byWd[w].pay / byWd[w].n)]);
  const w1 = rows.length;
  push([]);
  const iCmp = push(['■ 방식·시급 비교 (9월, 고정값)']);
  const hCmp = push(['방식', '금토일월 일수', '금토일월 알바비', '화수목 일수', '화수목 알바비', '합계']);
  const c0 = rows.length;
  const cmp = (name, o) => push([name, o.FM.n, o.FM.pay, o.TWT.n, o.TWT.pay, o.FM.pay + o.TWT.pay]);
  push(['현행: 금토일월 고정 근무 (1,200엔, 실제 입력분)', act.FM.n, act.FM.pay, 0, 0, act.FM.pay]);
  cmp('예약일만 출근 · 1,200엔 · 앞/뒤 15분', S1200);
  cmp('예약일만 출근 · 1,300엔 · 앞/뒤 15분', S1300);
  cmp('예약일만 출근 · 1,300엔 · 앞 45분/뒤 15분', S1300b);
  cmp(`예약일만 출근 · 1,300엔 · 분할(공백 ${GAP}분↑ 재출근)`, S1300s);
  cmp('예약일만 출근 · 1,300엔 · 하루 최소 3시간 보장', S1300m3);
  cmp('예약일만 출근 · 1,300엔 · 하루 최소 4시간 보장', S1300m4);
  const c1 = rows.length;

  // 요약 수식
  rows[rN][1] = `=COUNT(A${d0 + 1}:A${d1})`;
  rows[rA][1] = `=I${rTot + 1}`;
  rows[rB][1] = `=J${rTot + 1}`;
  rows[rAct][1] = `=K${rTot + 1}`;
  rows[rDiff][1] = `=B${rA + 1}-B${rAct + 1}`;

  // ── 4) 시트 생성·기입
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const old = meta.data.sheets.find(s => s.properties.title === TAB);
  const reqs0 = [];
  if (old) reqs0.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  reqs0.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 5, columnCount: NCOL } } } });
  const created = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs0 } });
  const sid = created.data.replies[old ? 1 : 0].addSheet.properties.sheetId;
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'USER_ENTERED', requestBody: { values: rows } });

  const C = {
    dark: { red: 0.122, green: 0.286, blue: 0.475 }, hdr: { red: 0.267, green: 0.447, blue: 0.769 },
    sec: { red: 0.851, green: 0.882, blue: 0.949 }, gold: { red: 1, green: 0.898, blue: 0.6 },
    band: { red: 0.955, green: 0.960, blue: 0.975 }, white: { red: 1, green: 1, blue: 1 },
    note: { red: 0.45, green: 0.45, blue: 0.45 }, inp: { red: 1, green: 0.97, blue: 0.85 },
  };
  const R = [];
  const rng = (r0, r1, c0 = 0, c1 = NCOL) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const fmt = (range, format, fields) => R.push({ repeatCell: { range, cell: { userEnteredFormat: format }, fields } });
  const gb = { style: 'SOLID', color: { red: 0.6, green: 0.6, blue: 0.6 } }, ib = { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } };
  const YEN = { numberFormat: { type: 'NUMBER', pattern: '¥#,##0;[Red]-¥#,##0' }, horizontalAlignment: 'RIGHT' };
  const merge = (r0, r1, c0, c1) => R.push({ mergeCells: { range: rng(r0, r1, c0, c1), mergeType: 'MERGE_ALL' } });

  merge(iTitle, iTitle + 1, 0, NCOL);
  fmt(rng(iTitle, iTitle + 1), { backgroundColor: C.dark, textFormat: { bold: true, fontSize: 13, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)');
  merge(iSub, iSub + 1, 0, NCOL);
  fmt(rng(iSub, iSub + 1), { textFormat: { italic: true, fontSize: 9, foregroundColor: C.note }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(textFormat,horizontalAlignment)');
  // 입력 3칸
  fmt(rng(rLead, rWage + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  fmt(rng(rLead, rWage + 1, 1, 2), { backgroundColor: C.inp, textFormat: { bold: true }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)');
  for (const i of [rLead, rTail, rWage]) merge(i, i + 1, 2, NCOL);
  fmt(rng(rLead, rWage + 1, 2, NCOL), { textFormat: { fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  // 섹션 헤더
  for (const i of [iSum, iDet, iWd]) { merge(i, i + 1, 0, NCOL); fmt(rng(i, i + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)'); }
  // 요약
  fmt(rng(rN, rDiff + 1, 0, 1), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold');
  fmt(rng(rN, rN + 1, 1, 2), { numberFormat: { type: 'NUMBER', pattern: '0"일"' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  fmt(rng(rA, rDiff + 1, 1, 2), YEN, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  fmt(rng(rA, rA + 1, 0, 2), { backgroundColor: C.gold, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
  for (const i of [rN, rA, rB, rAct, rDiff]) merge(i, i + 1, 2, NCOL);
  fmt(rng(rN, rDiff + 1, 2, NCOL), { textFormat: { fontSize: 9, foregroundColor: C.note } }, 'userEnteredFormat.textFormat');
  R.push({ updateBorders: { range: rng(rN, rDiff + 1, 0, 2), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  // 일별 표
  fmt(rng(hDet, hDet + 1), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)');
  for (let r = d0; r < d1; r += 2) fmt(rng(r, r + 1), { backgroundColor: C.band }, 'userEnteredFormat.backgroundColor');
  fmt(rng(d0, d1, 0, 1), { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd (ddd)' }, textFormat: { bold: true }, horizontalAlignment: 'LEFT' }, 'userEnteredFormat(numberFormat,textFormat,horizontalAlignment)');
  fmt(rng(d0, d1, 1, 3), { horizontalAlignment: 'CENTER' }, 'userEnteredFormat.horizontalAlignment');
  fmt(rng(d0, d1, 3, 7), { numberFormat: { type: 'TIME', pattern: 'hh:mm' }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  fmt(rng(d0, d1, 7, 8), { numberFormat: { type: 'NUMBER', pattern: '0.00' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  fmt(rng(d0, d1, 8, 11), YEN, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  fmt(rng(d0, d1, 8, 9), { backgroundColor: C.gold, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
  fmt(rng(rTot, rTot + 1), { backgroundColor: C.sec, textFormat: { bold: true } }, 'userEnteredFormat(backgroundColor,textFormat.bold)');
  fmt(rng(rTot, rTot + 1, 7, 8), { numberFormat: { type: 'NUMBER', pattern: '0.00' }, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  fmt(rng(rTot, rTot + 1, 8, 11), YEN, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  R.push({ updateBorders: { range: rng(hDet, rTot + 1), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  // 요일별
  fmt(rng(hWd, hWd + 1, 0, 4), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)');
  fmt(rng(w0, w1, 0, 2), { horizontalAlignment: 'CENTER', textFormat: { bold: true } }, 'userEnteredFormat(horizontalAlignment,textFormat)');
  fmt(rng(w0, w1, 2, 4), YEN, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  R.push({ updateBorders: { range: rng(hWd, w1, 0, 4), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  merge(iCmp, iCmp + 1, 0, NCOL); fmt(rng(iCmp, iCmp + 1), { backgroundColor: C.sec, textFormat: { bold: true, fontSize: 11 } }, 'userEnteredFormat(backgroundColor,textFormat)');
  fmt(rng(hCmp, hCmp + 1, 0, 6), { backgroundColor: C.hdr, textFormat: { bold: true, foregroundColor: C.white }, horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,wrapStrategy)');
  fmt(rng(c0, c1, 0, 1), { textFormat: { bold: true }, wrapStrategy: 'WRAP' }, 'userEnteredFormat(textFormat,wrapStrategy)');
  fmt(rng(c0, c1, 1, 2), { horizontalAlignment: 'CENTER', numberFormat: { type: 'NUMBER', pattern: '0"일"' } }, 'userEnteredFormat(horizontalAlignment,numberFormat)');
  fmt(rng(c0, c1, 3, 4), { horizontalAlignment: 'CENTER', numberFormat: { type: 'NUMBER', pattern: '0"일"' } }, 'userEnteredFormat(horizontalAlignment,numberFormat)');
  for (const c of [2, 4]) fmt(rng(c0, c1, c, c + 1), YEN, 'userEnteredFormat(numberFormat,horizontalAlignment)');
  fmt(rng(c0, c1, 5, 6), { backgroundColor: C.gold, textFormat: { bold: true }, numberFormat: YEN.numberFormat, horizontalAlignment: 'RIGHT' }, 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment)');
  R.push({ updateBorders: { range: rng(hCmp, c1, 0, 6), top: gb, bottom: gb, left: gb, right: gb, innerHorizontal: ib, innerVertical: ib } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 250 }, fields: 'pixelSize' } });
  R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: NCOL }, properties: { pixelSize: 100 }, fields: 'pixelSize' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: R } });

  // ── 5) 로그 → 텔레그램 (runner 가 끝 1200자 전송)
  console.log(`[알바 시뮬 완료] ${MONTH} 예약 ${used}건 / 출근일 ${dates.length}일 (건너뜀 ${skipped})`);
  console.log(`연속안(앞${LEAD}/뒤${TAIL}) ${A.pay.toLocaleString('ja-JP')}엔 (${(A.mins / 60).toFixed(1)}h) | 앞45분안 ${A45.pay.toLocaleString('ja-JP')}엔 | 분할안 ${B.pay.toLocaleString('ja-JP')}엔`);
  const T = o => (o.FM.pay + o.TWT.pay).toLocaleString('ja-JP');
  console.log(`현행(실제) 금토일월 ${act.FM.n}일 ${act.FM.pay.toLocaleString('ja-JP')}엔 | 예약일만출근 1200엔 ${T(S1200)}엔(금토일월 ${S1200.FM.n}일 ${S1200.FM.pay.toLocaleString('ja-JP')} + 화수목 ${S1200.TWT.n}일 ${S1200.TWT.pay.toLocaleString('ja-JP')}) | 1300엔 ${T(S1300)}엔(금토일월 ${S1300.FM.pay.toLocaleString('ja-JP')} + 화수목 ${S1300.TWT.pay.toLocaleString('ja-JP')}) | 1300·분할 ${T(S1300s)}엔`);
  console.log(`최소3h보장 ${T(S1300m3)}엔 | 최소4h보장 ${T(S1300m4)}엔`);
  console.log('요일별: ' + '月火水木金土日'.split('').filter(w => byWd[w]).map(w => `${w} ${byWd[w].n}일 ${byWd[w].pay.toLocaleString('ja-JP')}엔`).join(' / '));
})().catch(e => { console.error('ERROR:', e.response?.data?.error?.message || e.message); process.exit(1); });
