# KR→JP 아비트라지 리서치 도구 (kr-jp-arbitrage)

> 이 파일은 Claude Code용 프로젝트 지침서다. 작업 전 전체를 읽고, 아래 규칙을 우선한다.

## 0. 한 줄 요약

한국(네이버쇼핑·브랜드 공식몰)과 일본(라쿠텐·Yahoo·브랜드 일본 공식몰) 가격을 매일 수집 → 동일 상품 매칭 → 수수료·배송비·관세·소비세를 전부 뺀 **순마진**을 계산 → 기준 통과 상품만 Google Sheets + Telegram으로 보고하는 **리서치 도구**다. 자동 구매·자동 출품은 하지 않는다.

## 1. 범위 / 비범위

**한다**
- 대상 브랜드 3개: XEXYMIX(젝시믹스), Mardi Mercredi(마르디 메크르디), THE NORTH FACE(한국 영원아웃도어 라인 ↔ 일본 Goldwin 라인)
- 양국 가격 수집, 상품 매칭, 마진 계산, 랭킹 보고
- 매칭 결과를 사람이 승인/거부하는 최소한의 웹 UI

**안 한다**
- 자동 구매, 자동 출품, 재고 연동
- 화장품·식품·전기제품 (일본 薬機法·食品衛生法·PSE 때문에 처음부터 제외)
- 구글 검색 스크래핑 (차단·약관 문제. 공식 API와 브랜드 공식몰만 사용)

## 2. 서버 환경 (반드시 준수)

- 서버: Vultr VPS `66.245.217.115`, Ubuntu, root, Node.js 서비스 30개 이상이 PM2로 돌고 있음
- 작업 폴더: `/root/kr-jp-arbitrage` (새로 생성)
- **포트: 3016** (3000, 3001, 3011~3015, 4104, 8082~8084, 8091, 6080, 6081, 9223~9225는 이미 사용 중 — 절대 쓰지 말 것)
- PM2 서비스명: `kr-jp-arbitrage`
- 런타임: Node.js (현재 서버 버전 사용, `node -v`로 확인), TypeScript 없이 **plain JS(ESM)** 로 작성 — 다른 서비스와 패치 패턴을 맞추기 위함
- DB: SQLite (`better-sqlite3`), 파일은 `/root/kr-jp-arbitrage/data/arb.db`
- 브라우저 필요 시: 서버에 이미 Chrome이 있음. **기존 CDP 포트(9223/9224/9225)와 기존 프로필은 건드리지 말고**, Playwright를 별도 설치해 headless로 쓸 것 (`npx playwright install chromium`)
- 비밀값은 전부 `.env` (git 제외). 코드에 키 하드코딩 금지
- 완료 후 `/root/SERVICES.md`에 포트/경로/키 항목 추가 (기존 컨벤션 따름)
- 서비스 등록: `pm2 start ecosystem.config.cjs && pm2 save` — **`pm2 save` 빠뜨리지 말 것**
- 다른 PM2 프로세스를 중지·재시작·삭제하지 않는다. `pm2 restart all` 금지
- 기존 파일 수정 시 서버 표준: Python 치환 스크립트에 `assert old in s`, JS는 `node -c`로 문법 확인 후 `pm2 restart kr-jp-arbitrage`

## 3. 아키텍처

```
/root/kr-jp-arbitrage
├── CLAUDE.md
├── .env                     # 키 (git 제외)
├── ecosystem.config.cjs     # PM2
├── package.json
├── config/
│   ├── brands.json          # 브랜드별 수집 소스·URL·셀렉터
│   └── costs.json           # 수수료·배송비·관세율 상수 (아래 §6)
├── src/
│   ├── index.js             # express(3016) + node-cron 스케줄러
│   ├── collectors/
│   │   ├── kr/naver.js      # 네이버쇼핑 검색 API
│   │   ├── kr/brandSite.js  # 한국 공식몰 (Playwright)
│   │   ├── jp/rakuten.js    # 라쿠텐 상품검색 API
│   │   ├── jp/yahoo.js      # Yahoo!쇼핑 API
│   │   └── jp/brandSite.js  # 일본 공식몰 (Playwright)
│   ├── matcher/
│   │   ├── rules.js         # 규칙 기반 매칭 (품번·상품명·색상)
│   │   └── llm.js           # Claude API 보조 판정 (선택)
│   ├── pricing/
│   │   ├── fx.js            # 환율 (캐시 6시간)
│   │   └── margin.js        # 순마진 계산
│   ├── outputs/
│   │   ├── sheets.js        # Google Sheets 기록
│   │   └── telegram.js      # 일일 보고
│   ├── db.js                # SQLite 스키마·쿼리
│   └── web/                 # 매칭 승인용 미니 UI (정적 HTML + JSON API)
├── data/arb.db
└── logs/
```

**파이프라인 (매일 09:00 JST, 수동 실행 `node src/index.js --run-now` 지원)**
1. collect-kr → 2. collect-jp → 3. match → 4. price → 5. report

각 단계는 독립 실행 가능해야 함 (`--step=collect-kr` 등). 한 단계 실패가 전체를 죽이면 안 된다 — 실패는 로그+Telegram 경고.

## 4. 데이터 소스

### 한국
| 소스 | 방식 | 비고 |
|---|---|---|
| 네이버쇼핑 검색 API | `https://openapi.naver.com/v1/search/shop.json` | 일 25,000건 무료. `NAVER_CLIENT_ID/SECRET`. `sort=asc`로 최저가. 브랜드 공식 스토어(`mallName`) 우선 |
| XEXYMIX 공식몰 `xexymix.com` | Playwright | 한국은 세일·쿠폰이 커서 네이버 API 가격보다 공식몰 실결제가가 더 낮은 경우가 많음. 세일가 기준으로 수집 |
| Mardi Mercredi 공식몰 `mardimercredi.com` | Playwright | |
| THE NORTH FACE KOREA `thenorthfacekorea.co.kr` | Playwright | 영원아웃도어 라이선스. 품번 `NJ…/NM…/NF…` 체계 |

### 일본
| 소스 | 방식 | 비고 |
|---|---|---|
| 라쿠텐 상품검색 API | `IchibaItem/Search` | 무료. `RAKUTEN_APP_ID`. 브랜드 공식 라쿠텐점 있으면 `shopCode`로 한정 |
| Yahoo!쇼핑 API | `itemSearch` | 무료. `YAHOO_CLIENT_ID` |
| XEXYMIX JAPAN `xexymix.jp` | Playwright | 일본 정가 기준 |
| Mardi Mercredi JP 공식 온라인스토어 | Playwright | URL은 brands.json에서 확인·수정 |
| THE NORTH FACE JP (Goldwin) `goldwin.co.jp/tnf` | Playwright | 품번 `ND…/NT…/NP…` 체계 — 한국과 완전히 다름 |

**스크래핑 예절**: 요청 간 2~5초 랜덤 대기, 동일 페이지 24시간 캐시, robots.txt 확인, UA는 일반 Chrome. 하루 1회 수집으로 충분하다.

## 5. 매칭 전략 (가장 중요)

패션은 JAN코드가 노출되지 않는 경우가 많아 품번·상품명 기반 매칭이 핵심이다.

**신뢰도 등급**
- `A` 확정: 동일 품번 or 사람이 UI에서 승인
- `B` 유력: 브랜드+정규화된 상품명+색상 일치 (규칙 매칭 점수 ≥ 0.85)
- `C` 후보: 규칙 점수 0.6~0.85 → LLM 보조 판정 또는 사람 검토 대기
- 보고서에는 `A`, `B`만 포함. `C`는 승인 UI에 쌓는다.

**브랜드별 특이사항**
- **XEXYMIX / Mardi**: 한·일 모두 동일 회사의 직영이라 상품명·품번 체계가 거의 같음. 상품명 정규화(공백·대소문자·전각/반각·色名 매핑)만으로 B 등급 대부분 가능. **1단계는 여기부터**.
- **THE NORTH FACE**: 한국(영원아웃도어)과 일본(Goldwin)은 별도 라이선시라 같은 디자인도 품번·사양이 다르고, 한국 전용 라인(White Label 등)은 일본에 아예 없다. 자동 매칭 기대하지 말고 `product_master`에 사람이 쌍을 등록하는 구조로. 또한 상표권자가 다른 라이선시인 병행수입은 법적 회색지대이므로 보고서 비고에 "TNF: 병행수입 리스크 확인 필요"를 항상 붙인다.

**`product_master` 테이블** (수동 큐레이션의 원천)
```
id, brand, kr_product_id, kr_url, jp_product_id, jp_url, confidence(A/B/C),
approved_by_user(0/1), note, created_at, updated_at
```

**LLM 보조 (`matcher/llm.js`)**: `ANTHROPIC_API_KEY`가 있을 때만 동작. 입력은 양쪽 상품명·색상·이미지 URL·품번, 출력은 `{same: bool, confidence: 0~1, reason}` JSON. 하루 호출 상한 200건.

## 6. 마진 계산 (`config/costs.json` 상수 — 전부 수정 가능해야 함)

```
net_margin_jpy =
  jp_sell_price_jpy
  − kr_price_krw / fx_krw_per_jpy
  − kr_domestic_ship_krw / fx
  − intl_ship_jpy(weight_g)          # 배대지 요율표, g 단위 구간
  − customs_duty_jpy                 # jp_taxable_value × duty_rate(category)
  − import_consumption_tax_jpy       # (과세가격 + 관세) × 0.10
  − platform_fee_jpy(platform)       # 메루카리Shops 10% / BASE 3.6%+40엔+3%
  − packing_and_misc_jpy             # 기본 150엔
```

**기본값 (costs.json에 넣고 주석으로 "확인 필요" 표시)**
- `fx`: exchangerate API(무료) 6시간 캐시, 실패 시 마지막 값 사용. 안전마진으로 환율에 +2% 가산 옵션
- `kr_domestic_ship_krw`: 3,000
- `intl_ship_jpy`: 배대지 기준표 placeholder — 500g 1,800 / 1kg 2,600 / 2kg 3,800 (실제 이용 배대지 요율로 교체)
- `duty_rate`: 의류 10% (간이세율 기준, 품목별 확인 필요), 가방·잡화 별도
- `consumption_tax`: 10%. **재판매 목적 상업수입이라 0.6掛け·1만엔 면세 적용하지 않는다** (면세제도 자체도 폐지 방향)
- `platform`: 기본 `mercari_shops` (10% + 출금 200엔/회), `base_standard` (3.6%+40엔 + 3%)
- `jp_sell_price`: 일본 최저가 × 0.95 (팔리려면 최저가보다 싸야 함) — 계수 조정 가능

**통과 기준 (둘 다 만족)**: `net_margin_jpy ≥ 2,200` **AND** `net_margin_jpy / jp_sell_price_jpy ≥ 0.25`

**TNF 눕시/재킷류는 중량이 커서 배송비 비중이 크다** — 중량 추정치를 `product_master.weight_g`에 넣고, 없으면 카테고리 기본값(상의 300g, 레깅스 250g, 패딩 900g) 사용.

## 7. DB 스키마 (SQLite)

```sql
products_kr(id, brand, source, product_code, name, color, price_krw, sale_price_krw, url, image_url, in_stock, fetched_at)
products_jp(id, brand, source, product_code, name, color, price_jpy, url, image_url, in_stock, fetched_at)
product_master(... §5 참조 ...)
price_history(product_side('kr'|'jp'), product_id, price, fetched_at)   -- 추세용
margin_snapshots(master_id, date, kr_price_krw, jp_price_jpy, fx, net_margin_jpy, margin_rate, passed(0/1), breakdown_json)
run_log(run_id, step, status, message, started_at, finished_at)
```

## 8. 출력

### Google Sheets (`GOOGLE_SHEET_ID`, 서비스계정 JSON은 `.env`의 경로로)
- 탭 `daily_picks`: 날짜 | 브랜드 | 상품명 | 색상 | 한국가(KRW) | 일본가(JPY) | 환율 | 순마진(JPY) | 마진율 | 등급 | 한국URL | 일본URL | 비고
- 탭 `review_queue`: C등급 매칭 후보 (승인 UI와 동일 데이터)
- 탭 `config_override`: 시트에서 costs.json 값을 덮어쓸 수 있게 (창희님이 코드 안 건드리고 요율 조정)

### Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)
- 매일 09:00 JST: 통과 상품 상위 10개 요약 (브랜드·상품명·순마진·마진율·일본URL)
- 실패 시: 단계명 + 에러 1줄
- 명령: `/run` 즉시 실행, `/top` 최신 상위 10, `/pending` 검토 대기 건수

### 웹 UI (`http://66.245.217.115:3016`)
- `/` : 최신 통과 목록 (테이블, 정렬)
- `/review` : C등급 후보를 한·일 이미지 나란히 보고 승인/거부 → `product_master` 갱신
- `/api/*` : JSON. 인증은 `.env`의 `UI_TOKEN`을 쿼리/헤더로 (기존 서비스들처럼 basic-auth는 쓰지 않음)

## 9. 구현 순서 (Phase별로 커밋)

1. **Phase 1 — XEXYMIX만, 공식몰↔공식몰**: 양국 공식몰 수집 → 규칙 매칭 → 마진 계산 → Sheets `daily_picks` 기록 → Telegram 보고. PM2 등록까지. 여기서 동작 확인 받고 다음으로.
2. **Phase 2 — Mardi 추가 + 라쿠텐/Yahoo API로 일본 시장 최저가 보강** (공식몰가와 시장가 중 낮은 쪽을 `jp_sell_price` 기준으로)
3. **Phase 3 — TNF + 승인 UI + LLM 보조 매칭 + 네이버 API로 한국 시장 최저가 보강**
4. **Phase 4 — 가격 추세(2주 이상 하락 중인 한국 상품 = 재고 처분 신호) 알림**

각 Phase 끝에: `node -c`로 전 파일 문법 확인 → `pm2 restart kr-jp-arbitrage` → `pm2 logs kr-jp-arbitrage --lines 50`로 정상 확인 → `pm2 save` → `SERVICES.md` 갱신.

## 10. 필요한 .env 키

```
PORT=3016
UI_TOKEN=
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
RAKUTEN_APP_ID=
YAHOO_CLIENT_ID=
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_JSON=/root/kr-jp-arbitrage/sa.json
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ANTHROPIC_API_KEY=            # 선택 (LLM 매칭)
FX_SAFETY_MARGIN=0.02
```

없는 키는 시작 시 경고만 내고 해당 기능을 비활성화한다 (서비스 자체는 떠야 함).

## 11. 코드 규칙

- ESM, async/await, 외부 의존성 최소: `express`, `better-sqlite3`, `node-cron`, `playwright`, `googleapis`, `node-telegram-bot-api`, `dotenv`
- 모든 수집기는 `{brand, source, product_code, name, color, price, url, image_url, in_stock}` 동일 형태로 반환
- 로그는 `logs/YYYY-MM-DD.log` + 콘솔. 상품명·가격·URL은 남기되 키는 절대 로그에 남기지 않음
- 셀렉터는 코드가 아니라 `config/brands.json`에 — 사이트 개편 시 JSON만 고치면 되게
- 테스트: `node src/index.js --step=collect-kr --brand=xexymix --limit=5` 처럼 소량 실행 플래그 필수
- 주석과 Telegram/Sheets 문구는 한국어

## 12. 법·운영 주의 (보고서 비고란에 자동 삽입)

- 메루카리Shops는 무재고 판매 금지 → 이 도구는 "선매입 후보 선정"용. 보고서 상단에 명시
- TNF: 라이선시가 달라 병행수입 리스크 — 소량 테스트 전 확인
- 중고 판매 시 古物商許可 필요 (신품만 다룬다는 전제)
- 관세율·배대지 요율·플랫폼 수수료는 바뀌므로 `config_override` 시트에서 수시 갱신
