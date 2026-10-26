// 인테리어 A안 — 복원 모델의 실제 구조 좌표(geometry_metadata.json) 위에 절차적으로 생성.
// 원래 메쉬는 건드리지 않는다. 레이어별 Group 으로 ON/OFF.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

const WHITE = 0xf4f1ea, GOLD = 0xc9a24a, BLACK = 0x1c1c1c, WINE = 0x7a2e2e;
const FRAME_BAR = 0.045, FRAME_DEPTH = 0.018, FRAME_W_TARGET = 0.9, FRAME_GAP = 0.14, CORNER_MARGIN = 0.18, OPEN_MARGIN = 0.12;

export const LAYERS = ['molding', 'mirror_4_sides', 'gallery_art', 'track_lights', 'furniture', 'panel_white_optional', 'wine_accent_optional'];

export class InteriorA {
  constructor(viewer) {
    this.v = viewer; this.meta = viewer.meta; this.root = viewer.interior;
    this.opts = { mirrorH: 2.2, mirrorInset: 0.05, mirrorMode: 'env', lightI: 1.5, lightK: 3000, central: this.meta.central_wide_column };
    this.layers = {}; for (const k of LAYERS) { this.layers[k] = new THREE.Group(); this.layers[k].name = k; this.root.add(this.layers[k]); }
    this.layers.furniture.visible = false; this.layers.panel_white_optional.visible = false; this.layers.wine_accent_optional.visible = false;
    this.furniturePlacements = null;
    this.buildAll();
  }
  get ceil() { return this.meta.ceiling_height_m || 3.0; }
  get chair() { return this.meta.chair_rail_height_m || 0.95; }
  get base() { return this.meta.baseboard_height_m || 0.10; }
  walls() { return (this.meta.elements || []).filter((e) => e.type === 'wall'); }
  columns() { return (this.meta.elements || []).filter((e) => ['wide_column', 'thin_column', 'partition'].includes(e.type)); }
  central() { return (this.meta.elements || []).find((e) => e.id === this.opts.central); }

  buildAll() { for (const k of LAYERS) this['build_' + k](); }
  rebuild(layer) { this.layers[layer].clear(); this['build_' + layer](); this.v.setCeilingHidden(this.v.clipping); }
  setLayer(k, on) { this.layers[k].visible = on; }

  // 벽 안쪽 면의 "세그먼트" = 몰딩/액자를 놓을 수 있는 구간 (개구부·모서리 제외)
  wallRuns(w, margin = CORNER_MARGIN) {
    let runs = [[w.from + margin, w.to - margin]];
    for (const o of w.openings || []) {
      const next = [];
      for (const [a, b] of runs) {
        if (o.to + OPEN_MARGIN <= a || o.from - OPEN_MARGIN >= b) { next.push([a, b]); continue; }
        if (o.from - OPEN_MARGIN > a) next.push([a, o.from - OPEN_MARGIN]);
        if (o.to + OPEN_MARGIN < b) next.push([o.to + OPEN_MARGIN, b]);
      }
      runs = next;
    }
    return runs.filter(([a, b]) => b - a > 0.3);
  }
  // 벽면 좌표계: 길이방향 t, 높이 y → 월드. 벽 안쪽에 off 만큼 띄움.
  placeOnWall(obj, w, t, y, off) {
    if (w.axis === 'x') { obj.position.set(w.offset + w.inward * off, y, t); obj.rotation.y = w.inward > 0 ? Math.PI / 2 : -Math.PI / 2; }
    else { obj.position.set(t, y, w.offset + w.inward * off); obj.rotation.y = w.inward > 0 ? 0 : Math.PI; }
  }
  // 기둥 4면 → 가상의 "벽" 객체 배열 (안쪽 법선 = 바깥 방향)
  columnFaces(col) {
    const fx = col.footprint.x, fz = col.footprint.z;
    return [
      { axis: 'x', offset: fx[0], inward: -1, from: fz[0], to: fz[1], openings: [] },
      { axis: 'x', offset: fx[1], inward: 1, from: fz[0], to: fz[1], openings: [] },
      { axis: 'z', offset: fz[0], inward: -1, from: fx[0], to: fx[1], openings: [] },
      { axis: 'z', offset: fz[1], inward: 1, from: fx[0], to: fx[1], openings: [] },
    ];
  }

  frameGeometry(wd, ht) {
    const s = new THREE.Shape(); s.moveTo(-wd / 2, -ht / 2); s.lineTo(wd / 2, -ht / 2); s.lineTo(wd / 2, ht / 2); s.lineTo(-wd / 2, ht / 2); s.closePath();
    const hole = new THREE.Path(); const iw = wd / 2 - FRAME_BAR, ih = ht / 2 - FRAME_BAR;
    hole.moveTo(-iw, -ih); hole.lineTo(iw, -ih); hole.lineTo(iw, ih); hole.lineTo(-iw, ih); hole.closePath(); s.holes.push(hole);
    return new THREE.ExtrudeGeometry(s, { depth: FRAME_DEPTH, bevelEnabled: false }); // 45° 코너는 사각 링 형상에서 자연히 생김
  }
  // ---- 하부 화이트 사각 몰딩 (검은 띠와 걸레받이 사이)
  build_molding() {
    const g = this.layers.molding; const mat = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.55 });
    const yBottom = this.base + 0.08, yTop = this.chair - 0.06 - 0.08; const ht = yTop - yBottom; if (ht < 0.25) return;
    const targets = [...this.walls()]; for (const c of this.columns()) if (c.id !== this.opts.central) targets.push(...this.columnFaces(c));
    let count = 0;
    for (const w of targets) for (const [a, b] of this.wallRuns(w, w.openings ? CORNER_MARGIN : 0.08)) {
      const L = b - a; const n = Math.max(1, Math.floor((L + FRAME_GAP) / (FRAME_W_TARGET + FRAME_GAP))); const wd = (L - FRAME_GAP * (n - 1)) / n;
      if (wd < 0.3) continue;
      for (let i = 0; i < n; i++) {
        const t = a + wd / 2 + i * (wd + FRAME_GAP); const m = new THREE.Mesh(this.frameGeometry(wd, ht), mat); m.name = 'molding_frame';
        this.placeOnWall(m, w, t, yBottom + ht / 2, 0.002); g.add(m); count++;
      }
    }
    g.userData.count = count;
  }
  // ---- 중앙 넓은 기둥 4면 거울
  build_mirror_4_sides() {
    const g = this.layers.mirror_4_sides; const col = this.central(); if (!col) return;
    const y0 = this.base + 0.02, y1 = Math.min(this.opts.mirrorH, this.ceil - 0.05); const h = y1 - y0;
    for (const f of this.columnFaces(col)) {
      const wd = (f.to - f.from) - 2 * this.opts.mirrorInset; if (wd < 0.2 || h < 0.3) continue;
      let m;
      if (this.opts.mirrorMode === 'reflector') {
        m = new Reflector(new THREE.PlaneGeometry(wd, h), { clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, color: 0xcfd3d6 });
      } else {
        m = new THREE.Mesh(new THREE.PlaneGeometry(wd, h), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.03, envMapIntensity: 1.4 }));
      }
      m.name = 'mirror'; this.placeOnWall(m, f, (f.from + f.to) / 2, y0 + h / 2, 0.012); g.add(m);
      // 테두리(비산방지 필름 + 모서리 보호 몰딩을 표현)
      const edge = new THREE.Mesh(new THREE.BoxGeometry(wd + 0.04, h + 0.04, 0.006), new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.6 }));
      this.placeOnWall(edge, f, (f.from + f.to) / 2, y0 + h / 2, 0.006); g.add(edge);
    }
  }
  // ---- 골드 액자 작품 (플레이스홀더 그림 — 실제 작품 복제 아님)
  artTexture(seed) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 320; const c = cv.getContext('2d');
    const hues = [[28, 60, 38], [210, 25, 32], [40, 45, 70], [350, 30, 40], [95, 20, 45]]; const [h, s, l] = hues[seed % hues.length];
    const gr = c.createLinearGradient(0, 0, 256, 320); gr.addColorStop(0, `hsl(${h},${s}%,${l + 25}%)`); gr.addColorStop(1, `hsl(${h + 20},${s}%,${l - 10}%)`);
    c.fillStyle = gr; c.fillRect(0, 0, 256, 320); c.fillStyle = `hsla(${h + 180},40%,60%,0.35)`; c.beginPath(); c.ellipse(128 + (seed % 3) * 20, 170, 70, 95, 0.3, 0, Math.PI * 2); c.fill();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  build_gallery_art() {
    const g = this.layers.gallery_art; const gold = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.8, roughness: 0.35 });
    const yC = this.chair + (this.ceil - this.chair) * 0.42; let i = 0;
    for (const w of this.walls()) for (const [a, b] of this.wallRuns(w, 0.5)) {
      const L = b - a; const n = Math.floor(L / 1.7); if (n < 1) continue; const step = L / n;
      for (let k = 0; k < n; k++) {
        const t = a + step * (k + 0.5); const big = i % 2 === 0; const wd = big ? 0.72 : 0.56, ht = big ? 0.92 : 0.72;
        const grp = new THREE.Group(); grp.name = 'artwork';
        const frame = new THREE.Mesh(this.frameGeometry(wd + 0.12, ht + 0.12), gold); frame.geometry.scale(1, 1, 2.2); frame.position.z = 0; grp.add(frame);
        const canvas = new THREE.Mesh(new THREE.PlaneGeometry(wd, ht), new THREE.MeshStandardMaterial({ map: this.artTexture(i), roughness: 0.9 })); canvas.position.z = 0.01; grp.add(canvas);
        this.placeOnWall(grp, w, t, yC, 0.02); g.add(grp); i++;
      }
    }
  }
  // ---- 트랙 조명 (실광원은 6개 이내)
  build_track_lights() {
    const g = this.layers.track_lights; const box = this.v.roomBox(); const m = box.min, M = box.max; const y = this.ceil - 0.02;
    const trackMat = new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.5 }); const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color().setHSL(0.08, 0.6, 0.5), emissiveIntensity: 1.2 });
    const inset = 0.9; const tracks = [[[m.x + inset, m.z + inset], [M.x - inset, m.z + inset]], [[m.x + inset, M.z - inset], [M.x - inset, M.z - inset]], [[m.x + inset, m.z + inset], [m.x + inset, M.z - inset]], [[M.x - inset, m.z + inset], [M.x - inset, M.z - inset]]];
    const heads = [];
    for (const [[x0, z0], [x1, z1]] of tracks) {
      const L = Math.hypot(x1 - x0, z1 - z0); const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.03, 0.04), trackMat); rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); rail.rotation.y = Math.atan2(-(z1 - z0), x1 - x0); g.add(rail);
      const n = Math.max(2, Math.floor(L / 1.4));
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; const hx = x0 + (x1 - x0) * t, hz = z0 + (z1 - z0) * t; const head = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.14, 12), headMat); head.position.set(hx, y - 0.1, hz); head.rotation.x = 0.35; g.add(head); heads.push([hx, hz]); }
    }
    // 실광원: 균등 간격으로 6개만
    const pick = heads.filter((_, i) => i % Math.ceil(heads.length / 6) === 0).slice(0, 6);
    this.spots = pick.map(([x, z]) => { const s = new THREE.SpotLight(0xffffff, this.opts.lightI * 5, 9, Math.PI / 5, 0.6, 1.2); s.position.set(x, y - 0.15, z); s.target.position.set(x * 0.6, 1.3, z * 0.6); g.add(s); g.add(s.target); return s; });
    this.applyLight();
  }
  applyLight() {
    const col = kelvinToRGB(this.opts.lightK);
    for (const s of this.spots || []) { s.color.copy(col); s.intensity = this.opts.lightI * 5; }
  }
  // ---- 가구 (격자 후보 → 기둥·벽과 간섭 없는 자리만)
  build_furniture() {
    const g = this.layers.furniture; const box = this.v.roomBox(); const m = box.min, M = box.max;
    const wood = new THREE.MeshStandardMaterial({ color: 0xdccbb0, roughness: 0.7 }); const leg = new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.5 });
    const blocks = this.columns().map((c) => c.footprint).concat((this.meta.elements || []).filter((e) => e.type === 'fixture_candidate').map((e) => e.footprint));
    const clear = (x, z, r) => blocks.every((f) => x + r < f.x[0] || x - r > f.x[1] || z + r < f.z[0] || z - r > f.z[1]);
    let placements = this.furniturePlacements;
    if (!placements) {
      placements = [];
      for (let x = m.x + 1.6; x < M.x - 1.4; x += 2.4) for (let z = m.z + 1.8; z < M.z - 1.6; z += 2.6) if (clear(x, z, 1.0) && placements.length < 6) placements.push({ x, z, rot: 0 });
    }
    placements.forEach((p, i) => {
      const t = new THREE.Group(); t.name = 'table'; t.userData.index = i;
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.75), wood); top.position.y = 0.72; t.add(top);
      for (const [dx, dz] of [[-0.55, -0.32], [0.55, -0.32], [-0.55, 0.32], [0.55, 0.32]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8), leg); l.position.set(dx, 0.35, dz); t.add(l); }
      for (const [dx, dz] of [[-0.3, -0.65], [0.3, -0.65], [-0.3, 0.65], [0.3, 0.65]]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.45, 16), leg); s.position.set(dx, 0.225, dz); t.add(s); }
      t.position.set(p.x, 0, p.z); t.rotation.y = p.rot || 0; g.add(t);
    });
    this.furniturePlacements = placements;
  }
  furnitureLayout() { return this.layers.furniture.children.filter((o) => o.name === 'table').map((o) => ({ x: +o.position.x.toFixed(3), z: +o.position.z.toFixed(3), rot: +o.rotation.y.toFixed(3) })); }
  // ---- 옵션: 하단 화이트 패널 (걸레받이~검은 띠 사이 전체를 흰 패널로)
  build_panel_white_optional() {
    const g = this.layers.panel_white_optional; const mat = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.6 });
    const y0 = this.base + 0.005, y1 = this.chair - 0.06 - 0.005; const h = y1 - y0;
    for (const w of this.walls()) for (const [a, b] of this.wallRuns(w, 0.0)) { const p = new THREE.Mesh(new THREE.PlaneGeometry(b - a, h), mat); this.placeOnWall(p, w, (a + b) / 2, y0 + h / 2, 0.001); g.add(p); }
  }
  // ---- 옵션: 와인/테라코타 포인트 벽 (개구부 없는 벽 하나, 검은 띠 위쪽만)
  build_wine_accent_optional() {
    const g = this.layers.wine_accent_optional; const walls = this.walls(); if (!walls.length) return;
    const w = walls.find((x) => !(x.openings || []).length) || walls[0];
    const y0 = this.chair + 0.005, y1 = this.ceil - 0.005; const p = new THREE.Mesh(new THREE.PlaneGeometry(w.to - w.from, y1 - y0), new THREE.MeshStandardMaterial({ color: WINE, roughness: 0.85 }));
    this.placeOnWall(p, w, (w.from + w.to) / 2, (y0 + y1) / 2, 0.001); p.name = 'wine_accent_' + w.id; g.add(p);
  }
}

export function kelvinToRGB(k) {
  const t = k / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  const c = (v) => Math.min(255, Math.max(0, v)) / 255; return new THREE.Color(c(r), c(g), c(b));
}
