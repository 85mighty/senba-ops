// 연결 시험 — 서버에 들어 있는 키가 실제로 동작하는지 확인한다. 키 값은 결과에 넣지 않는다.
// 유료 호출(Claude, DataForSEO 검색)은 하지 않는다. 화면의 "연결 시험" 버튼과 CLI(--selftest)가 함께 쓴다.
import { features } from './util.js';
import { searchRakuten } from './collectors/jp/rakuten.js';
import { searchYahoo } from './collectors/jp/yahoo.js';
import { probeCoupang } from './collectors/kr/coupang.js';
import { searchElevenst } from './collectors/kr/elevenst.js';
import { probeDataforseo } from './collectors/jp/dataforseo.js';

async function check(name, keyOk, noKeyDetail, fn) {
  if (!keyOk) return { name, state: 'nokey', detail: noKeyDetail };
  const t0 = Date.now();
  try {
    const r = await fn();
    return { name, state: r.ok === false ? 'fail' : 'ok', detail: r.detail, ms: Date.now() - t0 };
  } catch (e) {
    return { name, state: 'fail', detail: e.message, ms: Date.now() - t0 };
  }
}
const count = (n) => ({ ok: n > 0, detail: n > 0 ? `정상 (검색 결과 ${n}건)` : '응답은 왔지만 결과가 0건입니다 (키는 유효할 수 있음)' });

export async function runSelfTest() {
  const f = features();
  return [
    await check('쿠팡 파트너스', f.coupang, '키(COUPANG_ACCESS_KEY/SECRET_KEY)가 서버 .env에 없습니다', () => probeCoupang('나이키')),
    await check('라쿠텐', f.rakuten, '키(RAKUTEN_APP_ID/ACCESS_KEY)가 없습니다', async () => count((await searchRakuten('ナイキ', { hits: 1 })).length)),
    await check('Yahoo!쇼핑', f.yahoo, '키(YAHOO_CLIENT_ID)가 없습니다', async () => count((await searchYahoo('ナイキ', { results: 1 })).length)),
    await check('11번가', f.elevenst, '키(ELEVENST_API_KEY)가 없습니다', async () => count((await searchElevenst('나이키', { pageSize: 1 })).length)),
    await check('구글 쇼핑(DataForSEO)', f.dataforseo, '로그인/비밀번호(DATAFORSEO_LOGIN/PASSWORD)가 없습니다', () => probeDataforseo()),
    await check('Claude(AI 이미지 비교)', f.llm, '키(ANTHROPIC_API_KEY)가 없습니다', async () => ({ ok: true, detail: '키 있음 (호출은 비용이 있어 시험하지 않음)' })),
  ];
}
