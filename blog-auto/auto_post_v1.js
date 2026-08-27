// 센바 블로그 자동발행 v1 (2026-08-27)
// 시트 큐(senba_blog 탭) → Claude 본문 → 대표이미지(명화=Wikimedia 퍼블릭도메인 / 기타=Brave) → WP 발행 → 텔레그램
// 카테고리: meiga(名画解説) / osaka-odekake(大阪・心斎橋おでかけ) / news(体験レポ) / en(English)
// 도어웨이 방지 원칙: 제목 주제를 본문 70%에서 충실히 다루고, 말미 30%에서 센바 CTA로 자연 연결.
require('dns').setDefaultResultOrder('ipv4first');
require('dotenv').config({ path: '/opt/senba-blog-auto/.env', override: true });
const fs = require('fs');
const { google } = require('googleapis');
const E = process.env;
const DRY = process.argv.includes('--dry');
const log = (...a) => console.log(new Date().toISOString(), ...a);

const CAT_ID = { meiga: 2, 'osaka-odekake': 3, news: 4, en: 5 };
const WP_AUTH = 'Basic ' + Buffer.from(`${E.WP_USER}:${E.WP_APP_PASS}`).toString('base64');

async function tg(text) {
  try {
    await fetch(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: E.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch (e) { log('tg fail', e.message); }
}

// ── 시트 큐 ──
async function sheetsClient() {
  const auth = new google.auth.GoogleAuth({ keyFile: E.GOOGLE_KEYFILE, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}
async function nextKeyword(sheets, onlyCat) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: E.SHEET_ID, range: `'${E.SHEET_TAB}'!A2:F500` });
  const rows = r.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const [keyword, cat, status] = rows[i];
    if (!keyword || (status || '').trim()) continue;
    if (onlyCat && !onlyCat.includes(cat)) continue;
    return { row: i + 2, keyword: keyword.trim(), cat: (cat || '').trim(), artHint: (rows[i][5] || '').trim() };
  }
  return null;
}
async function markRow(sheets, row, status, url) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: E.SHEET_ID, range: `'${E.SHEET_TAB}'!C${row}:E${row}`, valueInputOption: 'RAW',
    requestBody: { values: [[status, url || '', new Date().toISOString().slice(0, 10)]] },
  });
}

// ── CTA (고정 HTML — 모델 생성 아님) ──
const CTA_JA = `
<div style="background:#f4faf5;border:2px solid #1a7f3c;border-radius:12px;padding:20px 22px;margin:32px 0;">
<p style="font-weight:bold;font-size:17px;margin:0 0 8px;color:#1a7f3c;">🎨 心斎橋で、自分の手で名画を描いてみませんか？</p>
<p style="margin:0 0 14px;">船場美術館は心斎橋・四ツ橋駅徒歩5分の完全個室アート体験カフェ。下絵をご用意しているので絵心ゼロでもOK、道具はすべて揃っていて手ぶらで楽しめます（1〜4名・1組貸切／飲み物持ち込み自由）。</p>
<p style="margin:0;"><a href="${E.BOOKING_URL}" style="display:inline-block;background:#1a7f3c;color:#fff;font-weight:bold;padding:12px 26px;border-radius:8px;text-decoration:none;">オンライン予約はこちら（事前決済でスムーズ）</a></p>
<p style="margin:10px 0 0;font-size:13px;"><a href="${E.SITE_URL}">→ 船場美術館の詳細を見る</a></p>
</div>`;
const CTA_EN = `
<div style="background:#f4faf5;border:2px solid #1a7f3c;border-radius:12px;padding:20px 22px;margin:32px 0;">
<p style="font-weight:bold;font-size:17px;margin:0 0 8px;color:#1a7f3c;">🎨 Paint your own masterpiece in Shinsaibashi</p>
<p style="margin:0 0 14px;">Senba Art Studio is a fully private art-experience café, 5 min from Yotsubashi Station. Sketches and all tools provided — no skill needed, come empty-handed. Private room for 1–4 guests, BYO drinks welcome. English-friendly online booking with prepayment.</p>
<p style="margin:0;"><a href="${E.BOOKING_URL}" style="display:inline-block;background:#1a7f3c;color:#fff;font-weight:bold;padding:12px 26px;border-radius:8px;text-decoration:none;">Book online (Apple Pay / cards)</a></p>
<p style="margin:10px 0 0;font-size:13px;"><a href="${E.SITE_URL}">→ About Senba Art Studio</a></p>
</div>`;

// ── Claude 본문 생성 ──
const PROMPTS = {
  meiga: k => `あなたは美術ブログ「船場美術館ブログ」のライターです。名画「${k}」について、初心者にも分かりやすい解説記事を日本語で書いてください。

要件:
- 文字数 1400〜1800字
- 構成: 導入 → ## 見出し3〜4個(作品の背景/見どころ/豆知識など) → まとめ
- 事実に自信がない細部(正確な年号・所蔵先など)は断定を避ける
- 最後のまとめは「実際に自分で描いてみると新しい発見がある」という流れで自然に締める(宣伝文はこちらで別途挿入するので書かない)
- 出力はJSONのみ: {"title":"SEOタイトル(32字以内)","meta":"メタディスクリプション(110字以内)","slug":"english-url-slug-3-5-words","body":"本文(Markdown、##見出し)"}`,
  'osaka-odekake': k => `あなたは大阪ローカルのおでかけブログライターです。検索キーワード「${k}」で調べる人に役立つ記事を日本語で書いてください。

要件:
- 文字数 1400〜1800字
- 検索意図に本気で応える(具体的な過ごし方・エリアの雰囲気・予算感・回り方のコツ)
- 実在が不確かな個別店舗名の断定は避け、エリア・ジャンルで案内する
- 候補のひとつとして「心斎橋の完全個室アート体験(船場美術館)」を本文中に1回だけ自然に含める(雨でもOK・手ぶら・1組貸切という文脈で)。過剰な宣伝はしない
- 出力はJSONのみ: {"title":"SEOタイトル(32字以内)","meta":"メタディスクリプション(110字以内)","slug":"english-url-slug-3-5-words","body":"本文(Markdown、##見出し)"}`,
  en: k => `You are a travel writer for an Osaka local blog. Write a helpful English article for people searching "${k}".

Requirements:
- 900-1300 words, genuinely useful for tourists (practical tips, areas, budget, how to get around)
- Avoid asserting specific shop names you are not sure exist; guide by area and genre
- Naturally mention once: a fully-private paint-and-relax experience at Senba Art Studio in Shinsaibashi (rain-proof, no gear needed, private room) — as one option, not an ad
- Output JSON only: {"title":"SEO title (60 chars max)","meta":"meta description (150 chars max)","slug":"url-slug-3-5-words","body":"article body in Markdown with ## headings"}`,
};
async function generate(cat, keyword) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: E.CONTENT_MODEL, max_tokens: 4000, thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: PROMPTS[cat === 'news' ? 'osaka-odekake' : cat](keyword) }],
    }),
  });
  const j = await r.json();
  if (j.error) throw new Error('Claude: ' + JSON.stringify(j.error).slice(0, 200));
  const txt = j.content.map(c => c.text || '').join('');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('JSON 없음: ' + txt.slice(0, 120));
  const out = JSON.parse(m[0]);
  if (!out.title || !out.body) throw new Error('title/body 누락');
  return out;
}

// ── 이미지 ──
async function wikimediaImage(query) {
  const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1000&format=json`;
  const j = await (await fetch(u, { headers: { 'User-Agent': 'senba-blog/1.0' } })).json();
  const pages = Object.values(j.query?.pages || {});
  const pick = pages.find(p => /\.(jpe?g|png)$/i.test(p.title || ''));
  if (!pick) return null;
  const info = pick.imageinfo[0];
  return { url: info.thumburl || info.url, credit: 'Wikimedia Commons (Public Domain)' };
}
async function braveImage(query) {
  const j = await (await fetch(`https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=5&safesearch=strict`, {
    headers: { 'X-Subscription-Token': E.BRAVE_API_KEY } })).json();
  const hit = (j.results || []).find(r => /\.(jpe?g|png|webp)/i.test(r.properties?.url || ''));
  return hit ? { url: hit.properties.url, credit: hit.source || '' } : null;
}
async function uploadFeatured(img, slugBase) {
  const res = await fetch(img.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('이미지 다운로드 ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) throw new Error('이미지 너무 작음');
  const ext = /png/i.test(img.url) ? 'png' : 'jpg';
  const up = await fetch(`${E.WP_BASE}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: { Authorization: WP_AUTH, 'Content-Type': ext === 'png' ? 'image/png' : 'image/jpeg', 'Content-Disposition': `attachment; filename="${slugBase}-${Date.now()}.${ext}"` },
    body: buf,
  });
  const j = await up.json();
  if (!j.id) throw new Error('WP 미디어 업로드 실패: ' + JSON.stringify(j).slice(0, 120));
  return j.id;
}

// ── Markdown → HTML (간이) ──
function mdToHtml(md) {
  return String(md).split(/\n{2,}/).map(block => {
    const b = block.trim();
    if (!b) return '';
    if (b.startsWith('## ')) return `<h2>${b.slice(3).trim()}</h2>`;
    if (b.startsWith('### ')) return `<h3>${b.slice(4).trim()}</h3>`;
    if (/^[-*] /m.test(b)) return '<ul>' + b.split('\n').filter(l => /^[-*] /.test(l.trim())).map(l => `<li>${l.trim().slice(2)}</li>`).join('') + '</ul>';
    return `<p>${b.replace(/\n/g, '<br>')}</p>`;
  }).join('\n').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

(async () => {
  const onlyCat = process.argv.includes('--en') ? ['en'] : ['meiga', 'osaka-odekake', 'news'];
  const sheets = await sheetsClient();
  const t = await nextKeyword(sheets, onlyCat);
  if (!t) { log('큐 소진'); await tg('⚠️ <b>센바 블로그</b> 키워드 큐 소진 (' + onlyCat.join('/') + ')'); return; }
  log(`대상: [${t.cat}] ${t.keyword} (행 ${t.row})`);
  if (DRY) { log('--dry 종료'); return; }

  try {
    const gen = await generate(t.cat, t.keyword);
    let featuredId = null, creditLine = '';
    try {
      const img = t.cat === 'meiga'
        ? await wikimediaImage(t.artHint || t.keyword)
        : await braveImage(t.cat === 'en' ? t.keyword + ' osaka japan' : t.keyword);
      if (img) {
        featuredId = await uploadFeatured(img, t.cat);
        if (t.cat === 'meiga') creditLine = `<p style="font-size:12px;color:#888;">画像出典: ${img.credit}</p>`;
      }
    } catch (e) { log('이미지 스킵:', e.message); }

    const cta = t.cat === 'en' ? CTA_EN : CTA_JA;
    const html = mdToHtml(gen.body) + creditLine + cta;
    const post = await (await fetch(`${E.WP_BASE}/wp-json/wp/v2/posts`, {
      method: 'POST', headers: { Authorization: WP_AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: gen.title, content: html, status: 'publish',
        slug: gen.slug || undefined,
        categories: [CAT_ID[t.cat] || CAT_ID['osaka-odekake']],
        excerpt: gen.meta || '', featured_media: featuredId || undefined,
      }),
    })).json();
    if (!post.id) throw new Error('WP 발행 실패: ' + JSON.stringify(post).slice(0, 150));
    await markRow(sheets, t.row, 'done', post.link);
    log('발행 완료:', post.link);
    await tg(`📝 <b>센바 블로그 발행</b>\n[${t.cat}] ${gen.title}\n${post.link}`);
  } catch (e) {
    log('실패:', e.message);
    await markRow(sheets, t.row, 'error: ' + e.message.slice(0, 80), '');
    await tg(`❌ <b>센바 블로그 실패</b>\n[${t.cat}] ${t.keyword}\n${e.message.slice(0, 150)}`);
  }
})();
