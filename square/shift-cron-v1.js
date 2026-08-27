// 밤 21시(JST) 시프트 크론 — 자동화 ④ (2026-08-26)
// 내일 첫 예약 기준 알바 출근 판정(12:30/13:30) → 출근 전 이른 슬롯 자동 블록 → 텔레그램 통보
// 규칙(사용자 확정): 첫 예약 시작 13:45 이전(12:45~13:30) → 12:30 출근(블록 없음)
//                    첫 예약 13:45 이후 또는 예약 0건       → 13:30 출근(12:45~13:45 블록)
// 당일 예약은 출근+15분부터 열림. 블록은 내부 서비스(60분, 12:45~13:45) 예약으로 구현.
require('dns').setDefaultResultOrder('ipv4first');
const fs = require('fs');
const envOf = f => Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const env = envOf('/opt/senba-square/.env');
const TG = envOf('/opt/senba-sales-sync/.env');
const DRY = process.argv.includes('--dry');
const SQ = async (m,p,b) => {
  const r = await fetch('https://connect.squareup.com/v2'+p,{method:m,headers:{Authorization:'Bearer '+env.SQUARE_ACCESS_TOKEN,'Square-Version':'2025-01-23','Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});
  const j = await r.json(); if (j.errors?.length) throw new Error(p+': '+JSON.stringify(j.errors)); return j;
};
const tg = async text => {
  if (DRY) return console.log('[DRY-TG]', text.replace(/\n/g,' | '));
  await fetch(`https://api.telegram.org/bot${TG.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:TG.TELEGRAM_CHAT_ID,text,parse_mode:'HTML'})}).catch(e=>console.error('tg fail:',e.message));
};

(async () => {
  // 내일(JST) 날짜
  const nowJST = new Date(Date.now() + 9*3600e3);
  const tomorrow = new Date(nowJST); tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  const ymd = tomorrow.toISOString().slice(0,10);
  const dow = tomorrow.getUTCDay();                 // JST 기준 요일
  const isWeekend = dow === 0 || dow === 6;
  const dayLabel = ymd.slice(5).replace('-','/') + '(' + '日月火水木金土'[dow] + ')';

  // 내일 예약 조회 (블록 고객 제외)
  const res = await SQ('GET', `/bookings?location_id=${env.SQUARE_LOCATION_ID}&start_at_min=${ymd}T00:00:00%2B09:00&start_at_max=${ymd}T23:59:59%2B09:00&limit=100`);
  const bookings = (res.bookings||[]).filter(b => ['ACCEPTED','PENDING'].includes(b.status) && b.customer_id !== env.SQUARE_BLOCK_CUSTOMER_ID);
  bookings.sort((a,b)=>a.start_at.localeCompare(b.start_at));
  const jstHM = iso => new Date(iso).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'});
  const first = bookings[0] ? jstHM(bookings[0].start_at) : null;

  // 출근 판정
  const early = first && first < '13:45';
  const shift = early ? '12:30' : '13:30';

  console.log(`[shift] ${ymd} 예약 ${bookings.length}건, 첫 예약 ${first||'없음'} → 출근 ${shift}`);

  // 13:30 출근이면 이른 슬롯 블록 (내일 요일에 맞는 방 5개, 12:45~13:45)
  let blocked = 0, blockDenied = false;
  if (!early) {
    const team = (await SQ('POST','/team-members/search',{})).team_members||[];
    const rooms = team.filter(t => t.family_name === (isWeekend ? '土日祝' : '平日'));
    const already = new Set((res.bookings||[]).filter(b => b.customer_id === env.SQUARE_BLOCK_CUSTOMER_ID && b.status === 'ACCEPTED').map(b => b.appointment_segments?.[0]?.team_member_id));
    for (const r of rooms) {
      if (already.has(r.id)) { blocked++; continue; }
      if (DRY) { console.log('[DRY] 블록 예정:', r.given_name, r.family_name); blocked++; continue; }
      try {
        await SQ('POST','/bookings',{ idempotency_key:`blk-${ymd}-${r.id}`, booking:{
          location_id: env.SQUARE_LOCATION_ID,
          start_at: `${ymd}T12:45:00+09:00`,
          customer_id: env.SQUARE_BLOCK_CUSTOMER_ID,
          customer_note: '자동 시프트 블록 (알바 13:30 출근)',
          appointment_segments: [{ team_member_id: r.id, service_variation_id: env.SQUARE_BLOCK_VARIATION_ID, service_variation_version: Number(env.SQUARE_BLOCK_VARIATION_VERSION) }],
        }});
        blocked++;
      } catch (e) {
        if (e.message.includes('does not support write operations')) { blockDenied = true; break; }
        console.error('블록 실패:', r.given_name, r.family_name, e.message);
      }
    }
  }

  // 텔레그램 통보
  const list = bookings.slice(0,8).map(b => `· ${jstHM(b.start_at)} ${b.appointment_segments?.[0]?.duration_minutes||''}분`).join('\n');
  await tg(`🗓 <b>센바 내일(${dayLabel}) 시프트</b>\n알바 출근: <b>${shift}</b>${first?` (첫 예약 ${first})`:' (예약 없음)'}\n예약 ${bookings.length}건${list?'\n'+list:''}${!early ? (blockDenied ? '\n⚠️ 이른 슬롯(12:45~13:30)이 열려 있음 — 자동 블록은 유료 플랜 필요. 당일 이른 예약이 오면 웹훅 알림 보고 알바 출근 조정' : `\n🔒 12:45~13:30 슬롯 자동 블록 (${blocked}방)`) : ''}`);
})().catch(async e => { console.error('FAIL:', e.message); });
