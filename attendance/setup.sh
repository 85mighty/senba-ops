#!/usr/bin/env bash
# 알바 근태 봇 원클릭 설치 — 서버에서: bash setup.sh '<봇토큰>'
# 하는 일: 파일 복사 → .env 생성 → 알바방 /start 대기(chat id 자동 감지) → 명령메뉴 등록 → pm2 기동 → 테스트 발송
set -euo pipefail
DIR=/opt/senba-attend
SRC="$(cd "$(dirname "$0")" && pwd)"
TOKEN="${1:-}"
[ -z "$TOKEN" ] && read -rp "봇 토큰 입력: " TOKEN
API="https://api.telegram.org/bot$TOKEN"

# 0) 토큰 확인
ME=$(curl -s "$API/getMe")
echo "$ME" | grep -q '"ok":true' || { echo "❌ 토큰이 잘못됐습니다: $ME"; exit 1; }
BOTNAME=$(echo "$ME" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')
echo "✅ 봇 확인: @$BOTNAME"

# 1) 파일·설정
mkdir -p "$DIR"
cp "$SRC/attendance-bot-v1.js" "$DIR/"
if [ ! -f "$DIR/.env" ]; then
  cat > "$DIR/.env" <<EOF
ATTEND_BOT_TOKEN=$TOKEN
ATTEND_CHAT_ID=
ATTEND_WAGE=1200
ATTEND_END=18:30
ATTEND_CLEANUP_MIN=30
ATTEND_POST_HOUR=10
EOF
else
  sed -i "s|^ATTEND_BOT_TOKEN=.*|ATTEND_BOT_TOKEN=$TOKEN|" "$DIR/.env"
fi

# 2) chat id 자동 감지 (.env에 이미 있으면 건너뜀)
CHAT=$(grep '^ATTEND_CHAT_ID=' "$DIR/.env" | cut -d= -f2)
if [ -z "$CHAT" ]; then
  echo "⏳ 알바방에 @$BOTNAME 을 추가하고, 그 방에서 /start 를 보내세요. (최대 5분 대기 중...)"
  for _ in $(seq 1 60); do
    CHAT=$(curl -s "$API/getUpdates" | sed -n 's/.*"chat":{"id":\(-\{0,1\}[0-9]*\).*/\1/p' | tail -1)
    [ -n "$CHAT" ] && break
    sleep 5
  done
  [ -z "$CHAT" ] && { echo "❌ 메시지를 못 받았습니다. 방에서 /start 를 보낸 뒤 스크립트를 다시 실행하세요."; exit 1; }
  sed -i "s|^ATTEND_CHAT_ID=.*|ATTEND_CHAT_ID=$CHAT|" "$DIR/.env"
fi
echo "✅ 알바방 chat id: $CHAT"

# 3) 텔레그램 명령 메뉴 등록
curl -s "$API/setMyCommands" -H 'Content-Type: application/json' \
  -d '{"commands":[{"command":"in","description":"出勤 (출근)"},{"command":"out","description":"退勤 (퇴근)"},{"command":"today","description":"今日の状況"},{"command":"month","description":"今月の合計"},{"command":"fix","description":"記録修正 HH:MM HH:MM"}]}' > /dev/null

# 4) pm2 기동
pm2 delete senba-attend-bot >/dev/null 2>&1 || true
pm2 start "$DIR/attendance-bot-v1.js" --name senba-attend-bot
pm2 save

# 5) 테스트: 오늘 출근 안내 즉시 발송
sleep 2
node "$DIR/attendance-bot-v1.js" --post
echo "✅ 설치 완료 — 알바방에 출근 안내+버튼이 왔는지 확인하세요. 로그: pm2 logs senba-attend-bot"
