// Square 초기 세팅: 방 스태프 10명 + 서비스 4종(신가격) 생성/갱신 (2026-08-26)
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/opt/senba-square/.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>l.split('=')));
const TOKEN = env.SQUARE_ACCESS_TOKEN, LOC = env.SQUARE_LOCATION_ID;
const SQ = async (method, path, body) => {
  const r = await fetch('https://connect.squareup.com/v2' + path, {
    method, headers: { Authorization: 'Bearer ' + TOKEN, 'Square-Version': '2025-01-23', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (j.errors && j.errors.length) throw new Error(path + ': ' + JSON.stringify(j.errors));
  return j;
};

(async () => {
  // ── 1) 팀멤버 10명 (이미 있으면 재사용) ──
  const existing = (await SQ('POST', '/team-members/search', {})).team_members || [];
  const wanted = [];
  for (let i = 1; i <= 5; i++) wanted.push({ given_name: `Room${i}`, family_name: '平日' });
  for (let i = 1; i <= 5; i++) wanted.push({ given_name: `Room${i}`, family_name: '土日祝' });
  const ids = { 平日: [], 土日祝: [] };
  for (const w of wanted) {
    let tm = existing.find(t => t.given_name === w.given_name && t.family_name === w.family_name);
    if (!tm) {
      const res = await SQ('POST', '/team-members', { team_member: { given_name: w.given_name, family_name: w.family_name, assigned_locations: { assignment_type: 'EXPLICIT_LOCATIONS', location_ids: [LOC] } } });
      tm = res.team_member;
      console.log('스태프 생성:', w.given_name, w.family_name, tm.id);
    } else console.log('스태프 존재:', w.given_name, w.family_name, tm.id);
    ids[w.family_name].push(tm.id);
  }

  // ── 2) 서비스 4종 ──
  const cat = (await SQ('GET', '/catalog/list?types=ITEM')).objects || [];
  const old2h = cat.find(o => o.item_data?.name?.includes('2時間コース、お一人様3,000円'));
  const old3h = cat.find(o => o.item_data?.name?.includes('3時間コース、お一人様3,500円'));

  const H = 3600000;
  const svc = (idObj, name, price, durH, members, existingObj) => {
    const varId = existingObj ? existingObj.item_data.variations[0].id : `#var-${idObj}`;
    return {
      type: 'ITEM',
      id: existingObj ? existingObj.id : `#${idObj}`,
      version: existingObj ? existingObj.version : undefined,
      present_at_all_locations: true,
      item_data: {
        name, product_type: 'APPOINTMENTS_SERVICE',
        variations: [{
          type: 'ITEM_VARIATION',
          id: varId,
          version: existingObj ? existingObj.item_data.variations[0].version : undefined,
          item_variation_data: {
            item_id: existingObj ? existingObj.id : `#${idObj}`,
            name: 'Regular', pricing_type: 'FIXED_PRICING',
            price_money: { amount: price, currency: 'JPY' },
            service_duration: durH * H,
            available_for_booking: true,
            team_member_ids: members,
          },
        }],
      },
    };
  };
  const objects = [
    svc('wd2h', '【平日】完全個室でアート体験『2時間コース、お一人様3,200円』', 3200, 2, ids['平日'], old2h),
    svc('wd3h', '【平日】完全個室でアート体験『3時間コース、お一人様3,700円』', 3700, 3, ids['平日'], old3h),
    svc('we2h', '【土日祝】完全個室でアート体験『2時間コース、お一人様3,700円』', 3700, 2, ids['土日祝'], null),
    svc('we3h', '【土日祝】完全個室でアート体験『3時間コース、お一人様4,200円』', 4200, 3, ids['土日祝'], null),
  ];
  const res = await SQ('POST', '/catalog/batch-upsert', { idempotency_key: 'senba-setup-' + Date.now(), batches: [{ objects }] });
  console.log('서비스 업서트:', (res.objects || []).length, '건');
  (res.objects || []).forEach(o => console.log(' -', o.item_data?.name, '| ¥' + o.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount));
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
