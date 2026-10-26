# 형상 가정·판정 기록 (Phase 3)

| 항목 | 값 | 상태 | 비고 |
|---|---|---|---|
| 천장고 | 3.10 m | measured | 수평면 피크 |
| 체어레일(검은 띠) 높이 | 0.95 m | inferred | `--chair-rail` 로 사진 기준 보정 |
| 걸레받이 높이 | 0.10 m | inferred | `--baseboard` |
| 외벽 두께 | 0.12 m | inferred | 복원용 임의값 |
| 중앙 넓은 기둥 | wide_column_3 | inferred | 뷰어 ‘기둥 선택’으로 확정 |

## 검출 요소

| id | 종류 | 상태 | 위치 |
|---|---|---|---|
| wall_x_0 | wall | measured | x=-4.35, -4.08→4.87 (창/문 후보 0) |
| wall_x_1 | wall | measured | x=4.35, -4.10→4.75 (창/문 후보 0) |
| wall_z_2 | wall | measured | z=-5.04, -1.99→4.25 (창/문 후보 1) |
| wall_z_3 | wall | measured | z=5.01, -4.22→3.42 (창/문 후보 1) |
| thin_column_1 | thin_column | measured | x -2.54~-2.23 · z -2.62~-2.32 · h 0.06~3.04 |
| thin_column_2 | thin_column | measured | x -2.47~-2.16 · z 2.38~2.68 · h 0.06~3.04 |
| wide_column_3 | wide_column | measured | x -0.85~0.75 · z -0.21~0.21 · h 0.06~3.04 |
| thin_column_4 | thin_column | measured | x 2.16~2.47 · z -2.68~-2.38 · h 0.06~3.04 |
| fixture_candidate_5 | fixture_candidate | observed | x 2.79~4.13 · z 3.45~4.06 · h 0.03~0.87 |

## 사진과 다를 때 분류 기준

- **구조 추정 오류**: 스캔에는 면이 있는데 평면 적합이 잘못 묶음 (예: 가구 상판을 벽으로) → `--min-plane-area`·격자 셀 조정, 또는 요소 수동 삭제
- **LiDAR 누락/노이즈**: 유리·거울·검은 표면·가구 뒤는 스캔이 빈다 → `openings`/`fixture_candidate` 는 사진으로 채움
- 창문·문은 **스캔 공백에서 추정**한 것이므로 사진으로 위치·크기 확정 전까지 `inferred`
