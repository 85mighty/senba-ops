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
export function unmatchedHighDemandJp({ brand, minReviews = 50, limit = 10 } = {}) {
  let sql = `
    SELECT j.id, j.brand, j.name, j.price_jpy, j.review_count, j.url, j.product_code
    FROM products_jp j
    LEFT JOIN product_master m ON m.jp_product_id = j.id AND m.confidence != 'X'
    WHERE m.id IS NULL AND j.in_stock=1 AND j.review_count >= ?
      AND j.source IN ('rakuten','yahoo')
      -- 같은 품번이 이미 매칭돼 있으면 소싱 후보가 아님 (시장가 보강용 중복 행)
      AND NOT (j.product_code IS NOT NULL AND EXISTS (
        SELECT 1 FROM product_master m2 JOIN products_jp j2 ON j2.id = m2.jp_product_id
        WHERE m2.confidence != 'X' AND j2.brand = j.brand AND j2.product_code = j.product_code
      ))`;
  const args = [minReviews];
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

export default db;
