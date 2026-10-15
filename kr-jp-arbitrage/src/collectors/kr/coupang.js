// 쿠팡 파트너스 Open API 상품 검색 — 한국 시장가 보강 (공식 API만 사용, 쿠팡 페이지 스크래핑 안 함)
// 키: COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY (쿠팡 파트너스 > 도구 > 파트너스 API). 승인된 파트너만 발급.
// 주의: 호출 허용 IP를 서버 IP로 등록해야 함. 호출 한도가 낮으므로(후기상 시간당 10회 안팎) 1회 실행당 호출 수를 제한한다.
// 403/401/429 응답이 오면 이번 실행에서는 더 호출하지 않고 멈춘다.
import crypto from 'node:crypto';
import { info, warn, sleep } from '../../util.js';
import { extractCode } from '../../matcher/rules.js';

const HOST = 'https://api-gateway.coupang.com';
const PATH = '/v2/providers/affiliate_open_api/apis/openapi/products/search';

// 서명용 시각: yyMMdd'T'HHmmss'Z' (GMT)
export function signedDate(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    String(now.getUTCFullYear()).slice(2) + p(now.getUTCMonth() + 1) + p(now.getUTCDate()) +
    'T' + p(now.getUTCHours()) + p(now.getUTCMinutes()) + p(now.getUTCSeconds()) + 'Z'
  );
}

// Authorization 헤더: CEA algorithm=HmacSHA256 — 서명 대상 = 시각 + 메서드 + 경로 + 쿼리(? 제외)
export function authHeader({ method, path, query, accessKey, secretKey, now }) {
  const dt = signedDate(now);
  const signature = crypto.createHmac('sha256', secretKey).update(dt + method + path + query).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${dt}, signature=${signature}`;
}

// 파트너스 링크(추적 파라미터가 매번 달라짐) 대신 상품 ID로 고정 URL을 만든다 (중복 누적 방지)
export const canonicalUrl = (productId) => `https://www.coupang.com/vp/products/${productId}`;

let blocked = false; // 403/401/429를 받으면 이번 프로세스에서는 중단

export async function collect(brandKey, brandCfg, { limit } = {}) {
  if (blocked) return [];
  const ak = process.env.COUPANG_ACCESS_KEY;
  const sk = process.env.COUPANG_SECRET_KEY;
  if (!ak || !sk) return [];

  const cfg = brandCfg.kr?.coupang || {};
  if (cfg.enabled === false) return [];
  const queries = (cfg.queries?.length ? cfg.queries : brandCfg.kr?.naver?.queries?.length ? brandCfg.kr.naver.queries : [brandCfg.kr?.naver?.query])
    .filter(Boolean)
    .slice(0, parseInt(process.env.COUPANG_MAX_CALLS || '2', 10));

  const brandWords = (brandCfg.brand_words || []).map((w) => w.toLowerCase());
  const byId = new Map();

  for (const q of queries) {
    const query = `keyword=${encodeURIComponent(q)}&limit=${Math.min(limit || 10, 10)}`;
    const res = await fetch(`${HOST}${PATH}?${query}`, {
      headers: {
        Authorization: authHeader({ method: 'GET', path: PATH, query, accessKey: ak, secretKey: sk }),
        'Content-Type': 'application/json;charset=UTF-8',
      },
      signal: AbortSignal.timeout(20000),
    });
    if ([401, 403, 429].includes(res.status)) {
      blocked = true;
      warn(`[coupang] HTTP ${res.status} — 키·허용 IP·호출 한도 확인 필요. 이번 실행에서는 쿠팡 호출을 중단합니다 (403이면 10분 이상 쉴 것)`);
      break;
    }
    if (!res.ok) throw new Error(`쿠팡 API HTTP ${res.status}`);
    const data = await res.json();
    const list = data?.data?.productData || [];
    for (const it of list) {
      const name = String(it.productName || '');
      // 검색어에 걸린 다른 브랜드·무관 상품 제거: 브랜드명이 상품명에 있어야 함
      if (brandWords.length && !brandWords.some((w) => name.toLowerCase().includes(w))) continue;
      if (!it.productId || !it.productPrice) continue;
      byId.set(it.productId, {
        brand: brandKey,
        source: 'coupang',
        product_code: extractCode(name, brandCfg.product_code_regex),
        name,
        color: null,
        price: Number(it.productPrice),
        url: canonicalUrl(it.productId),
        image_url: it.productImage || null,
        in_stock: true,
      });
    }
    await sleep(6000); // 호출 간격
  }
  const items = [...byId.values()];
  info(`[coupang] ${brandKey}: ${items.length}건 (호출 ${queries.length}회)`);
  return items;
}
