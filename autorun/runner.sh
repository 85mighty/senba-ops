#!/bin/bash
# senba-ops 자동 실행기 — cron 5분마다: pull → autorun/queue.txt 가 새 커밋이면 목록 실행 → 텔레그램 통보
# 안전장치: queue.txt 의 항목 중 sheets-scripts/이름.js 패턴만 node 로 실행 (그 외 전부 무시)
REPO=/opt/senba-ops
STATE=/root/.senba-autorun.last
cd "$REPO" || exit 1
git pull -q 2>/dev/null || { echo "[autorun] pull 실패 $(date)"; exit 1; }
HASH=$(git log -1 --format=%H -- autorun/queue.txt)
[ -z "$HASH" ] && exit 0
[ "$HASH" = "$(cat "$STATE" 2>/dev/null)" ] && exit 0
echo "$HASH" > "$STATE"
MSG=$(git log -1 --format=%s -- autorun/queue.txt)
echo "[autorun] $(date '+%F %T') 실행: $MSG"
OUT=""; RC=0
while IFS= read -r line; do
  line="${line%%#*}"; line="$(echo "$line" | xargs)"
  [ -z "$line" ] && continue
  if [[ "$line" =~ ^sheets-scripts/[A-Za-z0-9_-]+\.js$ ]]; then
    echo "[autorun] node $line"
    O=$(node "$REPO/$line" 2>&1) || RC=1
    OUT="$OUT
[$line] $O"
  else
    OUT="$OUT
[skip] 허용되지 않은 항목: $line"
  fi
done < "$REPO/autorun/queue.txt"
echo "$OUT"
TG_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' /opt/senba-sales-sync/.env 2>/dev/null | cut -d= -f2-)
TG_CHAT=$(grep '^TELEGRAM_CHAT_ID=' /opt/senba-sales-sync/.env 2>/dev/null | cut -d= -f2-)
if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
  ICON="✅"; [ $RC -ne 0 ] && ICON="❌"
  curl -s "https://api.telegram.org/bot$TG_TOKEN/sendMessage" \
    --data-urlencode "chat_id=$TG_CHAT" \
    --data-urlencode "text=$ICON senba-ops 자동실행: $MSG$(echo "$OUT" | tail -c 1200)" > /dev/null
fi
exit $RC
