// 일본 공식몰 수집 (Playwright) — 일본 정가 기준
import { scrapeBrandSite } from '../browser.js';

export async function collect(brandKey, brandCfg, opts = {}) {
  const siteCfg = brandCfg.jp?.brand_site;
  if (!siteCfg?.enabled) return [];
  const items = await scrapeBrandSite(brandKey, siteCfg, opts);
  // 일본 측은 sale_price 구분 없이 실판매가 하나로 관리
  return items.map(({ sale_price, ...it }) => ({ ...it, price: sale_price || it.price }));
}
