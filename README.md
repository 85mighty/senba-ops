# senba-ops — 船場美術館 운영 자동화 저장소

센바미술관(신사이바시) 관련 자동화·설정 코드 모음. 운영 원본은 서버 각 경로에 있고,
`./sync.sh` 로 이 저장소에 수집한다. **시크릿(.env, 서비스계정 키)은 커밋하지 않는다.**

## 구성
| 디렉터리 | 내용 | 운영 원본 위치 |
|---|---|---|
| `square/` | Square 예약: 웹훅→텔레그램(`webhook-server.js`, pm2 senba-sq-webhook), 밤 21시 시프트 크론(`shift-cron-v1.js`), 초기세팅·검증 스크립트 | `/opt/senba-square/` |
| `attendance/` | 알바 근태 봇: 텔레그램 출근/퇴근 버튼 → 근무시간·일급(시급1200엔) 계산 → 자산현황 '알바근태' 탭 (pm2 senba-attend-bot) | `/opt/senba-attend/` |
| `blog-auto/` | blog.senbaartstudio.com 자동발행 (v2 = 장문·FAQ스키마·CTA없음, 크론 매일 JST10시 + 수·토 EN) | `/opt/senba-blog-auto/` |
| `blog-theme/` | 블로그 갤러리 테마 mu-plugin (히어로 예약버튼은 애드센스 심사 동안 주석 처리) | `/var/www/blog.senbaartstudio.com/wp-content/mu-plugins/` |
| `site-i18n/` | senbaartstudio.com 다국어 오버레이 v10 (일/영/중/베트남, 날짜 게이트 예약 모달, 언어별 이벤트) — 배포는 GitHub senba-website 저장소 public/i18n.js | `/root/senbaart-site/senbaartstudio.com/` |
| `sheets-scripts/` | 자산현황 스프레드시트 탭 생성 스크립트(수익계산·저금계산기·방향·고베·2호점) | scratchpad |
| `dashboard/` | biz-dashboard(:3014) → 자산현황 '경영 대시보드' 탭 시간별 동기화 | `/opt/biz-dashboard/` |
| `nginx/` | 블로그 nginx 설정 | `/etc/nginx/sites-available/` |

## 시크릿 위치 (커밋 금지, 서버에만)
- `/opt/senba-square/.env` — Square 토큰·로케이션·웹훅 서명키·블록용 ID
- `/opt/senba-attend/.env` — 알바 근태 봇 토큰·채팅 ID·시급 설정
- `/opt/senba-blog-auto/.env` — WP 앱패스워드·Anthropic·Brave·텔레그램·시트
- `/root/.senba-blog-dbpass`, `/root/.senba-blog-wppass`

## 주요 결정 기록
- 예약: Square 무료 플랜 + 전액 사전결제, 방 5개 = 스태프 10명(平日/土日祝 분리)로 요일별 가격 강제
- 무료 플랜은 Bookings API 쓰기 불가 → 이른 슬롯 자동 블록은 Plus 업그레이드 시 자동 활성(코드 내장)
- 신가격: 평일 3,200/3,700 · 토일축 3,700/4,200 (사이트 반영은 i18n v10 적용일 = 시행일)
- 구루나비: 리퀘스트予約 전환 + 전 채널 Square 통일, 12월 유입 실측 후 해지 판정(계약 ~2027-01)
- 블로그: 애드센스 승인까지 순수 콘텐츠(명화 장문), 승인 후 CTA·예약 버튼 복구
