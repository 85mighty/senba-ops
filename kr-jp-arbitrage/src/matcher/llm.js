// LLM 보조 매칭 판정 — ANTHROPIC_API_KEY 있을 때만. C등급 후보를 판정해 B로 승격하거나 사람 검토로 남긴다.
// 하루 호출 상한 LLM_DAILY_LIMIT(기본 200건). 출력: {same: bool, confidence: 0~1, reason}
import { kvGet, kvIncr, updateMasterLlm, getMaster } from '../db.js';
import { info, warn, today } from '../util.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

function dailyKey() {
  return `llm:${today()}`;
}

async function judgePair(kr, jp) {
  const body = {
    model: process.env.LLM_MODEL || 'claude-haiku-5-5',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `한국과 일본 쇼핑몰의 두 상품이 동일 상품(색상까지 동일)인지 판정해줘.

[한국 상품]
이름: ${kr.name}
색상: ${kr._color || kr.color || '불명'}
품번: ${kr._code || kr.product_code || '불명'}
이미지: ${kr.image_url || '없음'}

[일본 상품]
이름: ${jp.name}
색상: ${jp._color || jp.color || '불명'}
품번: ${jp._code || jp.product_code || '불명'}
이미지: ${jp.image_url || '없음'}

JSON만 출력: {"same": true|false, "confidence": 0~1, "reason": "근거 1문장"}`,
      },
    ],
  };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Anthropic API HTTP ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM 응답에 JSON 없음');
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    same: !!parsed.same,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    reason: String(parsed.reason || '').slice(0, 200),
  };
}

/**
 * C등급 후보들(matchBrand의 cPairs)을 판정. same && confidence ≥ 0.8 → B 승격, 아니면 C 유지(사람 검토).
 * @returns 판정한 건수
 */
export async function judgeCandidates(cPairs) {
  const limit = parseInt(process.env.LLM_DAILY_LIMIT || '200', 10);
  let judged = 0;
  for (const { masterId, kr, jp, score } of cPairs) {
    // 이미 사람이 처리한 행은 건너뜀
    const m = getMaster(masterId);
    if (!m || m.approved_by_user || m.confidence !== 'C') continue;

    const used = parseInt(kvGet(dailyKey()) || '0', 10);
    if (used >= limit) {
      warn(`[llm] 일일 호출 상한(${limit}건) 도달 — 나머지는 사람 검토 대기`);
      break;
    }
    try {
      kvIncr(dailyKey());
      const r = await judgePair(kr, jp);
      judged++;
      if (r.same && r.confidence >= 0.8) {
        updateMasterLlm(masterId, {
          confidence: 'B',
          note: `규칙 ${score.toFixed(2)} + LLM 동일(${r.confidence.toFixed(2)}): ${r.reason}`,
        });
      } else {
        updateMasterLlm(masterId, {
          confidence: 'C',
          note: `규칙 ${score.toFixed(2)} / LLM ${r.same ? '동일' : '다름'}(${r.confidence.toFixed(2)}): ${r.reason}`,
        });
      }
    } catch (e) {
      warn(`[llm] 판정 실패 master#${masterId}: ${e.message}`);
    }
  }
  if (judged) info(`[llm] ${judged}건 판정 완료`);
  return judged;
}

// ---------- 이미지·상품명 비교 (같은 상품인지 AI가 판단) ----------
// 서버가 이미지를 직접 내려받아 base64로 보낸다(사이트가 외부 접근을 막아도 동작).
// 모델: LLM_VISION_MODEL (기본 claude-sonnet-5-5). 하루 호출 상한은 judgeCandidates와 같은 LLM_DAILY_LIMIT을 공유한다.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const MEDIA = { 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/png': 'image/png', 'image/gif': 'image/gif', 'image/webp': 'image/webp' };

async function imageBlock(url) {
  if (!url) return null;
  try {
    if (url.startsWith('data:')) {
      const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(url);
      return m && MEDIA[m[1].toLowerCase()] ? { type: 'image', source: { type: 'base64', media_type: MEDIA[m[1].toLowerCase()], data: m[2] } } : null;
    }
    const abs = url.startsWith('//') ? `https:${url}` : url;
    const res = await fetch(abs, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const type = MEDIA[(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()];
    const buf = Buffer.from(await res.arrayBuffer());
    if (!type || buf.length > 4_500_000) return null;
    return { type: 'image', source: { type: 'base64', media_type: type, data: buf.toString('base64') } };
  } catch {
    return null;
  }
}

/**
 * @param {{name, image}} a 기준 상품   @param {{name, image}} b 비교할 상품
 * @returns {{verdict: 'same'|'different'|'unsure', reason: string}}
 */
export async function compareProducts(a, b) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY가 없어 AI 비교를 쓸 수 없습니다');
    e.status = 503;
    throw e;
  }
  const limit = parseInt(process.env.LLM_DAILY_LIMIT || '200', 10);
  if (parseInt(kvGet(dailyKey()) || '0', 10) >= limit) {
    const e = new Error(`AI 호출 하루 상한(${limit}건)에 도달했습니다`);
    e.status = 429;
    throw e;
  }
  const [imgA, imgB] = await Promise.all([imageBlock(a.image), imageBlock(b.image)]);
  const content = [{ type: 'text', text: `두 쇼핑몰 상품이 같은 상품인지 판단해줘. 같은 모델이라도 색상·디자인·구성(세트 여부)이 다르면 different로 한다. 이미지로 판단이 어려우면 unsure.\n\n[상품 A] ${a.name}` }];
  if (imgA) content.push(imgA);
  content.push({ type: 'text', text: `[상품 B] ${b.name}` });
  if (imgB) content.push(imgB);
  content.push({ type: 'text', text: 'JSON만 출력: {"verdict":"same|different|unsure","reason":"근거 1문장(한국어)"}' });
  if (!imgA && !imgB) content.push({ type: 'text', text: '(이미지를 가져오지 못해 상품명만으로 판단. 확실하지 않으면 unsure)' });

  kvIncr(dailyKey());
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.LLM_VISION_MODEL || 'claude-sonnet-5-5', max_tokens: 500, messages: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Anthropic API HTTP ${res.status}`);
  const data = await res.json();
  const text = data.content?.find((c) => c.type === 'text')?.text || '';
  // JSON을 못 읽는 응답(거절·잡담·잘림)은 오류로 중단하지 않고 '불확실'로 처리 — 나머지 비교가 계속되게
  const m = text.match(/\{[\s\S]*\}/);
  let parsed = null;
  try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  if (!parsed) return { verdict: 'unsure', reason: `AI 응답을 해석하지 못함${data.stop_reason ? ' (' + data.stop_reason + ')' : ''}`, usedImages: !!(imgA && imgB) };
  const verdict = ['same', 'different', 'unsure'].includes(parsed.verdict) ? parsed.verdict : 'unsure';
  return { verdict, reason: String(parsed.reason || '').slice(0, 200), usedImages: !!(imgA && imgB) };
}
