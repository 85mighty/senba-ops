# kobe3d-sync — 기기 간 자동 동기화 서버

고베 3D 뷰어(`../app/`, GitHub Pages)의 디자인 A안·B안·C안을 폰·아이패드·컴퓨터 사이에서 자동으로 맞추는 작은 저장 서버.
외부 패키지 없이 Node 18+ 만 있으면 된다. 데이터는 서버 디스크의 JSON 파일.

| 항목 | 값 |
|---|---|
| 운영 위치 | `/opt/kobe3d-sync/` (pm2 `kobe3d-sync`) |
| 포트 | `127.0.0.1:<PORT>` — 기본 3018, 서버에서 빈 포트로 (외부 직접 노출 없음, nginx 경유) |
| 공개 주소 | `https://blog.senbaartstudio.com/kobe3d-api/` |
| 데이터 | `/opt/kobe3d-sync/data/{A,B,C,D}.json` + `data/history/` (안마다 최근 50개 이력) |
| 시크릿 | `/opt/kobe3d-sync/.env` 의 `SYNC_TOKEN` (커밋 금지) |

## 설치 (서버에서, root)

```bash
# 0) 빈 포트 고르기 — 3018 은 기본값일 뿐, 이미 쓰는 서비스가 있으면 다른 번호를 쓴다 (vultr 서버는 3018 사용 중이었음)
for p in 3018 3028 3038 3048 3058; do ss -ltn | grep -q ":$p " || { PORT=$p; break; }; done; echo "사용할 포트: $PORT"

# 1) 파일 복사 — 이 저장소를 서버에 받아 둔 위치에서
mkdir -p /opt/kobe3d-sync && cp server.mjs package.json ecosystem.config.cjs /opt/kobe3d-sync/
cd /opt/kobe3d-sync && mkdir -p data logs

# 2) 비밀번호 만들기 (화면에 나온 값을 메모 — 기기마다 한 번 입력)
TOKEN=$(openssl rand -hex 12); echo "동기화 비밀번호: $TOKEN"
cat > .env <<ENV
SYNC_TOKEN=$TOKEN
ALLOW_ORIGIN=https://85mighty.github.io
PORT=$PORT
HOST=127.0.0.1
PATH_PREFIX=/kobe3d-api
DATA_DIR=/opt/kobe3d-sync/data
KEEP_HISTORY=50
ENV
chmod 600 .env

# 3) 실행 + 확인 (다른 pm2 프로세스는 건드리지 않는다 — pm2 restart all 금지)
pm2 start ecosystem.config.cjs && pm2 save
curl -s http://127.0.0.1:$PORT/kobe3d-api/health    # {"ok":true,...} — 다른 문구가 나오면 그 포트를 다른 서비스가 쓰는 것
#    시작 실패 원인: pm2 logs kobe3d-sync --lines 20 --nostream

# 4) nginx — blog.senbaartstudio.com 의 443 server 블록 안, `include snippets/wordpress-common.conf;` 위에
#    nginx-kobe3d-api.conf 내용을 붙여 넣고 proxy_pass 포트를 위 $PORT 로 바꾼 뒤:
nginx -t && systemctl reload nginx
curl -s https://blog.senbaartstudio.com/kobe3d-api/health
```

## 기기에서 연결

뷰어 ☰ 패널 → **기기 간 자동 동기화** → 비밀번호 입력 → **연결**. 위쪽 바에 `☁ 동기화됨` 이 뜨면 끝.
**디자인이 있는 기기(폰)를 먼저 연결**하고, 그다음 아이패드·컴퓨터를 연결한다.

- 편집하면 1~2초 안에 올라가고, 다른 기기는 열 때·탭으로 돌아올 때·15초마다 받아온다.
- 두 기기에서 같은 안을 동시에 고치면 나중에 편집한 쪽이 이긴다. 진 쪽 내용은 그 기기 브라우저에
  `kobe3d.design.v1.backup.<안>.<시각>` 으로 남는다. 서버에도 `data/history/` 에 이력이 남는다.
- 인터넷이 끊기면 `☁ 오프라인` — 기기에 보관했다가 연결되면 올린다.
- 숨긴 면·카메라 위치는 기기마다 따로(동기화 안 함).

## 운영

```bash
pm2 logs kobe3d-sync --lines 50              # 로그
ls -lt /opt/kobe3d-sync/data/history | head  # 최근 저장 이력
# 예전 버전으로 되돌리기: 이력 파일을 그 안으로 복사 (editedAt 이 더 커야 기기들이 받아감)
node -e 'const f=process.argv[1],s=process.argv[2],r=require(f);r.editedAt=Date.now();r.design.editedAt=r.editedAt;require("fs").writeFileSync("/opt/kobe3d-sync/data/"+s+".json",JSON.stringify(r))' /opt/kobe3d-sync/data/history/<파일>.json C
# 비밀번호 바꾸기: .env 의 SYNC_TOKEN 수정 → pm2 restart kobe3d-sync → 각 기기에서 새 비밀번호로 다시 연결
```

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/kobe3d-api/health` | 인증 없음. `{ ok: true }` |
| GET | `/kobe3d-api/designs` | `{ slots: { A: { rev, editedAt, updatedAt, device, design }, … } }` |
| GET | `/kobe3d-api/designs/:slot` | 한 안 |
| PUT | `/kobe3d-api/designs/:slot` | `{ design, editedAt, device }` → `{ rev, editedAt, updatedAt }`. 서버 쪽이 더 최근 편집이면 409 + `current` |

인증: `Authorization: Bearer <SYNC_TOKEN>`. 틀린 비밀번호는 IP 당 10분에 20회까지만. CORS 는 `ALLOW_ORIGIN` 만 허용. 요청 본문 최대 1 MB.

## 테스트

```bash
node test.mjs                                   # 서버 API 단위 테스트 (12개)
cd .. && npm run build && npm run test:sync     # 폰·아이패드 두 브라우저로 종단 테스트 (오프라인 포함)
```

## 서버 코드 바꾸기 (예: D안 추가 — 10/28)
```bash
curl -fsSL https://raw.githubusercontent.com/85mighty/senba-ops/main/kobe-interior/kobe-gallery-3d/sync-server/server.mjs -o /opt/kobe3d-sync/server.mjs
pm2 restart kobe3d-sync          # 이 프로세스만 — pm2 restart all 금지
curl -s https://blog.senbaartstudio.com/kobe3d-api/health   # "slots":["A","B","C","D"] 이면 완료
```
서버를 아직 바꾸지 않았으면 뷰어는 D안을 그 기기에만 보관하고(오류 표시 없음) A·B·C안은 그대로 동기화한다.
