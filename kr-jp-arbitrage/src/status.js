// 연결 현황: 브랜드별로 어떤 사이트·API가 연결돼 있고, 몇 건을 언제 수집했는지
import { loadBrands, features } from './util.js';
import { coverage, recentRuns } from './db.js';

const SOURCE_LABEL = {
  'kr/brand_site': '한국 공식몰',
  'kr/naver': '네이버쇼핑',
  'kr/coupang': '쿠팡',
  'kr/elevenst': '11번가',
  'jp/brand_site': '일본 공식몰',
  'jp/rakuten': '라쿠텐',
  'jp/yahoo': 'Yahoo!쇼핑',
};

// 각 소스의 상태: done(수집됨) / ready(대기) / nokey(키 없음) / off(설정 필요·꺼짐)
function planFor(cfg, feats) {
  const kr = cfg.kr || {};
  const jp = cfg.jp || {};
  const site = (s) => !!(s?.enabled && s.list_urls?.length && s.selectors?.item);
  return [
    { id: 'kr/brand_site', configured: site(kr.brand_site), key: true, hint: '목록 URL·셀렉터 설정 필요' },
    { id: 'kr/naver', configured: !!kr.naver?.enabled && feats.naver, key: feats.naver, hint: '2026-07-31 종료된 API (사용 안 함)' },
    { id: 'kr/elevenst', configured: kr.elevenst?.enabled !== false && !!(kr.naver?.query || kr.naver?.queries?.length || kr.elevenst?.queries?.length), key: feats.elevenst, hint: '11번가 키 필요', keyName: 'ELEVENST_API_KEY' },
    { id: 'kr/coupang', configured: kr.coupang?.enabled !== false && !!(kr.naver?.query || kr.naver?.queries?.length || kr.coupang?.queries?.length), key: feats.coupang, hint: '쿠팡 파트너스 키 필요', keyName: 'COUPANG_ACCESS_KEY/SECRET_KEY' },
    { id: 'jp/brand_site', configured: site(jp.brand_site), key: true, hint: '목록 URL·셀렉터 설정 필요' },
    { id: 'jp/rakuten', configured: !!jp.rakuten?.enabled, key: feats.rakuten, hint: '라쿠텐 키 필요', keyName: 'RAKUTEN_APP_ID/ACCESS_KEY' },
    { id: 'jp/yahoo', configured: !!jp.yahoo?.enabled, key: feats.yahoo, hint: 'Yahoo 키 필요', keyName: 'YAHOO_CLIENT_ID' },
  ];
}

export function buildStatus() {
  const feats = features();
  const brands = Object.entries(loadBrands())
    .filter(([k]) => !k.startsWith('_'))
    .map(([key, cfg]) => {
      const cov = coverage(key);
      const sources = planFor(cfg, feats).map((p) => {
        const [side, name] = p.id.split('/');
        const row = (side === 'kr' ? cov.kr : cov.jp).find((r) => r.source === name);
        let state;
        if (row?.n) state = 'done';
        else if (!p.configured) state = 'off';
        else if (!p.key) state = 'nokey';
        else state = 'ready';
        return {
          id: p.id,
          label: SOURCE_LABEL[p.id],
          side,
          state,
          count: row?.n || 0,
          last: row?.last || null,
          hint: state === 'nokey' ? `${p.hint} (${p.keyName})` : state === 'off' ? p.hint : '',
        };
      });
      return {
        key,
        name: cfg.display_name || key,
        enabled: !!cfg.enabled,
        phase: cfg.phase ?? '',
        comment: cfg._comment || '',
        sources,
        total: sources.reduce((s, x) => s + x.count, 0),
      };
    });
  return { brands, features: feats, runs: recentRuns(8) };
}
