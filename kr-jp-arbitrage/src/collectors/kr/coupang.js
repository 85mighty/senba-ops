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

let blockedUntil = 0; // 401/403/429를 받으면 15분간 쿠팡 호출을 멈춘다 (쿠팡 안내: 403이면 10분 이상 쉴 것)
const isBlocked = () => Date.now() < blockedUntil;
const blockNow = () => { blockedUntil = Date.now() + 15 * 60 * 1000; };
const calls = []; // 최근 호출 시각 (시간당 한도 보호)
const hourlyLimit = () => parseInt(process.env.COUPANG_HOURLY_LIMIT || '8', 10);
function pruneCalls() {
  const cutoff = Date.now() - 3600_000;
  while (calls.length && calls[0] < cutoff) calls.shift();
}
// 호출 가능 여부를 판단하고, 가능하면 호출 기록을 남긴다
function takeCall() {
  pruneCalls();
  if (isBlocked() || calls.length >= hourlyLimit()) return false;
  calls.push(Date.now());
  return true;
}
export function coupangStatus() {
  pruneCalls();
  return { blocked: isBlocked(), usedLastHour: calls.length, limited: isBlocked() || calls.length >= hourlyLimit() };
}

// 연결 시험용: 1회 호출해서 상태와 실패 이유(키·승인·허용 IP·시간)를 알려준다. 키 값은 절대 반환하지 않는다
export async function probeCoupang(keyword = '나이키') {
  const ak = process.env.COUPANG_ACCESS_KEY;
  const sk = process.env.COUPANG_SECRET_KEY;
  if (!ak || !sk) return { ok: false, detail: '키가 서버 .env에 없습니다' };
  if (!takeCall()) {
    return { ok: false, detail: isBlocked() ? '직전 호출이 거절(401/403/429)돼서 15분간 쿠팡 호출을 멈춘 상태입니다. 원인(승인·허용 IP)을 고치고 15분 뒤 다시 시험하세요' : '시간당 호출 한도 보호로 건너뜀 — 잠시 뒤 다시 시험하세요' };
  }
  const query = `keyword=${encodeURIComponent(keyword)}&limit=10`;
  const res = await fetch(`${HOST}${PATH}?${query}`, {
    headers: {
      Authorization: authHeader({ method: 'GET', path: PATH, query, accessKey: ak, secretKey: sk }),
      'Content-Type': 'application/json;charset=UTF-8',
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* JSON이 아닌 응답 */ }
  if (!res.ok) {
    if ([401, 403, 429].includes(res.status)) blockNow();
    const hint = {
      401: '서명이 맞지 않거나 서버 시각이 어긋났습니다 (키 오타·시각 확인)',
      403: '파트너스 최종 승인 전이거나 허용 IP 설정 문제일 수 있습니다. 쿠팡 파트너스의 API 메뉴에서 키 상태와 허용 IP를 확인하고 10분 뒤 다시 시도하세요',
      429: '호출 한도를 넘었습니다. 1시간 뒤 다시 시도하세요',
    }[res.status] || '쿠팡 응답 오류';
    return { ok: false, status: res.status, detail: `HTTP ${res.status} · ${body?.message || body?.rMessage || text.slice(0, 120)} → ${hint}` };
  }
  if (body && body.rCode && body.rCode !== '0') return { ok: false, detail: `쿠팡 응답 코드 ${body.rCode} · ${body.rMessage || ''}` };
  const n = body?.data?.productData?.length ?? 0;
  return { ok: true, count: n, detail: `정상 (검색 결과 ${n}건)` };
}

// 화면의 "시세 찾기"용 즉석 검색 (1회 호출, DB에 저장하지 않음)
export async function searchCoupang(keyword) {
  const ak = process.env.COUPANG_ACCESS_KEY;
  const sk = process.env.COUPANG_SECRET_KEY;
  if (!ak || !sk || !keyword || !takeCall()) return [];
  const query = `keyword=${encodeURIComponent(keyword)}&limit=10`;
  const res = await fetch(`${HOST}${PATH}?${query}`, {
    headers: {
      Authorization: authHeader({ method: 'GET', path: PATH, query, accessKey: ak, secretKey: sk }),
      'Content-Type': 'application/json;charset=UTF-8',
    },
    signal: AbortSignal.timeout(20000),
  });
  if ([401, 403, 429].includes(res.status)) {
    blockNow();
    warn(`[coupang] HTTP ${res.status} — 쿠팡 호출 중단 (키·허용 IP·호출 한도 확인)`);
    return [];
  }
  if (!res.ok) throw new Error(`쿠팡 API HTTP ${res.status}`);
  const data = await res.json();
  return (data?.data?.productData || [])
    .filter((it) => it.productId && it.productPrice)
    .map((it) => ({
      name: String(it.productName || ''),
      price: Number(it.productPrice),
      url: canonicalUrl(it.productId),
      image_url: it.productImage || null,
      in_stock: true,
      mall: it.isRocket ? '쿠팡 로켓' : '쿠팡',
    }));
}

export async function collect(brandKey, brandCfg, { limit } = {}) {
  if (isBlocked()) return [];
  const ak = process.env.COUPANG_ACCESS_KEY;
  const sk = process.env.COUPANG_SECRET_KEY;
  if (!ak || !sk) return [];

  const cfg = brandCfg.kr?.coupang || {};
  if (cfg.enabled === false) return [];
  const queries = (cfg.queries?.length ? cfg.queries : brandCfg.kr?.naver?.queries?.length ? brandCfg.kr.naver.queries : [brandCfg.kr?.naver?.query])
    .filter(Boolean)
    .slice(0, parseInt(process.env.COUPANG_MAX_CALLS || '1', 10));

  const brandWords = (brandCfg.brand_words || []).map((w) => w.toLowerCase());
  const byId = new Map();

  for (const q of queries) {
    if (!takeCall()) {
      warn('[coupang] 시간당 호출 한도 보호로 나머지 쿠팡 호출을 건너뜁니다');
      break;
    }
    const query = `keyword=${encodeURIComponent(q)}&limit=${Math.min(limit || 10, 10)}`;
    const res = await fetch(`${HOST}${PATH}?${query}`, {
      headers: {
        Authorization: authHeader({ method: 'GET', path: PATH, query, accessKey: ak, secretKey: sk }),
        'Content-Type': 'application/json;charset=UTF-8',
      },
      signal: AbortSignal.timeout(20000),
    });
    if ([401, 403, 429].includes(res.status)) {
      blockNow();
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
