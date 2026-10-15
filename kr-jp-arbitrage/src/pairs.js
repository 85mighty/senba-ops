// 시세 비교 목록 — 상품마다 "한국 가격·판매처 / 일본 가격·판매처 / 양방향 손익 / 결론"을 한 줄로.
// 한국→일본 마진은 엔(¥), 일본→한국 마진은 원(₩)이고, 정렬·결론 판단은 엔으로 환산해서 비교한다.
import { getProductById, getQuote, listPairRows } from './db.js';
import { loadBrands, loadCostsBase } from './util.js';
import { getFxKrwPerJpy } from './pricing/fx.js';
import { computeMargin, computeMarginJpToKr, estimateWeightG, categoryOfName } from './pricing/margin.js';

// DB에 저장된 출처 코드를 사람이 읽는 이름으로
const RAW = { rakuten: '라쿠텐', yahoo: 'Yahoo!쇼핑', coupang: '쿠팡', elevenst: '11번가', naver: '네이버' };
const siteLabel = (src, country) => (src === 'brand_site' ? (country === 'kr' ? '한국 공식몰' : '일본 공식몰') : RAW[src] || src || '');

export const VERDICTS = ['kr2jp', 'jp2kr', 'loss', 'mismatch', 'unverified'];

/**
 * @param {{filter?, brand?, q?, limit?}} opt
 *   filter: all | kr2jp(한국에서 사서 일본에 팔면 이득) | jp2kr(일본에서 사서 한국에 팔면 이득) | loss(둘 다 손해) | pass(통과 기준 충족)
 */
export async function buildPairs({ filter = 'all', brand, q, limit = 100 } = {}) {
  const fx = (await getFxKrwPerJpy()).rate;
  const seen = new Map();
  for (const r of listPairRows()) {
    const isKr = r.side === 'kr';
    const krPrice = isKr ? r.pprice : r.best_price;
    const jpPrice = isKr ? r.best_price : r.pprice;
    const key = `${r.brand}|${krPrice}|${jpPrice}`;
    const a = { net: r.margin_net, rate: r.margin_rate, passed: !!r.passed };
    const b = r.rev_net == null ? null : { net: r.rev_net, rate: r.rev_rate, passed: !!r.rev_passed };
    const score = Math.max(a.net ?? -1e9, b ? b.net / fx : -1e9);
    const row = {
      key, side: r.side, id: r.pid, brand: r.brand, name: r.pname, code: r.pcode,
      image: r.pimage, counterImage: r.best_image, counterName: r.best_name,
      reviews: r.review_count || 0,
      kr: { price: krPrice, site: isKr ? siteLabel(r.psource, 'kr') : siteLabel(r.best_source, 'kr'), url: isKr ? r.purl : r.best_url },
      jp: { price: jpPrice, site: isKr ? siteLabel(r.best_source, 'jp') : siteLabel(r.psource, 'jp'), url: isKr ? r.best_url : r.purl },
      a, b, score, kind: r.q_kind, verified: r.verified, reason: r.verified_reason, checked: r.checked_at,
    };
    const aGood = a.net > 0;
    const bGood = !!b && b.net > 0;
    // 이름 검색(추정)으로 찾았고 AI가 같은 상품이라고 확인하지 않은 건 '확인 필요' — 이득/손해 판정에 넣지 않는다 (엉뚱한 상품과 비교한 숫자일 수 있음)
    row.verdict = r.verified === 'different' ? 'mismatch'
      : r.q_kind === 'search' && r.verified !== 'same' ? 'unverified'
      : aGood && bGood ? (a.net >= b.net / fx ? 'kr2jp' : 'jp2kr')
      : aGood ? 'kr2jp' : bGood ? 'jp2kr' : 'loss';
    const prev = seen.get(key);
    if (!prev || (row.kind === 'code' && prev.kind !== 'code')) seen.set(key, row); // 같은 쌍이 양쪽에서 잡히면 품번 일치 쪽을 남김
  }

  let rows = [...seen.values()];
  if (brand) rows = rows.filter((r) => r.brand === brand);
  if (q) rows = rows.filter((r) => `${r.name} ${r.code || ''} ${r.counterName || ''}`.toLowerCase().includes(String(q).toLowerCase()));
  const count = (fn) => rows.filter(fn).length;
  const counts = {
    all: rows.length,
    kr2jp: count((r) => r.verdict === 'kr2jp'),
    jp2kr: count((r) => r.verdict === 'jp2kr'),
    loss: count((r) => r.verdict === 'loss' || r.verdict === 'mismatch'),
    check: count((r) => r.verdict === 'unverified'),
    pass: count((r) => r.verdict !== 'mismatch' && r.verdict !== 'unverified' && (r.a.passed || r.b?.passed)),
  };
  if (filter === 'kr2jp' || filter === 'jp2kr') rows = rows.filter((r) => r.verdict === filter);
  else if (filter === 'loss') rows = rows.filter((r) => r.verdict === 'loss' || r.verdict === 'mismatch');
  else if (filter === 'check') rows = rows.filter((r) => r.verdict === 'unverified');
  else if (filter === 'pass') rows = rows.filter((r) => r.verdict !== 'mismatch' && r.verdict !== 'unverified' && (r.a.passed || r.b?.passed));
  const rank = (r) => (r.verdict === 'mismatch' ? 2 : r.verdict === 'unverified' ? 1 : 0);
  rows.sort((x, y) => rank(x) - rank(y) || y.score - x.score);
  return { rows: rows.slice(0, Math.min(limit, 300)), counts, fx };
}

/** 이 쌍의 비용 내역(양방향) — "왜 이 숫자가 나왔나"를 보여주기 위함 */
export async function explainPair(side, id) {
  const sd = side === 'jp' ? 'jp' : 'kr';
  const p = getProductById(sd, id);
  const q = getQuote(sd, id);
  if (!p || !q || q.best_price == null) {
    const e = new Error('시세가 확인된 상품이 아닙니다');
    e.status = 404;
    throw e;
  }
  const brands = loadBrands();
  const costs = loadCostsBase();
  const fx = (await getFxKrwPerJpy()).rate;
  const weightG = estimateWeightG(p.name, costs, brands._global?.weight_keywords);
  const category = categoryOfName(p.name, brands._global?.weight_keywords);
  const krPrice = sd === 'kr' ? (p.sale_price_krw && p.sale_price_krw < p.price_krw ? p.sale_price_krw : p.price_krw) : q.best_price;
  const jpPrice = sd === 'kr' ? q.best_price : p.price_jpy;
  const a = computeMargin({ krPriceKrw: krPrice, jpLowestJpy: jpPrice, fx, weightG }, costs);
  const dutyCat = ['shoes', 'cap', 'bag'].includes(category) ? category : 'apparel';
  const b = computeMarginJpToKr({ jpPriceJpy: jpPrice, krSellKrw: krPrice, fx, weightG, category: dutyCat }, costs);
  return { name: p.name, fx, weightG, category, kr: { price: krPrice }, jp: { price: jpPrice }, a, b };
}
