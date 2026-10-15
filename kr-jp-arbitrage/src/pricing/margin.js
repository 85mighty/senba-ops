// 순마진 계산 — 상수는 전부 config/costs.json (+ Sheets config_override 탭으로 덮어쓰기 가능)
// net_margin_jpy =
//   jp_sell_price_jpy
//   − 한국 매입원가(JPY 환산, 환율 안전마진 포함)
//   − 한국 국내배송비(JPY 환산)
//   − 국제배송비(중량 구간)
//   − 관세 (과세가격 × duty_rate)
//   − 수입소비세 ((과세가격+관세) × 0.10)   ※ 상업수입: 0.6掛け·1만엔 면세 미적용
//   − 플랫폼 수수료
//   − 포장·잡비

// 중량 구간표에서 국제배송비 산출
export function intlShipJpy(weightG, costs) {
  const { tiers, over_per_kg_jpy } = costs.intl_ship;
  for (const t of tiers) {
    if (weightG <= t.max_g) return t.jpy;
  }
  const last = tiers[tiers.length - 1];
  const overKg = Math.ceil((weightG - last.max_g) / 1000);
  return last.jpy + overKg * (over_per_kg_jpy || 1500);
}

// 상품명 키워드로 중량 카테고리 추정 (master.weight_g 없을 때)
export function estimateWeightG(name, costs, weightKeywords) {
  const n = (name || '').toLowerCase();
  for (const [cat, words] of Object.entries(weightKeywords || {})) {
    if (words.some((w) => n.includes(w.toLowerCase()))) return costs.default_weight_g[cat] ?? costs.default_weight_g.default;
  }
  return costs.default_weight_g.default;
}

export function platformFeeJpy(sellJpy, costs) {
  const fee = costs.platform_fees[costs.platform] || costs.platform_fees.mercari_shops;
  return Math.round(sellJpy * (fee.rate || 0) + (fee.fixed_jpy || 0) + sellJpy * (fee.extra_rate || 0));
}

/**
 * @param {object} p
 * @param {number} p.krPriceKrw   한국 실구매가 (세일가 우선)
 * @param {number} p.jpLowestJpy  일본 최저가 (공식몰·시장가 중 낮은 쪽)
 * @param {number} p.fx           KRW per 1 JPY
 * @param {number} p.weightG      추정 중량(g)
 * @param {string} [p.category]   관세 카테고리 (기본 apparel)
 * @param {object} costs          costs.json (+override 병합본)
 * @returns breakdown 객체 (netMarginJpy, marginRate, passed 포함)
 */
export function computeMargin({ krPriceKrw, jpLowestJpy, fx, weightG, category = 'apparel' }, costs) {
  const fxMargin = Number(process.env.FX_SAFETY_MARGIN ?? costs.fx_safety_margin ?? 0);

  // 판매가: 일본 최저가 × 계수 (팔리려면 최저가보다 싸야 함)
  const jpSellPriceJpy = Math.floor(jpLowestJpy * (costs.jp_sell_price_factor ?? 0.95));

  // 한국 매입원가 (안전마진: 원가를 fxMargin만큼 비싸게 가정)
  const krGoodsJpy = Math.round((krPriceKrw / fx) * (1 + fxMargin));
  const krShipJpy = Math.round((costs.kr_domestic_ship_krw / fx) * (1 + fxMargin));

  const intlShip = intlShipJpy(weightG, costs);

  // 과세가격(CIF 근사) = 상품원가 + 국제배송비
  const taxableJpy = krGoodsJpy + intlShip;
  const dutyRate = costs.duty_rates[category] ?? costs.duty_rates.default;
  const customsDutyJpy = Math.round(taxableJpy * dutyRate);
  const importTaxJpy = Math.round((taxableJpy + customsDutyJpy) * (costs.consumption_tax ?? 0.1));

  const platformFee = platformFeeJpy(jpSellPriceJpy, costs);
  const packing = costs.packing_and_misc_jpy ?? 150;

  const netMarginJpy =
    jpSellPriceJpy - krGoodsJpy - krShipJpy - intlShip - customsDutyJpy - importTaxJpy - platformFee - packing;
  const marginRate = jpSellPriceJpy > 0 ? netMarginJpy / jpSellPriceJpy : 0;

  const passed =
    netMarginJpy >= (costs.pass_min_margin_jpy ?? 2200) && marginRate >= (costs.pass_min_margin_rate ?? 0.25);

  return {
    jpLowestJpy,
    jpSellPriceJpy,
    krPriceKrw,
    krGoodsJpy,
    krShipJpy,
    intlShipJpy: intlShip,
    weightG,
    taxableJpy,
    dutyRate,
    customsDutyJpy,
    importTaxJpy,
    platform: costs.platform,
    platformFeeJpy: platformFee,
    packingJpy: packing,
    fx,
    fxSafetyMargin: fxMargin,
    netMarginJpy,
    marginRate: Math.round(marginRate * 1000) / 1000,
    passed,
  };
}

// 상품명에서 품목 종류(shoes/cap/bag/…)를 추정 — 관세율 구분용
export function categoryOfName(name, weightKeywords) {
  const n = (name || '').toLowerCase();
  for (const [cat, words] of Object.entries(weightKeywords || {})) {
    if (words.some((w) => n.includes(w.toLowerCase()))) return cat;
  }
  return 'top';
}

/**
 * 일본에서 사서 한국에 파는 방향의 순마진(원).
 * net = 한국 판매가(시세×계수) − 일본 매입(환율·안전마진) − 일본 국내배송 − 일본→한국 배송비 − 한국 관세 − 수입 부가세 − 판매 수수료 − 포장·잡비
 * @param {number} p.jpPriceJpy  일본에서 사는 값(엔, 세금 포함가)
 * @param {number} p.krSellKrw   한국에서 팔리는 시세(원)
 * @param {number} p.fx          1엔당 원
 */
export function computeMarginJpToKr({ jpPriceJpy, krSellKrw, fx, weightG, category = 'default' }, costs) {
  const c = costs.jp_to_kr;
  const fxMargin = Number(process.env.FX_SAFETY_MARGIN ?? costs.fx_safety_margin ?? 0);

  const krSellPriceKrw = Math.floor(krSellKrw * (c.sell_price_factor ?? 0.95));
  const jpGoodsKrw = Math.round(jpPriceJpy * fx * (1 + fxMargin)); // 원화가 약해지면 비싸지므로 안전마진은 비용에 가산
  const jpShipKrw = Math.round((c.jp_domestic_ship_jpy ?? 0) * fx * (1 + fxMargin));

  const tiers = c.intl_ship_krw.tiers;
  let intlShipKrw = tiers.find((t) => weightG <= t.max_g)?.krw;
  if (intlShipKrw == null) {
    const last = tiers[tiers.length - 1];
    intlShipKrw = last.krw + Math.ceil((weightG - last.max_g) / 1000) * (c.intl_ship_krw.over_per_kg_krw || 8000);
  }

  const taxableKrw = jpGoodsKrw + intlShipKrw; // 과세가격(CIF 근사)
  const dutyRate = c.duty_rates[category] ?? c.duty_rates.default;
  const customsDutyKrw = Math.round(taxableKrw * dutyRate);
  const importVatKrw = Math.round((taxableKrw + customsDutyKrw) * (c.import_vat ?? 0.1));
  const platformFeeKrw = Math.round(krSellPriceKrw * (c.platform_fee_rate ?? 0));
  const packingKrw = c.packing_and_misc_krw ?? 0;

  const netMarginKrw = krSellPriceKrw - jpGoodsKrw - jpShipKrw - intlShipKrw - customsDutyKrw - importVatKrw - platformFeeKrw - packingKrw;
  const marginRate = krSellPriceKrw > 0 ? netMarginKrw / krSellPriceKrw : 0;
  const passed = netMarginKrw >= (c.pass_min_margin_krw ?? 20000) && marginRate >= (c.pass_min_margin_rate ?? 0.25);

  return {
    krSellKrw, krSellPriceKrw, jpPriceJpy, jpGoodsKrw, jpShipKrw, intlShipKrw, weightG, taxableKrw,
    dutyRate, customsDutyKrw, importVatKrw, platformFeeKrw, packingKrw, fx, category,
    netMarginKrw, marginRate: Math.round(marginRate * 1000) / 1000, passed,
  };
}

/**
 * 목표 매입가 역산: 이 일본가·중량에서 통과 기준을 만족하는 최대 한국 매입가(KRW).
 * 공짜여도 미달이면 null (이 상품은 가격이 아무리 떨어져도 안 됨 — 배송비·수수료 구조 문제).
 * 100원 단위 내림. 이분 탐색이라 마진 공식이 바뀌어도 항상 일치한다.
 */
export function breakEvenKrPrice({ jpLowestJpy, fx, weightG, category = 'apparel' }, costs) {
  const pass = (krw) => computeMargin({ krPriceKrw: krw, jpLowestJpy, fx, weightG, category }, costs).passed;
  if (!pass(0)) return null;
  let lo = 0;
  let hi = Math.ceil(jpLowestJpy * fx); // 상한: 환산 동일가 (이 가격이면 반드시 미달)
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (pass(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo / 100) * 100;
}

// Sheets config_override 병합: key는 점 표기 경로 (예: intl_ship.over_per_kg_jpy)
/**
 * 중국(1688)에서 사서 일본에 파는 방향의 순마진(JPY).
 *  판매가 = 일본 시세 × 계수 / 원가 = 위안×환율(+환율 안전마진) + 대행수수료 + 중국 내 배송 + 중국→일본 배송(무게)
 *  + 관세 + 수입 소비세 + 플랫폼 수수료 + 포장 + 불량 충당금
 * @param {{cnPriceCny:number, jpRefPriceJpy:number, jpyPerCny:number, weightG:number, dutyKey?:string}} p
 */
export function computeMarginCnToJp({ cnPriceCny, jpRefPriceJpy, jpyPerCny, weightG, dutyKey = 'default' }, costs) {
  const c = costs.cn_to_jp || {};
  const fxMargin = Number(process.env.FX_SAFETY_MARGIN ?? costs.fx_safety_margin ?? 0);
  const sellJpy = Math.floor(jpRefPriceJpy * (c.sell_price_factor ?? 0.95));
  const goodsJpy = Math.round(cnPriceCny * jpyPerCny * (1 + fxMargin));
  const agentFeeJpy = Math.round(goodsJpy * (c.agent_fee_rate ?? 0.05));
  const cnShipJpy = Math.round((c.cn_domestic_ship_cny ?? 6) * jpyPerCny);
  const sh = c.intl_ship || {};
  const intlShipJpy = Math.max(sh.min_jpy ?? 250, Math.round((weightG / 1000) * (sh.per_kg_jpy ?? 1100) + (sh.fixed_per_item_jpy ?? 120)));
  const taxableJpy = goodsJpy + agentFeeJpy + cnShipJpy + intlShipJpy; // 과세가격(CIF 근사)
  const dutyRate = (c.duty_rates || {})[dutyKey] ?? (c.duty_rates || {}).default ?? 0.05;
  const customsDutyJpy = Math.round(taxableJpy * dutyRate);
  const importTaxJpy = Math.round((taxableJpy + customsDutyJpy) * (c.import_consumption_tax ?? 0.1));
  const platformFee = platformFeeJpy(sellJpy, costs);
  const packing = c.packing_and_misc_jpy ?? 100;
  const reserve = Math.round(sellJpy * (c.defect_reserve_rate ?? 0.03));
  const netMarginJpy = sellJpy - goodsJpy - agentFeeJpy - cnShipJpy - intlShipJpy - customsDutyJpy - importTaxJpy - platformFee - packing - reserve;
  const marginRate = sellJpy > 0 ? netMarginJpy / sellJpy : 0;
  const passed = netMarginJpy >= (c.pass_min_margin_jpy ?? 800) && marginRate >= (c.pass_min_margin_rate ?? 0.3);
  return {
    jpRefPriceJpy, sellJpy, cnPriceCny, jpyPerCny, goodsJpy, agentFeeJpy, cnShipJpy, intlShipJpy, weightG,
    taxableJpy, dutyRate, customsDutyJpy, importTaxJpy, platform: costs.platform, platformFeeJpy: platformFee,
    packingJpy: packing, reserveJpy: reserve, netMarginJpy, marginRate: Math.round(marginRate * 1000) / 1000, passed,
  };
}

// 이 일본 판매가에서 마진 기준을 통과하려면 중국 원가(위안)가 얼마 이하여야 하는가 (이진 탐색)
export function breakEvenCnPriceCny({ jpRefPriceJpy, jpyPerCny, weightG, dutyKey }, costs) {
  let lo = 0, hi = 5000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (computeMarginCnToJp({ cnPriceCny: mid, jpRefPriceJpy, jpyPerCny, weightG, dutyKey }, costs).passed) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 10) / 10;
}

export function mergeOverrides(costs, overrides) {
  const merged = structuredClone(costs);
  for (const [key, raw] of overrides) {
    if (!key || key.startsWith('_')) continue;
    let value = raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed === '') continue;
      try {
        value = JSON.parse(trimmed); // 숫자·불리언·JSON 모두 처리
      } catch {
        value = trimmed; // 문자열 (예: platform=base_standard)
      }
    }
    const parts = key.split('.');
    let node = merged;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }
  return merged;
}
