// Telegram 일일 보고·실패 경고·명령(/run /top /pending)
import TelegramBot from 'node-telegram-bot-api';
import { features, info, warn, error } from '../util.js';

let bot = null;

function chatId() {
  return process.env.TELEGRAM_CHAT_ID;
}

export function getBot() {
  if (!features().telegram) return null;
  if (!bot) bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  return bot;
}

async function send(text) {
  const b = getBot();
  if (!b) {
    warn('[telegram] 비활성화 — 메시지 생략');
    return false;
  }
  try {
    await b.sendMessage(chatId(), text, { disable_web_page_preview: true });
    return true;
  } catch (e) {
    error(`[telegram] 전송 실패: ${e.message}`);
    return false;
  }
}

// 매일 보고: 통과 상품 상위 10개 요약 + 발굴·소싱 후보
export async function sendDailyReport({ date, rows, pendingCount, trendNotes = [], candidates = [], sourcing = [] }) {
  const lines = [];
  lines.push(`📊 KR→JP 아비트라지 일일 보고 (${date})`);
  lines.push('※ 리서치 도구 — 자동 구매·출품 없음. 메루카리Shops는 무재고 판매 금지 → 선매입 후보 선정용.');
  lines.push('');
  if (!rows.length) {
    lines.push('오늘 기준 통과 상품 없음.');
  } else {
    lines.push(`✅ 기준 통과 ${rows.length}건 — 상위 ${Math.min(rows.length, 10)}개:`);
    rows.slice(0, 10).forEach((r, i) => {
      lines.push(
        `${i + 1}. [${r.brand}/${r.confidence}] ${r.kr_name || r.jp_name}\n   순마진 ¥${r.net_margin_jpy.toLocaleString()} (${(r.margin_rate * 100).toFixed(1)}%)\n   ${r.jp_url || ''}`
      );
    });
  }
  if (rows.some((r) => r.brand === 'tnf')) {
    lines.push('');
    lines.push('⚠️ TNF: 병행수입 리스크 확인 필요 (한국 영원아웃도어 ↔ 일본 Goldwin 별도 라이선시)');
  }
  if (candidates.length) {
    lines.push('');
    lines.push('📈 발굴 후보 — 지금은 미달이지만 주시할 상품 (수요 높은 순):');
    candidates.slice(0, 5).forEach((c, i) => {
      lines.push(
        `${i + 1}. [${c.brand}] ${c.name}\n   현재 마진 ¥${c.netMarginJpy.toLocaleString()} · 리뷰 ${c.reviewCount}건\n   한국가 ₩${(c.krPriceKrw || 0).toLocaleString()} → ₩${c.targetKrPriceKrw.toLocaleString()} 이하로 떨어지면 통과`
      );
    });
  }
  if (sourcing.length) {
    lines.push('');
    lines.push('🔥 일본에서 잘 팔리는데 아직 한국 매칭 없는 상품 (소싱처 찾아볼 것):');
    sourcing.slice(0, 5).forEach((s, i) => {
      lines.push(`${i + 1}. [${s.brand}] ${s.name} — ¥${(s.price_jpy || 0).toLocaleString()} · 리뷰 ${s.review_count}건\n   ${s.url}`);
    });
  }
  if (trendNotes.length) {
    lines.push('');
    lines.push('📉 재고 처분 신호 후보 (한국가 2주 이상 하락):');
    for (const t of trendNotes.slice(0, 5)) lines.push(`- ${t}`);
  }
  if (pendingCount > 0) {
    lines.push('');
    lines.push(`🔍 검토 대기(C등급) ${pendingCount}건 → /review UI에서 승인/거부`);
  }
  return send(lines.join('\n'));
}

// 단계 실패 경고: 단계명 + 에러 1줄
export async function sendStepFailure(step, message) {
  return send(`🚨 kr-jp-arbitrage 단계 실패: ${step}\n${String(message).split('\n')[0].slice(0, 300)}`);
}

// 명령 수신 (polling) — index.js에서 핸들러 주입
export function startCommandBot({ onRun, onTop, onPending }) {
  if (!features().telegram) return null;
  const b = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  const allowed = String(chatId());
  const guard = (msg) => String(msg.chat.id) === allowed;

  b.onText(/^\/run\b/, async (msg) => {
    if (!guard(msg)) return;
    await b.sendMessage(msg.chat.id, '▶️ 파이프라인 즉시 실행 시작');
    try {
      await onRun();
    } catch (e) {
      await b.sendMessage(msg.chat.id, `실행 오류: ${e.message}`);
    }
  });
  b.onText(/^\/top\b/, async (msg) => {
    if (!guard(msg)) return;
    await b.sendMessage(msg.chat.id, await onTop(), { disable_web_page_preview: true });
  });
  b.onText(/^\/pending\b/, async (msg) => {
    if (!guard(msg)) return;
    await b.sendMessage(msg.chat.id, await onPending());
  });
  b.on('polling_error', (e) => warn(`[telegram] polling 오류: ${e.message}`));
  info('[telegram] 명령 봇 시작 (/run /top /pending)');
  return b;
}
