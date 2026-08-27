#!/bin/bash
# 서버 곳곳의 센바 관련 운영 파일을 이 저장소로 수집 (시크릿 제외)
# 사용법: ./sync.sh && git add -A && git commit -m "..."
set -e
cd "$(dirname "$0")"
mkdir -p square blog-auto blog-theme site-i18n sheets-scripts dashboard nginx

cp /opt/senba-square/*.js                                  square/
cp /opt/senba-blog-auto/auto_post_v*.js                    blog-auto/
cp /var/www/blog.senbaartstudio.com/wp-content/mu-plugins/senba-blog-theme.php blog-theme/
cp /root/senbaart-site/senbaartstudio.com/i18n.js          site-i18n/
cp /tmp/claude-0/-root/713a3419-03ff-4e17-86fa-f2234be55ce5/scratchpad/senba-*.js sheets-scripts/ 2>/dev/null || true
cp /opt/biz-dashboard/sheet-sync-v1.js                     dashboard/
cp /etc/nginx/sites-available/blog.senbaartstudio.com.conf nginx/
echo "sync 완료: $(date '+%F %T')"
