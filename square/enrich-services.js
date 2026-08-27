// 서비스에 사진(image_ids) + 설명(description) 부여
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/opt/senba-square/.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const IMG = 'VLCG6ZXRKR5YMXD2GBJ2CG6E';
const SQ = async (m,p,b) => {
  const r = await fetch('https://connect.squareup.com/v2'+p,{method:m,headers:{Authorization:'Bearer '+env.SQUARE_ACCESS_TOKEN,'Square-Version':'2025-01-23','Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});
  const j = await r.json(); if (j.errors?.length) throw new Error(p+': '+JSON.stringify(j.errors)); return j;
};
const DESC = {
  '【平日】2h': '完全個室のアトリエでゆったりドローイング体験。エプロン・ベレー帽・絵の具など道具はすべてご用意、手ぶらでOK。1〜4名様・1組貸切／飲食物の持ち込み自由。完成した作品はお持ち帰りいただけます。',
  '【平日】3h': '3時間たっぷり制作したい方に。完全個室・1組貸切で、お子様連れやカップル、ご友人同士でゆっくりお話ししながらの制作にぴったり。道具はすべてご用意、手ぶらでOK。',
  '【土日祝】2h': '週末・祝日のドローイング体験。完全個室のアトリエを1組貸切、道具はすべてご用意で手ぶらでOK。1〜4名様／飲食物の持ち込み自由。完成した作品はお持ち帰りいただけます。',
  '【土日祝】3h': '週末・祝日に3時間たっぷり制作コース。完全個室・1組貸切で、記念日やデート、ご家族での思い出づくりに。道具はすべてご用意、手ぶらでOK。',
};
(async () => {
  const items = (await SQ('GET','/catalog/list?types=ITEM')).objects.filter(o=>o.item_data?.product_type==='APPOINTMENTS_SERVICE' && !o.item_data.name.includes('内部ブロック'));
  for (const it of items) {
    const key = (it.item_data.name.includes('土日祝')?'【土日祝】':'【平日】') + (it.item_data.variations[0].item_variation_data.service_duration===7200000?'2h':'3h');
    it.item_data.image_ids = [IMG];
    it.item_data.description = DESC[key];
    const res = await SQ('POST','/catalog/object',{ idempotency_key:'enrich-'+it.id+'-'+Date.now(), object: it });
    console.log('✅', key, '| 사진+설명 반영');
  }
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
