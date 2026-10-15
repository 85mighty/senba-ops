// Yahoo!쇼핑 상품검색 API (V3 itemSearch) — 일본 시장 최저가 보강
// 무료. YAHOO_CLIENT_ID 필요. 공식 스토어가 있으면 brands.json의 seller_id로 한정.
import { info } from '../../util.js';
import { extractCode } from '../../matcher/rules.js';

const ENDPOINT = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';

export async function collect(brandKey, brandCfg, { limit } = {}) {
  const cfg = brandCfg.jp?.yahoo;
  if (!cfg?.enabled || !process.env.YAHOO_CLIENT_ID) return [];

  const params = new URLSearchParams({
    appid: process.env.YAHOO_CLIENT_ID,
    query: cfg.query,
    results: String(Math.min(limit || 50, 50)),
    sort: '+price', // 최저가부터
    in_stock: 'true',
  });
  if (cfg.seller_id) params.set('seller_id', cfg.seller_id);

  const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Yahoo API HTTP ${res.status}`);
  const data = await res.json();

  const items = (data.hits || []).map((it) => ({
    brand: brandKey,
    source: 'yahoo',
    product_code: extractCode(it.name, brandCfg.product_code_regex),
    name: it.name,
    color: null,
    price: it.price,
    url: it.url,
    image_url: it.image?.medium || null,
    in_stock: it.inStock !== false,
    review_count: it.review?.count || 0,
  }));
  info(`[yahoo] ${brandKey}: ${items.length}건`);
  return items;
}
