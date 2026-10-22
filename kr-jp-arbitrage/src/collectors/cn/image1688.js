// 1688 이미지 검색 — 일본 상품 사진으로 같은/비슷한 상품의 중국 도매 가격(위안)·최소주문수량(MOQ)·판매량을 찾는다.
// 공식 API가 아니라 서드파티 서비스를 쓴다 (둘 중 하나, 유료·건당 과금):
//   · nexscope : POST https://api.nexscope.ai/api/skill-api/v1/skills/1688-search-by-image/run  (Bearer, NEXSCOPE_API_KEY)
//   · apify    : Apify 액터의 run-sync-get-dataset-items (APIFY_TOKEN + CN_APIFY_ACTOR, 입력 형식은 CN_APIFY_INPUT)
// 서드파티 응답 구조는 바뀔 수 있으므로 필드명을 여러 후보로 읽고(방어적 파싱), 처음 연결할 때
// `node --env-file=.env src/index.js --probe-cn` 으로 응답의 키 구조를 확인한다 (값은 출력하지 않음).
import { warn } from '../../util.js';

export function cnProvider() {
  const forced = (process.env.CN_PROVIDER || '').toLowerCase();
  if (forced === 'nexscope' && process.env.NEXSCOPE_API_KEY) return 'nexscope';
  if (forced === 'apify' && process.env.APIFY_TOKEN && process.env.CN_APIFY_ACTOR) return 'apify';
  if (process.env.NEXSCOPE_API_KEY) return 'nexscope';
  if (process.env.APIFY_TOKEN && process.env.CN_APIFY_ACTOR) return 'apify';
  return '';
}

// 라쿠텐 이미지 URL의 ?_ex=128x128 같은 축소 옵션을 떼고 원본 크기로 (1688 쪽이 이미지를 직접 내려받는다)
export const fullImageUrl = (u) => String(u || '').split('?')[0];

const first = (o, keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((a, p) => (a == null ? a : a[p]), o);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};
const num = (v) => {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
};

// 응답 안에서 '상품 목록처럼 보이는 배열'을 찾는다 (깊이 4까지)
function findList(node, depth = 0) {
  if (Array.isArray(node)) {
    if (node.length && typeof node[0] === 'object' && node[0] && (first(node[0], TITLE) !== undefined || first(node[0], PRICE) !== undefined)) return node;
    for (const x of node) { const r = depth < 4 ? findList(x, depth + 1) : null; if (r) return r; }
    return null;
  }
  if (node && typeof node === 'object' && depth < 4) {
    for (const v of Object.values(node)) { const r = findList(v, depth + 1); if (r) return r; }
  }
  return null;
}

const TITLE = ['title', 'subject', 'name', 'productTitle', 'offerTitle', 'itemTitle'];
const PRICE = ['price', 'priceMin', 'minPrice', 'salePrice', 'unitPrice', 'priceInfo.price', 'priceInfo.minPrice', 'price.current', 'priceRange'];

// 가격 통화: 응답에 통화 필드가 있으면 그것, 없으면 가격 문자열의 기호(US $, $, ¥/元/CNY)로 추정. 기본은 위안.
function detectCurrency(it) {
  const c = String(first(it, ['currency', 'priceCurrency', 'currencyCode', 'price.currency', 'priceInfo.currency']) || '').toUpperCase();
  if (/^(USD|US\$)$/.test(c) || c === 'DOLLAR') return 'USD';
  if (c === 'CNY' || c === 'RMB') return 'CNY';
  if (c === 'JPY') return 'JPY';
  const raw = String(first(it, PRICE) ?? '');
  if (/US\s*\$|\$|USD/i.test(raw)) return 'USD';
  return 'CNY';
}

export function parseMatches(payload) {
  const list = findList(payload) || [];
  return list
    .map((it) => {
      const id = first(it, ['offerId', 'id', 'itemId', 'productId']);
      let url = first(it, ['url', 'detailUrl', 'link', 'productUrl', 'offerUrl', 'itemUrl']);
      if (!url && id) url = `https://detail.1688.com/offer/${id}.html`;
      return {
        title: String(first(it, TITLE) ?? ''),
        priceCny: num(first(it, PRICE)),
        url: url ? String(url) : '',
        image: first(it, ['image', 'imageUrl', 'imgUrl', 'picUrl', 'pic', 'mainImage', 'productImage', 'images.0']) || null,
        moq: num(first(it, ['moq', 'minOrderQuantity', 'minOrder', 'quantityBegin', 'minQuantity', 'minOrderQty'])),
        monthSold: num(first(it, ['monthSold', 'monthSoldCount', 'monthSales', 'saleQuantity', 'sold', 'soldCount', 'last30DaysSold'])),
        repurchase: num(first(it, ['rePurchaseRate', 'repurchaseRate', 'repeatRate', 'rebuyRate'])),
        currency: detectCurrency(it),
        site: /aliexpress|alibaba\.com/i.test(url || '') ? 'AliExpress' : '1688',
        supplier: String(first(it, ['seller', 'sellerName', 'companyName', 'shopName', 'supplier', 'sellerIdentity.name', 'seller.name', 'shop.name']) ?? ''),
      };
    })
    .filter((m) => m.title && m.priceCny > 0 && m.url);
}

// 키 이름만 보여주는 응답 구조 요약 (값은 넣지 않음 — 연결 확인·필드명 보정용)
export function describeShape(node, depth = 0) {
  if (Array.isArray(node)) return depth > 3 ? '[…]' : [node.length ? describeShape(node[0], depth + 1) : 'empty'];
  if (node && typeof node === 'object') {
    if (depth > 3) return '{…}';
    return Object.fromEntries(Object.entries(node).slice(0, 25).map(([k, v]) => [k, describeShape(v, depth + 1)]));
  }
  return typeof node;
}

// 이미지를 서버에서 내려받아 base64로 (상대 서버가 이미지 URL을 못 가져올 때 대비). jpg/png만, 4MB 이하
async function toBase64(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`이미지 다운로드 실패 HTTP ${res.status}`);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (!/image\/(jpeg|jpg|png)/.test(type)) throw new Error(`jpg/png가 아닌 이미지(${type || '알 수 없음'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 4 * 1024 * 1024) throw new Error('이미지가 4MB를 넘음');
  return buf.toString('base64');
}

// 응답 봉투에서 data를 뺀 나머지(코드·메시지 등)를 짧게 — 오류 원인 확인용 (키·상품 데이터는 포함되지 않음)
const envelopeOf = (json) => {
  if (!json || typeof json !== 'object') return '';
  const { data, ...rest } = json;
  return JSON.stringify(rest).slice(0, 300);
};

async function callNexscope(image, pageSize) {
  const body = { page: 1, pageSize };
  if (image.base64) body.imageBase64 = image.base64;
  else body.imageUrl = image.url;
  const res = await fetch('https://api.nexscope.ai/api/skill-api/v1/skills/1688-search-by-image/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NEXSCOPE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* JSON 아님 */ }
  if (!res.ok) throw new Error(`Nexscope HTTP ${res.status} ${envelopeOf(json) || text.slice(0, 150)}`);
  // 문서: HTTP 200이어도 code가 0이 아니면 실패
  if (json && json.code !== undefined && json.code !== 0 && json.code !== '0') {
    const e = new Error(`Nexscope 응답 코드 ${json.code} ${envelopeOf(json)}`);
    e.nexscopeCode = json.code;
    throw e;
  }
  return json;
}

async function callApify(imageUrl, pageSize) {
  const actor = process.env.CN_APIFY_ACTOR; // 예: user~actor-name
  const tpl = process.env.CN_APIFY_INPUT || '{"imageUrl":"{{image}}","maxResults":{{max}}}';
  const body = tpl.replaceAll('{{image}}', imageUrl).replaceAll('{{max}}', String(pageSize));
  const res = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?token=${encodeURIComponent(process.env.APIFY_TOKEN)}&timeout=120`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(130000),
  });
  if (!res.ok) throw new Error(`Apify HTTP ${res.status}`);
  return res.json();
}

/** @returns {{matches: Array, raw: any, provider: string}} */
export async function searchBy1688Image(imageUrl, { pageSize = 20 } = {}) {
  const provider = cnProvider();
  if (!provider) throw new Error('1688 이미지 검색 키가 없습니다 (NEXSCOPE_API_KEY 또는 APIFY_TOKEN+CN_APIFY_ACTOR)');
  const url = fullImageUrl(imageUrl);
  if (!/\.(jpe?g|png)$/i.test(url)) warn(`[1688] 이미지 확장자가 jpg/png가 아닙니다(검색이 실패할 수 있음): ${url.slice(-40)}`);
  let raw;
  if (provider === 'nexscope') {
    try {
      raw = await callNexscope({ url }, pageSize);
    } catch (e) {
      if (e.nexscopeCode === undefined) throw e;
      // 이미지 URL 방식이 거절되면 이미지를 직접 내려받아 base64로 한 번 더 시도
      warn(`[1688] URL 방식 실패(${e.message.slice(0, 80)}) → base64로 재시도`);
      raw = await callNexscope({ base64: await toBase64(url) }, pageSize);
    }
  } else raw = await callApify(url, pageSize);
  return { matches: parseMatches(raw), raw, provider };
}
