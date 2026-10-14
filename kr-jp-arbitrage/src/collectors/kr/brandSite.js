// 한국 공식몰 수집 (Playwright) — 세일가 기준 (한국은 세일·쿠폰이 커서 실결제가가 중요)
import { scrapeBrandSite } from '../browser.js';

export async function collect(brandKey, brandCfg, opts = {}) {
  const siteCfg = brandCfg.kr?.brand_site;
  if (!siteCfg?.enabled) return [];
  return scrapeBrandSite(brandKey, siteCfg, opts);
}
