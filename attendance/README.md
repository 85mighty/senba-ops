# 알바 근태 봇 (attendance-bot-v1)

텔레그램 출근/퇴근 버튼으로 알바 근무시간·일급(시급 1,200엔)을 계산해
자산현황 스프레드시트 **'알바근태'** 탭에 자동 기록한다. 운영 위치: `/opt/senba-attend/`

## 동작
- 매일 10시(JST) 알바방에 오늘 출근시간(12:30/13:30, shift-cron과 동일 판정) + **[▶️ 出勤]** 버튼 발송
- 출근 버튼 → 시각 기록, 메시지가 **[⏹ 退勤]** 버튼으로 전환
- 퇴근 버튼 → 근무시간·일급 계산, 시트 기록, 사장님 봇으로 요약 통보
- 21시(JST) 퇴근 미기록이면 알바방 리마인드 + 사장님 통보

## 인정 규칙 (확정)
| 상황 | 계산 |
|---|---|
| 기준출근 전에 출근 누름 (12:26 도착, 12:30 출근) | **12:30부터** |
| 기준퇴근(18:30) 전에 퇴근 (18:25, 정리 늦어 18:20 등) | **분단위 그대로** |
| 기준퇴근 후에 퇴근 누름 (18:32) | **18:30으로 절사** |
| 마지막 예약 종료+정리 30분이 18:30을 넘는 날 | 그 시각까지 분단위 인정 |
| 그 외 예외 (장시간 연장 등) | `/수정 HH:MM HH:MM` 입력값 그대로 |

## 명령어 (알바방·관리자 채팅, 영문 별칭은 텔레그램 명령 메뉴용)
- `/출근`(`/in`) `/퇴근`(`/out`) — 버튼 대신 명령으로도 가능
- `/오늘`(`/today`) — 오늘 상태 확인
- `/이번달`(`/month`) — 이번달 근무일수·합계시간·급여 합계
- `/수정`(`/fix`) `[M/D] HH:MM HH:MM` — 기록 정정 (날짜 생략 시 오늘, 절사 없이 그대로 기록)

명령 메뉴 등록(선택, 서버에서 1회):
```
curl -s "https://api.telegram.org/bot<토큰>/setMyCommands" -H 'Content-Type: application/json' \
  -d '{"commands":[{"command":"in","description":"出勤 (출근)"},{"command":"out","description":"退勤 (퇴근)"},{"command":"today","description":"今日の状況"},{"command":"month","description":"今月の合計"},{"command":"fix","description":"記録修正 HH:MM HH:MM"}]}'
```

## 설치 (서버)
1. BotFather로 알바용 봇 새로 생성 → 토큰 확보
2. 알바방(그룹 또는 1:1)에 봇 추가, 방에서 아무 메시지나 보낸 뒤:
   `node attendance-bot-v1.js --chatid` 로 chat id 확인
3. `/opt/senba-attend/.env` 작성:
   ```
   ATTEND_BOT_TOKEN=봇토큰
   ATTEND_CHAT_ID=알바방chatid
   ATTEND_WAGE=1200
   ATTEND_END=18:30
   ATTEND_CLEANUP_MIN=30
   ATTEND_POST_HOUR=10
   # ATTEND_ADMIN_CHAT_ID=사장님이 이 봇과 쓰는 채팅 (선택, /수정용)
   ```
4. 시트는 자산현황(대시보드와 동일 ID) — 서비스계정(`/opt/senba-sales-sync/service-account.json`)이
   이미 편집자로 공유돼 있으므로 추가 설정 불필요. '알바근태' 탭은 자동 생성.
5. 기동: `pm2 start /opt/senba-attend/attendance-bot-v1.js --name senba-attend-bot && pm2 save`
6. 테스트: `node attendance-bot-v1.js --post` (오늘 출근 안내 즉시 발송)

의존성 없음(내장 fetch·crypto만 사용), Node 18+. 상태는 `/opt/senba-attend/state.json`.
