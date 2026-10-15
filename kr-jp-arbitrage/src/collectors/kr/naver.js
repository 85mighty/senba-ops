// 네이버쇼핑 검색 API — 한국 시장 최저가 보강 (일 25,000건 무료)
// sort=asc 최저가순. 브랜드 공식 스토어(mallName) 우선, 없으면 시장 최저가.
// brands.json: kr.naver.query(단일) 또는 kr.naver.queries(여러 개) 지원.
import { info, warn, sleep } from '../../util.js';
import { extractCode } from '../../matcher/rules.js';

const ENDPOINT = 'https://openapi.naver.com/v1/search/shop.json';

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');

async function searchOne(brandKey, brandCfg, cfg, query, limit) {
  const params = new URLSearchParams({
    query,
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
  return (data.items || []).map((it) => {
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
}

// 화면의 "시세 찾기"용 즉석 검색 (DB에 저장하지 않음). 관련도순으로 받아 호출 측에서 가격순 정렬
export async function searchNaver(query, { display = 30 } = {}) {
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET || !query) return [];
  const params = new URLSearchParams({ query, display: String(Math.min(display, 100)), sort: 'sim' });
  const res = await fetch(`${ENDPOINT}?${params}`, {
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`네이버 API HTTP ${res.status}`);
  const data = await res.json();
  return (data.items || []).map((it) => ({
    name: stripTags(it.title),
    price: parseInt(it.lprice, 10),
    url: it.link,
    image_url: it.image || null,
    in_stock: true,
    mall: it.mallName || '',
  }));
}

export async function collect(brandKey, brandCfg, { limit } = {}) {
  const cfg = brandCfg.kr?.naver;
  if (!cfg?.enabled || !process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) return [];

  const queries = (cfg.queries?.length ? cfg.queries : [cfg.query]).filter(Boolean);
  const byUrl = new Map();
  for (const q of queries) {
    try {
      for (const it of await searchOne(brandKey, brandCfg, cfg, q, limit)) if (!byUrl.has(it.url)) byUrl.set(it.url, it);
    } catch (e) {
      warn(`[naver] "${q}" 실패: ${e.message}`);
    }
    await sleep(300);
  }
  // 공식 스토어 우선 정렬 (같은 상품이면 공식몰 행이 먼저 저장되도록)
  const items = [...byUrl.values()].sort((a, b) => Number(b._official) - Number(a._official));
  for (const it of items) delete it._official;
  info(`[naver] ${brandKey}: ${items.length}건 (검색어 ${queries.length}개)`);
  return items;
}
