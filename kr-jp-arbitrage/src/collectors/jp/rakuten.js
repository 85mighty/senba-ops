// 라쿠텐 상품검색 API (신형 2026-07-01판) — 일본 시장 최저가 + 수요(리뷰 수)
// 구형(app.rakuten.co.jp/.../20220601)은 2026-08 폐지됨(HTTP 400).
// 신형 인증: applicationId(UUID) 쿼리 + accessKey(pk_...) — RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY 둘 다 필요.
// 브랜드 공식 라쿠텐점이 있으면 brands.json의 shop_code로 한정.
import { info, warn, sleep } from '../../util.js';
import { extractCode } from '../../matcher/rules.js';

const ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';

// 응답 파서: 구형(Items[].Item 래핑)과 신형(플랫) 양쪽 구조를 방어적으로 처리
function parseItems(data) {
  const list = data?.Items || data?.items || [];
  return list.map((row) => row?.Item || row?.item || row).filter((it) => it && (it.itemName || it.itemUrl));
}

export async function collect(brandKey, brandCfg, { limit } = {}) {
  const cfg = brandCfg.jp?.rakuten;
  if (!cfg?.enabled || !process.env.RAKUTEN_APP_ID || !process.env.RAKUTEN_ACCESS_KEY) return [];

  const maxHits = Math.min(limit || 60, 60);

  async function fetchPage(sort, page) {
    const base = {
      applicationId: process.env.RAKUTEN_APP_ID,
      keyword: cfg.keyword,
      hits: '30',
      page: String(page),
      sort,
      format: 'json',
    };
    if (cfg.shop_code) base.shopCode = cfg.shop_code;

    // accessKey는 헤더로. availability는 신형에서 거부될 수 있어 400이면 빼고 1회 재시도.
    for (const params of [{ ...base, availability: '1' }, base]) {
      const res = await fetch(`${ENDPOINT}?${new URLSearchParams(params)}`, {
        headers: { accessKey: process.env.RAKUTEN_ACCESS_KEY },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return parseItems(await res.json());
      if (res.status !== 400) throw new Error(`라쿠텐 API HTTP ${res.status}`);
      warn(`[rakuten] HTTP 400 — 파라미터 축소 재시도 (sort=${sort}, page=${page})`);
    }
    throw new Error('라쿠텐 API HTTP 400 (파라미터 축소 후에도 실패 — 키·엔드포인트 확인 필요)');
  }

  // 최저가순(시장가 파악) + 리뷰 많은 순(수요 파악 = 재고 위험 낮은 발굴 후보) 두 축으로 수집
  const byUrl = new Map();
  for (const sort of ['+itemPrice', '-reviewCount']) {
    let page = 1;
    while (byUrl.size < maxHits && page <= Math.ceil(maxHits / 30)) {
      const batch = await fetchPage(sort, page);
      for (const it of batch) {
        const item = {
          brand: brandKey,
          source: 'rakuten',
          product_code: extractCode(it.itemName, brandCfg.product_code_regex),
          name: it.itemName,
          color: null,
          price: it.itemPrice ?? it.price,
          url: it.itemUrl ?? it.url,
          image_url: it.mediumImageUrls?.[0]?.imageUrl || it.mediumImageUrls?.[0] || it.imageUrl || null,
          in_stock: it.availability === undefined ? true : it.availability === 1 || it.availability === true,
          review_count: it.reviewCount ?? it.review_count ?? 0,
        };
        if (item.url && !byUrl.has(item.url)) byUrl.set(item.url, item);
      }
      if (batch.length < 30) break;
      page++;
      await sleep(1200); // API 예절
    }
    await sleep(1200);
  }
  const items = [...byUrl.values()].slice(0, maxHits * 2);
  info(`[rakuten] ${brandKey}: ${items.length}건 (가격순+리뷰순, 신형 API)`);
  return items;
}
