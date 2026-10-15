// DataForSEO Merchant API — 구글 쇼핑(일본) 가격 검색. 라쿠텐·Yahoo에 없는 쇼핑몰(아마존 재팬, 요도바시, ZOZO 등)까지 한 번에 본다.
// 인증: HTTP Basic (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD). 일본 = location_code 2392, language_code ja.
// 요청을 올리고(task_post) 결과를 가져오는(task_get) 방식이라 우선순위 큐(priority 2, 보통 1분 이내)를 쓴다. 건당 비용이 있으니 예산을 두고 쓴다.
// 응답 필드는 문서 기준으로 방어적으로 읽는다 (title/price/currency/url/seller/product_images).
import { warn, sleep } from '../../util.js';

const BASE = 'https://api.dataforseo.com/v3';

export const dataforseoReady = () => !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
const authHeader = () => 'Basic ' + Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`DataForSEO HTTP ${res.status}`);
  return res.json();
}

const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.]/g, '')));

export function parseItems(task) {
  const items = task?.result?.[0]?.items || [];
  return items
    .map((it) => {
      const price = num(it.price?.current ?? it.price);
      const seller = it.seller || it.domain || '';
      return {
        name: String(it.title || ''),
        price: Math.round(price),
        url: it.url || it.shopping_url || '',
        image_url: it.product_images?.[0] || it.image_url || null,
        in_stock: true,
        mall: seller,
        currency: it.currency || 'JPY',
      };
    })
    .filter((x) => x.name && x.price > 0 && x.url && (!x.currency || x.currency === 'JPY'));
}

// 연결 시험용: 무료 계정 조회로 로그인과 잔액만 확인한다
export async function probeDataforseo() {
  if (!dataforseoReady()) return { ok: false, detail: '로그인/비밀번호가 서버 .env에 없습니다' };
  const j = await call('/appendix/user_data');
  const t = j?.tasks?.[0];
  if (!t || t.status_code !== 20000) return { ok: false, detail: `DataForSEO 응답 ${t?.status_code || ''} ${t?.status_message || j?.status_message || ''}` };
  const bal = t.result?.[0]?.money?.balance;
  return { ok: true, detail: `정상${typeof bal === 'number' ? ` · 잔액 $${bal.toFixed(2)}` : ''}` };
}

/**
 * 구글 쇼핑(일본)에서 키워드 검색. 결과가 나올 때까지 폴링하며 최대 timeoutMs 기다린다.
 * @returns {Array<{name, price, url, image_url, mall}>}
 */
export async function searchGoogleShoppingJp(keyword, { depth = 40, timeoutMs = 90000 } = {}) {
  if (!dataforseoReady() || !keyword) return [];
  const posted = await call('/merchant/google/products/task_post', [
    { keyword, location_code: 2392, language_code: 'ja', depth, priority: parseInt(process.env.DATAFORSEO_PRIORITY || '2', 10) },
  ]);
  const t = posted?.tasks?.[0];
  if (!t?.id || (t.status_code && t.status_code >= 40000)) {
    throw new Error(`DataForSEO 요청 실패: ${t?.status_message || posted?.status_message || '알 수 없음'}`);
  }
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(4000);
    const got = await call(`/merchant/google/products/task_get/advanced/${t.id}`);
    const task = got?.tasks?.[0];
    if (task?.status_code === 20000) return parseItems(task);
    // 40602 = 대기열에 있음 → 계속 기다림. 그 밖의 40000번대는 실패
    if (task?.status_code && task.status_code >= 40000 && task.status_code !== 40602) {
      throw new Error(`DataForSEO 오류 ${task.status_code}: ${task.status_message}`);
    }
  }
  warn(`[dataforseo] "${keyword}" 결과 대기 시간 초과 (${Math.round(timeoutMs / 1000)}초)`);
  return [];
}
