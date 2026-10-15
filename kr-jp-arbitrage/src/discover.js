// 발굴 로직 — "다음에 팔 상품"을 찾는다.
// 재고 위험을 줄이는 원칙: 일본에서 이미 팔리는 상품(리뷰 수 = 수요)을 우선하고,
// 지금 기준 미달이어도 "목표 매입가"(이 가격까지 떨어지면 통과)를 붙여 주시 목록으로 만든다.
import db, { unmatchedHighDemandJp, cardRows } from './db.js';

// 발굴 점수 = 현재 순마진 + 수요 보정(리뷰 수 로그 × 300엔)
// 마진이 같으면 리뷰 많은 쪽(=빨리 팔려 재고 위험 낮은 쪽)이 위로 온다.
export function candidateScore(netMarginJpy, reviewCount) {
  return netMarginJpy + 300 * Math.log1p(reviewCount || 0);
}

/**
 * 오늘 계산된 전 상품(미달 포함)을 발굴 점수로 랭킹.
 * 이미 통과한 상품은 daily_picks로 보고되므로 여기서는 제외하고 '주시 후보'만 담는다.
 * @returns [{brand, name, netMarginJpy, marginRate, targetKrPriceKrw, krPriceKrw, jpSellPriceJpy, reviewCount, krUrl, jpUrl, score}]
 */
export function rankCandidates({ date, limit = 10 } = {}) {
  const d = date || db.prepare(`SELECT MAX(date) AS d FROM margin_snapshots`).get()?.d;
  if (!d) return [];
  const rows = db
    .prepare(
      `SELECT s.*, m.brand, m.confidence,
              k.name AS kr_name, k.url AS kr_url, j.name AS jp_name, j.url AS jp_url
       FROM margin_snapshots s
       JOIN product_master m ON m.id = s.master_id
       LEFT JOIN products_kr k ON k.id = m.kr_product_id
       LEFT JOIN products_jp j ON j.id = m.jp_product_id
       WHERE s.date=? AND s.passed=0`
    )
    .all(d);
  const out = [];
  for (const r of rows) {
    let bd = {};
    try {
      bd = JSON.parse(r.breakdown_json || '{}');
    } catch {
      /* 무시 */
    }
    // 목표가가 없는(=구조적으로 불가능한) 상품은 주시해도 소용없으니 제외
    if (!bd.targetKrPriceKrw) continue;
    out.push({
      date: r.date,
      brand: r.brand,
      confidence: r.confidence,
      name: r.kr_name || r.jp_name,
      netMarginJpy: r.net_margin_jpy,
      marginRate: r.margin_rate,
      krPriceKrw: r.kr_price_krw,
      jpSellPriceJpy: r.jp_price_jpy,
      targetKrPriceKrw: bd.targetKrPriceKrw,
      reviewCount: bd.jpReviewCount || 0,
      krUrl: r.kr_url,
      jpUrl: r.jp_url,
      score: candidateScore(r.net_margin_jpy, bd.jpReviewCount),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// 가능성 판정: 통과 여부 + 목표 매입가까지 필요한 하락폭
export function assess({ passed, krPrice, target }) {
  if (passed) return { level: 'go', label: '지금 가능', gapPct: 0 };
  if (!target) return { level: 'no', label: '구조상 어려움', gapPct: null, hint: '한국가가 공짜여도 배송비·수수료 때문에 기준 미달' };
  const gap = Math.max(0, (krPrice - target) / krPrice);
  const pct = Math.round(gap * 100);
  if (gap <= 0.2) return { level: 'near', label: `세일 임박 (−${pct}%면 통과)`, gapPct: pct };
  if (gap <= 0.5) return { level: 'wait', label: `큰 세일 필요 (−${pct}%)`, gapPct: pct };
  return { level: 'far', label: `가능성 낮음 (−${pct}% 필요)`, gapPct: pct };
}

export function demandLabel(reviews) {
  if (reviews >= 300) return '수요 높음';
  if (reviews >= 100) return '수요 보통';
  if (reviews > 0) return '수요 낮음';
  return '수요 미확인';
}

const LEVEL_RANK = { go: 0, near: 1, wait: 2, far: 3, no: 4 };

/**
 * 판단용 카드: 오늘 계산된 전 상품(통과+미달)을 이미지·가격·판정과 함께.
 * 같은 브랜드·품번은 마진이 가장 좋은 1건만 남긴다 (시장가 매칭에서 같은 품번이 여러 판매처로 중복되기 때문).
 */
export function buildCards({ date, limit = 60 } = {}) {
  const best = new Map();
  for (const r of cardRows({ date })) {
    let bd = {};
    try { bd = JSON.parse(r.breakdown_json || '{}'); } catch { /* 무시 */ }
    const a = assess({ passed: !!r.passed, krPrice: r.kr_price_krw, target: bd.targetKrPriceKrw });
    const card = {
      masterId: r.master_id,
      date: r.date,
      brand: r.brand,
      confidence: r.confidence,
      code: r.code || null,
      krName: r.kr_name,
      jpName: r.jp_name,
      krImage: r.kr_image,
      jpImage: r.jp_image,
      krUrl: r.kr_url,
      jpUrl: r.jp_url,
      krSource: r.kr_source,
      jpSource: r.jp_source,
      krPriceKrw: r.kr_price_krw,
      jpSellPriceJpy: r.jp_price_jpy,
      jpLowestJpy: bd.jpLowestJpy,
      netMarginJpy: r.net_margin_jpy,
      marginRate: r.margin_rate,
      targetKrPriceKrw: bd.targetKrPriceKrw ?? null,
      reviews: bd.jpReviewCount || 0,
      demand: demandLabel(bd.jpReviewCount || 0),
      verdict: a,
      breakdown: bd,
      note: r.master_note,
    };
    const key = card.code ? `${card.brand}:${card.code}` : `m:${card.masterId}`;
    const prev = best.get(key);
    if (!prev || card.netMarginJpy > prev.netMarginJpy) best.set(key, card);
  }
  return [...best.values()]
    .sort((x, y) =>
      LEVEL_RANK[x.verdict.level] - LEVEL_RANK[y.verdict.level] ||
      (x.verdict.gapPct ?? 999) - (y.verdict.gapPct ?? 999) ||
      y.reviews - x.reviews
    )
    .slice(0, limit);
}

/**
 * 일본 수요 상위인데 아직 매칭 없는 상품 — 사람이 한국 소싱처를 찾아볼 후보.
 */
export function sourcingCandidates({ brand, limit = 10 } = {}) {
  return unmatchedHighDemandJp({ brand, limit });
}
