// 가격 추세 분석 (Phase 4) — 2주 이상 하락 중인 한국 상품 = 재고 처분 신호
// report 단계에서 호출되어 Telegram 보고에 "재고 처분 신호 후보"로 붙는다.
import db, { priceHistory } from './db.js';
import { info } from './util.js';

const MIN_SPAN_DAYS = 14; // 최소 관찰 기간
const MIN_DROP_RATE = 0.05; // 총 하락폭 5% 이상
const NOISE_TOLERANCE = 0.01; // 중간에 1% 이내 반등은 노이즈로 간주

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// 기록이 전 구간에 걸쳐 (노이즈 허용 범위에서) 하락 추세인지
function isDeclining(history) {
  for (let i = 1; i < history.length; i++) {
    if (history[i].price > history[i - 1].price * (1 + NOISE_TOLERANCE)) return false;
  }
  return history[history.length - 1].price < history[0].price * (1 - MIN_DROP_RATE);
}

/**
 * 한국 상품 중 재고 처분 신호(2주 이상 지속 하락) 목록
 * @returns {string[]} 보고용 문자열 배열
 */
export function krClearanceSignals(limit = 20) {
  const products = db
    .prepare(`SELECT id, brand, name, url FROM products_kr WHERE in_stock=1 AND source='brand_site'`)
    .all();
  const signals = [];
  for (const p of products) {
    const hist = priceHistory('kr', p.id, 30);
    if (hist.length < 3) continue;
    const span = daysBetween(hist[0].fetched_date, hist[hist.length - 1].fetched_date);
    if (span < MIN_SPAN_DAYS) continue;
    if (!isDeclining(hist)) continue;
    const first = hist[0].price;
    const last = hist[hist.length - 1].price;
    const dropPct = ((1 - last / first) * 100).toFixed(0);
    signals.push(
      `[${p.brand}] ${p.name}: ₩${first.toLocaleString()}→₩${last.toLocaleString()} (-${dropPct}%, ${span}일) ${p.url}`
    );
    if (signals.length >= limit) break;
  }
  if (signals.length) info(`[trend] 재고 처분 신호 ${signals.length}건`);
  return signals;
}
