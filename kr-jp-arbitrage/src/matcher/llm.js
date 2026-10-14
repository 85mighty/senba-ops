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
