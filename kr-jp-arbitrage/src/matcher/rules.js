// 규칙 기반 매칭 — 품번 > 정규화 상품명 + 색상
// A 확정: 동일 품번 / B 유력: 점수 ≥ 0.85 / C 후보: 0.6~0.85
import { upsertMaster, updateProductCode } from '../db.js';
import { info } from '../util.js';

// 전각→반각 포함 정규화 (NFKC), 소문자, 브랜드어 제거, 기호 제거, 공백 정리
export function normalizeName(name, brandWords = []) {
  let s = (name || '').normalize('NFKC').toLowerCase();
  for (const w of brandWords) s = s.replaceAll(w.toLowerCase(), ' ');
  s = s.replace(/[\[\](){}<>|/\\,.·･‥…~〜\-_+*&!?@#%^'"“”‘’:;]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// color_map(정식색 → 이표기 목록)에서 역인덱스 생성
export function buildColorIndex(colorMap) {
  const idx = [];
  for (const [canon, words] of Object.entries(colorMap || {})) {
    for (const w of words) idx.push([w.normalize('NFKC').toLowerCase(), canon]);
  }
  // 긴 단어 먼저 매칭 (예: '스카이' 전에 '스카이블루' 같은 충돌 방지)
  idx.sort((a, b) => b[0].length - a[0].length);
  return idx;
}

export function extractColor(name, colorIndex) {
  const n = (name || '').normalize('NFKC').toLowerCase();
  for (const [word, canon] of colorIndex) {
    if (n.includes(word)) return canon;
  }
  return null;
}

export function extractCode(text, regexStr) {
  if (!regexStr || !text) return null;
  const m = String(text).normalize('NFKC').toUpperCase().match(new RegExp(regexStr, 'i'));
  return m ? m[0].toUpperCase() : null;
}

// 문자 bigram Dice 계수 — 한글·가나·영문 혼합 상품명에 무난
export function nameSimilarity(a, b) {
  const grams = (s) => {
    const t = s.replace(/\s+/g, '');
    const set = new Map();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      set.set(g, (set.get(g) || 0) + 1);
    }
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let overlap = 0;
  let total = 0;
  for (const [, c] of ga) total += c;
  for (const [, c] of gb) total += c;
  for (const [g, c] of ga) {
    if (gb.has(g)) overlap += Math.min(c, gb.get(g));
  }
  return (2 * overlap) / total;
}

// 한 쌍의 점수: 이름 0.8 + 색상 0.2 (색상 불명이면 이름만으로 평가하되 0.1 감점)
export function scorePair(kr, jp, brandWords) {
  const nameScore = nameSimilarity(normalizeName(kr.name, brandWords), normalizeName(jp.name, brandWords));
  let colorScore;
  if (kr._color && jp._color) colorScore = kr._color === jp._color ? 1 : 0;
  else colorScore = 0.5; // 한쪽이라도 색상 불명 → 중립
  return nameScore * 0.8 + colorScore * 0.2;
}

/**
 * 브랜드 단위 매칭 실행: products_kr × products_jp → product_master upsert
 * @returns {object} {a, b, c} 등급별 신규/갱신 건수, cPairs: LLM/사람 검토 후보 [{masterId, kr, jp, score}]
 */
export function matchBrand(brandKey, brandCfg, globalCfg, krItems, jpItems) {
  const brandWords = brandCfg.brand_words || [];
  const colorIndex = buildColorIndex(globalCfg.color_map);
  const codeRegex = brandCfg.product_code_regex;

  for (const it of krItems) {
    it._code = it.product_code || extractCode(`${it.name} ${it.url}`, codeRegex);
    it._color = it.color || extractColor(it.name, colorIndex);
    if (it._code && !it.product_code && it.id) updateProductCode('kr', it.id, it._code);
  }
  for (const it of jpItems) {
    it._code = it.product_code || extractCode(`${it.name} ${it.url}`, codeRegex);
    it._color = it.color || extractColor(it.name, colorIndex);
    if (it._code && !it.product_code && it.id) updateProductCode('jp', it.id, it._code);
  }

  const counts = { a: 0, b: 0, c: 0 };
  const cPairs = [];
  const usedJp = new Set();

  // 1) 품번 완전 일치 → A (색상까지 같으면 우선, 다르면 색상 무관 품번 일치도 A)
  const jpByCode = new Map();
  for (const jp of jpItems) {
    if (!jp._code) continue;
    if (!jpByCode.has(jp._code)) jpByCode.set(jp._code, []);
    jpByCode.get(jp._code).push(jp);
  }
  for (const kr of krItems) {
    if (!kr._code || !jpByCode.has(kr._code)) continue;
    const candidates = jpByCode.get(kr._code);
    const jp = candidates.find((j) => kr._color && j._color === kr._color) || candidates[0];
    upsertMaster({
      brand: brandKey,
      krId: kr.id,
      krUrl: kr.url,
      jpId: jp.id,
      jpUrl: jp.url,
      confidence: 'A',
      note: `품번 일치: ${kr._code}`,
    });
    usedJp.add(jp.id);
    kr._matched = true;
    counts.a++;
  }

  // 2) 이름+색상 점수 매칭 → B(≥0.85) / C(0.6~0.85)
  for (const kr of krItems) {
    if (kr._matched) continue;
    let best = null;
    let bestScore = 0;
    for (const jp of jpItems) {
      if (usedJp.has(jp.id)) continue;
      const s = scorePair(kr, jp, brandWords);
      if (s > bestScore) {
        bestScore = s;
        best = jp;
      }
    }
    if (!best || bestScore < 0.6) continue;
    const grade = bestScore >= 0.85 ? 'B' : 'C';
    const masterId = upsertMaster({
      brand: brandKey,
      krId: kr.id,
      krUrl: kr.url,
      jpId: best.id,
      jpUrl: best.url,
      confidence: grade,
      note: `규칙 점수 ${bestScore.toFixed(3)}`,
    });
    if (grade === 'B') {
      usedJp.add(best.id);
      counts.b++;
    } else {
      counts.c++;
      cPairs.push({ masterId, kr, jp: best, score: bestScore });
    }
  }

  info(`[match] ${brandKey}: A=${counts.a} B=${counts.b} C=${counts.c} (kr=${krItems.length}, jp=${jpItems.length})`);
  return { ...counts, cPairs };
}
