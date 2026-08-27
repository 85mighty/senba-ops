<?php
/**
 * 센바 블로그 — 미술관 갤러리 테마 스타일 (2026-08-27)
 * GeneratePress 무료판 위에 CSS + 홈 히어로를 얹는다 (seido-note 패턴).
 */

// ── 폰트 + 전역 스타일 ──
add_action('wp_head', function () { ?>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@500;700;900&family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{
  --paper:#faf7f1; --ink:#2b2a26; --frame:#b8964f; --green:#1a7f3c; --green-d:#14602e;
  --serif:'Noto Serif JP',serif; --sans:'Noto Sans JP',sans-serif;
}
body{background:var(--paper);color:var(--ink);font-family:var(--sans);}
/* 종이 질감 느낌의 미세 그라데이션 */
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:-1;
  background:radial-gradient(ellipse at 20% 0%,rgba(184,150,79,.06),transparent 55%),
             radial-gradient(ellipse at 90% 100%,rgba(26,127,60,.05),transparent 50%);}
h1,h2,h3,.entry-title,.main-title{font-family:var(--serif);letter-spacing:.02em;}
.site-header,.main-navigation{background:var(--paper) !important;}
.main-title a,.site-description{color:var(--ink) !important;}
.site-logo img,.header-image img{max-width:70px !important;height:auto;border-radius:50%;}
.site-branding-container,.site-header .inside-header{display:flex;align-items:center;gap:14px;}
.site-description{font-size:12px;letter-spacing:.14em;color:#8a8577 !important;}

/* ── 글 목록: 액자 카드 ── */
.blog .site-main article, .archive .site-main article{
  background:#fff;border:1px solid #e8e2d5;outline:6px solid #fff;
  box-shadow:0 1px 2px rgba(43,42,38,.08),0 12px 28px -12px rgba(43,42,38,.22),0 0 0 7px var(--frame);
  margin:0 0 46px;padding:28px 30px;border-radius:2px;}
.blog .entry-title a,.archive .entry-title a{color:var(--ink);text-decoration:none;}
.blog .entry-title a:hover,.archive .entry-title a:hover{color:var(--green);}
article .post-image img,.entry-content img{border:1px solid #eee;box-shadow:0 6px 18px rgba(43,42,38,.15);}

/* ── 본문 ── */
.single .entry-content{font-size:16.5px;line-height:2.05;}
.single .entry-content h2{border-bottom:2px solid var(--frame);padding-bottom:8px;margin-top:2.2em;
  font-size:24px;}
.single .entry-content h3{color:var(--green-d);font-size:19px;}
.single .inside-article{background:#fff;border:1px solid #e8e2d5;padding:34px 36px;
  box-shadow:0 10px 30px -14px rgba(43,42,38,.25);}

/* ── 카테고리 라벨 ── */
.cat-links a,.entry-meta a{color:var(--green);}
a{color:var(--green-d);}
a:hover{color:var(--green);}

/* ── 버튼류 ── */
.button,button,input[type=submit]{background:var(--green);border-radius:6px;}

/* ── 히어로 ── */
.senba-hero{max-width:1100px;margin:34px auto 8px;padding:0 20px;text-align:center;}
.senba-hero-inner{border:1px solid #e5ddca;background:#fff;border-radius:4px;
  box-shadow:0 0 0 6px #fff,0 0 0 7px var(--frame),0 18px 40px -18px rgba(43,42,38,.3);
  padding:46px 26px 40px;}
.senba-hero h1{font-family:var(--serif);font-weight:900;font-size:clamp(26px,4.6vw,40px);margin:0 0 10px;}
.senba-hero h1 span{color:var(--green);}
.senba-hero p{color:#6d6858;margin:0 0 22px;font-size:15px;}
.senba-hero .cats{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:22px;}
.senba-hero .cats a{border:1.5px solid var(--green);color:var(--green-d);border-radius:999px;
  padding:8px 20px;text-decoration:none;font-weight:700;font-size:14px;background:#fff;}
.senba-hero .cats a:hover{background:var(--green);color:#fff;}
.senba-hero .book{display:inline-block;background:var(--green);color:#fff;font-weight:700;
  padding:13px 34px;border-radius:8px;text-decoration:none;font-size:15px;
  box-shadow:0 6px 16px -6px rgba(26,127,60,.55);}
.senba-hero .book:hover{background:var(--green-d);color:#fff;}
@media(max-width:600px){.senba-hero-inner{padding:32px 16px 28px;}}
</style>
<?php });

// ── 홈 히어로 ──
add_action('generate_after_header', function () {
  if (!is_home() && !is_front_page()) return;
  if (is_paged()) return;
  ?>
  <div class="senba-hero"><div class="senba-hero-inner">
    <h1>アートを、<span>もっと身近に。</span></h1>
    <p>名画の楽しみ方と、大阪・心斎橋のおでかけ情報 — 心斎橋のアート体験カフェ「船場美術館」が届けるブログ</p>
    <div class="cats">
      <a href="/category/meiga/">✦ 名画解説</a>
      <a href="/category/osaka-odekake/">📍 大阪・心斎橋おでかけ</a>
      <a href="/category/news/">🎨 体験レポ</a>
      <a href="/category/en/">🌏 English</a>
    </div>
    <?php /* [애드센스 심사 기간 비노출 — 승인 후 주석 해제]
    <a class="book" href="https://book.squareup.com/appointments/w10qd9b5byn80k/location/LCM2AJZHBA6SK" rel="noopener">心斎橋でアート体験を予約する →</a>
    */ ?>
  </div></div>
  <?php
});

// ── 푸터 가게 정보 ──
add_action('generate_before_footer', function () { ?>
  <div style="text-align:center;padding:34px 18px 8px;color:#6d6858;font-size:13px;">
    <p style="font-family:'Noto Serif JP',serif;font-size:17px;color:#2b2a26;margin-bottom:6px;">船場美術館 Senba Art Studio</p>
    <p style="margin:0 0 4px;">大阪・心斎橋 四ツ橋駅徒歩5分の完全個室アートドローイングカフェ</p>
    <p style="margin:0;"><a href="https://senbaartstudio.com">公式サイト</a> ・ <a href="https://instagram.com/senbaartstudio">Instagram</a></p>
  </div>
<?php });
