#!/bin/bash
# 가족 영상 보관함 배포 — 서버에서 저장소 pull 후: bash family-upload/deploy.sh
# 하는 일: /opt/family-upload 설치 → 토큰 생성 → 방화벽 3015 개방 → pm2 등록 → 가족에게 보낼 링크 출력
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/family-upload
PORT=3015

mkdir -p "$APP/videos"
cp "$SRC/server.js" "$SRC/package.json" "$APP/"

cd "$APP"

# 토큰(.env)은 최초 1회만 생성 — 재배포해도 링크가 바뀌지 않는다
if [ ! -f .env ]; then
  {
    echo "PORT=$PORT"
    echo "UPLOAD_TOKEN=$(openssl rand -hex 16)"
  } > .env
  chmod 600 .env
fi

npm install --omit=dev

# ufw가 켜져 있으면 포트 개방 (Vultr 클라우드 방화벽을 쓰면 거기서도 3015 허용 필요)
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow ${PORT}/tcp
fi

if pm2 describe family-upload >/dev/null 2>&1; then
  pm2 restart family-upload --update-env
else
  pm2 start server.js --name family-upload
fi
pm2 save

TOKEN=$(grep '^UPLOAD_TOKEN=' .env | cut -d= -f2)
IP=$(curl -s -4 --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')

echo ""
echo "============================================="
echo " 배포 완료! 가족 단톡방에 보낼 링크:"
echo ""
echo " http://${IP}:${PORT}/?key=${TOKEN}"
echo ""
echo " 이 링크로 아빠는 올리고, 가족 누구나 내려받아요."
echo " 링크가 안 열리면 Vultr 방화벽에서 ${PORT} 포트를 허용하세요."
echo "============================================="
