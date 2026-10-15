// SQLite 스키마·쿼리 (better-sqlite3)
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR, nowIso, today } from './util.js';

const db = new Database(path.join(DATA_DIR, 'arb.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS products_kr (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  source TEXT NOT NULL,          -- 'brand_site' | 'naver'
  product_code TEXT,
  name TEXT NOT NULL,
  color TEXT,
  price_krw INTEGER,
  sale_price_krw INTEGER,
  url TEXT NOT NULL,
  image_url TEXT,
  in_stock INTEGER DEFAULT 1,
  fetched_at TEXT,
  UNIQUE(brand, source, url)
);
CREATE TABLE IF NOT EXISTS products_jp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  source TEXT NOT NULL,          -- 'brand_site' | 'rakuten' | 'yahoo'
  product_code TEXT,
  name TEXT NOT NULL,
  color TEXT,
  price_jpy INTEGER,
  url TEXT NOT NULL,
  image_url TEXT,
  in_stock INTEGER DEFAULT 1,
  review_count INTEGER DEFAULT 0,     -- 리뷰 수 = 일본 수요 지표 (라쿠텐/Yahoo)
  fetched_at TEXT,
  UNIQUE(brand, source, url)
);
-- 수동 큐레이션의 원천. confidence: A 확정 / B 유력 / C 후보 / X 거부
CREATE TABLE IF NOT EXISTS product_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  kr_product_id INTEGER,
  kr_url TEXT,
  jp_product_id INTEGER,
  jp_url TEXT,
  confidence TEXT NOT NULL DEFAULT 'C',
  approved_by_user INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  weight_g INTEGER,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(brand, kr_product_id, jp_product_id)
);
-- 추세용. fetched_date로 하루 1건 유지
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_side TEXT NOT NULL,    -- 'kr' | 'jp'
  product_id INTEGER NOT NULL,
  price INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  fetched_date TEXT NOT NULL,
  UNIQUE(product_side, product_id, fetched_date)
);
CREATE TABLE IF NOT EXISTS margin_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  kr_price_krw INTEGER,
  jp_price_jpy INTEGER,
  fx REAL,
  net_margin_jpy INTEGER,
  margin_rate REAL,
  passed INTEGER DEFAULT 0,
  breakdown_json TEXT,
  UNIQUE(master_id, date)
);
CREATE TABLE IF NOT EXISTS run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL,          -- 'ok' | 'fail' | 'skip'
  message TEXT,
  started_at TEXT,
  finished_at TEXT
);
-- 범용 키-값 (LLM 일일 호출 카운터 등)
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- 상품마다 반대편 나라에서 찾은 가장 싼 같은 상품과 예상 마진 (목록에서 한눈에 보기 위함)
CREATE TABLE IF NOT EXISTS quotes (
  side TEXT NOT NULL,              -- 기준 상품이 어느 나라 것인지 'kr' | 'jp'
  product_id INTEGER NOT NULL,
  kind TEXT,                       -- 'code' 품번 일치 | 'search' 이름 검색(추정) | 'none' 못 찾음
  best_name TEXT,
  best_price INTEGER,
  best_url TEXT,
  best_image TEXT,
  best_source TEXT,
  margin_net INTEGER,
  margin_rate REAL,
  passed INTEGER DEFAULT 0,
  verified TEXT,                   -- AI 이미지 비교: 'same' | 'different' | 'unsure'
  verified_reason TEXT,
  checked_at TEXT,
  PRIMARY KEY (side, product_id)
);
CREATE INDEX IF NOT EXISTS idx_kr_brand ON products_kr(brand, in_stock);
CREATE INDEX IF NOT EXISTS idx_jp_brand ON products_jp(brand, in_stock);
CREATE INDEX IF NOT EXISTS idx_hist ON price_history(product_side, product_id, fetched_date);
CREATE INDEX IF NOT EXISTS idx_snap_date ON margin_snapshots(date, passed);
`);

// 기존 DB 마이그레이션: review_count 컬럼이 없던 시절 DB에 추가
try {
  db.exec(`ALTER TABLE products_jp ADD COLUMN review_count INTEGER DEFAULT 0`);
} catch {
  /* 이미 있음 */
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_jp_review ON products_jp(brand, review_count)`);
for (const col of ['rev_net INTEGER', 'rev_rate REAL', 'rev_passed INTEGER DEFAULT 0', 'alts TEXT']) {
  try {
    db.exec(`ALTER TABLE quotes ADD COLUMN ${col}`);
  } catch {
    /* 이미 있음 */
  }
}

// ---------- 상품 upsert ----------
const upsertKrStmt = db.prepare(`
INSERT INTO products_kr (brand, source, product_code, name, color, price_krw, sale_price_krw, url, image_url, in_stock, fetched_at)
VALUES (@brand, @source, @product_code, @name, @color, @price, @sale_price, @url, @image_url, @in_stock, @fetched_at)
ON CONFLICT(brand, source, url) DO UPDATE SET
  product_code=excluded.product_code, name=excluded.name, color=excluded.color,
  price_krw=excluded.price_krw, sale_price_krw=excluded.sale_price_krw,
  image_url=excluded.image_url, in_stock=excluded.in_stock, fetched_at=excluded.fetched_at
`);
const upsertJpStmt = db.prepare(`
INSERT INTO products_jp (brand, source, product_code, name, color, price_jpy, url, image_url, in_stock, review_count, fetched_at)
VALUES (@brand, @source, @product_code, @name, @color, @price, @url, @image_url, @in_stock, @review_count, @fetched_at)
ON CONFLICT(brand, source, url) DO UPDATE SET
  product_code=excluded.product_code, name=excluded.name, color=excluded.color,
  price_jpy=excluded.price_jpy, image_url=excluded.image_url,
  in_stock=excluded.in_stock, review_count=MAX(excluded.review_count, products_jp.review_count),
  fetched_at=excluded.fetched_at
`);
const histStmt = db.prepare(`
INSERT OR REPLACE INTO price_history (product_side, product_id, price, fetched_at, fetched_date)
VALUES (?, ?, ?, ?, ?)
`);

function idByUrl(side, brand, source, url) {
  const table = side === 'kr' ? 'products_kr' : 'products_jp';
  const row = db.prepare(`SELECT id FROM ${table} WHERE brand=? AND source=? AND url=?`).get(brand, source, url);
  return row?.id;
}

// 수집기 공통 형태 {brand, source, product_code, name, color, price, sale_price?, url, image_url, in_stock} 저장
export const saveProducts = db.transaction((side, items) => {
  const now = nowIso();
  const date = today();
  let n = 0;
  for (const it of items) {
    if (!it.url || !it.name || it.price == null) continue;
    const rec = {
      product_code: null,
      color: null,
      sale_price: null,
      image_url: null,
      in_stock: 1,
      review_count: 0,
      ...it,
      in_stock: it.in_stock === false || it.in_stock === 0 ? 0 : 1,
      fetched_at: now,
    };
    if (side === 'kr') upsertKrStmt.run(rec);
    else upsertJpStmt.run(rec);
    const id = idByUrl(side, rec.brand, rec.source, rec.url);
    // 추세용: 실구매 기준가(세일가 우선)를 하루 1건 기록
    const effective = side === 'kr' ? (rec.sale_price || rec.price) : rec.price;
    if (id && effective) histStmt.run(side, id, effective, now, date);
    n++;
  }
  return n;
});

export function getProducts(side, brand) {
  const table = side === 'kr' ? 'products_kr' : 'products_jp';
  return db.prepare(`SELECT * FROM ${table} WHERE brand=?`).all(brand);
}

export function getProductById(side, id) {
  const table = side === 'kr' ? 'products_kr' : 'products_jp';
  return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
}

// 매칭 단계에서 추출한 품번을 영속화 (시장 최저가 보강 시 품번으로 후보를 묶는다)
export function updateProductCode(side, id, code) {
  const table = side === 'kr' ? 'products_kr' : 'products_jp';
  db.prepare(`UPDATE ${table} SET product_code=? WHERE id=? AND (product_code IS NULL OR product_code='')`).run(code, id);
}

// 같은 품번의 일본 상품들(공식몰+시장) 중 재고 있는 최저가
export function jpLowestByCode(brand, code) {
  if (!code) return null;
  return db
    .prepare(
      `SELECT MIN(price_jpy) AS p FROM products_jp WHERE brand=? AND product_code=? AND in_stock=1 AND price_jpy > 0`
    )
    .get(brand, code)?.p;
}

// 같은 품번의 한국 상품들(공식몰 세일가 + 네이버 시장가) 중 최저 매입가
export function krLowestByCode(brand, code) {
  if (!code) return null;
  return db
    .prepare(
      `SELECT MIN(CASE WHEN sale_price_krw > 0 AND sale_price_krw < price_krw THEN sale_price_krw ELSE price_krw END) AS p
       FROM products_kr WHERE brand=? AND product_code=? AND in_stock=1 AND price_krw > 0`
    )
    .get(brand, code)?.p;
}

// ---------- product_master ----------
export function upsertMaster({ brand, krId, krUrl, jpId, jpUrl, confidence, note }) {
  const existing = db
    .prepare(`SELECT * FROM product_master WHERE brand=? AND kr_product_id=? AND jp_product_id=?`)
    .get(brand, krId, jpId);
  const now = nowIso();
  if (existing) {
    // 사람이 승인/거부한 행은 자동 매칭이 덮어쓰지 않는다
    if (existing.approved_by_user || existing.confidence === 'X') return existing.id;
    // 등급은 상향만 (C→B→A)
    const rank = { C: 0, B: 1, A: 2 };
    const next = (rank[confidence] ?? 0) > (rank[existing.confidence] ?? 0) ? confidence : existing.confidence;
    db.prepare(`UPDATE product_master SET confidence=?, note=COALESCE(?, note), updated_at=? WHERE id=?`).run(
      next,
      note || null,
      now,
      existing.id
    );
    return existing.id;
  }
  const r = db
    .prepare(
      `INSERT INTO product_master (brand, kr_product_id, kr_url, jp_product_id, jp_url, confidence, approved_by_user, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    )
    .run(brand, krId, krUrl, jpId, jpUrl, confidence, note || null, now, now);
  return r.lastInsertRowid;
}

export function listMasters({ confidences, brand } = {}) {
  let sql = `SELECT * FROM product_master WHERE 1=1`;
  const args = [];
  if (confidences?.length) {
    sql += ` AND confidence IN (${confidences.map(() => '?').join(',')})`;
    args.push(...confidences);
  }
  if (brand) {
    sql += ` AND brand=?`;
    args.push(brand);
  }
  return db.prepare(sql).all(...args);
}

export function getMaster(id) {
  return db.prepare(`SELECT * FROM product_master WHERE id=?`).get(id);
}

export function setMasterReview(id, action, by = 'ui') {
  // 승인 → A등급 확정 / 거부 → X (보고·재매칭 제외)
  const now = nowIso();
  if (action === 'approve') {
    db.prepare(`UPDATE product_master SET confidence='A', approved_by_user=1, updated_at=?, note=COALESCE(note,'') || ' [승인:' || ? || ']' WHERE id=?`).run(now, by, id);
  } else {
    db.prepare(`UPDATE product_master SET confidence='X', approved_by_user=1, updated_at=?, note=COALESCE(note,'') || ' [거부:' || ? || ']' WHERE id=?`).run(now, by, id);
  }
}

export function setMasterWeight(id, weightG) {
  db.prepare(`UPDATE product_master SET weight_g=?, updated_at=? WHERE id=?`).run(weightG, nowIso(), id);
}

export function updateMasterLlm(id, { confidence, note }) {
  db.prepare(`UPDATE product_master SET confidence=?, note=?, updated_at=? WHERE id=? AND approved_by_user=0`).run(
    confidence,
    note,
    nowIso(),
    id
  );
}

// 검토 대기(C등급) 후보 — 양쪽 상품 정보 포함
export function pendingReviews(limit = 100) {
  return db
    .prepare(
      `SELECT m.id, m.brand, m.confidence, m.note,
              k.name AS kr_name, k.color AS kr_color, k.price_krw, k.sale_price_krw, k.url AS kr_url, k.image_url AS kr_image, k.product_code AS kr_code,
              j.name AS jp_name, j.color AS jp_color, j.price_jpy, j.url AS jp_url, j.image_url AS jp_image, j.product_code AS jp_code
       FROM product_master m
       JOIN products_kr k ON k.id = m.kr_product_id
       JOIN products_jp j ON j.id = m.jp_product_id
       WHERE m.confidence='C' AND m.approved_by_user=0
       ORDER BY m.updated_at DESC LIMIT ?`
    )
    .all(limit);
}

export function pendingCount() {
  return db.prepare(`SELECT COUNT(*) AS n FROM product_master WHERE confidence='C' AND approved_by_user=0`).get().n;
}

// ---------- margin_snapshots ----------
export function saveSnapshot(s) {
  db.prepare(
    `INSERT OR REPLACE INTO margin_snapshots
     (master_id, date, kr_price_krw, jp_price_jpy, fx, net_margin_jpy, margin_rate, passed, breakdown_json)
     VALUES (@master_id, @date, @kr_price_krw, @jp_price_jpy, @fx, @net_margin_jpy, @margin_rate, @passed, @breakdown_json)`
  ).run(s);
}

export function topSnapshots({ date, onlyPassed = true, limit = 50 } = {}) {
  const d = date || db.prepare(`SELECT MAX(date) AS d FROM margin_snapshots`).get()?.d;
  if (!d) return [];
  return db
    .prepare(
      `SELECT s.*, m.brand, m.confidence, m.note AS master_note,
              k.name AS kr_name, k.color AS kr_color, k.url AS kr_url,
              j.name AS jp_name, j.url AS jp_url
       FROM margin_snapshots s
       JOIN product_master m ON m.id = s.master_id
       LEFT JOIN products_kr k ON k.id = m.kr_product_id
       LEFT JOIN products_jp j ON j.id = m.jp_product_id
       WHERE s.date=? ${onlyPassed ? 'AND s.passed=1' : ''}
       ORDER BY s.net_margin_jpy DESC LIMIT ?`
    )
    .all(d, limit);
}

// ---------- 발굴 (수요·소싱 후보) ----------
// 같은 품번의 일본 상품 중 최대 리뷰 수 = 수요 지표
export function jpDemandByCode(brand, code, fallbackId) {
  if (code) {
    const n = db
      .prepare(`SELECT MAX(review_count) AS n FROM products_jp WHERE brand=? AND product_code=?`)
      .get(brand, code)?.n;
    if (n) return n;
  }
  if (fallbackId) {
    return db.prepare(`SELECT review_count AS n FROM products_jp WHERE id=?`).get(fallbackId)?.n || 0;
  }
  return 0;
}

// 일본에서 수요(리뷰)는 높은데 아직 매칭/소싱이 없는 상품 — 사람이 한국 소싱처를 찾아볼 후보
export function unmatchedHighDemandJp({ brand, minReviews = 50, minPrice = 0, limit = 10 } = {}) {
  let sql = `
    SELECT j.id, j.brand, j.name, j.price_jpy, j.review_count, j.url, j.product_code, j.image_url, j.source
    FROM products_jp j
    LEFT JOIN product_master m ON m.jp_product_id = j.id AND m.confidence != 'X'
    WHERE m.id IS NULL AND j.in_stock=1 AND j.review_count >= ? AND j.price_jpy >= ?
      AND j.source IN ('rakuten','yahoo')
      -- 같은 품번이 이미 매칭돼 있으면 소싱 후보가 아님 (시장가 보강용 중복 행)
      AND NOT (j.product_code IS NOT NULL AND EXISTS (
        SELECT 1 FROM product_master m2 JOIN products_jp j2 ON j2.id = m2.jp_product_id
        WHERE m2.confidence != 'X' AND j2.brand = j.brand AND j2.product_code = j.product_code
      ))`;
  const args = [minReviews, minPrice];
  if (brand) {
    sql += ` AND j.brand=?`;
    args.push(brand);
  }
  sql += ` ORDER BY j.review_count DESC LIMIT ?`;
  args.push(limit);
  return db.prepare(sql).all(...args);
}

// ---------- 가격 추세 (Phase 4) ----------
export function priceHistory(side, productId, days = 30) {
  return db
    .prepare(
      `SELECT price, fetched_date FROM price_history
       WHERE product_side=? AND product_id=? AND fetched_date >= date('now', ?)
       ORDER BY fetched_date ASC`
    )
    .all(side, productId, `-${days} days`);
}

// ---------- run_log ----------
export function logRun(runId, step, status, message, startedAt, finishedAt) {
  db.prepare(
    `INSERT INTO run_log (run_id, step, status, message, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(runId, step, status, message || null, startedAt, finishedAt);
}

// ---------- kv (LLM 일일 카운터 등) ----------
export function kvGet(key) {
  return db.prepare(`SELECT value FROM kv WHERE key=?`).get(key)?.value ?? null;
}
export function kvSet(key, value) {
  db.prepare(`INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)`).run(key, String(value));
}
export function kvIncr(key) {
  const n = parseInt(kvGet(key) || '0', 10) + 1;
  kvSet(key, n);
  return n;
}

// ---------- 화면용 조회 (카드·연결 현황·수집 상품) ----------
// 마진 스냅샷 전체(통과+미달)를 양쪽 이미지·URL과 함께
export function cardRows({ date } = {}) {
  const d = date || db.prepare(`SELECT MAX(date) AS d FROM margin_snapshots`).get()?.d;
  if (!d) return [];
  return db
    .prepare(
      `SELECT s.*, m.brand, m.confidence, m.note AS master_note, k.product_code AS code,
              k.name AS kr_name, k.color AS kr_color, k.url AS kr_url, k.image_url AS kr_image, k.source AS kr_source,
              j.name AS jp_name, j.url AS jp_url, j.image_url AS jp_image, j.source AS jp_source
       FROM margin_snapshots s
       JOIN product_master m ON m.id = s.master_id
       LEFT JOIN products_kr k ON k.id = m.kr_product_id
       LEFT JOIN products_jp j ON j.id = m.jp_product_id
       WHERE s.date=?`
    )
    .all(d);
}

// 브랜드·소스별 수집 건수와 마지막 수집 시각
export function coverage(brand) {
  const q = (table) =>
    db.prepare(`SELECT source, COUNT(*) AS n, MAX(fetched_at) AS last FROM ${table} WHERE brand=? GROUP BY source`).all(brand);
  return { kr: q('products_kr'), jp: q('products_jp') };
}

export function recentRuns(limit = 8) {
  return db.prepare(`SELECT run_id, step, status, message, started_at, finished_at FROM run_log ORDER BY id DESC LIMIT ?`).all(limit);
}

// 수집된 상품 둘러보기 (이미지 포함). 같은 이름·가격의 색상별 중복은 1건으로 묶고 variants로 개수 표시.
// 각 상품에는 quotes(반대편 시세·예상 마진)가 붙는다. sort: 'margin'(마진 높은 순) | 'recent'(최근 수집순)
// profit: 'plus'(마진 +만) | 'pass'(통과 기준 충족만) | 그 외 전체
export function listProducts({ side = 'kr', brand, source, q, minPrice = 0, sort = 'margin', profit = '', dir = 'kr2jp', limit = 60, offset = 0 } = {}) {
  const netCol = dir === 'jp2kr' ? 'q.rev_net' : 'q.margin_net';
  const passCol = dir === 'jp2kr' ? 'q.rev_passed' : 'q.passed';
  const table = side === 'jp' ? 'products_jp' : 'products_kr';
  const price = side === 'jp' ? 'price_jpy' : 'COALESCE(NULLIF(sale_price_krw,0), price_krw)';
  const extra = side === 'jp' ? ', MAX(review_count) AS review_count' : ', price_krw, sale_price_krw';
  let inner = `SELECT MIN(id) AS id, brand, source, product_code, name, ${price} AS price, url, image_url, in_stock,
                      MAX(fetched_at) AS fetched_at, COUNT(*) AS variants${extra}
               FROM ${table} WHERE 1=1`;
  const args = [];
  if (brand) { inner += ` AND brand=?`; args.push(brand); }
  if (source) { inner += ` AND source=?`; args.push(source); }
  if (q) { inner += ` AND name LIKE ?`; args.push(`%${q}%`); }
  if (minPrice) { inner += ` AND ${price} >= ?`; args.push(minPrice); }
  inner += ` GROUP BY brand, source, name, price`;

  let sql = `SELECT t.*, q.kind AS q_kind, q.best_name AS q_name, q.best_price AS q_price, q.best_url AS q_url, q.best_image AS q_image,
                    q.best_source AS q_source, q.margin_net AS q_net, q.margin_rate AS q_rate, q.passed AS q_passed,
                    q.rev_net AS q_rev_net, q.rev_rate AS q_rev_rate, q.rev_passed AS q_rev_passed,
                    q.verified AS q_verified, q.verified_reason AS q_reason, q.checked_at AS q_checked
             FROM (${inner}) t LEFT JOIN quotes q ON q.side='${side === 'jp' ? 'jp' : 'kr'}' AND q.product_id = t.id WHERE 1=1`;
  // AI가 '다른 상품'이라고 판정한 시세는 마진이 +여도 필터·상위 정렬에서 제외
  if (profit === 'plus') sql += ` AND ${netCol} > 0 AND COALESCE(q.verified,'') != 'different'`;
  if (profit === 'pass') sql += ` AND ${passCol} = 1 AND COALESCE(q.verified,'') != 'different'`;
  if (sort === 'margin') sql += ` ORDER BY (${netCol} IS NULL OR q.best_price IS NULL), COALESCE(q.verified = 'different', 0), ${netCol} DESC, t.fetched_at DESC`;
  else sql += side === 'jp' ? ` ORDER BY t.review_count DESC, t.fetched_at DESC` : ` ORDER BY t.fetched_at DESC, t.id DESC`;
  sql += ` LIMIT ? OFFSET ?`;
  args.push(Math.min(limit, 200), offset);
  return db.prepare(sql).all(...args);
}

// 시세 확인 대상: 같은 이름·가격의 색상 묶음당 1건(MIN id). 오늘 이미 확인한 것은 제외
export function quoteTargets(side, { brand, minPrice = 0, limit = 400, force = false } = {}) {
  const table = side === 'jp' ? 'products_jp' : 'products_kr';
  const price = side === 'jp' ? 'price_jpy' : 'COALESCE(NULLIF(sale_price_krw,0), price_krw)';
  let sql = `SELECT MIN(id) AS id, brand, source, name, ${price} AS price
             FROM ${table} WHERE in_stock=1 AND ${price} > 0`;
  const args = [];
  if (brand) { sql += ` AND brand=?`; args.push(brand); }
  if (minPrice) { sql += ` AND ${price} >= ?`; args.push(minPrice); }
  // 공식몰 상품을 먼저 (시장 수집분은 양이 많아 뒤로)
  sql += ` GROUP BY brand, source, name, price ORDER BY (source='brand_site') DESC, MAX(fetched_at) DESC`;
  const rows = db.prepare(sql).all(...args);
  if (force) return rows.slice(0, limit);
  const todayStr = new Date().toISOString().slice(0, 10);
  const done = new Set(
    db.prepare(`SELECT product_id FROM quotes WHERE side=? AND substr(checked_at,1,10)=? AND (rev_net IS NOT NULL OR best_price IS NULL) AND (alts IS NOT NULL OR best_price IS NULL OR kind='code')`).all(side, todayStr).map((r) => r.product_id)
  );
  return rows.filter((r) => !done.has(r.id)).slice(0, limit);
}

export function saveQuote(side, productId, q) {
  db.prepare(
    `INSERT INTO quotes (side, product_id, kind, best_name, best_price, best_url, best_image, best_source, margin_net, margin_rate, passed, rev_net, rev_rate, rev_passed, alts, checked_at)
     VALUES (@side, @product_id, @kind, @best_name, @best_price, @best_url, @best_image, @best_source, @margin_net, @margin_rate, @passed, @rev_net, @rev_rate, @rev_passed, @alts, @checked_at)
     ON CONFLICT(side, product_id) DO UPDATE SET
       kind=excluded.kind, best_name=excluded.best_name, best_price=excluded.best_price, best_url=excluded.best_url,
       best_image=excluded.best_image, best_source=excluded.best_source, margin_net=excluded.margin_net,
       margin_rate=excluded.margin_rate, passed=excluded.passed, rev_net=excluded.rev_net, rev_rate=excluded.rev_rate,
       rev_passed=excluded.rev_passed, alts=excluded.alts, checked_at=excluded.checked_at,
       verified = CASE WHEN quotes.best_url = excluded.best_url THEN quotes.verified ELSE NULL END,
       verified_reason = CASE WHEN quotes.best_url = excluded.best_url THEN quotes.verified_reason ELSE NULL END`
  ).run({
    side, product_id: productId, kind: q.kind || 'none', best_name: q.name ?? null, best_price: q.price ?? null,
    best_url: q.url ?? null, best_image: q.image ?? null, best_source: q.source ?? null, margin_net: q.net ?? null,
    margin_rate: q.rate ?? null, passed: q.passed ? 1 : 0,
    rev_net: q.rev?.net ?? null, rev_rate: q.rev?.rate ?? null, rev_passed: q.rev?.passed ? 1 : 0,
    alts: JSON.stringify(q.alts || []), checked_at: nowIso(),
  });
}

export function getQuote(side, productId) {
  return db.prepare(`SELECT * FROM quotes WHERE side=? AND product_id=?`).get(side, productId);
}

export function setQuoteVerdict(side, productId, verdict, reason) {
  db.prepare(`UPDATE quotes SET verified=?, verified_reason=? WHERE side=? AND product_id=?`).run(verdict, reason || null, side, productId);
}

// AI가 '다른 상품'이라 판정했을 때, 다음 후보로 대표 시세를 바꾼다 (이미 확인한 후보는 alts에서 뺌)
export function swapQuoteBest(side, productId, alt, rest, verdict, reason) {
  db.prepare(
    `UPDATE quotes SET best_name=?, best_price=?, best_url=?, best_image=?, best_source=?, margin_net=?, margin_rate=?, passed=?,
       rev_net=?, rev_rate=?, rev_passed=?, alts=?, verified=?, verified_reason=?, checked_at=? WHERE side=? AND product_id=?`
  ).run(
    alt.name, alt.price, alt.url, alt.image ?? null, alt.source ?? null, alt.net, alt.rate, alt.passed ? 1 : 0,
    alt.rev?.net ?? null, alt.rev?.rate ?? null, alt.rev?.passed ? 1 : 0, JSON.stringify(rest || []), verdict ?? null, reason ?? null, nowIso(), side, productId
  );
}

// AI 이미지 비교 대상: 이름 검색으로 찾은(품번 일치가 아닌) 결과 중 마진이 + 이고 아직 확인 안 한 것 (양방향 중 큰 이익 순)
export function quotesToVerify(limit = 30) {
  return db
    .prepare(`SELECT * FROM quotes WHERE (margin_net > 0 OR rev_net > 0) AND kind='search' AND verified IS NULL AND best_image IS NOT NULL
              ORDER BY MAX(COALESCE(margin_net, -1000000), COALESCE(rev_net, -1000000) / 9.0) DESC LIMIT ?`)
    .all(limit);
}

// 같은 품번의 반대편(또는 같은 편) 상품들 — 시세 찾기에서 DB에 이미 있는 가격을 함께 보여주기 위함
export function productsByCode(side, brand, code) {
  if (!code) return [];
  const table = side === 'jp' ? 'products_jp' : 'products_kr';
  return db.prepare(`SELECT * FROM ${table} WHERE brand=? AND product_code=? AND in_stock=1`).all(brand, code);
}

// 시세 비교 목록용: 시세가 확인된 모든 상품(한국·일본 양쪽)과 반대편 최저 시세
export function listPairRows() {
  const qcols = `q.kind AS q_kind, q.best_name, q.best_price, q.best_url, q.best_image, q.best_source,
                 q.margin_net, q.margin_rate, q.passed, q.rev_net, q.rev_rate, q.rev_passed,
                 q.verified, q.verified_reason, q.checked_at`;
  return db
    .prepare(
      `SELECT 'kr' AS side, k.id AS pid, k.brand, k.source AS psource, k.name AS pname, k.product_code AS pcode, k.url AS purl,
              k.image_url AS pimage, COALESCE(NULLIF(k.sale_price_krw,0), k.price_krw) AS pprice, 0 AS review_count, ${qcols}
       FROM quotes q JOIN products_kr k ON q.side='kr' AND k.id=q.product_id
       WHERE q.best_price IS NOT NULL
       UNION ALL
       SELECT 'jp', j.id, j.brand, j.source, j.name, j.product_code, j.url, j.image_url, j.price_jpy, j.review_count, ${qcols}
       FROM quotes q JOIN products_jp j ON q.side='jp' AND j.id=q.product_id
       WHERE q.best_price IS NOT NULL`
    )
    .all();
}

export default db;
