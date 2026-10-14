// kr-jp-arbitrage 엔트리 — express(3016) + node-cron(매일 09:00 JST) + CLI
// 수동 실행: node src/index.js --run-now
// 단계 실행: node src/index.js --step=collect-kr --brand=xexymix --limit=5
import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import cron from 'node-cron';
import { ROOT, info, warn, error, warnMissingFeatures, today } from './util.js';
import * as db from './db.js';
import { runPipeline, STEP_ORDER } from './pipeline.js';
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

// --run-now / --step=... : 1회 실행 후 종료 (PM2 상주와 분리된 수동 모드)
if (hasFlag('run-now') || argValue('step')) {
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

  // 최신 통과 목록
  app.get('/api/top', auth, (req, res) => {
    const rows = db.topSnapshots({
      date: req.query.date || undefined,
      onlyPassed: req.query.all !== '1',
      limit: parseInt(req.query.limit || '50', 10),
    });
    res.json({ rows });
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
