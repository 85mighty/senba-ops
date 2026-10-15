// 시세 찾기 — 상품 하나를 골라 반대편 나라의 같은 상품을 즉석 검색하고, 판매처마다 마진을 계산한다.
//  · 한국 상품 → 일본 라쿠텐/Yahoo 시세 (이 가격에 팔 수 있다면 마진은?)
//  · 일본 상품 → 한국 네이버/쿠팡/공식몰 가격 (어디서 사오면 마진이 남나?)
// 검색 결과에는 다른 상품이 섞일 수 있으므로 화면에서 이미지로 확인하게 한다.
import { loadBrands, loadCostsBase, features, warn } from './util.js';
import { getProductById, productsByCode } from './db.js';
import { getFxKrwPerJpy } from './pricing/fx.js';
import { computeMargin, estimateWeightG } from './pricing/margin.js';
import { extractCode } from './matcher/rules.js';
import { searchRakuten } from './collectors/jp/rakuten.js';
import { searchYahoo } from './collectors/jp/yahoo.js';
import { searchNaver } from './collectors/kr/naver.js';
import { searchCoupang, coupangStatus } from './collectors/kr/coupang.js';
import { searchElevenst } from './collectors/kr/elevenst.js';

const USED = /中古|USED|used|古着|ジャンク|訳あり|訳アリ/;
const HANGUL = /[가-힣]/;
const KANA = /[぀-ヿ]/;

// 브랜드 표기 중 대상 나라 글자로 된 것 (일본 검색은 가타카나, 한국 검색은 한글)
function brandWord(brandCfg, target) {
  const ws = brandCfg?.brand_words || [];
  return (target === 'jp' ? ws.find((w) => KANA.test(w)) : ws.find((w) => HANGUL.test(w))) || ws[0] || '';
}

// [시즌오프] 같은 말머리·색상 꼬리표를 걷어낸 검색용 이름
const cleanName = (n) => String(n || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

// 일본어 상품명에서 검색에 쓸 만한 영문·숫자 토큰 (품번 등)
const latinTokens = (n) => (String(n || '').match(/[A-Za-z0-9][A-Za-z0-9-]{2,}/g) || []).slice(0, 4).join(' ');

const effectiveKr = (p) => (p.sale_price_krw && p.sale_price_krw < p.price_krw ? p.sale_price_krw : p.price_krw);

function uniqByUrl(list) {
  const seen = new Set();
  return list.filter((r) => (seen.has(r.url) ? false : seen.add(r.url)));
}

export async function lookup({ side, id }) {
  const p = getProductById(side === 'jp' ? 'jp' : 'kr', id);
  if (!p) {
    const e = new Error('없는 상품');
    e.status = 404;
    throw e;
  }
  const brands = loadBrands();
  const brandCfg = brands[p.brand] || {};
  const costs = loadCostsBase();
  const feats = features();
  const fx = (await getFxKrwPerJpy()).rate;
  const weightG = estimateWeightG(p.name, costs, brands._global?.weight_keywords);
  const code = p.product_code || extractCode(p.name, brandCfg.product_code_regex);
  const notes = [];
  const calc = (krPriceKrw, jpLowestJpy) => {
    const bd = computeMargin({ krPriceKrw, jpLowestJpy, fx, weightG }, costs);
    return { net: bd.netMarginJpy, rate: bd.marginRate, passed: bd.passed, sell: bd.jpSellPriceJpy };
  };

  // ---------- 한국 상품 → 일본 시세 ----------
  if (side !== 'jp') {
    const buy = effectiveKr(p);
    const query = code || `${brandWord(brandCfg, 'jp')} ${cleanName(p.name)}`.trim();
    const jobs = [];
    if (feats.rakuten) jobs.push(searchRakuten(query, { hits: 30 }).then((r) => r.map((x) => ({ ...x, source: '라쿠텐' }))));
    else notes.push('라쿠텐 키가 없어 라쿠텐 검색을 건너뛰었습니다.');
    if (feats.yahoo) jobs.push(searchYahoo(query, { results: 30 }).then((r) => r.map((x) => ({ ...x, source: 'Yahoo!쇼핑' }))));
    else notes.push('Yahoo 키가 없어 Yahoo 검색을 건너뛰었습니다.');
    const settled = await Promise.allSettled(jobs);
    let list = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') list = list.concat(s.value);
      else {
        warn(`[lookup] ${s.reason?.message}`);
        notes.push(`일부 검색 실패: ${s.reason?.message}`);
      }
    }
    // 이미 수집해 둔 일본 상품 중 같은 품번
    for (const j of productsByCode('jp', p.brand, code)) {
      list.push({ name: j.name, price: j.price_jpy, url: j.url, image_url: j.image_url, review_count: j.review_count || 0, source: j.source === 'brand_site' ? '일본 공식몰' : j.source });
    }
    list = uniqByUrl(list.filter((r) => r.price > 0 && !USED.test(r.name))).sort((a, b) => a.price - b.price).slice(0, 14);
    if (!code) notes.push('품번이 없어 상품명으로 검색했습니다. 다른 상품이 섞일 수 있으니 이미지를 꼭 확인하세요.');
    return {
      side: 'kr', query, fx, weightG,
      base: { name: p.name, price: buy, image: p.image_url, url: p.url, label: `한국 매입가 ₩${buy.toLocaleString()}` },
      results: list.map((r) => ({ ...r, margin: calc(buy, r.price) })),
      notes,
    };
  }

  // ---------- 일본 상품 → 한국 구입처 ----------
  const sellRef = p.price_jpy;
  const tokens = code || latinTokens(p.name);
  const query = tokens ? `${tokens}` : `${brandWord(brandCfg, 'kr')} ${cleanName(p.name)}`.trim();
  const jobs = [];
  if (feats.naver) jobs.push(searchNaver(query, { display: 30 }).then((r) => r.map((x) => ({ ...x, source: x.mall ? `네이버·${x.mall}` : '네이버' }))));
  else notes.push('네이버 쇼핑 검색 API가 2026-07-31에 종료되어 한국 시장 가격은 자동 검색되지 않습니다. 아래에는 수집해 둔 한국 공식몰 가격만 나옵니다. 다른 한국 쇼핑몰은 아래 "직접 찾기" 링크로 확인하세요.');
  if (feats.coupang) jobs.push(searchCoupang(query).then((r) => r.map((x) => ({ ...x, source: x.mall || '쿠팡' }))));
  if (feats.elevenst) jobs.push(searchElevenst(query).then((r) => r.map((x) => ({ ...x, source: x.mall || '11번가' }))));
  else notes.push('11번가 키(ELEVENST_API_KEY)를 넣으면 11번가 가격도 함께 나옵니다.');
  if (!feats.coupang) notes.push('쿠팡 파트너스 키를 넣으면 쿠팡 가격도 함께 나옵니다.');
  else if (coupangStatus().limited) notes.push('쿠팡 호출 한도에 가까워 이번에는 쿠팡 검색을 건너뛰었습니다. 잠시 뒤 다시 시도하세요.');
  const settled = await Promise.allSettled(jobs);
  let list = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') list = list.concat(s.value);
    else {
      warn(`[lookup] ${s.reason?.message}`);
      notes.push(`일부 검색 실패: ${s.reason?.message}`);
    }
  }
  // 이미 수집해 둔 한국 상품 중 같은 품번 (공식몰 세일가 포함)
  for (const k of productsByCode('kr', p.brand, code)) {
    list.push({ name: k.name, price: effectiveKr(k), url: k.url, image_url: k.image_url, source: k.source === 'brand_site' ? '한국 공식몰' : k.source });
  }
  list = uniqByUrl(list.filter((r) => r.price > 0)).sort((a, b) => a.price - b.price).slice(0, 14);
  if (!tokens) notes.push('품번을 찾지 못해 상품명으로 검색했습니다. 일본어 상품명은 한국 검색에 잘 안 걸리니 아래 링크로 직접 찾아보세요.');
  return {
    side: 'jp', query, fx, weightG,
    base: { name: p.name, price: sellRef, image: p.image_url, url: p.url, label: `일본 판매 기준 ¥${sellRef.toLocaleString()}` },
    results: list.map((r) => ({ ...r, margin: calc(r.price, sellRef) })),
    notes,
  };
}
