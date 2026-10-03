// 가족 영상 보관함 — 링크 하나로 업로드/다운로드 (로그인 없음, 토큰 링크)
// 운영 위치: /opt/family-upload/  (pm2 family-upload, 포트 3015)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const express = require('express');
const multer = require('multer');

// .env 로드 (PORT, UPLOAD_TOKEN)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const PORT = parseInt(process.env.PORT || '3015', 10);
const TOKEN = process.env.UPLOAD_TOKEN || '';
if (!TOKEN) {
  console.error('.env에 UPLOAD_TOKEN이 없습니다. deploy.sh를 먼저 실행하세요.');
  process.exit(1);
}

const VIDEO_DIR = path.join(__dirname, 'videos');
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const ALLOWED_EXT = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'm4v', 'mts',
  'jpg', 'jpeg', 'png', 'heic', 'gif',
]);
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024; // 4GB
const MIN_FREE_KB = 10 * 1024 * 1024; // 여유 10GB 미만이면 업로드 거부

function diskFreeKb() {
  try {
    const out = execSync(`df -kP ${JSON.stringify(VIDEO_DIR)}`).toString().trim();
    return parseInt(out.split('\n').pop().split(/\s+/)[3], 10);
  } catch {
    return Infinity; // 확인 실패 시 업로드는 막지 않는다
  }
}

// 짧은 토큰을 쓰므로 무작위 대입 방어: IP당 10분에 30회 실패하면 10분 차단
const fails = new Map();
function rateLimited(ip) {
  const f = fails.get(ip);
  return f && f.count >= 30 && Date.now() < f.until;
}
function recordFail(ip) {
  const f = fails.get(ip) || { count: 0, until: 0 };
  f.count += 1;
  f.until = Date.now() + 10 * 60 * 1000;
  fails.set(ip, f);
  if (fails.size > 10000) fails.clear();
}

// 토큰은 쿼리(?key=) 또는 경로(/토큰) 어느 쪽으로 와도 인정
function keyOk(req, pathKey) {
  const raw = String(req.query.key || pathKey || '');
  const key = Buffer.from(raw);
  const tok = Buffer.from(TOKEN);
  const ok = key.length === tok.length && crypto.timingSafeEqual(key, tok);
  if (!ok) recordFail(req.ip);
  else fails.delete(req.ip);
  return ok;
}

// multer는 원본 파일명을 latin1으로 주므로 한글 복원
function decodeName(name) {
  return Buffer.from(name, 'latin1').toString('utf8');
}

function safeName(name) {
  const base = path.basename(decodeName(name)).replace(/[^\w.\-가-힣ㄱ-ㅎㅏ-ㅣ ]/g, '_');
  return base.replace(/ +/g, '_').slice(-120) || 'file';
}

function ext(name) {
  return path.extname(decodeName(name)).slice(1).toLowerCase();
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: VIDEO_DIR,
    filename: (req, file, cb) => cb(null, `${stamp()}-${safeName(file.originalname)}`),
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_EXT.has(ext(file.originalname))) cb(null, true);
    else cb(new Error('동영상/사진 파일만 올릴 수 있어요'));
  },
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtSize(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1e3)) + ' KB';
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function listFiles() {
  return fs.readdirSync(VIDEO_DIR)
    .filter((f) => !f.startsWith('.'))
    .map((f) => {
      const st = fs.statSync(path.join(VIDEO_DIR, f));
      return { name: f, size: st.size, mtime: st.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function page(key) {
  const k = encodeURIComponent(key);
  const rows = listFiles().map((f) => `
      <li class="item">
        <div class="meta">
          <div class="fname">${escapeHtml(f.name.replace(/^\d{8}-\d{6}-/, ''))}</div>
          <div class="sub">${fmtDate(f.mtime)} · ${fmtSize(f.size)}</div>
        </div>
        <a class="dl" href="/download/${encodeURIComponent(f.name)}?key=${k}">내려받기</a>
      </li>`).join('');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>가족 영상 보관함</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
         margin: 0; background: #f4f6f9; color: #1b2430; font-size: 18px; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 20px 16px 60px; }
  h1 { font-size: 26px; text-align: center; margin: 18px 0 6px; }
  .hint { text-align: center; color: #5b6878; font-size: 16px; margin: 0 0 22px; }
  .bigbtn { display: block; width: 100%; padding: 22px; font-size: 24px; font-weight: 700;
            color: #fff; background: #2563eb; border: none; border-radius: 16px; cursor: pointer; }
  .bigbtn:active { background: #1d4ed8; }
  #file { display: none; }
  #progwrap { display: none; margin-top: 18px; background: #fff; border-radius: 14px; padding: 18px; }
  #ptext { font-size: 20px; font-weight: 700; margin-bottom: 10px; }
  #pwarn { color: #b45309; font-size: 15px; margin-top: 8px; }
  #bar { height: 18px; background: #e5e9f0; border-radius: 9px; overflow: hidden; }
  #fill { height: 100%; width: 0%; background: #22c55e; transition: width .2s; }
  #done { display: none; margin-top: 18px; background: #dcfce7; color: #166534; border-radius: 14px;
          padding: 18px; font-size: 22px; font-weight: 700; text-align: center; }
  #err { display: none; margin-top: 18px; background: #fee2e2; color: #991b1b; border-radius: 14px;
         padding: 16px; font-size: 17px; }
  h2 { font-size: 20px; margin: 34px 0 10px; }
  ul { list-style: none; margin: 0; padding: 0; }
  .item { display: flex; align-items: center; gap: 12px; background: #fff;
          border-radius: 14px; padding: 14px 16px; margin-bottom: 10px; }
  .meta { flex: 1; min-width: 0; }
  .fname { font-weight: 600; word-break: break-all; }
  .sub { color: #5b6878; font-size: 14px; margin-top: 3px; }
  .dl { flex-shrink: 0; background: #eef2ff; color: #2563eb; font-weight: 700; text-decoration: none;
        padding: 12px 16px; border-radius: 12px; font-size: 16px; }
  .empty { color: #5b6878; text-align: center; padding: 24px 0; }
</style>
</head>
<body>
<div class="wrap">
  <h1>📷 가족 영상 보관함</h1>
  <p class="hint">아래 버튼을 눌러 영상이나 사진을 올려주세요</p>

  <button class="bigbtn" id="pick">📤 영상 올리기</button>
  <input type="file" id="file" accept="video/*,image/*" multiple>

  <div id="progwrap">
    <div id="ptext">올리는 중… 0%</div>
    <div id="bar"><div id="fill"></div></div>
    <div id="pwarn">📱 올리는 동안 화면이 저절로 꺼지지 않아요. 전원 버튼만 누르지 말고 그대로 두세요</div>
  </div>
  <div id="done">✅ 올리기 완료!</div>
  <div id="err"></div>

  <!-- 업로드 중 화면 꺼짐 방지용 초소형 무음 영상 (NoSleep 기법, 외부 의존 없음) -->
  <video id="nosleep" playsinline style="position:fixed;left:-9999px;width:2px;height:2px">
    <source type="video/mp4" src="data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANNbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAnd0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAIAAAACAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHvbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABmm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAVpzdGJsAAAAunN0c2QAAAAAAAAAAQAAAKphdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAIAAgBIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAMGF2Y0MBQsAK/+EAGGdCwArZH4iIwEQAAAMABAAAAwBQPEiZIAEABWjLg8sgAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAFqgAABaoAAAAGHN0dHMAAAAAAAAAAQAAAAoAAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAoAAAABAAAAPHN0c3oAAAAAAAAAAAAAAAoAAAKDAAAACQAAAAoAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAAFHN0Y28AAAAAAAAAAQAAA30AAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYwLjE2LjEwMAAAAAhmcmVlAAAC3W1kYXQAAAJxBgX//23cRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MTExIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yNTAga2V5aW50X21pbj0xMCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAApliIQP8mKAAMPuAAAABUGaOB/qAAAABkGaVAf6gAAAAAVBmmA/1AAAAAVBmoA/1AAAAAVBmqA/1AAAAAVBmsA/1AAAAAVBmuA/1AAAAAVBmwA71AAAAAVBmyA31A==">
  </video>

  <h2>올라온 파일 (누르면 받아져요)</h2>
  <ul>${rows || '<li class="empty">아직 올라온 파일이 없어요</li>'}</ul>
</div>
<script>
  var pick = document.getElementById('pick');
  var input = document.getElementById('file');
  // 업로드 중 화면 꺼짐 방지: Wake Lock API(지원 기기) + 무음 영상 재생(그 외 기기)
  var wakeVideo = document.getElementById('nosleep');
  var wakeLock = null;
  // loop 속성 대신 되감기 — 일부 기기는 loop 재생을 '유휴'로 보고 화면을 꺼버림
  wakeVideo.addEventListener('timeupdate', function () {
    if (wakeVideo.currentTime > 0.5) wakeVideo.currentTime = 0.1;
  });
  function keepAwake(on) {
    if (on) {
      if (navigator.wakeLock) {
        navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
      }
      try { wakeVideo.play().catch(function () {}); } catch (e) {}
    } else {
      if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
      try { wakeVideo.pause(); } catch (e) {}
    }
  }
  pick.onclick = function () {
    // iOS는 사용자 터치 안에서만 영상 재생 허용 → 버튼 누르는 순간 미리 켠다
    keepAwake(true);
    input.click();
  };
  input.addEventListener('cancel', function () { keepAwake(false); });
  input.onchange = function () {
    if (!input.files.length) { keepAwake(false); return; }
    var fd = new FormData();
    for (var i = 0; i < input.files.length; i++) fd.append('files', input.files[i]);
    pick.style.display = 'none';
    document.getElementById('err').style.display = 'none';
    document.getElementById('progwrap').style.display = 'block';
    keepAwake(true); // 버튼 터치(사용자 동작) 직후라 모바일에서도 허용됨
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload?key=${k}');
    xhr.upload.onprogress = function (e) {
      if (!e.lengthComputable) return;
      var pct = Math.round(e.loaded / e.total * 100);
      document.getElementById('ptext').textContent = '올리는 중… ' + pct + '%';
      document.getElementById('fill').style.width = pct + '%';
    };
    xhr.onload = function () {
      keepAwake(false);
      document.getElementById('progwrap').style.display = 'none';
      if (xhr.status === 200) {
        document.getElementById('done').style.display = 'block';
        setTimeout(function () { location.reload(); }, 1500);
      } else { fail(xhr.responseText || '올리기에 실패했어요. 다시 시도해 주세요.'); }
    };
    xhr.onerror = function () {
      keepAwake(false);
      document.getElementById('progwrap').style.display = 'none';
      fail('인터넷 연결이 불안정해요. 와이파이 상태를 확인하고 다시 시도해 주세요.');
    };
    xhr.send(fd);
  };
  function fail(msg) {
    var el = document.getElementById('err');
    el.textContent = '❌ ' + msg;
    el.style.display = 'block';
    pick.style.display = 'block';
    input.value = '';
  }
</script>
</body>
</html>`;
}

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  if (rateLimited(req.ip)) return res.status(429).send('시도가 너무 많아요. 10분 뒤에 다시 열어주세요.');
  next();
});
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/', (req, res) => {
  if (!keyOk(req)) return res.status(403).send('주소가 올바르지 않아요. 카톡으로 받은 링크를 그대로 눌러주세요.');
  res.send(page(String(req.query.key)));
});

app.post('/upload', (req, res) => {
  if (!keyOk(req)) return res.status(403).send('주소가 올바르지 않아요.');
  if (diskFreeKb() < MIN_FREE_KB) {
    return res.status(507).send('서버 저장공간이 부족해요. 관리자(아들)에게 알려주세요!');
  }
  upload.array('files', 10)(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? '파일 하나가 4GB를 넘어서 올릴 수 없어요.'
        : err.message || '올리기에 실패했어요.';
      return res.status(400).send(msg);
    }
    console.log(`[upload] ${(req.files || []).map((f) => `${f.filename} (${fmtSize(f.size)})`).join(', ')}`);
    res.send('ok');
  });
});

app.get('/download/:name', (req, res) => {
  if (!keyOk(req)) return res.status(403).send('주소가 올바르지 않아요.');
  const name = path.basename(req.params.name);
  const file = path.join(VIDEO_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).send('파일을 찾을 수 없어요.');
  res.download(file, name.replace(/^\d{8}-\d{6}-/, ''));
});

// 짧은 주소 지원: http://서버IP:포트/토큰
app.get('/:key', (req, res) => {
  if (!keyOk(req, req.params.key)) {
    return res.status(403).send('주소가 올바르지 않아요. 카톡으로 받은 링크를 그대로 눌러주세요.');
  }
  res.send(page(req.params.key));
});

// 도메인/nginx 없이 서버 IP:포트로 바로 접속하는 구성이라 모든 인터페이스에서 수신
app.listen(PORT, '0.0.0.0', () => {
  console.log(`family-upload listening on 0.0.0.0:${PORT}`);
});
