// 라쿠텐 상품검색 API (IchibaItem/Search) — 일본 시장 최저가 보강
// 무료. RAKUTEN_APP_ID 필요. 브랜드 공식 라쿠텐점이 있으면 brands.json의 shop_code로 한정.
import { info, sleep } from '../../util.js';
import { extractCode } from '../../matcher/rules.js';

const ENDPOINT = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601';

export async function collect(brandKey, brandCfg, { limit } = {}) {
  const cfg = brandCfg.jp?.rakuten;
  if (!cfg?.enabled || !process.env.RAKUTEN_APP_ID) return [];

  const items = [];
  const maxHits = Math.min(limit || 60, 60);
  const pages = Math.ceil(maxHits / 30);

  for (let page = 1; page <= pages; page++) {
    const params = new URLSearchParams({
      applicationId: process.env.RAKUTEN_APP_ID,
      keyword: cfg.keyword,
      hits: '30',
      page: String(page),
      sort: '+itemPrice', // 최저가부터
      availability: '1',
      format: 'json',
    });
    if (cfg.shop_code) params.set('shopCode', cfg.shop_code);

    const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`라쿠텐 API HTTP ${res.status}`);
    const data = await res.json();

    for (const wrap of data.Items || []) {
      const it = wrap.Item;
      items.push({
        brand: brandKey,
        source: 'rakuten',
        product_code: extractCode(it.itemName, brandCfg.product_code_regex),
        name: it.itemName,
        color: null,
        price: it.itemPrice,
        url: it.itemUrl,
        image_url: it.mediumImageUrls?.[0]?.imageUrl || null,
        in_stock: it.availability === 1,
      });
      if (items.length >= maxHits) break;
    }
    if ((data.Items || []).length < 30 || items.length >= maxHits) break;
    await sleep(1200); // API 예절
  }
  info(`[rakuten] ${brandKey}: ${items.length}건`);
  return items;
}
