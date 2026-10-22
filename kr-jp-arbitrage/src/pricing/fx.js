// 환율 (KRW per 1 JPY) — 무료 exchangerate API, 6시간 캐시, 실패 시 마지막 값 사용
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, info, warn, nowIso } from '../util.js';

const CACHE_FILE = path.join(DATA_DIR, 'fx.json');
const TTL_MS = 6 * 60 * 60 * 1000; // 6시간

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// 반환: { rate: KRW/JPY, fetchedAt, stale }
export async function getFxKrwPerJpy() {
  const cached = readCache();
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < TTL_MS) {
    return { ...cached, stale: false };
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/JPY', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rate = data?.rates?.KRW;
    if (!rate || rate <= 0) throw new Error('KRW 환율 없음');
    const entry = { rate, fetchedAt: nowIso() };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(entry));
    info(`환율 갱신: 1 JPY = ${rate.toFixed(4)} KRW`);
    return { ...entry, stale: false };
  } catch (e) {
    if (cached) {
      warn(`환율 API 실패(${e.message}) → 마지막 값 사용 (${cached.fetchedAt})`);
      return { ...cached, stale: true };
    }
    throw new Error(`환율 조회 실패, 캐시도 없음: ${e.message}`);
  }
}

// 위안(CNY) → 엔(JPY): 1위안이 몇 엔인지. 중국 소싱 원가 환산용. 같은 방식으로 6시간 캐시
const CNY_CACHE = path.join(DATA_DIR, 'fx-cny.json');
export async function getFxJpyPerCny() {
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(CNY_CACHE, 'utf8')); } catch { /* 없음 */ }
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < TTL_MS) return { ...cached, stale: false };
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/CNY', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rate = (await res.json())?.rates?.JPY;
    if (!rate || rate <= 0) throw new Error('JPY 환율 없음');
    const entry = { rate, fetchedAt: nowIso() };
    fs.writeFileSync(CNY_CACHE, JSON.stringify(entry));
    info(`환율 갱신: 1 CNY = ${rate.toFixed(3)} JPY`);
    return { ...entry, stale: false };
  } catch (e) {
    if (cached) { warn(`위안 환율 API 실패(${e.message}) → 마지막 값 사용`); return { ...cached, stale: true }; }
    throw new Error(`위안 환율 조회 실패, 캐시도 없음: ${e.message}`);
  }
}

// 임의 통화(USD 등) 1단위가 몇 엔인지 — AliExpress처럼 달러로 가격이 나오는 소싱처 환산용 (6시간 캐시)
export async function getFxJpyPer(code) {
  if (code === 'JPY') return 1;
  if (code === 'CNY') return (await getFxJpyPerCny()).rate;
  const file = path.join(DATA_DIR, `fx-${code}.json`);
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 없음 */ }
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < TTL_MS) return cached.rate;
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${code}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rate = (await res.json())?.rates?.JPY;
    if (!rate || rate <= 0) throw new Error('JPY 환율 없음');
    fs.writeFileSync(file, JSON.stringify({ rate, fetchedAt: nowIso() }));
    return rate;
  } catch (e) {
    if (cached) return cached.rate;
    throw new Error(`${code} 환율 조회 실패: ${e.message}`);
  }
}
