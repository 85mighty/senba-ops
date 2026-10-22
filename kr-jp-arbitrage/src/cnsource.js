// 중국 소싱 탐색 — 일본에서 수요가 검증된 상품을 고르고(후보 선별), 1688에서 원가를 찾아(이미지 검색), 마진을 계산한다.
//  1) discover: 라쿠텐에서 카테고리 키워드별로 '리뷰 많은 순' 상품을 가져와 규제·브랜드·가격대 필터 + 점수화 → cn_items
//  2) cost    : 점수 높은 순으로 1688 이미지 검색(건당 과금, 실행당 예산 제한) → 원가·MOQ·판매량 → 마진 계산 → cn_quotes
//  3) verify  : 마진이 남는 후보는 AI가 일본 상품 사진과 1688 사진을 비교 (같은 상품인지)
// 판매가는 후보 자체의 라쿠텐 가격 × 0.95로 가정한다 (리뷰가 쌓인 상품 = 그 가격에 팔린다는 증거).
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.js';
import { ROOT, info, warn, features, loadCostsBase, sleep } from './util.js';
import { searchRakuten } from './collectors/jp/rakuten.js';
import { searchBy1688Image, cnProvider, fullImageUrl } from './collectors/cn/image1688.js';
import { getFxJpyPerCny, getFxJpyPer } from './pricing/fx.js';
import { computeMarginCnToJp, breakEvenCnPriceCny } from './pricing/margin.js';
import { compareProducts } from './matcher/llm.js';

export const loadCnConfig = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'cn-sourcing.json'), 'utf8'));

const USED = /中古|USED|used|訳あり|ジャンク/;
const squash = (t) => String(t || '').normalize('NFKC').toLowerCase();

// ---------- 후보 점수 ----------
// 수요(리뷰 수) 40 + 가격대 적합 25 + 가벼움 20 + 평점 15
export function scoreCandidate(it, cat, filters) {
  const reasons = [];
  const demand = Math.min(1, Math.log10(1 + it.review_count) / 3.3);
  if (it.review_count >= 300) reasons.push(`리뷰 ${it.review_count}개(수요 검증)`);
  else reasons.push(`리뷰 ${it.review_count}개`);
  const mid = (filters.min_price_jpy + filters.max_price_jpy) / 2;
  const priceFit = Math.max(0, 1 - Math.abs(it.price - Math.min(mid, 4000)) / 4000);
  const light = cat.weight_g <= 300 ? 1 : cat.weight_g <= 500 ? 0.65 : 0.3;
  if (cat.weight_g <= 300) reasons.push('가벼움(배송비 유리)');
  const rate = it.review_avg ? Math.max(0, Math.min(1, (it.review_avg - 3.8) / 1.0)) : 0.4;
  if (it.review_avg >= 4.4) reasons.push(`평점 ${it.review_avg}`);
  const score = Math.round((40 * demand + 25 * priceFit + 20 * light + 15 * rate) * 10) / 10;
  return { score, reasons };
}

export function isExcluded(name, cfg) {
  const t = squash(name);
  const words = [...(cfg.exclude_words?.regulated || []), ...(cfg.exclude_words?.brand_ip || [])];
  const hit = words.find((w) => t.includes(squash(w)));
  if (hit) return hit;
  if (cfg.exclude_jan !== false && /(?<!\d)(45|49)\d{11}(?!\d)/.test(String(name).normalize('NFKC'))) return 'JAN코드(정규 브랜드 상품)';
  return USED.test(name) ? '중고' : null;
}

// ---------- 1) 후보 선별 ----------
export async function discoverCandidates({ perKeyword = 30, maxNew } = {}) {
  const cfg = loadCnConfig();
  if (cfg.enabled === false) return { added: 0, seen: 0, excluded: 0 };
  if (!features().rakuten) return { added: 0, seen: 0, excluded: 0, note: '라쿠텐 키가 없어 후보를 못 가져옴' };
  const f = cfg.filters;
  let added = 0, seen = 0, excluded = 0;
  // 한 키워드(예: '車 ハンドルカバー')가 후보를 독점하지 않도록 키워드마다 상한을 둔다 — 모든 카테고리·키워드가 고르게 나온다
  const perKw = maxNew ?? parseInt(process.env.CN_PER_KEYWORD || '4', 10);
  for (const cat of cfg.categories) {
    for (const keyword of cat.keywords) {
      let kwAdded = 0;
      let rows = [];
      try {
        rows = await searchRakuten(keyword, { hits: Math.min(perKeyword, 30), sort: '-reviewCount' });
      } catch (e) {
        warn(`[china] 라쿠텐 검색 실패(${keyword}): ${e.message}`);
        continue;
      }
      for (const r of rows) {
        if (kwAdded >= perKw) break;
        seen++;
        if (!r.in_stock || !r.price || r.price < f.min_price_jpy || r.price > f.max_price_jpy) continue;
        if ((r.review_count || 0) < f.min_reviews) continue;
        if (isExcluded(r.name, cfg)) { excluded++; continue; }
        const { score, reasons } = scoreCandidate({ ...r, review_count: r.review_count || 0 }, cat, f);
        db.upsertCnItem({
          category: cat.key, keyword, name: r.name, price_jpy: r.price, url: r.url, image_url: r.image_url || null,
          shop: r.shop || null, review_count: r.review_count || 0, review_avg: r.review_avg ?? null,
          score, reasons: JSON.stringify(reasons), weight_g: cat.weight_g,
        });
        added++;
        kwAdded++;
      }
      await sleep(1200); // 라쿠텐 API 예절
    }
  }
  return { added, seen, excluded };
}

// ---------- 2) 원가 조회 ----------
// 1688 결과(시각 유사도 순)에서 대표 원가를 고른다: 지나치게 싼 이상치(부속품·샘플)는 빼고, MOQ가 너무 큰 것도 뺀 뒤 가장 싼 것.
// 1688은 위안이지만 AliExpress 등은 달러로 나올 수 있다 → 위안 환산값으로 통일 (마진 계산이 위안 기준)
export async function normalizeCurrency(matches, jpyPerCny) {
  const out = [];
  for (const m of matches) {
    if (!m.currency || m.currency === 'CNY') { out.push(m); continue; }
    try {
      const jpy = (await getFxJpyPer(m.currency)) * m.priceCny;
      out.push({ ...m, priceOrig: m.priceCny, priceCny: Math.round((jpy / jpyPerCny) * 100) / 100 });
    } catch { /* 환율을 못 구하면 그 결과는 버림 */ }
  }
  return out;
}

export function pickMatch(matches, { maxMoq = 100 } = {}) {
  const top = matches.filter((m) => !m.patent).slice(0, 12);
  if (!top.length) return { best: null, alts: [] };
  const prices = top.map((m) => m.priceCny).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  const ok = top.filter((m) => m.priceCny >= median * 0.3 && (!Number.isFinite(m.moq) || m.moq <= maxMoq));
  const pool = (ok.length ? ok : top).slice().sort((a, b) => a.priceCny - b.priceCny);
  return { best: pool[0], alts: pool.slice(1, 3) };
}

export function marginFor(item, cnPriceCny, jpyPerCny, costs) {
  const bd = computeMarginCnToJp({ cnPriceCny, jpRefPriceJpy: item.price_jpy, jpyPerCny, weightG: item.weight_g || 300 }, costs);
  return bd;
}

const clean = (v) => (Number.isFinite(v) ? v : null);

// 원가 조회 대상을 고르게 뽑는다: 카테고리를 번갈아, 카테고리 안에서는 키워드를 번갈아, 키워드 안에서는 점수 순
export function diversify(items, n) {
  const cats = new Map();
  for (const it of items.slice().sort((a, b) => b.score - a.score)) {
    if (!cats.has(it.category)) cats.set(it.category, new Map());
    const kws = cats.get(it.category);
    if (!kws.has(it.keyword)) kws.set(it.keyword, []);
    kws.get(it.keyword).push(it);
  }
  const out = [];
  const catList = [...cats.values()].map((kws) => ({ kws: [...kws.values()], i: 0 }));
  while (out.length < n && catList.some((c) => c.kws.some((k) => k.length))) {
    for (const c of catList) {
      if (out.length >= n) break;
      for (let tries = 0; tries < c.kws.length; tries++) {
        const bucket = c.kws[c.i++ % c.kws.length];
        if (bucket.length) { out.push(bucket.shift()); break; }
      }
    }
  }
  return out;
}

export async function costCandidates({ budget } = {}) {
  const provider = cnProvider();
  if (!provider) return { costed: 0, none: 0, note: '1688 이미지 검색 키가 없어 원가 조회를 건너뜀' };
  const costs = loadCostsBase();
  const fx = (await getFxJpyPerCny()).rate;
  const max = budget ?? parseInt(process.env.CN_IMAGE_BUDGET || '10', 10);
  const maxMoq = parseInt(process.env.CN_MAX_MOQ || '100', 10);
  let costed = 0, none = 0, errors = 0;
  const cfg = loadCnConfig();
  const catKeys = new Set(cfg.categories.map((c) => c.key));
  const pending = db.cnItemsToCost(1000).filter((i) => catKeys.has(i.category) && !isExcluded(i.name, cfg));
  for (const item of diversify(pending, max)) {
    if (!item.image_url) continue;
    try {
      const found = await searchBy1688Image(item.image_url, { pageSize: 20 });
      const { best, alts } = pickMatch(await normalizeCurrency(found.matches, fx), { maxMoq });
      if (!best) {
        db.saveCnQuote({ item_id: item.id, status: 'none', provider, note: '1688에서 비슷한 상품을 못 찾음' });
        none++;
      } else {
        const bd = marginFor(item, best.priceCny, fx, costs);
        db.saveCnQuote({
          item_id: item.id, status: 'ok', provider, cn_title: best.title, cn_price_cny: best.priceCny, cn_url: best.url, cn_image: best.image,
          moq: clean(best.moq), month_sold: clean(best.monthSold), supplier: best.supplier || null,
          alts: JSON.stringify(alts.map((a) => ({ ...a, moq: clean(a.moq), monthSold: clean(a.monthSold), repurchase: clean(a.repurchase) }))),
          weight_g: item.weight_g, net_jpy: bd.netMarginJpy, rate: bd.marginRate, passed: bd.passed ? 1 : 0, sell_jpy: bd.sellJpy,
        });
        costed++;
      }
    } catch (e) {
      errors++;
      warn(`[china] 1688 검색 실패 #${item.id}: ${e.message}`);
      if (/HTTP (401|403|402|429)|키/.test(e.message)) break; // 인증·한도 문제면 더 호출하지 않음
    }
    await sleep(800);
  }
  return { costed, none, errors };
}

// ---------- 3) AI 이미지 확인 ----------
export async function verifyCandidates({ limit } = {}) {
  if (!features().llm) return { verified: 0 };
  const costs = loadCostsBase();
  const fx = (await getFxJpyPerCny()).rate;
  let verified = 0;
  for (const q of db.cnQuotesToVerify(limit ?? parseInt(process.env.CN_VERIFY_LIMIT || '15', 10))) {
    const item = db.getCnItem(q.item_id);
    try {
      let v = await compareProducts({ name: item.name, image: fullImageUrl(item.image_url) }, { name: q.cn_title, image: q.cn_image });
      verified++;
      let alts = [];
      try { alts = JSON.parse(q.alts || '[]'); } catch { /* 없음 */ }
      while (v.verdict === 'different' && alts.length) {
        const alt = alts.shift();
        if (!alt.image) continue;
        const v2 = await compareProducts({ name: item.name, image: fullImageUrl(item.image_url) }, { name: alt.title, image: alt.image });
        verified++;
        if (v2.verdict !== 'different') {
          const bd = marginFor(item, alt.priceCny, fx, costs);
          db.saveCnQuote({
            item_id: item.id, status: 'ok', provider: q.provider, cn_title: alt.title, cn_price_cny: alt.priceCny, cn_url: alt.url, cn_image: alt.image,
            moq: clean(alt.moq), month_sold: clean(alt.monthSold), supplier: alt.supplier || null, alts: JSON.stringify(alts), weight_g: q.weight_g,
            net_jpy: bd.netMarginJpy, rate: bd.marginRate, passed: bd.passed ? 1 : 0, sell_jpy: bd.sellJpy, verified: v2.verdict, verified_reason: v2.reason,
          });
          v = null;
          break;
        }
      }
      if (v) db.setCnVerdict(item.id, v.verdict, v.reason);
    } catch (e) {
      warn(`[china] AI 비교 중단: ${e.message}`);
      break;
    }
  }
  return { verified };
}

// ---------- 파이프라인 단계 ----------
export async function stepChina() {
  const d = await discoverCandidates();
  const c = await costCandidates();
  const v = await verifyCandidates();
  const parts = [`후보 ${d.added}건 선별 (검토 ${d.seen}, 규제·브랜드 제외 ${d.excluded})`];
  if (d.note) parts.push(d.note);
  parts.push(c.note || `1688 원가 ${c.costed}건 확인 (못 찾음 ${c.none}${c.errors ? `, 오류 ${c.errors}` : ''})`);
  parts.push(`AI 이미지 확인 ${v.verified}건`);
  return parts.join(' · ');
}

// ---------- 화면용 ----------
// verdict: pass(남음) | thin(얇음) | loss(손해) | unverified(같은 상품인지 확인 필요) | mismatch(다른 상품) | nocost(원가 미확인)
export async function buildCnRows({ filter = 'all', category, q, limit = 100 } = {}) {
  const costs = loadCostsBase();
  const fxInfo = await getFxJpyPerCny().catch(() => null);
  const jpyPerCny = fxInfo?.rate || null;
  const cnCfg = loadCnConfig();
  const catKeys = new Set(cnCfg.categories.map((c) => c.key));
  const rows = db.listCnRows().filter((r) => catKeys.has(r.category) && !isExcluded(r.name, cnCfg)).map((r) => {
    let verdict;
    if (r.q_status !== 'ok') verdict = 'nocost';
    else if (r.verified === 'different') verdict = 'mismatch';
    else if (!r.manual && r.verified !== 'same') verdict = 'unverified';
    else if (r.passed) verdict = 'pass';
    else if (r.net_jpy > 0) verdict = 'thin';
    else verdict = 'loss';
    let target = null;
    if (jpyPerCny) target = breakEvenCnPriceCny({ jpRefPriceJpy: r.price_jpy, jpyPerCny, weightG: r.weight_g || 300 }, costs);
    return {
      id: r.id, category: r.category, name: r.name, image: r.image_url, url: r.url, shop: r.shop, reviews: r.review_count, reviewAvg: r.review_avg,
      score: r.score, reasons: safeJson(r.reasons, []), jpPrice: r.price_jpy, weightG: r.weight_g,
      cn: r.q_status === 'ok' ? { title: r.cn_title, priceCny: r.cn_price_cny, url: r.cn_url, image: r.cn_image, moq: r.moq, monthSold: r.month_sold, supplier: r.supplier, manual: !!r.manual } : null,
      cnNote: r.q_status === 'none' ? r.note : null,
      net: r.q_status === 'ok' ? r.net_jpy : null, rate: r.rate, passed: !!r.passed, sell: r.sell_jpy,
      verified: r.verified, reason: r.verified_reason, checked: r.checked_at, verdict,
      targetCny: target, // 이 원가(위안) 이하면 마진 기준 통과
    };
  });
  const base = rows.filter((r) => (!category || r.category === category) && (!q || `${r.name} ${r.cn?.title || ''}`.toLowerCase().includes(String(q).toLowerCase())));
  const cnt = (v) => base.filter((r) => r.verdict === v).length;
  const counts = { all: base.length, pass: cnt('pass'), thin: cnt('thin'), loss: cnt('loss'), unverified: cnt('unverified'), nocost: cnt('nocost'), mismatch: cnt('mismatch') };
  let out = filter === 'all' ? base : base.filter((r) => r.verdict === filter);
  const rank = { pass: 0, thin: 1, unverified: 2, loss: 3, nocost: 4, mismatch: 5 };
  out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.net ?? -1e9) - (a.net ?? -1e9) || b.score - a.score);
  return { rows: out.slice(0, Math.min(limit, 300)), counts, fx: jpyPerCny, provider: cnProvider() || null, categories: loadCnConfig().categories.map((c) => ({ key: c.key, name: c.name })) };
}
const safeJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// 수동 원가 입력(자동 조회가 안 될 때): 사람이 1688에서 찾은 위안 단가를 넣으면 마진만 계산한다
export async function setManualCost(itemId, { priceCny, url, moq }) {
  const item = db.getCnItem(itemId);
  if (!item) { const e = new Error('없는 후보'); e.status = 404; throw e; }
  const p = Number(priceCny);
  if (!(p > 0)) { const e = new Error('위안 단가를 숫자로 입력하세요'); e.status = 400; throw e; }
  const costs = loadCostsBase();
  const fx = (await getFxJpyPerCny()).rate;
  const bd = marginFor(item, p, fx, costs);
  db.saveCnQuote({
    item_id: itemId, status: 'ok', provider: 'manual', manual: 1, cn_title: '(직접 입력)', cn_price_cny: p, cn_url: url || null, moq: moq ? Number(moq) : null,
    weight_g: item.weight_g, net_jpy: bd.netMarginJpy, rate: bd.marginRate, passed: bd.passed ? 1 : 0, sell_jpy: bd.sellJpy, verified: 'same', verified_reason: '사람이 직접 입력',
  });
  return bd;
}

// "왜 이 숫자?" — 비용 내역
export async function explainCn(itemId) {
  const item = db.getCnItem(itemId);
  const q = db.getCnQuote(itemId);
  if (!item || !q || q.status !== 'ok') { const e = new Error('원가가 확인된 후보가 아닙니다'); e.status = 404; throw e; }
  const costs = loadCostsBase();
  const fx = (await getFxJpyPerCny()).rate;
  const bd = marginFor(item, q.cn_price_cny, fx, costs);
  return {
    name: item.name, jpPrice: item.price_jpy, cnPriceCny: q.cn_price_cny, jpyPerCny: fx, weightG: item.weight_g, breakdown: bd,
    targetCny: breakEvenCnPriceCny({ jpRefPriceJpy: item.price_jpy, jpyPerCny: fx, weightG: item.weight_g || 300 }, costs),
    moq: q.moq,
  };
}
