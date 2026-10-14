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

// ---------- 경량 로마자화: 한글(국어의 로마자 표기법 근사) + 가타카나(헵번 근사) ----------
// 한·일 상품명이 같은 발음의 다른 문자(플라워마르디 ↔ フラワーマルディ)인 경우를 잡기 위함
const CHO = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const JUNG = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const JONG = ['','g','kk','gs','n','nj','nh','d','l','lg','lm','lb','ls','lt','lp','lh','m','b','bs','s','ss','ng','j','ch','k','t','p','h'];
const KATA = {
  'キャ':'kya','キュ':'kyu','キョ':'kyo','シャ':'sha','シュ':'shu','ショ':'sho','チャ':'cha','チュ':'chu','チョ':'cho',
  'ニャ':'nya','ニュ':'nyu','ニョ':'nyo','ヒャ':'hya','ヒュ':'hyu','ヒョ':'hyo','ミャ':'mya','ミュ':'myu','ミョ':'myo',
  'リャ':'rya','リュ':'ryu','リョ':'ryo','ギャ':'gya','ギュ':'gyu','ギョ':'gyo','ジャ':'ja','ジュ':'ju','ジョ':'jo',
  'ビャ':'bya','ビュ':'byu','ビョ':'byo','ピャ':'pya','ピュ':'pyu','ピョ':'pyo','ウィ':'wi','ウェ':'we','ウォ':'wo',
  'ファ':'fa','フィ':'fi','フェ':'fe','フォ':'fo','ティ':'ti','ディ':'di','デュ':'dyu','トゥ':'tu','ドゥ':'du','シェ':'she','ジェ':'je','チェ':'che','ツァ':'tsa','ツェ':'tse','ツォ':'tso','ヴァ':'va','ヴィ':'vi','ヴェ':'ve','ヴォ':'vo',
  'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o','カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko',
  'サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so','タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to',
  'ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no','ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho',
  'マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo','ヤ':'ya','ユ':'yu','ヨ':'yo',
  'ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro','ワ':'wa','ヲ':'o','ン':'n','ヴ':'vu',
  'ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go','ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo',
  'ダ':'da','ヂ':'ji','ヅ':'zu','デ':'de','ド':'do','バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo',
  'パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po','ッ':'','ー':'','・':' ','ァ':'a','ィ':'i','ゥ':'u','ェ':'e','ォ':'o','ャ':'ya','ュ':'yu','ョ':'yo',
};

export function romanize(s) {
  // 히라가나 → 가타카나 통일 후 한 번에 처리
  const t = s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const code = t.charCodeAt(i);
    if (code >= 0xac00 && code <= 0xd7a3) {
      // 한글 음절 분해 → 초성·중성·종성 로마자
      const idx = code - 0xac00;
      out += CHO[Math.floor(idx / 588)] + JUNG[Math.floor((idx % 588) / 28)] + JONG[idx % 28];
    } else if (code >= 0x30a0 && code <= 0x30ff) {
      const two = t.slice(i, i + 2);
      if (two.length === 2 && KATA[two] !== undefined) { out += KATA[two]; i++; }
      else out += KATA[t[i]] ?? t[i];
    } else {
      out += t[i];
    }
  }
  return out;
}

// 로마자 음운 폴딩 — 한국어 RR(ㅡ 삽입모음, l/p)과 일본어 헵번(촉음, f/r)의 체계 차이를 접는다
export function phoneticFold(s) {
  return s
    .replace(/eu/g, '')      // 한국어 ㅡ 삽입모음 제거 (peulrawo→plrawo)
    .replace(/sh/g, 's').replace(/ch/g, 'c').replace(/ts/g, 's')
    .replace(/l/g, 'r').replace(/f/g, 'p').replace(/v/g, 'b').replace(/z/g, 'j')
    .replace(/(.)\1+/g, '$1'); // 겹자음·장음 축약 (burakku→buraku)
}

// 문자 bigram Dice 계수. 직접·로마자화·음운폴딩 비교 중 가장 높은 점수 —
// 같은 발음의 한·일 표기(플라워마르디 ↔ フラワーマルディ)도 잡는다.
export function nameSimilarity(a, b) {
  const ra = romanize(a);
  const rb = romanize(b);
  return Math.max(bigramDice(a, b), bigramDice(ra, rb), bigramDice(phoneticFold(ra), phoneticFold(rb)));
}

function bigramDice(a, b) {
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
  const thB = globalCfg.match_thresholds?.b ?? 0.85;
  const thC = globalCfg.match_thresholds?.c ?? 0.6;

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
    if (!best || bestScore < thC) continue;
    const grade = bestScore >= thB ? 'B' : 'C';
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
