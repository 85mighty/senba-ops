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
