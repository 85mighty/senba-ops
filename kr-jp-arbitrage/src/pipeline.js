// 파이프라인: collect-kr → collect-jp → match → quote → price → report
// 각 단계는 독립 실행 가능. 한 단계 실패가 전체를 죽이지 않는다 — 실패는 로그 + Telegram 경고.
import crypto from 'node:crypto';
import {
  enabledBrands, loadCostsBase, loadBrands, features,
  info, warn, error, nowIso, today, sleep,
} from './util.js';
import * as db from './db.js';
import { matchBrand } from './matcher/rules.js';
import { getFxKrwPerJpy } from './pricing/fx.js';
import { computeMargin, estimateWeightG, mergeOverrides, breakEvenKrPrice } from './pricing/margin.js';
import { collect as collectKrBrandSite } from './collectors/kr/brandSite.js';
import { collect as collectJpBrandSite } from './collectors/jp/brandSite.js';
import { closeBrowser } from './collectors/browser.js';
import { appendDailyPicks, writeReviewQueue, writeCandidates, readConfigOverride } from './outputs/sheets.js';
import { sendDailyReport, sendStepFailure } from './outputs/telegram.js';
import { rankCandidates, sourcingCandidates } from './discover.js';
import { findCounterparts, toQuote } from './lookup.js';
import { compareProducts } from './matcher/llm.js';

export const STEP_ORDER = ['collect-kr', 'collect-jp', 'match', 'quote', 'price', 'report'];

// 뒤 Phase에서 추가되는 수집기·LLM 모듈은 없으면 조용히 건너뛴다
async function optionalModule(spec) {
  try {
    return await import(spec);
  } catch {
    return null;
  }
}

// ---------- 1~2. 수집 ----------
async function stepCollect(side, { brand, limit } = {}) {
  const feats = features();
  let total = 0;
  for (const { key, cfg } of enabledBrands(brand)) {
    // 공식몰 (Playwright)
    try {
      const items = side === 'kr' ? await collectKrBrandSite(key, cfg, { limit }) : await collectJpBrandSite(key, cfg, { limit });
      const n = db.saveProducts(side, items);
      info(`[collect-${side}] ${key}/brand_site: ${n}건 저장`);
      total += n;
    } catch (e) {
      error(`[collect-${side}] ${key}/brand_site 실패: ${e.message}`);
    }
    // 시장가 API (키·설정 있을 때만)
    const apiSources =
      side === 'kr'
        ? [
            ['naver', feats.naver, cfg.kr?.naver, './collectors/kr/naver.js'],
            // 쿠팡: 별도 설정이 없으면 네이버 검색어를 재사용 (brands.json에 kr.coupang.enabled=false로 끌 수 있음)
            ['elevenst', feats.elevenst, { enabled: cfg.kr?.elevenst?.enabled !== false && !!(cfg.kr?.naver?.query || cfg.kr?.naver?.queries?.length || cfg.kr?.elevenst?.queries?.length) }, './collectors/kr/elevenst.js'],
            ['coupang', feats.coupang, { enabled: cfg.kr?.coupang?.enabled !== false && !!(cfg.kr?.naver?.query || cfg.kr?.naver?.queries?.length || cfg.kr?.coupang?.queries?.length) }, './collectors/kr/coupang.js'],
          ]
        : [
            ['rakuten', feats.rakuten, cfg.jp?.rakuten, './collectors/jp/rakuten.js'],
            ['yahoo', feats.yahoo, cfg.jp?.yahoo, './collectors/jp/yahoo.js'],
          ];
    for (const [name, featOk, srcCfg, modPath] of apiSources) {
      if (!featOk || !srcCfg?.enabled) continue;
      const mod = await optionalModule(modPath);
      if (!mod) {
        warn(`[collect-${side}] ${name} 수집기 미구현(다음 Phase) — 건너뜀`);
        continue;
      }
      try {
        let items = await mod.collect(key, cfg, { limit });
        const floor = side === 'jp' ? loadCostsBase().market_min_price_jpy || 0 : 0;
        if (floor) items = items.filter((it) => it.price >= floor);
        const n = db.saveProducts(side, items);
        info(`[collect-${side}] ${key}/${name}: ${n}건 저장`);
        total += n;
      } catch (e) {
        error(`[collect-${side}] ${key}/${name} 실패: ${e.message}`);
      }
    }
  }
  return `${total}건 저장`;
}

// ---------- 3. 매칭 ----------
async function stepMatch({ brand } = {}) {
  const global = loadBrands()._global || {};
  const summary = [];
  let allCPairs = [];
  for (const { key, cfg } of enabledBrands(brand)) {
    // 기본은 공식몰끼리 매칭. 공식몰 수집이 없는 브랜드(일본 미진출 등)는
    // 시장 상품(네이버/라쿠텐/Yahoo 대행 시세)으로 매칭한다.
    let kr = db.getProducts('kr', key).filter((p) => p.source === 'brand_site');
    if (!kr.length) kr = db.getProducts('kr', key);
    let jp = db.getProducts('jp', key).filter((p) => p.source === 'brand_site');
    if (!jp.length) jp = db.getProducts('jp', key);
    // TNF는 품번 체계가 달라 자동 매칭 기대 금지 — 품번 일치(우연)와 사람 등록만
    if (cfg.auto_match === false) {
      info(`[match] ${key}: 자동 이름 매칭 비활성화 (사람이 product_master에 쌍 등록)`);
      continue;
    }
    const r = matchBrand(key, cfg, global, kr, jp);
    summary.push(`${key}: A=${r.a} B=${r.b} C=${r.c}`);
    allCPairs = allCPairs.concat(r.cPairs);
  }

  // LLM 보조 판정 (ANTHROPIC_API_KEY 있을 때만, 하루 상한)
  if (features().llm && allCPairs.length) {
    const llm = await optionalModule('./matcher/llm.js');
    if (llm) {
      const judged = await llm.judgeCandidates(allCPairs);
      summary.push(`LLM 판정 ${judged}건`);
    }
  }
  return summary.join(' / ') || '매칭 대상 없음';
}

// ---------- 3.5 시세 확인: 모든 상품의 반대편 시세와 예상 마진을 미리 계산해 목록에서 한눈에 보이게 ----------
// 1) DB에 있는 같은 품번(무료·즉시) → 2) 못 찾으면 예산 안에서 외부 API 검색 → 3) 이름 검색 결과는 AI가 이미지 비교
async function stepQuote({ brand, limit } = {}) {
  const feats = features();
  const floor = loadCostsBase().market_min_price_jpy || 0;
  const budget = {
    kr: feats.rakuten || feats.yahoo ? parseInt(process.env.QUOTE_SEARCH_BUDGET || '60', 10) : 0,
    jp: feats.coupang || feats.elevenst ? parseInt(process.env.QUOTE_SEARCH_BUDGET_JP || '15', 10) : 0,
  };
  let done = 0, found = 0, searched = 0;
  for (const side of ['kr', 'jp']) {
    const targets = db.quoteTargets(side, { brand, minPrice: side === 'jp' ? floor : 0, limit: limit || 600 });
    for (const t of targets) {
      try {
        const p = db.getProductById(side, t.id);
        let r = await findCounterparts(p, side, { online: false });
        if (!r.best && budget[side] > 0) {
          budget[side]--;
          searched++;
          r = await findCounterparts(p, side, { online: true });
          await sleep(1200); // 라쿠텐 API 예절(초당 1회)
        }
        db.saveQuote(side, t.id, toQuote(r));
        done++;
        if (r.best) found++;
      } catch (e) {
        warn(`[quote] ${side}#${t.id} 실패: ${e.message}`);
      }
    }
  }
  let verified = 0;
  if (feats.llm) {
    for (const q of db.quotesToVerify(parseInt(process.env.LLM_VERIFY_LIMIT || '30', 10))) {
      try {
        const p = db.getProductById(q.side, q.product_id);
        const v = await compareProducts({ name: p.name, image: p.image_url }, { name: q.best_name, image: q.best_image });
        db.setQuoteVerdict(q.side, q.product_id, v.verdict, v.reason);
        verified++;
      } catch (e) {
        warn(`[quote] AI 비교 중단: ${e.message}`);
        break;
      }
    }
  }
  return `시세 확인 ${done}건 (반대편 찾음 ${found}건, 외부 검색 ${searched}건, AI 이미지 비교 ${verified}건)`;
}

// ---------- 4. 마진 계산 ----------
async function stepPrice({ brand } = {}) {
  const fx = await getFxKrwPerJpy();
  let costs = loadCostsBase();
  try {
    const overrides = await readConfigOverride();
    if (overrides.length) {
      costs = mergeOverrides(costs, overrides);
      info(`[price] config_override ${overrides.length}건 적용`);
    }
  } catch (e) {
    warn(`[price] config_override 읽기 실패(기본값 사용): ${e.message}`);
  }
  const weightKeywords = loadBrands()._global?.weight_keywords || {};

  const masters = db.listMasters({ confidences: ['A', 'B'], brand });
  const date = today();
  let computed = 0;
  let passed = 0;
  for (const m of masters) {
    const kr = db.getProductById('kr', m.kr_product_id);
    const jp = db.getProductById('jp', m.jp_product_id);
    if (!kr || !jp || !kr.in_stock || !jp.in_stock) continue;

    // 한국 매입가: 공식몰 실결제가(세일가 우선)와 같은 품번 네이버 시장가 중 낮은 쪽
    const krEffective = kr.sale_price_krw && kr.sale_price_krw < kr.price_krw ? kr.sale_price_krw : kr.price_krw;
    const krMarketLow = db.krLowestByCode(m.brand, kr.product_code);
    const krPrice = Math.min(...[krEffective, krMarketLow].filter((v) => v > 0));
    // 일본 최저가: 매칭된 공식몰가와 같은 품번의 시장가(라쿠텐/Yahoo) 중 낮은 쪽
    const marketLow = db.jpLowestByCode(m.brand, jp.product_code);
    const jpLowest = Math.min(...[jp.price_jpy, marketLow].filter((v) => v > 0));
    if (!krPrice || !jpLowest || !isFinite(krPrice) || !isFinite(jpLowest)) continue;

    const weightG = m.weight_g || estimateWeightG(kr.name, costs, weightKeywords);
    const bd = computeMargin({ krPriceKrw: krPrice, jpLowestJpy: jpLowest, fx: fx.rate, weightG }, costs);
    // 발굴용 부가정보: 목표 매입가(이 한국가면 통과) + 일본 수요(리뷰 수)
    bd.targetKrPriceKrw = breakEvenKrPrice({ jpLowestJpy: jpLowest, fx: fx.rate, weightG }, costs);
    bd.jpReviewCount = db.jpDemandByCode(m.brand, jp.product_code, jp.id);

    db.saveSnapshot({
      master_id: m.id,
      date,
      kr_price_krw: krPrice,
      jp_price_jpy: bd.jpSellPriceJpy,
      fx: fx.rate,
      net_margin_jpy: bd.netMarginJpy,
      margin_rate: bd.marginRate,
      passed: bd.passed ? 1 : 0,
      breakdown_json: JSON.stringify(bd),
    });
    computed++;
    if (bd.passed) passed++;
  }
  return `계산 ${computed}건, 통과 ${passed}건 (fx=${fx.rate.toFixed(4)}${fx.stale ? ', 캐시값' : ''})`;
}

// ---------- 5. 보고 ----------
async function stepReport() {
  const date = today();
  const rows = db.topSnapshots({ date, onlyPassed: true, limit: 100 });

  // 법·운영 비고 자동 삽입 (§12) — 브랜드별 비고는 brands.json의 report_note
  const brandNotes = {};
  for (const [k, cfg] of Object.entries(loadBrands())) {
    if (!k.startsWith('_') && cfg.report_note) brandNotes[k] = cfg.report_note;
  }
  for (const r of rows) {
    const notes = [];
    if (brandNotes[r.brand]) notes.push(brandNotes[r.brand]);
    if (r.master_note) notes.push(r.master_note);
    r.note = notes.join(' / ');
  }

  // 가격 추세 (Phase 4) — 모듈 있으면 사용
  let trendNotes = [];
  const trend = await optionalModule('./trend.js');
  if (trend) {
    try {
      trendNotes = trend.krClearanceSignals();
    } catch (e) {
      warn(`[report] 추세 분석 실패: ${e.message}`);
    }
  }

  // 발굴: 기준 미달이지만 주시할 후보 + 일본 수요 높은데 매칭 없는 소싱 후보
  const candidates = rankCandidates({ date, limit: 10 });
  const sourcing = sourcingCandidates({ limit: 10 });

  const pendings = db.pendingReviews();
  await appendDailyPicks(rows);
  await writeReviewQueue(pendings);
  await writeCandidates(date, candidates, sourcing);
  await sendDailyReport({ date, rows, pendingCount: pendings.length, trendNotes, candidates, sourcing });
  return `통과 ${rows.length}건 보고, 발굴 후보 ${candidates.length}건, 소싱 후보 ${sourcing.length}건, 검토 대기 ${pendings.length}건`;
}

const STEP_FNS = {
  'collect-kr': (o) => stepCollect('kr', o),
  'collect-jp': (o) => stepCollect('jp', o),
  match: stepMatch,
  quote: stepQuote,
  price: stepPrice,
  report: stepReport,
};

/**
 * 파이프라인 실행. steps 미지정 시 전체.
 * @param {object} opts {steps?: string[], brand?: string, limit?: number}
 */
export async function runPipeline(opts = {}) {
  const steps = opts.steps?.length ? opts.steps : STEP_ORDER;
  const runId = crypto.randomBytes(4).toString('hex');
  info(`=== 파이프라인 시작 run=${runId} steps=${steps.join(',')}${opts.brand ? ` brand=${opts.brand}` : ''}${opts.limit ? ` limit=${opts.limit}` : ''} ===`);
  const results = {};
  for (const step of steps) {
    const fn = STEP_FNS[step];
    if (!fn) {
      warn(`알 수 없는 단계: ${step}`);
      continue;
    }
    const startedAt = nowIso();
    try {
      const msg = await fn(opts);
      db.logRun(runId, step, 'ok', msg, startedAt, nowIso());
      info(`[${step}] 완료: ${msg}`);
      results[step] = { ok: true, msg };
    } catch (e) {
      db.logRun(runId, step, 'fail', e.message, startedAt, nowIso());
      error(`[${step}] 실패:`, e);
      await sendStepFailure(step, e.message);
      results[step] = { ok: false, msg: e.message };
      // 다음 단계는 계속 진행 (한 단계 실패가 전체를 죽이면 안 된다)
    }
  }
  await closeBrowser();
  info(`=== 파이프라인 종료 run=${runId} ===`);
  return results;
}
