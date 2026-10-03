#!/bin/bash
# 가족 영상 보관함 배포 — 서버에서 저장소 pull 후: bash family-upload/deploy.sh
# 하는 일: /opt/family-upload 설치 → 빈 포트 자동 선택 → 짧은 토큰 생성 → 방화벽 개방
#          → pm2 등록 → 동작 확인 → 가족에게 보낼 짧은 링크 출력
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/family-upload

mkdir -p "$APP/videos"
cp "$SRC/server.js" "$SRC/package.json" "$APP/"
cd "$APP"

# 포트 검사 전에 우리 앱을 먼저 멈춰서, 포트를 점유한 건 전부 '다른 프로그램'이 되게 한다
pm2 stop family-upload >/dev/null 2>&1 || true

# 포트: 기존 .env 값(없으면 3015)에서 시작해 비어 있는 포트를 찾는다
PORT=3015
if [ -f .env ]; then
  SAVED_PORT=$(grep '^PORT=' .env | cut -d= -f2)
  [ -n "$SAVED_PORT" ] && PORT=$SAVED_PORT
fi
# 접속이 되면 누군가 쓰는 포트 → 다음 포트로
while (echo > "/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; do
  PORT=$((PORT + 1))
done

# 토큰: 짧은 6자리(소문자+숫자). 기존 토큰이 길면(예전 32자리) 짧은 것으로 교체해 링크를 짧게 만든다
TOKEN=""
[ -f .env ] && TOKEN=$(grep '^UPLOAD_TOKEN=' .env | cut -d= -f2)
if [ -z "$TOKEN" ] || [ ${#TOKEN} -gt 10 ]; then
  TOKEN=$(tr -dc 'a-z0-9' </dev/urandom | head -c 6)
fi
{
  echo "PORT=$PORT"
  echo "UPLOAD_TOKEN=$TOKEN"
} > .env
chmod 600 .env

npm install --omit=dev

# ufw가 켜져 있으면 포트 개방 (Vultr 클라우드 방화벽을 쓰면 거기서도 이 포트 허용 필요)
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow ${PORT}/tcp
fi

pm2 delete family-upload >/dev/null 2>&1 || true
pm2 start server.js --name family-upload
pm2 save

sleep 1
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/${TOKEN}" || echo 000)
IP=$(curl -s -4 --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')

echo ""
echo "============================================="
if [ "$CODE" = "200" ]; then
  echo " 배포 완료! 가족 단톡방에 보낼 링크:"
  echo ""
  echo " http://${IP}:${PORT}/${TOKEN}"
  echo ""
  echo " 이 링크로 아빠는 올리고, 가족 누구나 내려받아요."
  echo " 링크가 밖에서 안 열리면 Vultr 방화벽에서 ${PORT} 포트를 허용하세요."
else
  echo " 앱이 정상 응답하지 않습니다 (HTTP $CODE)."
  echo " pm2 logs family-upload --lines 20 --nostream 결과를 확인하세요."
fi
echo "============================================="
