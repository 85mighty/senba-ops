// 센바 블로그 자동발행 v2 (2026-08-27)
// v1 대비: ① CTA·센바 소개 전면 제거(애드센스 심사 대비 클린 콘텐츠 — 승인+Square 공개 후 재삽입 예정)
//          ② shimaferry.com 장문 구조 채택: 도입 3문단 → H2 5개(각 4~5문단+형광펜 강조 1개)
//             → 총정리 H2 → FAQ(schema.org FAQPage) → 마무리 3문단, 일문 4,500~6,000자
//          ③ 출력 포맷 TITLE/META/SLUG + '---' + 본문HTML (긴 본문의 JSON 이스케이프 리스크 회피)
require('dns').setDefaultResultOrder('ipv4first');
require('dotenv').config({ path: '/opt/senba-blog-auto/.env', override: true });
const { google } = require('googleapis');
const E = process.env;
const DRY = process.argv.includes('--dry');
const log = (...a) => console.log(new Date().toISOString(), ...a);
const CAT_ID = { meiga: 2, 'osaka-odekake': 3, news: 4, en: 5 };
const WP_AUTH = 'Basic ' + Buffer.from(`${E.WP_USER}:${E.WP_APP_PASS}`).toString('base64');

async function tg(text) {
  try { await fetch(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: E.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }) }); } catch (e) { log('tg fail', e.message); }
}
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
  await sheets.spreadsheets.values.update({ spreadsheetId: E.SHEET_ID, range: `'${E.SHEET_TAB}'!C${row}:E${row}`, valueInputOption: 'RAW', requestBody: { values: [[status, url || '', new Date().toISOString().slice(0, 10)]] } });
}

const FAQ_TEMPLATE = `<div itemscope="" itemtype="https://schema.org/FAQPage">
<blockquote>
  <div itemscope="" itemprop="mainEntity" itemtype="https://schema.org/Question">
      <h4 itemprop="name">질문1</h4>
      <div itemscope="" itemprop="acceptedAnswer" itemtype="https://schema.org/Answer"><span itemprop="text"><p>답변1</p></span></div>
  </div>
  ...(질문4개)
</blockquote>
</div>`;

const COMMON_RULES_JA = `
執筆ルール(厳守):
- 総文字数 4,500〜6,000字の長文。です・ます調。一人称「私」の視点や感想を自然に交える
- 出力は本文HTMLのみ使用可能タグ: <p> <h2> <h4> <span> <div> <blockquote>。<p>&nbsp;</p> を段落間に挟む
- 構成:
  ① 導入 <p> 3段落(最初の段落は記事キーワードで書き始め、この記事で何が分かるかを示す)
  ② <h2> 見出しを5つ(見出しに関連キーワードを含める)。各セクションは<p>4〜5段落(各180〜280字)。
     各セクションに1文だけ <span style="background-color: #f6e199;">重要文</span> で強調
  ③ <h2>「(キーワード)総まとめ」セクション: <p>3〜4段落
  ④ <h2>質問 QnA + 以下の形式のFAQ(schema.org FAQPageマークアップ、質問4つ):
${FAQ_TEMPLATE}
  ⑤ 締めの<p>3段落
- 事実に自信のない正確な年号・数値・所蔵先・店名は断定しない
- 宣伝・特定店舗への誘導は書かない`;

const PROMPTS = {
  meiga: k => `あなたは美術専門ブログのベテランライターです。名画「${k}」について、初心者が最後まで読める長文解説記事を書いてください。
見出しテーマの例: 作品の基本と背景 / 画家の人生と時代 / 絵の見どころと技法 / 意外なエピソード・豆知識 / 現代での楽しみ方(実際に見る・模写するなど)。作品に合わせて自然な見出しにしてください。
${COMMON_RULES_JA}

出力形式(この順序で):
TITLE: SEOタイトル(32字以内)
META: メタディスクリプション(110字以内)
SLUG: english-url-slug
---
(本文HTML)`,
  'osaka-odekake': k => `あなたは大阪ローカル情報ブログのベテランライターです。検索キーワード「${k}」で調べる人の疑問に本気で応える長文記事を書いてください。エリアの雰囲気・予算感・回り方・時間帯のコツなど実用情報を中心に。実在が不確かな個別店舗名は断定せずエリアとジャンルで案内します。
${COMMON_RULES_JA}

出力形式(この順序で):
TITLE: SEOタイトル(32字以内)
META: メタディスクリプション(110字以内)
SLUG: english-url-slug
---
(本文HTML)`,
  en: k => `You are a veteran writer for an art & Japan travel blog. Write a long-form English article for people searching "${k}".

Rules (strict):
- 1,500-2,000 words, first-person touches, genuinely useful
- HTML only: <p> <h2> <h4> <span> <div> <blockquote>, with <p>&nbsp;</p> between paragraphs
- Structure: intro 3 paragraphs (start with the keyword) → five <h2> sections (4-5 paragraphs each, one highlighted sentence per section using <span style="background-color: #f6e199;">...</span>) → an <h2> summary section → <h2>FAQ with schema.org FAQPage markup (4 questions, format below) → 3 closing paragraphs
${FAQ_TEMPLATE}
- Do not assert specific shop names or exact prices you are unsure of; no promotion of any specific business

Output format (in this order):
TITLE: SEO title (60 chars max)
META: meta description (150 chars max)
SLUG: url-slug
---
(article HTML)`,
};

async function generate(cat, keyword) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: E.CONTENT_MODEL, max_tokens: 16000, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: PROMPTS[cat === 'news' ? 'osaka-odekake' : cat](keyword) }] }),
  });
  const j = await r.json();
  if (j.error) throw new Error('Claude: ' + JSON.stringify(j.error).slice(0, 200));
  const txt = j.content.map(c => c.text || '').join('');
  const [head, ...bodyParts] = txt.split(/\n---\n/);
  const body = bodyParts.join('\n---\n').trim();
  const pick = re => (head.match(re) || [])[1]?.trim();
  const title = pick(/TITLE:\s*(.+)/), meta = pick(/META:\s*(.+)/), slug = pick(/SLUG:\s*([a-z0-9-]+)/i);
  if (!title || !body || body.length < 1500) throw new Error(`파싱 실패 (title:${!!title} body:${body.length}자)`);
  return { title, meta: meta || '', slug: slug || '', body };
}

async function wikimediaImage(query) {
  const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url&iiurlwidth=1000&format=json`;
  const j = await (await fetch(u, { headers: { 'User-Agent': 'senba-blog/1.0' } })).json();
  const pick = Object.values(j.query?.pages || {}).find(p => /\.(jpe?g|png)$/i.test(p.title || ''));
  return pick ? { url: pick.imageinfo[0].thumburl || pick.imageinfo[0].url, credit: 'Wikimedia Commons (Public Domain)' } : null;
}
async function braveImage(query) {
  const j = await (await fetch(`https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=5&safesearch=strict`, { headers: { 'X-Subscription-Token': E.BRAVE_API_KEY } })).json();
  const hit = (j.results || []).find(r => /\.(jpe?g|png|webp)/i.test(r.properties?.url || ''));
  return hit ? { url: hit.properties.url, credit: hit.source || '' } : null;
}
async function uploadFeatured(img, slugBase) {
  const res = await fetch(img.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('이미지 다운로드 ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) throw new Error('이미지 너무 작음');
  const ext = /png/i.test(img.url) ? 'png' : 'jpg';
  const up = await fetch(`${E.WP_BASE}/wp-json/wp/v2/media`, { method: 'POST', headers: { Authorization: WP_AUTH, 'Content-Type': ext === 'png' ? 'image/png' : 'image/jpeg', 'Content-Disposition': `attachment; filename="${slugBase}-${Date.now()}.${ext}"` }, body: buf });
  const j = await up.json();
  if (!j.id) throw new Error('WP 미디어 업로드 실패: ' + JSON.stringify(j).slice(0, 120));
  return j.id;
}

(async () => {
  const onlyCat = process.argv.includes('--en') ? ['en'] : ['meiga', 'osaka-odekake', 'news'];
  const sheets = await sheetsClient();
  const t = await nextKeyword(sheets, onlyCat);
  if (!t) { log('큐 소진'); await tg('⚠️ <b>센바 블로그</b> 키워드 큐 소진 (' + onlyCat.join('/') + ')'); return; }
  log(`대상: [${t.cat}] ${t.keyword} (행 ${t.row})`);
  if (DRY) return;
  try {
    const gen = await generate(t.cat, t.keyword);
    let featuredId = null, creditLine = '';
    try {
      const img = t.cat === 'meiga' ? await wikimediaImage(t.artHint || t.keyword) : await braveImage(t.cat === 'en' ? t.keyword + ' osaka japan' : t.keyword);
      if (img) { featuredId = await uploadFeatured(img, t.cat); if (t.cat === 'meiga') creditLine = `<p style="font-size:12px;color:#888;">画像出典: ${img.credit}</p>`; }
    } catch (e) { log('이미지 스킵:', e.message); }
    const post = await (await fetch(`${E.WP_BASE}/wp-json/wp/v2/posts`, {
      method: 'POST', headers: { Authorization: WP_AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: gen.title, content: gen.body + creditLine, status: 'publish', slug: gen.slug || undefined, categories: [CAT_ID[t.cat] || CAT_ID['osaka-odekake']], excerpt: gen.meta, featured_media: featuredId || undefined }),
    })).json();
    if (!post.id) throw new Error('WP 발행 실패: ' + JSON.stringify(post).slice(0, 150));
    await markRow(sheets, t.row, 'done', post.link);
    log('발행 완료:', post.link, `(본문 ${gen.body.length}자)`);
    await tg(`📝 <b>센바 블로그 발행</b>\n[${t.cat}] ${gen.title}\n${post.link}\n${Math.round(gen.body.length / 100) / 10}천자`);
  } catch (e) {
    log('실패:', e.message);
    await markRow(sheets, t.row, 'error: ' + e.message.slice(0, 80), '');
    await tg(`❌ <b>센바 블로그 실패</b>\n[${t.cat}] ${t.keyword}\n${e.message.slice(0, 150)}`);
  }
})();
