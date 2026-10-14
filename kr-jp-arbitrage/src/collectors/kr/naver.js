// 네이버쇼핑 검색 API — 한국 시장 최저가 보강 (일 25,000건 무료)
// sort=asc 최저가순. 브랜드 공식 스토어(mallName) 우선, 없으면 시장 최저가.
import { info } from '../../util.js';
import { extractCode } from '../../matcher/rules.js';

const ENDPOINT = 'https://openapi.naver.com/v1/search/shop.json';

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');

export async function collect(brandKey, brandCfg, { limit } = {}) {
  const cfg = brandCfg.kr?.naver;
  if (!cfg?.enabled || !process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) return [];

  const params = new URLSearchParams({
    query: cfg.query,
    display: String(Math.min(limit || 100, 100)),
    sort: 'asc', // 최저가순
  });
  const res = await fetch(`${ENDPOINT}?${params}`, {
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`네이버 API HTTP ${res.status}`);
  const data = await res.json();

  const officialMalls = (cfg.mall_names || []).map((m) => m.toLowerCase());
  const items = (data.items || []).map((it) => {
    const name = stripTags(it.title);
    const isOfficial = officialMalls.some((m) => (it.mallName || '').toLowerCase().includes(m));
    return {
      brand: brandKey,
      source: 'naver',
      product_code: extractCode(name, brandCfg.product_code_regex),
      name,
      color: null,
      price: parseInt(it.lprice, 10),
      url: it.link,
      image_url: it.image || null,
      in_stock: true, // 검색 결과는 판매 중으로 간주
      _official: isOfficial,
    };
  });
  // 공식 스토어 우선 정렬 (같은 상품이면 공식몰 행이 먼저 저장되도록)
  items.sort((a, b) => Number(b._official) - Number(a._official));
  for (const it of items) delete it._official;
  info(`[naver] ${brandKey}: ${items.length}건`);
  return items;
}
