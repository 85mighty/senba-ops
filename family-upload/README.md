# family-upload — 가족 영상 보관함

아빠가 링크 하나 눌러서 영상을 올리고, 링크를 아는 가족 누구나 내려받는 초간단 업로드 페이지.
도메인·로그인 없음 — `http://서버IP:포트/토큰` (토큰 6자리) 짧은 주소로 바로 접속.
배포 시 빈 포트를 자동으로 찾는다(3015부터, 점유 중이면 +1). 짧은 토큰 보호를 위해
IP당 10분에 30회 틀리면 10분간 차단한다.

## 배포 (서버에서)

```bash
cd ~/senba-ops && git pull
bash family-upload/deploy.sh
```

끝나면 가족 단톡방에 보낼 링크가 출력된다. 재배포해도 토큰(링크)은 유지된다.

## 동작

- `GET /토큰` (또는 `/?key=토큰`) — 업로드 버튼 + 올라온 파일 목록(내려받기 버튼). 토큰 틀리면 403.
- `POST /upload?key=토큰` — 동영상/사진만, 파일당 최대 4GB, 한 번에 10개까지.
  디스크 여유 10GB 미만이면 거부.
- `GET /download/파일명?key=토큰` — 다운로드.
- 저장 위치: `/opt/family-upload/videos/` (파일명 앞에 올린 일시가 붙음)

## 관리

- 상태: `pm2 status family-upload` / 로그: `pm2 logs family-upload`
- 용량 정리: `/opt/family-upload/videos/` 에서 오래된 파일 삭제
- 링크(토큰) 바꾸기: `/opt/family-upload/.env` 의 `UPLOAD_TOKEN` 수정 후 `pm2 restart family-upload`
- `.env`, `videos/`, `node_modules/` 는 커밋 금지 (.gitignore 처리됨)
