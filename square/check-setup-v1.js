// Square 세팅 종합 점검 (2026-08-26)
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/opt/senba-square/.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const SQ = async (m,p,b) => {
  const r = await fetch('https://connect.squareup.com/v2'+p,{method:m,headers:{Authorization:'Bearer '+env.SQUARE_ACCESS_TOKEN,'Square-Version':'2025-01-23','Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});
  const j = await r.json(); if (j.errors?.length) throw new Error(p+': '+JSON.stringify(j.errors)); return j;
};
const LOC = env.SQUARE_LOCATION_ID;
(async () => {
  // 1) 온라인 예약 전체 상태
  const bp = (await SQ('GET','/bookings/business-booking-profile')).business_booking_profile || {};
  console.log('■ 온라인 예약:', bp.booking_enabled ? '✅ 활성' : '❌ 비활성', '| 정책:', bp.booking_policy, '| 고객 시간대선택:', bp.customer_timezone_choice);
  // 2) 예약 가능 스태프
  const profiles = (await SQ('GET','/bookings/team-member-booking-profiles?bookable_only=true&limit=32')).team_member_booking_profiles || [];
  console.log('■ 예약 가능 스태프:', profiles.length + '명');
  // 3) 로케이션 영업시간
  const loc = (await SQ('GET','/locations/'+LOC)).location;
  console.log('■ 로케이션 영업시간:', JSON.stringify((loc.business_hours?.periods||[]).map(p=>p.day_of_week+' '+p.start_local_time+'-'+p.end_local_time)));
  // 4) 서비스 목록 + variation id
  const items = (await SQ('GET','/catalog/list?types=ITEM')).objects.filter(o=>o.item_data?.product_type==='APPOINTMENTS_SERVICE');
  const svc = {};
  for (const it of items) {
    const v = it.item_data.variations[0];
    const vd = v.item_variation_data;
    const key = (it.item_data.name.includes('土日祝')?'주말':'평일') + (vd.service_duration===7200000?'2h':'3h');
    svc[key] = v.id;
    console.log('■ 서비스:', it.item_data.name.slice(0,14)+'…', '¥'+vd.price_money.amount, (vd.service_duration/3600000)+'h', '스태프 '+(vd.team_member_ids||[]).length+'명');
  }
  // 5) 실제 빈자리 검색 — 다음 주 금요일(평일)과 토요일
  const now = new Date();
  const nextSat = new Date(now); nextSat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
  const nextFri = new Date(nextSat); nextFri.setDate(nextSat.getDate() - 1);
  const range = d => ({ start_at: d.toISOString().slice(0,10)+'T00:00:00+09:00', end_at: d.toISOString().slice(0,10)+'T23:59:59+09:00' });
  const search = async (varId, day) => {
    const r = await SQ('POST','/bookings/availability/search',{ query:{ filter:{ location_id: LOC, start_at_range: range(day), segment_filters:[{ service_variation_id: varId }] } } });
    return (r.availabilities||[]).map(a=>new Date(a.start_at).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}));
  };
  const fmt = d => (d.getMonth()+1)+'/'+d.getDate();
  console.log('■ 평일2h @ 금요일('+fmt(nextFri)+'):', (await search(svc['평일2h'], nextFri)).join(', ') || '슬롯 없음');
  console.log('■ 평일2h @ 토요일('+fmt(nextSat)+'):', (await search(svc['평일2h'], nextSat)).join(', ') || '(정상: 슬롯 없어야 함)');
  console.log('■ 주말2h @ 토요일('+fmt(nextSat)+'):', (await search(svc['주말2h'], nextSat)).join(', ') || '슬롯 없음');
  console.log('■ 주말3h @ 토요일('+fmt(nextSat)+'):', (await search(svc['주말3h'], nextSat)).join(', ') || '슬롯 없음');
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
