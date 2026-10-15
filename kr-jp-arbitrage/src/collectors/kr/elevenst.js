// 11번가 Open API 상품검색 (ProductSearch) — 한국 시장가 보강
// 키: ELEVENST_API_KEY (openapi.11st.co.kr 에서 발급, 32자리, 유효기간 180일 정책이 있으니 만료 시 재발급)
// 응답은 EUC-KR XML이고, 검색어도 EUC-KR로 URL 인코딩해서 보내는 것이 원래 규격이다.
// 한글 검색어가 UTF-8로도 되는지는 환경마다 달라서, EUC-KR로 먼저 보내고 결과가 없으면 UTF-8로 한 번 더 보낸다.
import { info, warn, sleep } from '../../util.js';
import { extractCode } from '../../matcher/rules.js';

const ENDPOINT = 'http://openapi.11st.co.kr/openapi/OpenApiService.tmall';

// ---------- EUC-KR 인코딩 (Node에는 인코더가 없어서 디코더로 역방향 표를 만든다) ----------
let krMap = null;
function buildKrMap() {
  const dec = new TextDecoder('euc-kr');
  const map = new Map();
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x41; trail <= 0xfe; trail++) {
      const ch = dec.decode(new Uint8Array([lead, trail]));
      if (ch.length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, [lead, trail]);
    }
  }
  return map;
}
const hex = (n) => '%' + n.toString(16).toUpperCase().padStart(2, '0');

export function encodeEucKr(str) {
  krMap ||= buildKrMap();
  let out = '';
  for (const ch of String(str)) {
    if (ch.charCodeAt(0) < 128) out += encodeURIComponent(ch);
    else {
      const b = krMap.get(ch);
      if (b) out += hex(b[0]) + hex(b[1]); // EUC-KR에 없는 글자(일본어 등)는 버린다
    }
  }
  return out;
}

// ---------- 응답 XML 해석 ----------
const decodeEntities = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim()) : '';
}

export function parseProducts(xml) {
  return (xml.match(/<Product>[\s\S]*?<\/Product>/g) || []).map((b) => ({
    code: tag(b, 'ProductCode'),
    name: tag(b, 'ProductName'),
    price: parseInt(tag(b, 'ProductPrice'), 10),
    image: tag(b, 'ProductImage'),
    seller: tag(b, 'Seller'),
    reviews: parseInt(tag(b, 'ReviewCount'), 10) || 0,
  }));
}

// 검색 결과 URL은 추적 파라미터가 섞이므로 상품번호로 고정 주소를 만든다
export const canonicalUrl = (code) => `https://www.11st.co.kr/products/${code}`;

async function call(keywordParam, pageSize) {
  const url = `${ENDPOINT}?key=${process.env.ELEVENST_API_KEY}&apiCode=ProductSearch&keyword=${keywordParam}&pageNum=1&pageSize=${pageSize}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const buf = Buffer.from(await res.arrayBuffer());
  const declared = /encoding=["']([^"']+)["']/i.exec(buf.subarray(0, 120).toString('latin1'))?.[1] || 'euc-kr';
  let xml;
  try {
    xml = new TextDecoder(/euc/i.test(declared) ? 'euc-kr' : declared).decode(buf);
  } catch {
    xml = buf.toString('utf8');
  }
  if (!res.ok) throw new Error(`11번가 API HTTP ${res.status}`);
  const products = parseProducts(xml);
  if (!products.length && !/<Products>/.test(xml) && /error/i.test(xml)) {
    // 키가 잘못됐거나 허용 IP 문제 등. URL(키 포함)은 메시지에 넣지 않는다
    throw new Error(`11번가 API 오류 응답: ${xml.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  return products;
}

// 화면의 "시세 찾기"용 즉석 검색 (DB에 저장하지 않음)
export async function searchElevenst(keyword, { pageSize = 30 } = {}) {
  if (!process.env.ELEVENST_API_KEY || !keyword) return [];
  let list = await call(encodeEucKr(keyword), pageSize);
  if (!list.length && /[^\x00-\x7f]/.test(keyword)) list = await call(encodeURIComponent(keyword), pageSize);
  return list
    .filter((p) => p.code && p.price > 0)
    .map((p) => ({
      name: p.name,
      price: p.price,
      url: canonicalUrl(p.code),
      image_url: p.image || null,
      in_stock: true,
      mall: p.seller ? `11번가·${p.seller}` : '11번가',
      review_count: p.reviews,
    }));
}

export async function collect(brandKey, brandCfg, { limit } = {}) {
  if (!process.env.ELEVENST_API_KEY) return [];
  const cfg = brandCfg.kr?.elevenst || {};
  if (cfg.enabled === false) return [];
  const queries = (cfg.queries?.length ? cfg.queries : brandCfg.kr?.naver?.queries?.length ? brandCfg.kr.naver.queries : [brandCfg.kr?.naver?.query])
    .filter(Boolean)
    .slice(0, parseInt(process.env.ELEVENST_MAX_CALLS || '2', 10));
  const brandWords = (brandCfg.brand_words || []).map((w) => w.toLowerCase());
  const byUrl = new Map();
  for (const q of queries) {
    try {
      for (const it of await searchElevenst(q, { pageSize: Math.min(limit || 50, 100) })) {
        if (brandWords.length && !brandWords.some((w) => it.name.toLowerCase().includes(w))) continue;
        byUrl.set(it.url, {
          brand: brandKey,
          source: 'elevenst',
          product_code: extractCode(it.name, brandCfg.product_code_regex),
          name: it.name,
          color: null,
          price: it.price,
          url: it.url,
          image_url: it.image_url,
          in_stock: true,
        });
      }
    } catch (e) {
      warn(`[11st] "${q}" 실패: ${e.message}`);
    }
    await sleep(500);
  }
  const items = [...byUrl.values()];
  info(`[11st] ${brandKey}: ${items.length}건`);
  return items;
}
