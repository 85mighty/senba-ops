// 주방·화장실 설비 — 복원 때 상자/벽으로 뭉개진 부분을 사진(07·08·10·11)과 원본 스캔 위치대로 다시 만든다.
// 위치·치수는 geometry_metadata.json 의 kitchen / door_openings (observed: 사진 확인, 치수는 스캔 추정).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
// 월드 범위로 상자 만들기
function boxAt(g, x, y, z, mat, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x[1] - x[0], y[1] - y[0], z[1] - z[0]), mat);
  m.position.set((x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2); if (name) m.name = name; g.add(m); return m;
}
// 흰 타일(10 cm, 회색 줄눈) — UV 를 m 단위로 늘려 반복
let tileTex = null;
function tileMaterial() {
  if (!tileTex) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d');
    c.fillStyle = '#c9cdcf'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#f1f3f2'; c.fillRect(2, 2, 61, 61);
    const gr = c.createLinearGradient(0, 0, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(200,210,214,0.25)'); c.fillStyle = gr; c.fillRect(2, 2, 61, 61);
    tileTex = new THREE.CanvasTexture(cv); tileTex.colorSpace = THREE.SRGBColorSpace; tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  }
  return new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2 });
}
function tilePlane(g, w, h, pos, rotY, mat) {
  const geo = new THREE.PlaneGeometry(w, h); const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 0.1, uv.getY(i) * h / 0.1);
  const m = new THREE.Mesh(geo, mat); m.position.copy(pos); m.rotation.y = rotY; g.add(m); return m;
}

// 경첩(pivot)에 열림·닫힘 각도를 달아 둔다 — 화면에서 문을 누르면 Editor.toggleDoor 가 돌린다
function hinge(pivot, closed, open, isOpen, name) {
  pivot.name = name; pivot.userData.swing = { closed, open, isOpen }; pivot.rotation.y = isOpen ? open : closed;
  pivot.traverse((o) => { o.userData.doorPivot = pivot; });
}

export function buildFixtures(meta) {
  const root = new THREE.Group(); root.name = 'fixtures'; const ceil = meta.ceiling_height_m || 2.38;
  const k = meta.kitchen;
  if (k) {
    const g = new THREE.Group(); g.name = 'kitchen'; root.add(g); g.userData.surface = 'kitchen';
    const gray = std(0xa9a59f, { roughness: 0.9 }), black = std(0x1c1c1c), cream = std(0xece5d3, { roughness: 0.5 }), gold = std(0xc9a24a, { metalness: 0.7, roughness: 0.35 });
    const steel = std(0xc3c6c8, { metalness: 0.65, roughness: 0.3 }), dark = std(0x55595c, { metalness: 0.5, roughness: 0.35 }), seam = std(0x6d6a63);
    // 주방 입구 위 하부 벽(소핏) + 커튼 레일
    const o = k.opening; boxAt(g, o.x, [o.soffit_y, ceil], [o.z - 0.07, o.z + 0.07], gray, 'kitchen_soffit'); boxAt(g, o.x, [o.soffit_y - 0.02, o.soffit_y], [o.z, o.z + 0.05], steel);
    // 수납 코너 안쪽 벽(회색 벽지 + 걸레받이)
    const nx = k.nook_x, nz = k.nook_back_z; boxAt(g, [nx[0], nx[1] - 0.05], [0, ceil], [nz, nz + 0.1], gray, 'kitchen_nook_wall'); boxAt(g, [nx[0], nx[1] - 0.05], [0, 0.08], [nz - 0.012, nz], black);
    // 싱크대 하부장: 몸통·걸레받이·문 2짝(+X 쪽)·서랍 3단(−X 쪽)·금색 손잡이
    const s = k.sink, top = s.h, fz = s.z[0];
    boxAt(g, s.x, [0.08, top - 0.02], [fz + 0.02, s.z[1]], cream, 'kitchen_sink_cabinet'); boxAt(g, s.x, [0, 0.08], [fz + 0.07, s.z[1]], black);
    const split = s.x[1] - (s.x[1] - s.x[0]) * 0.49, mid = (split + s.x[1]) / 2;
    for (const x of [split, mid]) boxAt(g, [x - 0.003, x + 0.003], [0.08, top - 0.02], [fz + 0.012, fz + 0.022], seam);
    for (const y of [0.34, 0.58]) boxAt(g, [s.x[0], split], [y - 0.003, y + 0.003], [fz + 0.012, fz + 0.022], seam);
    for (const y of [0.31, 0.55, 0.78]) boxAt(g, [s.x[0] + 0.03, split - 0.03], [y - 0.008, y + 0.008], [fz + 0.002, fz + 0.022], gold);   // 서랍 금색 띠 손잡이
    for (const x of [mid - 0.05, mid + 0.05]) boxAt(g, [x - 0.035, x + 0.035], [0.72, 0.74], [fz, fz + 0.022], gold);
    // 스테인리스 상판 + 개수대 + 뒤턱 + 수전
    boxAt(g, [s.x[0] - 0.02, s.x[1] + 0.02], [top - 0.02, top + 0.01], [fz - 0.02, s.z[1]], steel, 'kitchen_counter');
    boxAt(g, [s.x[0] - 0.02, s.x[1] + 0.02], [top + 0.01, top + 0.06], [s.z[1] - 0.03, s.z[1]], steel);
    boxAt(g, s.bowl_x, [top + 0.011, top + 0.013], [fz + 0.08, s.z[1] - 0.09], dark, 'kitchen_bowl');
    for (const x of [(s.bowl_x[0] + s.bowl_x[1]) / 2, s.bowl_x[0] - 0.3]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 10), steel); p.rotation.x = Math.PI / 2; p.position.set(x, top + 0.2, s.z[1] - 0.08); g.add(p);
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 10), steel); h.position.set(x, top + 0.24, s.z[1] - 0.03); g.add(h);
    }
    // 타일: 싱크대 뒤 벽(상판 위) + 오른쪽 타일 기둥 면(바닥부터)
    const tm = tileMaterial(); const tt = k.tile_top;
    tilePlane(g, s.x[1] - s.x[0] + 0.04, tt - top, new THREE.Vector3((s.x[0] + s.x[1]) / 2, (top + tt) / 2, s.z[1] - 0.004), Math.PI, tm);
    const wx = s.x[0] - 0.018, zlen = s.z[1] - nz; tilePlane(g, zlen, tt, new THREE.Vector3(wx, tt / 2, nz + zlen / 2), Math.PI / 2, tm);
    // 수납 코너: 올리브색 카운터(받침 없이 벽에 고정) · 박스 · 회색 장 · 나무 선반
    const c = k.counter; boxAt(g, c.x, [c.h - 0.03, c.h], c.z, std(0x7b8064, { roughness: 0.5 }), 'kitchen_side_counter');
    boxAt(g, [c.x[0] + 0.06, c.x[1] - 0.06], [0, 0.3], [c.z[0] + 0.08, c.z[1] - 0.03], std(0xa67c4e, { roughness: 0.95 }), 'kitchen_box');
    const cb = k.cabinet; boxAt(g, cb.x, [0, cb.h], cb.z, std(0x8e9194, { roughness: 0.7 }), 'kitchen_gray_cabinet');
    boxAt(g, [nx[0] + 0.05, nx[0] + 0.55], [1.93, 1.96], [nz - 0.2, nz], std(0xcfae7a, { roughness: 0.8 }), 'kitchen_shelf');
  }
  for (const d of meta.door_openings || []) {
    const wall = (meta.elements || []).find((e) => e.id === d.wall); if (!wall || wall.axis !== 'z') continue;   // 현재는 X 방향 벽(z=상수)만
    const g = new THREE.Group(); g.name = 'toilet_door'; root.add(g); g.userData.surface = 'toilet';
    const frameM = std(0x8b8e90, { metalness: 0.3, roughness: 0.45 }), leafM = std(0x63666a, { metalness: 0.45, roughness: 0.38 }), steel = std(0xc3c6c8, { metalness: 0.7, roughness: 0.3 });
    const z0 = wall.offset - 0.07, z1 = wall.offset + 0.07, jt = 0.035;
    boxAt(g, [d.from, d.from + jt], [0, d.y1], [z0, z1], frameM); boxAt(g, [d.to - jt, d.to], [0, d.y1], [z0, z1], frameM); boxAt(g, [d.from, d.to], [d.y1 - jt, d.y1], [z0, z1], frameM);
    // 문짝: 경첩 쪽(from)에서 방 쪽으로 열림(기본 열린 상태). 닫으면 문틀 안에 들어간다
    const lw = d.to - d.from - 2 * jt - 0.006, lh = d.y1 - jt - 0.015, t = 0.04, side = d.room_side || -1;
    const pivot = new THREE.Group(); pivot.position.set(d.from + jt, 0, side < 0 ? z0 : z1); g.add(pivot); const lz = -side * t / 2;
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(lw, lh, t), leafM); leaf.position.set(lw / 2, 0.01 + lh / 2, lz); pivot.add(leaf);
    for (const sz of [-1, 1]) { const lev = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.018), steel); lev.position.set(lw - 0.1, 0.98, lz + sz * (t / 2 + 0.03)); pivot.add(lev); const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 14), steel); rose.rotation.x = Math.PI / 2; rose.position.set(lw - 0.06, 0.98, lz + sz * (t / 2 + 0.008)); pivot.add(rose); }
    const closer = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.06), std(0x2b2b2b)); closer.position.set(0.2, lh - 0.04, lz + side * (t / 2 + 0.03)); pivot.add(closer);
    hinge(pivot, 0, side * -(d.swing_deg ?? 70) * Math.PI / 180, true, 'toilet_door_leaf');
    // 안쪽: 벽걸이 세면대(왼쪽 벽) + 안쪽 칸막이 문(오른쪽 벽) — 사진 11
    const inner = (meta.elements || []).filter((e) => e.type === 'wall' && e.axis === 'x' && e.from <= wall.offset + 0.1 && e.to > wall.offset + 1.0 && e.offset > d.from - 0.3 && e.offset < d.to + 0.6);
    const right = inner.reduce((a, e) => (!a || e.offset < a.offset ? e : a), null), left = inner.reduce((a, e) => (!a || e.offset > a.offset ? e : a), null);
    const st = meta.toilet_stall;
    if (left && left !== right) { const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std(0xb8bbbd, { metalness: 0.5, roughness: 0.3, side: THREE.DoubleSide })); bowl.scale.y = 0.55; bowl.position.set(left.offset - 0.05 - 0.17, 0.82, st?.basin_z ?? wall.offset + 0.62); g.add(bowl); }
    if (right) {
      const dz = st?.door_z || [wall.offset + 0.64, wall.offset + 1.29], wf = right.offset, ft = 0.03, brown = std(0x5a3d28, { roughness: 0.6 });
      boxAt(g, [wf - 0.1, wf + 0.02], [0, 1.88], [dz[0], dz[0] + ft], brown); boxAt(g, [wf - 0.1, wf + 0.02], [0, 1.88], [dz[1] - ft, dz[1]], brown); boxAt(g, [wf - 0.1, wf + 0.02], [1.85, 1.88], dz, brown);
      const sw = dz[1] - dz[0] - 2 * ft - 0.006, sh = 1.82, stt = 0.035;
      const sp = new THREE.Group(); sp.position.set(wf, 0, dz[1] - ft); g.add(sp);   // 경첩: 안쪽 끝, 세면실 쪽 면
      const sl = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, stt), std(0x9b968d, { roughness: 0.5 })); sl.position.set(sw / 2, 0.02 + sh / 2, -stt / 2); sp.add(sl);
      const kn = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), steel); kn.position.set(sw - 0.07, 0.95, 0.02); sp.add(kn);
      hinge(sp, Math.PI / 2, Math.PI / 2 - 1.25, false, 'stall_door_leaf');
    }
    // 양변기 칸(Polycam 스캔 확인 — Scaniverse 에는 비어 있던 곳): 베이지 벽·바닥 + 양변기(물탱크는 큰방 쪽 벽)
    if (st) {
      const beige = std(0xe4d6bb, { roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }), white = std(0xf3f1ec, { roughness: 0.25 });
      boxAt(g, st.x, [0, 0.004], st.z, std(0xd8c6a2, { roughness: 0.9 }), 'toilet_stall_floor');
      boxAt(g, st.x, [0, ceil], [st.z[1], st.z[1] + 0.1], beige, 'toilet_stall_back');
      boxAt(g, [st.x[0], st.x[0] + 0.004], [0, ceil], st.z, beige); const dz = st.door_z; if (dz) { boxAt(g, [st.x[1] - 0.004, st.x[1]], [0, ceil], [st.z[0], dz[0]], beige); boxAt(g, [st.x[1] - 0.004, st.x[1]], [0, ceil], [dz[1], st.z[1]], beige); boxAt(g, [st.x[1] - 0.004, st.x[1]], [1.88, ceil], dz, beige); } else boxAt(g, [st.x[1] - 0.004, st.x[1]], [0, ceil], st.z, beige); boxAt(g, st.x, [0, ceil], [st.z[0], st.z[0] + 0.004], beige);
      const cx = (st.x[0] + st.x[1]) / 2, z0 = st.z[0] + 0.005;
      boxAt(g, [cx - 0.19, cx + 0.19], [0.42, 0.82], [z0, z0 + 0.19], white, 'toilet_wc_tank');
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.36, 18), white); base.scale.z = 1.35; base.position.set(cx, 0.18, z0 + 0.42); g.add(base);
      const seat = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 8, 20), white); seat.rotation.x = Math.PI / 2; seat.scale.y = 1.35; seat.position.set(cx, 0.4, z0 + 0.45); g.add(seat);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 20), std(0xeceae4, { roughness: 0.3 })); lid.scale.z = 1.3; lid.position.set(cx, 0.43, z0 + 0.45); g.add(lid);
      boxAt(g, [st.x[0] + 0.004, st.x[0] + 0.03], [0.68, 0.74], [z0 + 0.5, z0 + 0.64], steel);   // 휴지걸이
    }
  }
  root.traverse((m) => { if (m.isMesh) m.userData.surface = m.parent?.userData.surface || 'fixture'; });
  return root;
}

// 스캔 복원 벽(상자·텍스처 면·띠)에 문 구멍을 낸다. 축정렬 상자/사각면만 대상 — 조각(왼·오·위·아래)으로 나눠 다시 붙인다.
// axis: 벽 축('z' = 벽이 X 방향으로 뻗음 → 길이방향 t = x). 텍스처 UV 는 (t, y) 의 1차식으로 다시 계산.
export function cutWallOpening(mesh, axis, t0, t1, y0, y1) {
  mesh.updateWorldMatrix(true, false); const mw = mesh.matrixWorld, inv = mw.clone().invert();
  const src = mesh.geometry; const pos = src.attributes.position; const n = pos.count; const ti = axis === 'z' ? 0 : 2;
  const P = []; const v = new THREE.Vector3(); let tmin = Infinity, tmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mw); P.push(v.clone()); const t = v.getComponent(ti); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); ymin = Math.min(ymin, v.y); ymax = Math.max(ymax, v.y); }
  if (t1 <= tmin || t0 >= tmax || y1 <= ymin || y0 >= ymax) return false;
  const a = Math.max(t0, tmin), b = Math.min(t1, tmax), c = Math.max(y0, ymin), d = Math.min(y1, ymax);
  const pieces = [];
  if (a > tmin + 1e-3) pieces.push([tmin, a, ymin, ymax]); if (b < tmax - 1e-3) pieces.push([b, tmax, ymin, ymax]);
  if (d < ymax - 1e-3) pieces.push([a, b, d, ymax]); if (c > ymin + 1e-3) pieces.push([a, b, ymin, c]);
  // UV = 1차식(t, y) 맞춤 (텍스처가 있을 때만)
  const uvA = src.attributes.uv; const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material; let fit = null;
  if (uvA && mat?.map) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bu = [0, 0, 0], bv = [0, 0, 0];
    for (let i = 0; i < n; i++) { const r = [1, P[i].getComponent(ti), P[i].y]; for (let p = 0; p < 3; p++) { for (let q = 0; q < 3; q++) A[p][q] += r[p] * r[q]; bu[p] += r[p] * uvA.getX(i); bv[p] += r[p] * uvA.getY(i); } }
    const solve = (M, y) => { const m = M.map((row, i) => [...row, y[i]]); for (let i = 0; i < 3; i++) { let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r; [m[i], m[p]] = [m[p], m[i]]; if (Math.abs(m[i][i]) < 1e-12) return null; for (let r = 0; r < 3; r++) if (r !== i) { const f = m[r][i] / m[i][i]; for (let q = i; q < 4; q++) m[r][q] -= f * m[i][q]; } } return m.map((row, i) => row[3] / row[i]); };
    const cu = solve(A, bu), cv = solve(A, bv); if (cu && cv) fit = (t, y) => [cu[0] + cu[1] * t + cu[2] * y, cv[0] + cv[1] * t + cv[2] * y];
  }
  const geos = pieces.map(([p0, p1, q0, q1]) => {
    const g = src.clone(); const gp = g.attributes.position;
    for (let i = 0; i < n; i++) {
      const w = P[i].clone(); const t = w.getComponent(ti);
      const nt = p0 + (tmax > tmin ? (t - tmin) / (tmax - tmin) : 0) * (p1 - p0), ny = q0 + (ymax > ymin ? (w.y - ymin) / (ymax - ymin) : 0) * (q1 - q0);
      w.setComponent(ti, nt); w.y = ny; if (fit) g.attributes.uv.setXY(i, ...fit(nt, ny)); w.applyMatrix4(inv); gp.setXYZ(i, w.x, w.y, w.z);
    }
    return g;
  });
  const old = mesh.geometry;
  if (!geos.length) { mesh.visible = false; mesh.userData.keepVisible = false; return true; }
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos); if (!merged) return false;
  merged.computeBoundingBox(); merged.computeBoundingSphere(); mesh.geometry = merged; old.dispose(); if (geos.length > 1) geos.forEach((g) => g.dispose());
  return true;
}

// 통로 커튼(이케아 사진처럼 검은 봉 + 짙은 회색 암막 커튼): 벽 면(face_x) 바깥에 봉, 주름 진 한 장을 한쪽으로 걷는다.
// 경첩 대신 '접는 축'(gather 쪽 끝)을 기준으로 가로 비율(scale.x)을 줄였다 늘렸다 — Editor.toggleDoor 가 같은 방식으로 움직인다
export function buildPassCurtain(d, isOpen, onToggle) {
  const g = new THREE.Group(); g.name = 'pass_curtain'; const dir = d.face_dir || 1, x0 = d.face_x, top = d.y1 + 0.07;
  const z0 = d.from - 0.02, z1 = d.to + 0.02, W = z1 - z0, H = top - 0.03;
  const iron = std(0x161616, { metalness: 0.5, roughness: 0.4 });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, W + 0.06, 12), iron); rod.rotation.x = Math.PI / 2; rod.position.set(x0 + dir * 0.075, top, (z0 + z1) / 2); g.add(rod);
  for (const z of [z0 - 0.01, z1 + 0.01]) { const br = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.02), iron); br.position.set(x0 + dir * 0.04, top, z); g.add(br); const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 14), iron); fin.rotation.x = Math.PI / 2; fin.position.set(x0 + dir * 0.075, top, z + (z < (z0 + z1) / 2 ? -0.03 : 0.03)); g.add(fin); }
  // 주름 판: 로컬 x 0…W, 로컬 z 로 주름 깊이. 접는 축은 gather 쪽 끝
  const seg = 48, geo = new THREE.PlaneGeometry(W, H, seg, 1); const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const u = pos.getX(i) + W / 2; pos.setX(i, u); pos.setZ(i, Math.sin((u / W) * Math.PI * 14) * 0.025); }
  geo.computeVertexNormals();
  const panel = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: d.curtain?.color || '#5c5955', roughness: 0.95, side: THREE.DoubleSide })); panel.position.y = 0.03 + H / 2;
  const toEnd = (d.curtain?.gather || 'to') === 'to'; const pivot = new THREE.Group(); pivot.name = 'pass_curtain_panel'; pivot.add(panel);
  // 로컬 +x 가 접는 축에서 반대쪽 끝으로 향하게: to 끝에서 −Z 로 = 회전 +90°, from 끝에서 +Z 로 = −90°
  pivot.position.set(x0 + dir * 0.06, 0, toEnd ? z1 : z0); pivot.rotation.y = toEnd ? Math.PI / 2 : -Math.PI / 2; g.add(pivot);
  pivot.userData.swing = { kind: 'scale', closed: 1, open: 0.18, isOpen, onToggle, label: '주방 통로 커튼' }; pivot.scale.x = isOpen ? 0.18 : 1;
  pivot.traverse((o) => { o.userData.doorPivot = pivot; }); g.traverse((o) => { if (o.isMesh) o.userData.surface = 'curtain'; });
  return g;
}
