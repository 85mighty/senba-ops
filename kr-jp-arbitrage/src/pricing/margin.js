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

// Sheets config_override 병합: key는 점 표기 경로 (예: intl_ship.over_per_kg_jpy)
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
