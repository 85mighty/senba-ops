// 시프트 크론용 자산: 내부 블록 서비스(비공개 60분) + 블록용 고객 생성
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/opt/senba-square/.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const SQ = async (m,p,b) => {
  const r = await fetch('https://connect.squareup.com/v2'+p,{method:m,headers:{Authorization:'Bearer '+env.SQUARE_ACCESS_TOKEN,'Square-Version':'2025-01-23','Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});
  const j = await r.json(); if (j.errors?.length) throw new Error(p+': '+JSON.stringify(j.errors)); return j;
};
(async () => {
  const team = (await SQ('POST','/team-members/search',{})).team_members||[];
  const roomIds = team.filter(t=>['平日','土日祝'].includes(t.family_name)).map(t=>t.id);

  // 1) 블록 서비스 (온라인 비노출)
  const items = (await SQ('GET','/catalog/list?types=ITEM')).objects||[];
  let block = items.find(o=>o.item_data?.name==='内部ブロック（自動シフト）');
  if (!block) {
    const res = await SQ('POST','/catalog/object',{ idempotency_key:'blk-'+Date.now(), object:{
      type:'ITEM', id:'#blk', present_at_all_locations:true,
      item_data:{ name:'内部ブロック（自動シフト）', product_type:'APPOINTMENTS_SERVICE',
        variations:[{ type:'ITEM_VARIATION', id:'#blkv', item_variation_data:{
          item_id:'#blk', name:'Regular', pricing_type:'FIXED_PRICING',
          price_money:{amount:0,currency:'JPY'}, service_duration:3600000,
          available_for_booking:false, team_member_ids: roomIds } }] } } });
    block = res.catalog_object;
    console.log('블록 서비스 생성:', block.id);
  } else console.log('블록 서비스 존재:', block.id);
  const v = block.item_data.variations[0];

  // 2) 블록 고객
  const found = await SQ('POST','/customers/search',{ query:{ filter:{ reference_id:{ exact:'senba-shift-block' } } } });
  let cust = (found.customers||[])[0];
  if (!cust) {
    cust = (await SQ('POST','/customers',{ given_name:'シフト', family_name:'自動ブロック', reference_id:'senba-shift-block', note:'자동 시프트 크론이 이른 슬롯을 막을 때 쓰는 내부 고객' })).customer;
    console.log('블록 고객 생성:', cust.id);
  } else console.log('블록 고객 존재:', cust.id);

  const lines = fs.readFileSync('/opt/senba-square/.env','utf8').split('\n').filter(l=>l && !l.startsWith('SQUARE_BLOCK_'));
  lines.push('SQUARE_BLOCK_VARIATION_ID='+v.id, 'SQUARE_BLOCK_VARIATION_VERSION='+v.version, 'SQUARE_BLOCK_CUSTOMER_ID='+cust.id);
  fs.writeFileSync('/opt/senba-square/.env', lines.join('\n')+'\n');
  console.log('env 저장 완료');
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
