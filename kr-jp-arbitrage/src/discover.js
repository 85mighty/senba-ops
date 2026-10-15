// 발굴 로직 — "다음에 팔 상품"을 찾는다.
// 재고 위험을 줄이는 원칙: 일본에서 이미 팔리는 상품(리뷰 수 = 수요)을 우선하고,
// 지금 기준 미달이어도 "목표 매입가"(이 가격까지 떨어지면 통과)를 붙여 주시 목록으로 만든다.
import db, { unmatchedHighDemandJp } from './db.js';

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

/**
 * 일본 수요 상위인데 아직 매칭 없는 상품 — 사람이 한국 소싱처를 찾아볼 후보.
 */
export function sourcingCandidates({ brand, limit = 10 } = {}) {
  return unmatchedHighDemandJp({ brand, limit });
}
