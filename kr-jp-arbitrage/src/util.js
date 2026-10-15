// 공용 유틸: 로그·대기·설정 로드·기능 플래그
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const LOG_DIR = path.join(ROOT, 'logs');
for (const d of [DATA_DIR, CACHE_DIR, LOG_DIR]) fs.mkdirSync(d, { recursive: true });

// JST 기준 오늘 날짜 (YYYY-MM-DD)
export function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export function nowIso() {
  return new Date().toISOString();
}

// 로그: logs/YYYY-MM-DD.log + 콘솔. 키(토큰·시크릿)는 절대 로그에 남기지 않는다.
function writeLog(level, args) {
  const msg = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : JSON.stringify(a)))
    .join(' ');
  const line = `[${nowIso()}] [${level}] ${msg}`;
  // eslint 없는 환경 — console 직접 사용
  console.log(line);
  try {
    fs.appendFileSync(path.join(LOG_DIR, `${today()}.log`), line + '\n');
  } catch {
    /* 로그 파일 실패는 무시 */
  }
}
export const info = (...a) => writeLog('INFO', a);
export const warn = (...a) => writeLog('WARN', a);
export const error = (...a) => writeLog('ERROR', a);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 스크래핑 예절: 요청 간 2~5초 랜덤 대기
export const politeWait = () => sleep(2000 + Math.floor(Math.random() * 3000));

// "1,234원" / "¥1,234" / "1234" → 1234
export function parsePrice(text) {
  if (text == null) return null;
  const digits = String(text).replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

export function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// config/brands.extra.json 은 brands.json 위에 덮어쓰는 보강 설정이다 (객체는 합치고, 배열·값은 교체).
// 서버에서 셀렉터를 직접 고친 brands.json 은 배포(rsync)에서 제외되므로, 검색어·쿠팡 쿼리 같은 추가분은 이 파일로 배포한다.
function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra === undefined ? base : extra;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(extra)) {
    if (k.startsWith('__')) continue;
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out;
}

export function loadBrands() {
  const base = loadJson(path.join(ROOT, 'config', 'brands.json'));
  const extraFile = path.join(ROOT, 'config', 'brands.extra.json');
  if (!fs.existsSync(extraFile)) return base;
  try {
    return deepMerge(base, loadJson(extraFile));
  } catch (e) {
    warn(`config/brands.extra.json 읽기 실패 — 무시합니다: ${e.message}`);
    return base;
  }
}

export function loadCostsBase() {
  return loadJson(path.join(ROOT, 'config', 'costs.json'));
}

// 활성화된 브랜드 목록 (--brand 필터 적용)
export function enabledBrands(brandFilter) {
  const brands = loadBrands();
  return Object.entries(brands)
    .filter(([key, cfg]) => !key.startsWith('_') && cfg.enabled)
    .filter(([key]) => !brandFilter || key === brandFilter)
    .map(([key, cfg]) => ({ key, cfg, global: brands._global || {} }));
}

// 기능별 활성화 여부 — 없는 키는 경고만 내고 비활성화 (서비스 자체는 뜬다)
export function features() {
  const e = process.env;
  return {
    // 네이버 쇼핑 검색 API는 2026-07-31 종료됨. 혹시 되살아난 경우를 위해 NAVER_SHOP_ENABLED=1 일 때만 시도
    naver: !!(e.NAVER_CLIENT_ID && e.NAVER_CLIENT_SECRET && e.NAVER_SHOP_ENABLED === '1'),
    coupang: !!(e.COUPANG_ACCESS_KEY && e.COUPANG_SECRET_KEY),
    elevenst: !!e.ELEVENST_API_KEY,
    dataforseo: !!(e.DATAFORSEO_LOGIN && e.DATAFORSEO_PASSWORD),
    rakuten: !!(e.RAKUTEN_APP_ID && e.RAKUTEN_ACCESS_KEY),
    yahoo: !!e.YAHOO_CLIENT_ID,
    sheets: !!(e.GOOGLE_SHEET_ID && e.GOOGLE_SERVICE_ACCOUNT_JSON && fs.existsSync(e.GOOGLE_SERVICE_ACCOUNT_JSON)),
    telegram: !!(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID),
    llm: !!e.ANTHROPIC_API_KEY,
    ui: !!e.UI_TOKEN,
  };
}

export function warnMissingFeatures() {
  const f = features();
  const msgs = {
    naver: '네이버 쇼핑 검색 API는 2026-07-31 종료되어 사용하지 않음 (한국 가격은 공식몰·쿠팡 키로 보강)',
    coupang: '쿠팡 파트너스 API 키 없음(COUPANG_ACCESS_KEY/SECRET_KEY) → 쿠팡 시장가 비활성화',
    elevenst: '11번가 API 키 없음(ELEVENST_API_KEY) → 11번가 시장가 비활성화',
    dataforseo: 'DataForSEO 로그인/비밀번호 없음 → 구글 쇼핑(일본) 검색 비활성화',
    rakuten: 'RAKUTEN_APP_ID/RAKUTEN_ACCESS_KEY 없음 → 라쿠텐 수집 비활성화 (신형 API는 둘 다 필요)',
    yahoo: 'YAHOO_CLIENT_ID 없음 → Yahoo!쇼핑 수집 비활성화',
    sheets: 'Google Sheets 설정 없음(GOOGLE_SHEET_ID / 서비스계정 JSON) → 시트 기록 비활성화',
    telegram: 'Telegram 설정 없음 → 보고·경고 비활성화',
    llm: 'ANTHROPIC_API_KEY 없음 → LLM 보조 매칭 비활성화',
    ui: 'UI_TOKEN 없음 → 웹 API 잠금(읽기 포함) — .env에 UI_TOKEN 설정 필요',
  };
  for (const [k, ok] of Object.entries(f)) {
    if (!ok) warn(msgs[k]);
  }
  return f;
}
