// 시세 찾기 — 상품 하나의 반대편 나라 같은 상품을 찾고, 판매처마다 마진을 계산한다.
//  · 한국 상품 → 일본 라쿠텐/Yahoo 시세 (이 가격에 팔 수 있다면 마진은?)
//  · 일본 상품 → 한국 공식몰/쿠팡/11번가 가격 (어디서 사오면 마진이 남나?)
// 같은 로직을 화면의 "시세 찾기" 버튼과 매일 자동 확인(quote 단계)이 함께 쓴다.
// 검색 결과에는 다른 상품이 섞일 수 있어서, 품번이 일치한 결과(byCode)를 우선하고 아니면 '추정'으로 표시한다.
import { loadBrands, loadCostsBase, features, warn } from './util.js';
import { getProductById, productsByCode } from './db.js';
import { getFxKrwPerJpy } from './pricing/fx.js';
import { computeMargin, computeMarginJpToKr, estimateWeightG, categoryOfName } from './pricing/margin.js';
import { extractCode, nameSimilarity, normalizeName } from './matcher/rules.js';
import { searchRakuten } from './collectors/jp/rakuten.js';
import { searchYahoo } from './collectors/jp/yahoo.js';
import { searchNaver } from './collectors/kr/naver.js';
import { searchCoupang, coupangStatus } from './collectors/kr/coupang.js';
import { searchElevenst } from './collectors/kr/elevenst.js';
import { searchGoogleShoppingJp } from './collectors/jp/dataforseo.js';

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

const norm = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '');
const hasCode = (name, code) => !!code && norm(name).includes(norm(code));

// 검색 결과가 '같은 브랜드의 비슷한 상품'인지 점수화한다.
//  · brandOk: 결과 이름에 브랜드명(한글·영문·가타카나 표기 중 하나)이 있어야 한다 — 없으면 다른 브랜드 유사 상품(ASOS 가디건 등)일 가능성이 높다
//  · sim: 브랜드명을 뺀 상품명끼리 글자 유사도 (한글↔가타카나·영문 발음 보정 포함)
const SIM_MIN = parseFloat(process.env.MATCH_SIM_MIN || '0.3');
const squash = (t) => String(t || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
function relevance(baseName, cand, brandCfg) {
  const words = (brandCfg?.brand_words || []).map(squash).filter(Boolean);
  const text = squash(cand.name);
  const brandOk = !words.length || words.some((w) => text.includes(w));
  const sim = nameSimilarity(normalizeName(cleanName(baseName), brandCfg?.brand_words || []), normalizeName(cand.name, brandCfg?.brand_words || []));
  return { brandOk, sim: Math.round(sim * 100) / 100 };
}

function uniqByUrl(list) {
  const seen = new Set();
  return list.filter((r) => (seen.has(r.url) ? false : seen.add(r.url)));
}

/**
 * 반대편 시세 찾기.
 * @param {object} p        기준 상품(DB 행)
 * @param {'kr'|'jp'} side  기준 상품의 나라
 * @param {object} opt      online=false면 외부 API를 부르지 않고 DB에 있는 같은 품번만 사용, google=true면 구글 쇼핑(일본)도 검색(최대 1분 이상 걸릴 수 있음)
 * @returns {{results, best, kind, query, fx, weightG, base, notes, searched}}
 */
export async function findCounterparts(p, side, { online = true, google = false } = {}) {
  const brands = loadBrands();
  const brandCfg = brands[p.brand] || {};
  const costs = loadCostsBase();
  const feats = features();
  const fx = (await getFxKrwPerJpy()).rate;
  const weightG = estimateWeightG(p.name, costs, brands._global?.weight_keywords);
  const code = p.product_code || extractCode(p.name, brandCfg.product_code_regex);
  const floor = costs.market_min_price_jpy || 0;
  const notes = [];
  const calc = (krPriceKrw, jpLowestJpy) => {
    const bd = computeMargin({ krPriceKrw, jpLowestJpy, fx, weightG }, costs);
    return { net: bd.netMarginJpy, rate: bd.marginRate, passed: bd.passed, sell: bd.jpSellPriceJpy };
  };
  // 일본에서 사서 한국에 파는 방향 (한국 관세·부가세 구분용 품목)
  const category = categoryOfName(p.name, brands._global?.weight_keywords);
  const dutyCat = ['shoes', 'cap', 'bag'].includes(category) ? category : 'apparel';
  const calcRev = (krSellKrw, jpBuyJpy) => {
    const bd = computeMarginJpToKr({ jpPriceJpy: jpBuyJpy, krSellKrw, fx, weightG, category: dutyCat }, costs);
    return { net: bd.netMarginKrw, rate: bd.marginRate, passed: bd.passed, sell: bd.krSellPriceKrw };
  };
  const settle = async (jobs) => {
    let list = [];
    for (const s of await Promise.allSettled(jobs)) {
      if (s.status === 'fulfilled') list = list.concat(s.value);
      else {
        warn(`[lookup] ${s.reason?.message}`);
        notes.push(`일부 검색 실패: ${s.reason?.message}`);
      }
    }
    return list;
  };
  let searched = false;
  let results;
  let query;
  let base;

  if (side !== 'jp') {
    // ---------- 한국 상품 → 일본 시세 ----------
    const buy = effectiveKr(p);
    query = code || `${brandWord(brandCfg, 'jp')} ${cleanName(p.name)}`.trim();
    base = { name: p.name, price: buy, image: p.image_url, url: p.url, label: `한국 매입가 ₩${buy.toLocaleString()}` };
    let list = [];
    // DB에 이미 있는 같은 품번 일본 상품 (무료·즉시)
    for (const j of productsByCode('jp', p.brand, code)) {
      list.push({ name: j.name, price: j.price_jpy, url: j.url, image_url: j.image_url, review_count: j.review_count || 0, source: j.source === 'brand_site' ? '일본 공식몰' : j.source, byCode: true });
    }
    if (online) {
      const jobs = [];
      if (feats.rakuten) jobs.push(searchRakuten(query, { hits: 30 }).then((r) => r.map((x) => ({ ...x, source: '라쿠텐' }))));
      else notes.push('라쿠텐 키가 없어 라쿠텐 검색을 건너뛰었습니다.');
      if (feats.yahoo) jobs.push(searchYahoo(query, { results: 30 }).then((r) => r.map((x) => ({ ...x, source: 'Yahoo!쇼핑' }))));
      else notes.push('Yahoo 키가 없어 Yahoo 검색을 건너뛰었습니다.');
      if (google) {
        if (feats.dataforseo) jobs.push(searchGoogleShoppingJp(query).then((r) => r.map((x) => ({ ...x, source: x.mall ? `구글쇼핑·${x.mall}` : '구글쇼핑' }))));
        else notes.push('DataForSEO 키가 없어 구글 쇼핑 검색을 건너뛰었습니다.');
      }
      searched = jobs.length > 0;
      list = list.concat((await settle(jobs)).map((r) => ({ ...r, byCode: hasCode(r.name, code) })));
      if (!code) notes.push('품번이 없어 상품명으로 검색했습니다. 다른 상품이 섞일 수 있으니 이미지를 꼭 확인하세요.');
    }
    results = uniqByUrl(list.filter((r) => r.price >= Math.max(floor, 1) && !USED.test(r.name)))
      .map((r) => ({ ...r, ...relevance(p.name, r, brandCfg) }))
      .sort((a, b) => a.price - b.price).slice(0, 14)
      .map((r) => ({ ...r, margin: calc(buy, r.price), reverse: calcRev(buy, r.price) }));
  } else {
    // ---------- 일본 상품 → 한국 구입처 ----------
    const sellRef = p.price_jpy;
    const tokens = code || latinTokens(p.name);
    query = tokens ? `${tokens}` : `${brandWord(brandCfg, 'kr')} ${cleanName(p.name)}`.trim();
    base = { name: p.name, price: sellRef, image: p.image_url, url: p.url, label: `일본 판매 기준 ¥${sellRef.toLocaleString()}` };
    let list = [];
    // DB에 이미 있는 같은 품번 한국 상품 (공식몰 세일가 포함)
    for (const k of productsByCode('kr', p.brand, code)) {
      list.push({ name: k.name, price: effectiveKr(k), url: k.url, image_url: k.image_url, source: k.source === 'brand_site' ? '한국 공식몰' : k.source, byCode: true });
    }
    if (online) {
      const jobs = [];
      if (feats.naver) jobs.push(searchNaver(query, { display: 30 }).then((r) => r.map((x) => ({ ...x, source: x.mall ? `네이버·${x.mall}` : '네이버' }))));
      else notes.push('네이버 쇼핑 검색 API가 2026-07-31에 종료되어 자동 검색되지 않습니다. 다른 한국 쇼핑몰은 아래 "직접 찾기" 링크로 확인하세요.');
      if (feats.coupang) jobs.push(searchCoupang(query).then((r) => r.map((x) => ({ ...x, source: x.mall || '쿠팡' }))));
      else notes.push('쿠팡 파트너스 키를 넣으면 쿠팡 가격도 함께 나옵니다.');
      if (feats.coupang && coupangStatus().limited) notes.push('쿠팡 호출 한도에 가까워 이번에는 쿠팡 검색을 건너뛰었습니다. 잠시 뒤 다시 시도하세요.');
      if (feats.elevenst) jobs.push(searchElevenst(query).then((r) => r.map((x) => ({ ...x, source: x.mall || '11번가' }))));
      else notes.push('11번가 키(ELEVENST_API_KEY)를 넣으면 11번가 가격도 함께 나옵니다.');
      searched = jobs.length > 0;
      list = list.concat((await settle(jobs)).map((r) => ({ ...r, byCode: hasCode(r.name, code) })));
      if (!tokens) notes.push('품번을 찾지 못해 상품명으로 검색했습니다. 일본어 상품명은 한국 검색에 잘 안 걸리니 아래 링크로 직접 찾아보세요.');
    }
    results = uniqByUrl(list.filter((r) => r.price > 0))
      .map((r) => ({ ...r, ...relevance(p.name, r, brandCfg) }))
      .sort((a, b) => a.price - b.price).slice(0, 14)
      .map((r) => ({ ...r, margin: calc(r.price, sellRef), reverse: calcRev(r.price, sellRef) }));
  }

  // 대표 결과: 품번이 일치한 것 중 가장 싼 것. 없으면 '브랜드명이 있고 이름이 비슷한' 후보 중 이름이 가장 비슷한 것(추정).
  // 예전에는 전체 중 가장 싼 것을 골라서 다른 브랜드 유사 상품이 대표로 뽑혔다. 후보가 없으면 '못 찾음'으로 둔다.
  const coded = results.filter((r) => r.byCode);
  const likely = results.filter((r) => !r.byCode && r.brandOk && r.sim >= SIM_MIN).sort((a, b) => b.sim - a.sim || a.price - b.price);
  results.forEach((r) => { r.likely = r.byCode || (r.brandOk && r.sim >= SIM_MIN); });
  const best = coded[0] || likely[0] || null;
  const alts = (coded[0] ? coded.slice(1) : likely.slice(1)).slice(0, 2); // AI가 best를 '다른 상품'이라 판정하면 다음 후보로 재확인
  if (!best && results.length) notes.push('검색 결과 중 브랜드명이 있고 이름이 비슷한 상품이 없어 대표 시세를 정하지 않았습니다 (다른 브랜드 유사 상품만 나옴).');
  return { side: side === 'jp' ? 'jp' : 'kr', query, fx, weightG, base, results, best, alts, kind: best ? (best.byCode ? 'code' : 'search') : 'none', notes, searched, google: !!google && side !== 'jp', googleAvailable: feats.dataforseo };
}

export async function lookup({ side, id, google = false }) {
  const sd = side === 'jp' ? 'jp' : 'kr';
  const p = getProductById(sd, id);
  if (!p) {
    const e = new Error('없는 상품');
    e.status = 404;
    throw e;
  }
  return findCounterparts(p, sd, { online: true, google });
}

// 목록용 요약 (quotes 테이블에 저장하는 형태)
const brief = (b) => ({
  name: b.name, price: b.price, url: b.url, image: b.image_url, source: b.source,
  net: b.margin.net, rate: b.margin.rate, passed: b.margin.passed,
  rev: b.reverse ? { net: b.reverse.net, rate: b.reverse.rate, passed: b.reverse.passed } : null,
});
export const toQuoteBrief = brief;
export function toQuote(r) {
  if (!r.best) return { kind: 'none' };
  return { kind: r.kind, ...brief(r.best), alts: (r.alts || []).map(brief) };
}
