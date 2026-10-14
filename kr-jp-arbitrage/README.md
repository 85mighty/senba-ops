# kr-jp-arbitrage — KR→JP 아비트라지 리서치 도구

한국(공식몰·네이버)과 일본(공식몰·라쿠텐·Yahoo) 가격을 매일 수집 → 동일 상품 매칭 → 수수료·배송비·관세·소비세를 뺀 **순마진** 계산 → 기준 통과 상품만 Google Sheets + Telegram으로 보고. **자동 구매·자동 출품은 하지 않는다.** 상세 지침은 `CLAUDE.md` 참조.

## VPS 배포 절차 (/root/kr-jp-arbitrage)

```bash
# 1) 코드 반입 (이 저장소의 kr-jp-arbitrage/ 디렉터리를 서버로)
mkdir -p /root/kr-jp-arbitrage
rsync -a --exclude node_modules --exclude data --exclude logs \
  <repo>/kr-jp-arbitrage/ /root/kr-jp-arbitrage/

cd /root/kr-jp-arbitrage

# 2) 의존성 + Playwright chromium (기존 Chrome/CDP 9223~9225는 건드리지 않음)
npm install
npx playwright install chromium

# 3) 시크릿
cp .env.example .env   # 값 채우기. 서비스계정 JSON은 /root/kr-jp-arbitrage/sa.json

# 4) 소량 테스트 (셀렉터 검증 — brands.json의 셀렉터는 추정치라 첫 실행 때 반드시 확인)
node src/index.js --step=collect-kr --brand=xexymix --limit=5
node src/index.js --step=collect-jp --brand=xexymix --limit=5
node src/index.js --step=match,price,report --brand=xexymix

# 5) PM2 등록 (pm2 save 필수! 다른 프로세스 건드리지 말 것 / pm2 restart all 금지)
pm2 start ecosystem.config.cjs && pm2 save
pm2 logs kr-jp-arbitrage --lines 50

# 6) /root/SERVICES.md에 항목 추가 (기존 컨벤션)
#    kr-jp-arbitrage | :3016 | /root/kr-jp-arbitrage | .env(UI_TOKEN, NAVER_*, RAKUTEN_APP_ID,
#    YAHOO_CLIENT_ID, GOOGLE_SHEET_ID, sa.json, TELEGRAM_*, ANTHROPIC_API_KEY) | 매일 09:00 JST
```

## 실행 방법

| 명령 | 설명 |
|---|---|
| `node src/index.js` | 상주 모드: express(:3016) + 매일 09:00 JST 파이프라인 + Telegram 명령 봇 |
| `node src/index.js --run-now` | 전체 파이프라인 1회 실행 후 종료 |
| `node src/index.js --step=collect-kr --brand=xexymix --limit=5` | 단계·브랜드·소량 지정 실행 |
| `npm run check` | 전 파일 문법 확인 (`node --check`) |

파이프라인: `collect-kr → collect-jp → match → price → report` — 각 단계 독립 실행 가능, 실패는 로그 + Telegram 경고 후 다음 단계 계속.

## 웹 UI (`http://<서버>:3016`)

- `/` 최신 통과 목록 (정렬 테이블)
- `/review` C등급 후보 승인/거부 (Phase 3)
- `/api/*` 인증: `.env`의 `UI_TOKEN`을 `?token=` 쿼리 또는 `x-ui-token` 헤더로

## Telegram 명령

`/run` 즉시 실행 · `/top` 최신 상위 10 · `/pending` 검토 대기 건수

## 요율 조정 (코드 수정 없이)

Google Sheets의 `config_override` 탭에 `key | value` 입력 → 매 실행 시 `config/costs.json` 위에 덮어씀.
key는 점 표기 경로: 예) `kr_domestic_ship_krw`, `intl_ship.over_per_kg_jpy`, `platform`, `jp_sell_price_factor`.

## Phase 진행 상황

코드는 전 Phase 구현 완료. **서버 배포 시에는 Phase 순서대로 검증**할 것 — brands.json의 각 브랜드 `enabled` 플래그로 단계적 활성화 가능.

- [x] Phase 1 — XEXYMIX 공식몰↔공식몰: 수집→매칭→마진→Sheets/Telegram, PM2 (**서버에서 동작 확인 필요: brands.json 셀렉터 검증**)
- [x] Phase 2 — Mardi 추가 + 라쿠텐/Yahoo 일본 시장 최저가 보강 (공식몰가와 시장가 중 낮은 쪽 기준)
- [x] Phase 3 — TNF(수동 쌍 등록) + `/review` 승인 UI + LLM 보조 매칭 + 네이버 한국 시장가 보강
- [x] Phase 4 — 가격 추세 알림 (2주 이상 하락 = 재고 처분 신호, 일일 보고에 포함)

### TNF 수동 쌍 등록 (자동 매칭 비활성 브랜드)

```bash
# 수집 후 DB에서 양쪽 상품 id 확인 → 쌍 등록 (A등급 확정, weight_g 지정 권장 — 패딩 900g 등)
curl -X POST "http://localhost:3016/api/master?token=$UI_TOKEN" -H 'content-type: application/json' \
  -d '{"brand":"tnf","kr_product_id":12,"jp_product_id":34,"weight_g":900,"note":"눕시 자켓"}'
```

## 법·운영 주의

- 메루카리Shops 무재고 판매 금지 → 이 도구는 "선매입 후보 선정"용 (보고서 상단 자동 명시)
- TNF는 한·일 라이선시가 달라(영원아웃도어↔Goldwin) 병행수입 리스크 — 소량 테스트 전 확인
- 신품만 취급 전제 (중고는 古物商許可 필요)
- 관세율·배대지 요율·수수료는 `config_override` 시트에서 수시 갱신
