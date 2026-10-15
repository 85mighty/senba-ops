// 라쿠텐 상품검색 API (IchibaItem/Search) — 일본 시장 최저가 보강
// 무료. RAKUTEN_APP_ID 필요. 브랜드 공식 라쿠텐점이 있으면 brands.json의 shop_code로 한정.
import { info, sleep } from '../../util.js';
import { extractCode } from '../../matcher/rules.js';

const ENDPOINT = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601';

export async function collect(brandKey, brandCfg, { limit } = {}) {
  const cfg = brandCfg.jp?.rakuten;
  if (!cfg?.enabled || !process.env.RAKUTEN_APP_ID) return [];

  const maxHits = Math.min(limit || 60, 60);

  async function fetchPage(sort, page) {
    const params = new URLSearchParams({
      applicationId: process.env.RAKUTEN_APP_ID,
      keyword: cfg.keyword,
      hits: '30',
      page: String(page),
      sort,
      availability: '1',
      format: 'json',
    });
    if (cfg.shop_code) params.set('shopCode', cfg.shop_code);
    const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`라쿠텐 API HTTP ${res.status}`);
    const data = await res.json();
    return (data.Items || []).map((wrap) => {
      const it = wrap.Item;
      return {
        brand: brandKey,
        source: 'rakuten',
        product_code: extractCode(it.itemName, brandCfg.product_code_regex),
        name: it.itemName,
        color: null,
        price: it.itemPrice,
        url: it.itemUrl,
        image_url: it.mediumImageUrls?.[0]?.imageUrl || null,
        in_stock: it.availability === 1,
        review_count: it.reviewCount || 0,
      };
    });
  }

  // 최저가순(시장가 파악) + 리뷰 많은 순(수요 파악 = 재고 위험 낮은 발굴 후보) 두 축으로 수집
  const byUrl = new Map();
  for (const sort of ['+itemPrice', '-reviewCount']) {
    let page = 1;
    while (byUrl.size < maxHits && page <= Math.ceil(maxHits / 30)) {
      const batch = await fetchPage(sort, page);
      for (const it of batch) if (!byUrl.has(it.url)) byUrl.set(it.url, it);
      if (batch.length < 30) break;
      page++;
      await sleep(1200); // API 예절
    }
    await sleep(1200);
  }
  const items = [...byUrl.values()].slice(0, maxHits * 2);
  info(`[rakuten] ${brandKey}: ${items.length}건 (가격순+리뷰순)`);
  return items;
}
