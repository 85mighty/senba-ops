# Kobe Gallery Studio — Scaniverse 3D 복원 · 인테리어 A안 시뮬레이터

iPhone LiDAR(Scaniverse) 스캔 → **원본 보존** → 노이즈 정리 → 평면 적합으로 벽·기둥 복원 → 인테리어 A안을
같은 좌표에서 전환 비교하는 브라우저 뷰어. 상상으로 공간을 만들지 않고, 스캔(형상)과 사진(재질·위치)만 근거로 쓴다.

> 작업 원칙과 요구사항 전문은 `CLAUDE.md`. 시공 체크리스트는 `reports/construction_checklist.md`.

## 현재 상태 (2026-10-26)
- **실제 Scaniverse 스캔 + 사진 11장으로 복원 완료.** 정점 121,947 · 삼각형 161,336 · 텍스처 있음 · 단위 m · 벽 정렬 −3.75°.
- 측정: 천장고 2.38 m, 본실 약 6.3×6.8 m, 바닥 점유 48 m², 검은 띠 윗면 0.88 m(두께 0.08), 걸레받이 0.10 m, 중앙 넓은 가벽 0.26×0.82 m.
- 창은 벽 전개도(`screenshots/walls/`)의 형상 공백(유리 = LiDAR 누락)으로 검출. 문·세면실/주방 라벨·뒷방 용도는 `inferred`.
- 사진 대조 캡처: `screenshots/compare_<북마크>_<모드>.png` (입구·창가·주방·화장실·큰 기둥).
- 합성 테스트 스캔 생성기(`scripts/make_synthetic_scan.py`)는 파이프라인 회귀 테스트용으로 유지.

## Mac 에서 실행하기

```bash
# 0) 준비 (처음 한 번)
cd ~/Downloads/kobe-gallery-3d            # 이 폴더를 받은 위치
python3 -m pip install -r requirements.txt
npm install

# 1) 원본 넣기 — ZIP 은 수정하지 않고 보관된다
cp ~/Downloads/"Scaniverse 2026-10-26 113837(1).zip" assets/original/
cp ~/Downloads/매장사진*.jpg assets/photos/      # 실내 사진 (있으면)

# 2) 파이프라인: 검증·정렬 → 노이즈 정리 → 벽/기둥 복원
python3 scripts/inspect_scan.py           # reports/scan_analysis.md, screenshots/diag_*.png
python3 scripts/clean_scan.py             # reports/clean_log.md  (--keep/--drop ID 로 되돌리기)
python3 scripts/reconstruct_room.py       # 벽/기둥 평면 검출 (reports/geometry_assumptions.md, screenshots/recon_footprint.png)
python3 scripts/flatten_scan.py           # ② 평탄화: 정점을 검출 평면에 스냅 (scan_cleaned_raw.glb 보관)
python3 scripts/reconstruct_room.py       # ③ 텍스처 베이크: 평탄화 스캔 색을 벽·기둥·바닥·천장에 입힘 (--no-bake 면 회색 박스)
#    사진으로 창이 없는 벽은:  --no-window wall_x_0 --no-window wall_x_1  (메타데이터에 기억됨)
#    스캔이 빈 바닥/천장은 벽 경계까지 최대 1 m 자동으로 메움. 벽 끝은 직교 벽까지 연장(모서리 틈 제거)
#    사진으로 확인한 값이 있으면:  --chair-rail 0.92 --baseboard 0.08 --central-column wide_column_3

# 3) 뷰어
npm run dev                               # 터미널에 뜨는 http://localhost:5173/ 을 Chrome 에서 열기
```

정적 서버로 보려면 `npm run build` 후 `cd dist && python3 -m http.server 8000` → `http://localhost:8000/`.
(Vite 가 출력하는 포트를 그대로 쓰면 된다. 8000 을 강제하지 않는다.)

## 폰·아이패드에서 보기 (호스팅)
- **claude.ai 아티팩트(비공개, 로그인 필요)**: https://claude.ai/artifact/GzKU6De3CW6SuNwK2Tmt8M — 모델을 base64 텍스트로 묶은 빌드(`VITE_MODEL_B64=1`). GLB 내보내기 버튼은 이 환경에선 동작하지 않는다.
- **GitHub Pages(공개 URL)**: 저장소 Settings → Pages → Source "Deploy from a branch" → Branch `claude/blissful-gauss-qzpvom`, 폴더 `/ (root)` → Save.
  몇 분 뒤 `https://85mighty.github.io/senba-ops/kobe-interior/kobe-gallery-3d/app/` 에서 열린다 (app/ 이 ../assets/models 를 상대경로로 읽으므로 브랜치 루트 배포여야 한다).

## 뷰어 사용법
| 버튼/옵션 | 동작 |
|---|---|
| ① 원본 스캔 / ② 노이즈 정리 / ③ 공간 보정 / ④ 인테리어 A안 | 모델 전환. **카메라는 유지**되어 전후 비교 가능. ②는 떠 있는 조각 제거 + 벽·바닥·기둥 평면 스냅, ③은 평면 모델에 스캔 텍스처를 구워 입힌 것 |
| 북마크 | 메인·전체(위)·창가·입구·주방(설비 후보)·큰 기둥 — 메타데이터에서 자동 계산 |
| 천장 숨기기 / 단면 높이 | 클리핑 평면으로 위에서 내려다보기 |
| 치수 표시 | 가로·세로·천장고 + 요소별 footprint (초록=measured, 주황=inferred) |
| ③④에서 정리 스캔 겹쳐 보기 | 복원 벽이 스캔과 어긋나는지 반투명으로 확인 |
| 레이어 토글 | 몰딩 / 4면 거울 / 골드 액자 / 트랙 조명 / 가구 / 하단 화이트 패널(옵션) / 와인 포인트 벽(옵션) |
| 거울 | 높이·여백 슬라이더, **환경맵**(가벼움, 기본) ↔ **실시간 반사**(Reflector, 면당 1회 추가 렌더 — 4면=4회, 모바일 비권장) |
| 기둥 클릭 → 거울 대상 변경 | 복원 모델의 기둥을 클릭해 중앙 넓은 기둥을 바꾼다 (브라우저에 저장). 확정 시 `--central-column ID` 로 재생성 |
| 가구 클릭 → 이동 | G 이동 / R 회전 / Esc 해제. ‘가구 배치 JSON 복사’ 로 좌표 추출 |
| interior_A.glb 내보내기 | 복원 모델 + 현재 켜진 인테리어 레이어를 GLB 로 다운로드 |

로딩 실패 시 왼쪽 아래에 **원인별 메시지**(404·경로 불일치 / GLB 파싱 / JS 예외)가 뜬다. 검은 화면으로 멈추지 않는다.

## 인테리어 편집 (편집 모드)
패널 아래 **인테리어 편집 → 편집 모드**를 켜면 ③/④ 화면에서 면과 소품을 클릭해 바꿀 수 있다. 모든 변경은 이 브라우저에 자동 저장된다.

| 대상 | 선택 | 할 수 있는 것 |
|---|---|---|
| 벽 (벽 1, 벽 2…) | 클릭 또는 번호 칩 | 분할(1~8등분 → 벽 3-2 처럼 세그먼트별 색), 칠할 영역(전체/띠 위/띠 아래), 색(팔레트·직접 선택), 스캔 텍스처 끄기, 몰딩 on/off, 액자 on/off·개수·틀(골드/블랙/화이트/우드), 창 추가 |
| 기둥 (기둥 1…) | 클릭/칩 | **실측 가로·세로 입력(cm)** 과 위치 보정 → 모델·거울·몰딩이 따라감, 거울 on/off·면 선택(동서남북), 색, 몰딩 |
| 천장 | '천장' 칩 또는 실내에서 천장 클릭 | 내부 천장 하나(기본 흰색). 색 팔레트에 '스캔 원본'도 있음. **위에서 내려다보면 자동으로 투명**, 실내 시점에서 올려다볼 때만 천장이 보임 |
| 바닥 (바닥 1…) | 칩 또는 클릭 | 1.5 m 타일 단위 색 또는 '바닥 전체'(타일 설정을 덮어쓰고 한 번에). 팔레트는 스캔 우드 중간색 기준 밝게/어둡게 프리셋 |
| 창 | 창 클릭/칩 | 시작 위치·폭·상하단 높이(cm), 프레임 색, **커튼**(밤색 등 7색, 양쪽 걷음/전체 닫음), 삭제 |
| 소품 | '소품 놓기' 버튼 → 바닥 클릭 | 이젤(+캔버스), 작업 테이블, 스툴, 벤치, 전시 좌대, 화분, 파티션, 러그, 접수 카운터, 안내판, 펜던트 조명. 드래그 이동, 회전·크기·색, 복제/삭제(Delete) |
| 📍 랜드마크 | 핀 클릭 | 입구·주방·화장실·창가·메인 핀을 드래그해 실제 위치로 → 북마크가 따라감 |
| 띠·몰딩·하부 벽 (전체) | 편집 패널 '띠 · 몰딩 · 하부 벽' | 검은 띠·걸레받이 색(원목·화이트·골드 등)과 형태(평면/액자 몰드), 흰 몰딩 색, 띠 사이 하부 벽 마감(원목 패널·단색) |
| 소품 빠른 조작 | 소품 선택 시 화면 아래 떠 있는 바 | 회전 ±15°, 복제, 삭제, 선택 해제 (패널을 스크롤하지 않아도 됨) |
| 숨기기 | 면 선택 후 '숨기기' 버튼 | 벽·기둥·천장 번호별 숨김/보이기, '숨긴 면' 칩으로 복원, 모두 보이기. **시야 가리는 벽·천장 자동 숨김**을 켜면 카메라 앞의 벽이 저절로 사라짐 (천장은 이 옵션과 무관하게 위에서 볼 때 항상 투명) |
| 도구 | | 거리 재기(두 점 클릭), 화면 캡처 PNG 저장, 번호 라벨 표시 |
| 저장 | | **저장**(⌘/Ctrl+S)·**되돌리기**(⌘/Ctrl+Z)·다시 실행·저장본으로 복원, 창 기본값 재설정, 슬롯 A/B/C, JSON 내보내기/불러오기(다른 기기로 옮길 때), 초기화 |

디자인 파일은 `src/design.js` 의 스키마(JSON)로, 면 설정 `surfaces`, 기둥 `columns`, 창 `windows`, 소품 `props`, 랜드마크 `landmarks` 를 담는다.

## 파일 구조
```
assets/original/     Scaniverse ZIP (수정 금지) — 풀린 폴더는 .gitignore
assets/photos/       실내 사진 (사용자가 복사)
assets/models/       scan_original.glb · scan_cleaned.glb · reconstructed_room.glb  (같은 월드 좌표)
src/                 main.js(UI) · viewer.js(씬/로더/모드) · interior.js(A안 절차 생성) · editor.js(편집기) · design.js(디자인 상태) · props.js(소품·창·커튼) · geometry_metadata.json
scripts/             inspect_scan.py · clean_scan.py · reconstruct_room.py · make_synthetic_scan.py(테스트용) · browser_test.mjs
reports/             scan_analysis.md · clean_log.md/json · geometry_assumptions.md · construction_checklist.md
screenshots/         진단 그림 + 브라우저 캡처
```

## 좌표·상태 규약
- 뷰어 월드: **+Y 위, 바닥 y=0, 벽은 X/Z 축 정렬, 단위 m**. 원본→월드 4×4 변환은 `geometry_metadata.json › alignment_transform`.
- 요소 상태: `measured`(스캔 평면 적합) / `observed`(사진으로 확인, 치수 추정) / `inferred`(불명확 — 실측 필수).
  창·문은 스캔 공백에서 추정하므로 항상 `inferred` 로 시작한다.
- 노이즈 정리 원칙: 바닥·천장·외벽에 **접한 컴포넌트는 절대 삭제하지 않음**. 작고 떠 있는 것만 제거, 전부 `clean_log.json` 에 기록.

## 검증
```bash
npm run build && npm run test:browser     # Chromium 헤드리스: 404/콘솔 오류, 4모드 렌더, 토글·북마크, 캡처
```
합성 데이터 기준 통과 로그·캡처는 `screenshots/mode_*.png`, `interior_*.png`.

## 한계·주의
- 천장고는 수평면 면적 피크로 잡는다. 천장이 일부만 스캔되면 틀릴 수 있다 → `scan_analysis.md` 의 히스토그램 확인.
- 외벽은 bbox 가장자리 근처의 긴 수직 평면만 잡는다. L자형 평면은 내부 벽이 `partition` 으로 잡힐 수 있다.
- 유리·거울·검은 표면은 LiDAR 가 비는 경우가 많다 → 사진으로 `openings` 보정.
- Blender 는 사용하지 않았다(의존성 최소화). 텍스처 베이크가 필요하면 추가.
