// kr-jp-arbitrage 엔트리 — express(3016) + node-cron(매일 09:00 JST) + CLI
// 수동 실행: node src/index.js --run-now
// 단계 실행: node src/index.js --step=collect-kr --brand=xexymix --limit=5
import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import cron from 'node-cron';
import { ROOT, info, warn, error, warnMissingFeatures, today, loadCostsBase } from './util.js';
import * as db from './db.js';
import { runPipeline, STEP_ORDER } from './pipeline.js';
import { rankCandidates, sourcingCandidates, buildCards } from './discover.js';
import { buildStatus } from './status.js';
import { lookup, toQuote } from './lookup.js';
import { runSelfTest } from './selftest.js';
import { buildPairs, explainPair } from './pairs.js';
import { getFxKrwPerJpy } from './pricing/fx.js';
import { compareProducts } from './matcher/llm.js';
import { startCommandBot } from './outputs/telegram.js';

// ---------- CLI 인자 ----------
const args = process.argv.slice(2);
const argValue = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const cliOpts = {
  brand: argValue('brand') || undefined,
  limit: argValue('limit') ? parseInt(argValue('limit'), 10) : undefined,
};

// --probe-cn [--image=URL] : 1688 이미지 검색을 1회만 호출해 응답의 키 구조를 확인한다 (건당 과금 · 값은 출력하지 않음)
if (hasFlag('probe-cn')) {
  (async () => {
    const { searchBy1688Image, describeShape } = await import('./collectors/cn/image1688.js');
    const dbm = await import('./db.js');
    const image = argValue('image') || dbm.default.prepare(`SELECT image_url FROM cn_items WHERE image_url IS NOT NULL ORDER BY score DESC LIMIT 1`).get()?.image_url;
    if (!image) throw new Error('시험할 이미지가 없습니다. 먼저 --step=china 로 후보를 만들거나 --image=https://...jpg 를 주세요');
    const r = await searchBy1688Image(image, { pageSize: 5 });
    console.log(`제공자: ${r.provider} · 파싱된 결과 ${r.matches.length}건${r.cost !== undefined ? ' · 응답의 cost=' + r.cost : ''}`);
    console.log('응답 구조(키만):', JSON.stringify(describeShape(r.raw)));
    const m = r.matches[0];
    if (m) console.log(`첫 결과: ${m.priceCny}위안 · MOQ ${m.moq} · 월판매 ${m.monthSold} · 제목 ${m.title.slice(0, 40)}`);
    else console.log('파싱된 결과가 0건입니다 → 위 응답 구조를 알려주세요 (필드명 보정 필요)');
  })().then(() => process.exit(0)).catch((e) => { console.error('실패:', e.message); process.exit(1); });
} else if (hasFlag('selftest')) {
  runSelfTest()
    .then((rs) => {
      for (const r of rs) console.log(`${r.state === 'ok' ? 'OK  ' : r.state === 'nokey' ? '키없음' : 'FAIL'} ${r.name} — ${r.detail}`);
      process.exit(rs.some((r) => r.state === 'fail') ? 1 : 0);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
} else if (hasFlag('run-now') || argValue('step')) {
  warnMissingFeatures();
  const steps = argValue('step') ? argValue('step').split(',') : undefined;
  runPipeline({ ...cliOpts, steps })
    .then((results) => {
      const failed = Object.values(results).some((r) => !r.ok);
      process.exit(failed ? 1 : 0);
    })
    .catch((e) => {
      error('파이프라인 치명적 오류:', e);
      process.exit(1);
    });
} else {
  startServer();
}

// ---------- 상주 서버 ----------
function startServer() {
  warnMissingFeatures();
  const app = express();
  app.use(express.json());

  let running = false;
  async function safeRun(opts = {}) {
    if (running) {
      warn('파이프라인 이미 실행 중 — 요청 무시');
      return { skipped: true };
    }
    running = true;
    try {
      return await runPipeline(opts);
    } finally {
      running = false;
    }
  }

  // 인증: .env의 UI_TOKEN을 쿼리(?token=) 또는 헤더(x-ui-token)로 (basic-auth 미사용)
  function auth(req, res, next) {
    const token = process.env.UI_TOKEN;
    if (!token) return res.status(503).json({ error: 'UI_TOKEN 미설정 — .env에 설정 필요' });
    const given = req.query.token || req.get('x-ui-token');
    if (given !== token) return res.status(401).json({ error: '인증 실패' });
    next();
  }

  // 정적 페이지 (/, /review)
  const webDir = path.join(ROOT, 'src', 'web');
  app.get('/', (req, res) => res.sendFile(path.join(webDir, 'index.html')));
  app.get('/review', (req, res) => res.sendFile(path.join(webDir, 'review.html'), (err) => {
    if (err) res.status(404).send('승인 UI는 Phase 3에서 추가됩니다');
  }));

  app.get('/api/health', (req, res) => res.json({ ok: true, service: 'kr-jp-arbitrage', date: today() }));

  // 최신 통과 목록 (목표 매입가·리뷰수는 breakdown에서 꺼내 평탄화)
  app.get('/api/top', auth, (req, res) => {
    const rows = db.topSnapshots({
      date: req.query.date || undefined,
      onlyPassed: req.query.all !== '1',
      limit: parseInt(req.query.limit || '50', 10),
    });
    for (const r of rows) {
      try {
        const bd = JSON.parse(r.breakdown_json || '{}');
        r.target_kr_price = bd.targetKrPriceKrw ?? null;
        r.review_count = bd.jpReviewCount ?? 0;
      } catch {
        /* 무시 */
      }
    }
    res.json({ rows });
  });

  // 판단용 카드 (이미지·가격·판정) + 소싱 후보(이미지 포함)
  app.get('/api/cards', auth, (req, res) => {
    const cards = buildCards({ date: req.query.date || undefined, limit: parseInt(req.query.limit || '80', 10) });
    const brand = req.query.brand;
    res.json({
      cards: brand ? cards.filter((c) => c.brand === brand) : cards,
      sourcing: sourcingCandidates({ brand: brand || undefined, limit: 30 }),
    });
  });

  // 시세 비교 목록: 상품마다 한국/일본 가격·판매처와 양방향 손익
  app.get('/api/pairs', auth, async (req, res) => {
    try {
      res.json(await buildPairs({ filter: req.query.filter || 'all', brand: req.query.brand || undefined, q: req.query.q || undefined, limit: parseInt(req.query.limit || '100', 10) }));
    } catch (e) {
      error(`[pairs] ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // 이 쌍의 비용 내역(양방향)
  app.get('/api/breakdown', auth, async (req, res) => {
    try {
      res.json(await explainPair(req.query.side, parseInt(req.query.id, 10)));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // 중국 소싱: 후보 + 1688 원가 + 마진
  app.get('/api/cn', auth, async (req, res) => {
    try {
      const cn = await import('./cnsource.js');
      res.json(await cn.buildCnRows({ filter: req.query.filter || 'all', category: req.query.category || undefined, q: req.query.q || undefined, limit: parseInt(req.query.limit || '100', 10) }));
    } catch (e) {
      error(`[cn] ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });
  app.get('/api/cn/breakdown', auth, async (req, res) => {
    try {
      res.json(await (await import('./cnsource.js')).explainCn(parseInt(req.query.id, 10)));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });
  // 자동 조회가 안 될 때 사람이 1688 위안 단가를 직접 넣는 보조 수단
  app.post('/api/cn/cost', auth, async (req, res) => {
    try {
      const b = await (await import('./cnsource.js')).setManualCost(parseInt(req.body?.id, 10), { priceCny: req.body?.priceCny, url: req.body?.url, moq: req.body?.moq });
      res.json({ ok: true, net: b.netMarginJpy, rate: b.marginRate, passed: b.passed });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // 연결 시험: 서버의 키가 실제로 동작하는지 (유료 호출 없음)
  app.get('/api/selftest', auth, async (req, res) => {
    try {
      res.json({ results: await runSelfTest() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 연결 현황: 브랜드별 어떤 사이트에서 몇 건 수집했는지
  app.get('/api/status', auth, (req, res) => res.json(buildStatus()));

  // 시세 찾기: 상품 하나의 반대편 나라 시세·구입처를 즉석 검색하고 판매처별 마진 계산
  app.get('/api/lookup', auth, async (req, res) => {
    try {
      const sd = req.query.side === 'jp' ? 'jp' : 'kr';
      const id = parseInt(req.query.id, 10);
      const r = await lookup({ side: sd, id, google: req.query.google === '1' });
      db.saveQuote(sd, id, toQuote(r)); // 방금 찾은 결과를 목록에도 반영
      res.json(r);
    } catch (e) {
      error(`[lookup] ${e.message}`);
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // 같은 상품인지 AI가 이미지·상품명으로 비교 (결과가 목록의 대표 시세와 같은 상품이면 목록에도 저장)
  app.post('/api/compare', auth, async (req, res) => {
    try {
      const { side, id, name, image, url } = req.body || {};
      const sd = side === 'jp' ? 'jp' : 'kr';
      const p = db.getProductById(sd, parseInt(id, 10));
      if (!p) return res.status(404).json({ error: '없는 상품' });
      const v = await compareProducts({ name: p.name, image: p.image_url }, { name: name || '', image });
      const q = db.getQuote(sd, p.id);
      if (q && url && q.best_url === url) db.setQuoteVerdict(sd, p.id, v.verdict, v.reason);
      res.json(v);
    } catch (e) {
      error(`[compare] ${e.message}`);
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // 수집된 상품 둘러보기 (+ 반대편 시세·예상 마진)
  app.get('/api/products', auth, async (req, res) => {
    const rows = db.listProducts({
        side: req.query.side === 'jp' ? 'jp' : 'kr',
        brand: req.query.brand || undefined,
        source: req.query.source || undefined,
        q: req.query.q || undefined,
        minPrice: req.query.side === 'jp' && req.query.all !== '1' ? loadCostsBase().market_min_price_jpy || 0 : 0,
        sort: req.query.sort === 'recent' ? 'recent' : 'margin',
        profit: req.query.profit || '',
        dir: req.query.dir === 'jp2kr' ? 'jp2kr' : 'kr2jp',
        limit: parseInt(req.query.limit || '60', 10),
        offset: parseInt(req.query.offset || '0', 10),
      });
    for (const r of rows) {
      r.quote = r.q_checked
        ? { kind: r.q_kind, price: r.q_price, name: r.q_name, url: r.q_url, image: r.q_image, source: r.q_source, net: r.q_net, rate: r.q_rate, passed: !!r.q_passed, rev: r.q_rev_net == null ? null : { net: r.q_rev_net, rate: r.q_rev_rate, passed: !!r.q_rev_passed }, verified: r.q_verified, reason: r.q_reason, checked: r.q_checked }
        : null;
      for (const k of Object.keys(r)) if (k.startsWith('q_')) delete r[k];
    }
    let fx = null; // 화면에서 원↔엔 환산 표시용
    try { fx = (await getFxKrwPerJpy()).rate; } catch { /* 환율을 못 가져오면 환산 표시만 생략 */ }
    res.json({ rows, fx });
  });

  // 발굴: 주시 후보 + 소싱 후보
  app.get('/api/discover', auth, (req, res) => {
    res.json({
      candidates: rankCandidates({ limit: parseInt(req.query.limit || '20', 10) }),
      sourcing: sourcingCandidates({ limit: parseInt(req.query.limit || '20', 10) }),
    });
  });

  // C등급 검토 대기
  app.get('/api/review', auth, (req, res) => {
    res.json({ rows: db.pendingReviews(parseInt(req.query.limit || '100', 10)) });
  });
  app.get('/api/pending', auth, (req, res) => res.json({ count: db.pendingCount() }));

  // 승인/거부 → product_master 갱신
  app.post('/api/review/:id', auth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const action = req.body?.action;
    if (!db.getMaster(id)) return res.status(404).json({ error: '없는 master_id' });
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action은 approve|reject' });
    db.setMasterReview(id, action);
    info(`[review] master#${id} ${action === 'approve' ? '승인(A)' : '거부(X)'}`);
    res.json({ ok: true });
  });

  // 수동 쌍 등록 (TNF처럼 자동 매칭이 안 되는 브랜드용) — 승인된 A등급으로 생성
  app.post('/api/master', auth, (req, res) => {
    const { brand, kr_product_id, jp_product_id, weight_g, note } = req.body || {};
    const kr = kr_product_id && db.getProductById('kr', kr_product_id);
    const jp = jp_product_id && db.getProductById('jp', jp_product_id);
    if (!brand || !kr || !jp) return res.status(400).json({ error: 'brand, kr_product_id, jp_product_id 필요 (상품이 DB에 있어야 함)' });
    const id = db.upsertMaster({ brand, krId: kr.id, krUrl: kr.url, jpId: jp.id, jpUrl: jp.url, confidence: 'C', note: note || '수동 등록' });
    db.setMasterReview(id, 'approve', 'manual');
    if (weight_g) db.setMasterWeight(id, weight_g);
    info(`[master] 수동 쌍 등록 #${id} (${brand})`);
    res.json({ ok: true, id });
  });

  // 수동 트리거 (전체 또는 특정 단계)
  app.post('/api/run', auth, (req, res) => {
    const steps = req.body?.steps;
    safeRun({ steps }).then((r) => info('[api/run] 완료', r)).catch((e) => error('[api/run] 오류:', e));
    res.json({ ok: true, message: '백그라운드 실행 시작' });
  });

  const port = parseInt(process.env.PORT || '3016', 10);
  app.listen(port, () => info(`kr-jp-arbitrage 웹 서버 시작: :${port}`));

  // 매일 09:00 JST 파이프라인
  cron.schedule('0 9 * * *', () => {
    info('[cron] 일일 파이프라인 시작 (09:00 JST)');
    safeRun().catch((e) => error('[cron] 파이프라인 오류:', e));
  }, { timezone: 'Asia/Tokyo' });
  info('스케줄 등록: 매일 09:00 JST');

  // Telegram 명령 봇
  startCommandBot({
    onRun: () => safeRun(),
    onTop: async () => {
      const rows = db.topSnapshots({ limit: 10 });
      if (!rows.length) return '최신 통과 상품 없음';
      return rows
        .map((r, i) => `${i + 1}. [${r.brand}/${r.confidence}] ${r.kr_name || r.jp_name}\n   순마진 ¥${r.net_margin_jpy.toLocaleString()} (${(r.margin_rate * 100).toFixed(1)}%)\n   ${r.jp_url || ''}`)
        .join('\n');
    },
    onPending: async () => `검토 대기(C등급): ${db.pendingCount()}건`,
  });

  process.on('unhandledRejection', (e) => error('unhandledRejection:', e));
}
