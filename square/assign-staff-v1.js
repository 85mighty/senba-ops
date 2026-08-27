// 서비스 ↔ 방 스태프 재배정 (초기 upsert에서 team_member_ids 유실 → 재시도)
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/opt/senba-square/.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const SQ = async (m, p, b) => {
  const r = await fetch('https://connect.squareup.com/v2'+p, { method:m, headers:{Authorization:'Bearer '+env.SQUARE_ACCESS_TOKEN,'Square-Version':'2025-01-23','Content-Type':'application/json'}, body: b?JSON.stringify(b):undefined });
  const j = await r.json();
  if (j.errors?.length) throw new Error(p+': '+JSON.stringify(j.errors));
  return j;
};
(async () => {
  const team = (await SQ('POST','/team-members/search',{})).team_members||[];
  const wk = team.filter(t=>t.family_name==='平日').map(t=>t.id);
  const we = team.filter(t=>t.family_name==='土日祝').map(t=>t.id);
  console.log('평일 방:', wk.length, '주말 방:', we.length);
  const items = (await SQ('GET','/catalog/list?types=ITEM')).objects.filter(o=>o.item_data?.product_type==='APPOINTMENTS_SERVICE');
  for (const it of items) {
    const isWeekend = it.item_data.name.includes('土日祝');
    it.item_data.variations[0].item_variation_data.team_member_ids = isWeekend ? we : wk;
    it.item_data.variations[0].item_variation_data.available_for_booking = true;
    const res = await SQ('POST','/catalog/object',{ idempotency_key: 'assign-'+it.id+'-'+Date.now(), object: it });
    const got = res.catalog_object.item_data.variations[0].item_variation_data.team_member_ids || [];
    console.log(it.item_data.name.slice(0,16)+'…', '→ 저장된 배정:', got.length+'명');
  }
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
