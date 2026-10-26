"""Phase 2 — 스캔 노이즈 정리 (되돌릴 수 있게).

원칙: 일괄 임계값으로 지우지 않는다. 컴포넌트마다 (삼각형 수, 면적, bbox 대각, 주 구조와의 거리,
바닥/천장/외벽 접촉 여부) 를 계산해 '작고 + 주 구조에서 떨어져 떠 있는' 것만 제거한다.
큰 컴포넌트, 바닥/벽에 붙은 컴포넌트는 크기가 작아도 유지한다.

사용: python3 scripts/clean_scan.py [--input ...] [--min-faces 200] [--min-area 0.02] [--detach 0.08]
       [--keep ID,ID] [--drop ID,ID]   ← 로그 보고 수동 보정
출력: assets/models/scan_cleaned.glb, reports/clean_log.json, reports/clean_log.md
"""
import argparse
import json

import numpy as np
import trimesh

import common as C


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input")
    ap.add_argument("--min-faces", type=int, default=200, help="이보다 삼각형이 적으면 '작은' 후보")
    ap.add_argument("--min-area", type=float, default=0.02, help="m² — 이보다 면적이 작으면 '작은' 후보")
    ap.add_argument("--detach", type=float, default=0.08, help="m — 주 구조 표면에서 이보다 멀면 '떠 있음'")
    ap.add_argument("--keep", default="", help="강제 유지 컴포넌트 ID (쉼표)")
    ap.add_argument("--drop", default="", help="강제 삭제 컴포넌트 ID (쉼표)")
    args = ap.parse_args()

    meta = C.load_meta()
    if "alignment_transform" not in meta:
        raise SystemExit("먼저 inspect_scan.py 를 실행해 정렬 변환을 만들어 주세요.")
    T = np.array(meta["alignment_transform"])
    mesh = C.load_mesh(C.find_input(args.input))
    mesh.apply_transform(T)
    ceil = meta.get("ceiling_height_m") or float(mesh.bounds[1][1])
    bmin, bmax = mesh.bounds

    # 컴포넌트 라벨 (face 단위) — visual(UV) 보존을 위해 서브메쉬 대신 face mask 사용
    # OBJ 는 텍스처 좌표가 다른 정점이 분리돼 있어 그대로 두면 한 벽이 수천 조각으로 보인다.
    # 연결성 판정만 위치 기준으로 정점을 합친 복사본에서 계산하고, 내보내는 메쉬(UV)는 건드리지 않는다.
    conn = mesh.copy(); conn.merge_vertices(merge_tex=True, merge_norm=True)
    assert len(conn.faces) == len(mesh.faces), "merge_vertices 가 면 수를 바꿈"
    labels = trimesh.graph.connected_component_labels(conn.face_adjacency, node_count=len(mesh.faces))
    ids, counts = np.unique(labels, return_counts=True)
    main_id = ids[np.argmax(counts)]
    main_mask = labels == main_id
    # 주 구조 표면까지의 거리: 주 컴포넌트의 정점+삼각형 중심 KD-tree (rtree 불필요, 조밀 스캔에선 충분)
    from scipy.spatial import cKDTree
    main_pts = np.vstack([mesh.vertices[np.unique(mesh.faces[main_mask])], mesh.triangles_center[main_mask]])
    tree = cKDTree(main_pts)

    keep_force = {int(x) for x in args.keep.split(",") if x.strip()}
    drop_force = {int(x) for x in args.drop.split(",") if x.strip()}
    log, drop_mask = [], np.zeros(len(mesh.faces), bool)
    area_faces = mesh.area_faces
    for cid, cnt in zip(ids, counts):
        if cid == main_id:
            log.append({"id": int(cid), "faces": int(cnt), "decision": "keep", "reason": "주 구조(최대 컴포넌트)"}); continue
        fmask = labels == cid
        tri = mesh.triangles[fmask]
        pts = tri.reshape(-1, 3)
        area = float(area_faces[fmask].sum())
        lo, hi = pts.min(0), pts.max(0)
        diag = float(np.linalg.norm(hi - lo))
        sample = pts[np.random.default_rng(0).choice(len(pts), min(len(pts), 64), replace=False)]
        dist = float(np.median(tree.query(sample)[0]))
        touches_floor = lo[1] < 0.05
        touches_ceil = hi[1] > ceil - 0.08
        touches_outer = bool((lo[0] < bmin[0] + 0.05) | (lo[2] < bmin[2] + 0.05) | (hi[0] > bmax[0] - 0.05) | (hi[2] > bmax[2] - 0.05))
        small = cnt < args.min_faces or area < args.min_area          # 작다 (둘 중 하나)
        biggish = cnt >= 5 * args.min_faces and area >= 0.5            # 가구·설비일 가능성 — 떠 있어도 유지
        touching = touches_floor or touches_ceil or touches_outer
        floating = dist > args.detach and not touching
        if cid in keep_force:
            decision, reason = "keep", "수동 유지"
        elif cid in drop_force:
            decision, reason = "drop", "수동 삭제"
        elif floating and not biggish:
            decision, reason = "drop", f"떠 있음(주 구조와 {dist:.2f}m, 바닥/천장/외벽 미접촉) · {cnt}면 {area:.3f}m²"
        elif small and dist > 0.5 and not touching:
            decision, reason = "drop", f"작음 + 주 구조에서 {dist:.2f}m 이격 + 미접촉"
        elif floating and biggish:
            decision, reason = "keep", f"떠 있지만 큼({cnt}면 {area:.2f}m²) — 가구/설비 가능, 검토 필요"
        else:
            decision, reason = "keep", ("크기 충분" if not small else "작지만 구조에 접함/붙어 있음")
        if decision == "drop":
            drop_mask |= fmask
        log.append({"id": int(cid), "faces": int(cnt), "area_m2": round(area, 4), "bbox_diag_m": round(diag, 3),
                    "dist_to_main_m": round(dist, 3), "touches": {"floor": bool(touches_floor), "ceiling": bool(touches_ceil), "outer": touches_outer},
                    "decision": decision, "reason": reason})

    cleaned = mesh.copy()
    cleaned.update_faces(~drop_mask)
    cleaned.remove_unreferenced_vertices()
    C.export_glb(cleaned, "scan_cleaned.glb")

    dropped = [l for l in log if l["decision"] == "drop"]
    out = {"params": vars(args), "faces_before": int(len(mesh.faces)), "faces_after": int(len(cleaned.faces)),
           "components_total": int(len(ids)), "components_dropped": len(dropped), "components": log}
    (C.REPORTS_DIR / "clean_log.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    md = ["# 노이즈 정리 로그 (Phase 2)", "",
          f"- 임계값: min_faces={args.min_faces}, min_area={args.min_area} m², detach={args.detach} m",
          f"- 삼각형 {len(mesh.faces):,} → {len(cleaned.faces):,} (제거 {drop_mask.sum():,})",
          f"- 컴포넌트 {len(ids):,} 중 {len(dropped):,} 제거", "",
          "되돌리기: `--keep ID` 로 특정 컴포넌트를 유지, `--drop ID` 로 추가 삭제 후 재실행.", "",
          "## 제거된 컴포넌트 (상위 40)", "", "| ID | 면 | 면적 m² | 이격 m | 이유 |", "|---|---|---|---|---|",
          *[f"| {l['id']} | {l['faces']} | {l['area_m2']} | {l['dist_to_main_m']} | {l['reason']} |" for l in sorted(dropped, key=lambda x: -x["faces"])[:40]],
          "", "## 유지했지만 작은 컴포넌트 (검토 권장)", "", "| ID | 면 | 면적 m² | 이격 m | 접촉 | 이유 |", "|---|---|---|---|---|---|",
          *[f"| {l['id']} | {l['faces']} | {l['area_m2']} | {l['dist_to_main_m']} | {','.join(k for k, v in l['touches'].items() if v) or '-'} | {l['reason']} |"
            for l in log if l["decision"] == "keep" and l.get("faces", 0) < args.min_faces][:40]]
    (C.REPORTS_DIR / "clean_log.md").write_text("\n".join(md), encoding="utf-8")
    meta["clean"] = {"faces_after": int(len(cleaned.faces)), "components_dropped": len(dropped), "params": vars(args)}
    C.save_meta(meta)
    print(f"[정리] 컴포넌트 {len(ids)} → 제거 {len(dropped)} · 보고 reports/clean_log.md")


if __name__ == "__main__":
    main()
