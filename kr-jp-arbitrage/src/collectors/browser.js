// Playwright 공용: 브라우저 수명주기, robots.txt 확인, 24시간 페이지 캐시, 공식몰 목록 스크래퍼
// 서버의 기존 Chrome CDP 포트(9223~9225)·프로필은 건드리지 않는다 — 별도 headless chromium 사용
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CACHE_DIR, info, warn, error, politeWait, parsePrice } from '../util.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 동일 페이지 24시간 캐시

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = import('playwright').then(({ chromium }) => chromium.launch({ headless: true }));
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    try {
      (await browserPromise).close();
    } catch {
      /* 무시 */
    }
    browserPromise = null;
  }
}

// ---------- robots.txt (origin별 메모리 캐시, User-agent: * 그룹의 Disallow만 확인) ----------
const robotsCache = new Map();

async function robotsAllowed(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let disallows = [];
    try {
      const res = await fetch(`${u.origin}/robots.txt`, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const text = await res.text();
        let inStar = false;
        for (const raw of text.split('\n')) {
          const line = raw.replace(/#.*/, '').trim();
          const [k, ...rest] = line.split(':');
          const v = rest.join(':').trim();
          if (/^user-agent$/i.test(k)) inStar = v === '*';
          else if (inStar && /^disallow$/i.test(k) && v) disallows.push(v);
        }
      }
    } catch {
      /* robots 조회 실패 → 허용으로 간주 */
    }
    robotsCache.set(u.origin, disallows);
  }
  const disallows = robotsCache.get(u.origin);
  const full = u.pathname + u.search;
  return !disallows.some((p) => full.startsWith(p));
}

// ---------- 페이지 추출 결과 24시간 파일 캐시 ----------
function cacheFile(url) {
  return path.join(CACHE_DIR, crypto.createHash('sha1').update(url).digest('hex') + '.json');
}
function readPageCache(url) {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(url), 'utf8'));
    if (Date.now() - new Date(c.fetchedAt).getTime() < CACHE_TTL_MS) return c.items;
  } catch {
    /* 캐시 없음 */
  }
  return null;
}
function writePageCache(url, items) {
  try {
    fs.writeFileSync(cacheFile(url), JSON.stringify({ fetchedAt: new Date().toISOString(), items }));
  } catch {
    /* 무시 */
  }
}

// ---------- 한 목록 페이지에서 상품 카드 추출 ----------
async function extractListPage(page, url, selectors) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500); // 지연 렌더 대비
  return page.$$eval(
    selectors.item,
    (nodes, sel) => {
      const text = (root, s) => {
        if (!s) return null;
        for (const part of s.split(',')) {
          const el = root.querySelector(part.trim());
          if (el && el.textContent.trim()) return el.textContent.trim();
        }
        return null;
      };
      const attr = (root, s, a) => {
        if (!s) return null;
        for (const part of s.split(',')) {
          const el = root.querySelector(part.trim());
          if (el && el.getAttribute(a)) return el.getAttribute(a);
        }
        return null;
      };
      return nodes.map((node) => ({
        name: text(node, sel.name),
        priceText: text(node, sel.price),
        salePriceText: text(node, sel.sale_price),
        href: attr(node, sel.link, 'href'),
        image: attr(node, sel.image, 'src') || attr(node, sel.image, 'data-src'),
        soldOut: sel.sold_out ? !!node.querySelector(sel.sold_out.split(',')[0].trim()) : false,
      }));
    },
    selectors
  );
}

/**
 * 공식몰 목록 스크래핑 (한·일 공용)
 * @param {string} brandKey
 * @param {object} siteCfg brands.json의 kr.brand_site / jp.brand_site
 * @param {object} [opts] {limit}
 * @returns 수집기 공통 형태 배열 (price는 정가, sale_price는 세일가)
 */
export async function scrapeBrandSite(brandKey, siteCfg, { limit } = {}) {
  const items = [];
  const base = siteCfg.base_url;

  outer: for (const listUrl of siteCfg.list_urls || []) {
    const paged = listUrl.includes('{page}');
    const maxPages = paged ? siteCfg.max_pages || 3 : 1;

    for (let p = 1; p <= maxPages; p++) {
      const url = paged ? listUrl.replaceAll('{page}', String(p)) : listUrl;

      let raw = readPageCache(url);
      if (!raw) {
        if (!(await robotsAllowed(url))) {
          warn(`[scrape] robots.txt 불허 → 건너뜀: ${url}`);
          continue;
        }
        const browser = await getBrowser();
        const ctx = await browser.newContext({ userAgent: UA, locale: url.includes('.jp') ? 'ja-JP' : 'ko-KR' });
        const page = await ctx.newPage();
        try {
          await politeWait();
          raw = await extractListPage(page, url, siteCfg.selectors);
          writePageCache(url, raw);
          info(`[scrape] ${url} → ${raw.length}건`);
        } catch (e) {
          error(`[scrape] 실패 ${url}: ${e.message}`);
          raw = [];
        } finally {
          await ctx.close();
        }
      } else {
        info(`[scrape] 캐시 사용(24h): ${url} → ${raw.length}건`);
      }

      if (raw.length === 0 && paged) break; // 빈 페이지 → 페이지네이션 종료

      for (const r of raw) {
        if (!r.name || !r.href) continue;
        const price = parsePrice(r.priceText);
        const salePrice = parsePrice(r.salePriceText);
        if (!price && !salePrice) continue;
        items.push({
          brand: brandKey,
          source: 'brand_site',
          product_code: null, // 매칭 단계에서 이름·URL 정규식으로 추출
          name: r.name,
          color: null,
          price: price || salePrice,
          sale_price: salePrice && price && salePrice < price ? salePrice : null,
          url: new URL(r.href, base).href,
          image_url: r.image ? new URL(r.image, base).href : null,
          in_stock: !r.soldOut,
        });
        if (limit && items.length >= limit) break outer;
      }
    }
  }
  return items;
}
