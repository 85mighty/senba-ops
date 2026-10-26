// 뷰어 코어 — 씬/카메라/조명/로더/모드 전환/단면/치수/북마크. 모든 모델은 같은 월드 좌표를 공유한다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const MODELS = {
  original: 'models/scan_original.glb',
  cleaned: 'models/scan_cleaned.glb',
  reconstructed: 'models/reconstructed_room.glb',
};

export class Viewer {
  constructor(canvas, meta, { onError, onProgress } = {}) {
    this.meta = meta; this.onError = onError || console.error; this.onProgress = onProgress || (() => {});
    const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 0.85;
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x17181b);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; this.scene.environmentIntensity = 0.45;

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08; this.controls.maxPolarAngle = Math.PI * 0.95;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x50483f, 0.35));
    const sun = new THREE.DirectionalLight(0xffffff, 0.35); sun.position.set(5, 8, 3); this.scene.add(sun);

    this.groups = {}; for (const k of Object.keys(MODELS)) { this.groups[k] = new THREE.Group(); this.groups[k].name = k; this.scene.add(this.groups[k]); }
    this.interior = new THREE.Group(); this.interior.name = 'interior'; this.scene.add(this.interior);
    this.dims = new THREE.Group(); this.dims.visible = false; this.scene.add(this.dims);
    this.loaded = {}; this.mode = 'original'; this.ghost = false;
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.6); this.clipping = false;
    this.highlight = new THREE.Group(); this.scene.add(this.highlight);

    this.fitCamera();
    this.buildDims();
    this.bookmarks = this.computeBookmarks();
    window.addEventListener('resize', () => this.resize()); this.resize();
    this.clock = new THREE.Clock(); this.onFrame = []; this.animate();
  }

  // ---------------- 로드
  async loadAll() {
    const loader = new GLTFLoader();
    const names = Object.keys(MODELS); let done = 0;
    await Promise.all(names.map(async (name) => {
      const url = MODELS[name];
      try {
        const head = await fetch(url, { method: 'HEAD' });
        if (!head.ok) throw new Error(`HTTP ${head.status} — 파일이 없거나 경로가 다릅니다: ${url}\n(assets/models/ 에 ${url.split('/').pop()} 가 있는지, 파이프라인을 실행했는지 확인)`);
        const gltf = await new Promise((res, rej) => loader.load(url, res, undefined, (e) => rej(new Error(`GLB 파싱 실패 ${url}: ${e?.message || e}`))));
        const root = gltf.scene; root.name = name;
        root.traverse((o) => { if (o.isMesh) { o.frustumCulled = true; o.userData.model = name; this.prepMaterial(o); } });
        this.groups[name].add(root); this.loaded[name] = root;
      } catch (e) { this.onError(`[${name}] ${e.message}`); }
      finally { done++; this.onProgress(done / names.length); }
    }));
    this.setMode(this.mode); this.updateHighlight();
    return this.loaded;
  }
  prepMaterial(mesh) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) { m.side = THREE.DoubleSide; m.clippingPlanes = [this.clipPlane]; m.clipShadows = false; }
    mesh.userData.baseMats = mats.map((m) => m);
  }

  // ---------------- 모드
  setMode(mode) {
    this.mode = mode;
    const show = { original: ['original'], cleaned: ['cleaned'], reconstructed: ['reconstructed'], interior: ['reconstructed'] }[mode] || [];
    for (const k of Object.keys(this.groups)) this.groups[k].visible = show.includes(k);
    this.interior.visible = mode === 'interior';
    // ③④ 에서 정리 스캔 반투명 겹치기
    const ghostOn = this.ghost && (mode === 'reconstructed' || mode === 'interior');
    if (ghostOn) this.groups.cleaned.visible = true;
    this.groups.cleaned.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m.transparent = ghostOn; m.opacity = ghostOn ? 0.35 : 1; m.depthWrite = !ghostOn; }
    });
    this.setCeilingHidden(this.clipping);
  }
  setGhost(on) { this.ghost = on; this.setMode(this.mode); }
  setCeilingHidden(on, y) {
    this.clipping = on; if (y !== undefined) this.clipPlane.constant = y;
    const ceil = this.meta.ceiling_height_m || 3.0;
    this.clipPlane.constant = on ? this.clipPlane.constant : ceil + 10;
    for (const k of Object.keys(this.groups)) this.groups[k].traverse((o) => { if (o.isMesh && o.name === 'ceiling') o.visible = !on; });
    this.interior.traverse((o) => { if (o.isMesh && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => (m.clippingPlanes = [this.clipPlane])); } });
  }

  // ---------------- 카메라
  roomBox() {
    const b = this.meta.bounds_world_m; if (!b) return new THREE.Box3(new THREE.Vector3(-4, 0, -5), new THREE.Vector3(4, 3, 5));
    return new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
  }
  fitCamera() {
    const box = this.roomBox(); const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3());
    this.camera.position.set(c.x + s.x * 0.9, s.y * 1.6, c.z + s.z * 0.9); this.controls.target.set(c.x, 1.2, c.z); this.controls.update();
  }
  computeBookmarks() {
    const box = this.roomBox(); const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3());
    const els = this.meta.elements || []; const eye = 1.6; const bm = [];
    bm.push({ name: '메인', pos: [c.x + s.x * 0.35, 1.9, c.z + s.z * 0.4], tgt: [c.x, 1.1, c.z] });
    bm.push({ name: '전체(위)', pos: [c.x + s.x * 0.9, s.y * 1.8, c.z + s.z * 0.9], tgt: [c.x, 0.8, c.z] });
    const lm = this.meta.landmarks || {};
    // 랜드마크 X 를 바라보는 북마크. X_from 이 있으면 그 자리에서, 없으면 방 중심 쪽으로 dist 만큼 물러난 자리에서.
    const look = (name, label, dist = 1.2) => { const p = lm[name]; if (!p) return; const f = lm[name + '_from']; if (f) { bm.push({ name: label, pos: [f.x, eye, f.z], tgt: [p.x, 1.2, p.z] }); return; } const dx = c.x - p.x, dz = c.z - p.z; const d = Math.hypot(dx, dz) || 1; bm.push({ name: label, pos: [p.x + dx / d * dist, eye, p.z + dz / d * dist], tgt: [p.x, 1.2, p.z] }); };
    const lookFrom = (name, label, dist = 2.2) => look(name, label, dist);
    if (lm.entrance) look('entrance', '입구'); if (lm.windows) lookFrom('windows', '창가', 2.5); if (lm.kitchen) lookFrom('kitchen', '주방'); if (lm.toilet) lookFrom('toilet', '화장실');
    const walls = els.filter((e) => e.type === 'wall');
    const openings = walls.flatMap((w) => w.openings.map((o) => ({ w, o })));
    const atOpening = (w, o, dist) => { const t = (o.from + o.to) / 2; const p = w.axis === 'x' ? [w.offset + w.inward * dist, eye, t] : [t, eye, w.offset + w.inward * dist]; return p; };
    if (Object.keys(lm).length) { /* 랜드마크 기반 북마크 사용 */ } else if (openings.length) {
      // 가장 긴 공백 = 창 후보, 가장 짧은 = 문(입구) 후보
      const sorted = [...openings].sort((a, b) => (b.o.to - b.o.from) - (a.o.to - a.o.from));
      const win = sorted[0], door = sorted[sorted.length - 1];
      const wp = atOpening(win.w, win.o, 2.0); bm.push({ name: '창가', pos: wp, tgt: atOpening(win.w, win.o, 0) });
      const dp = atOpening(door.w, door.o, 0.8); bm.push({ name: '입구', pos: dp, tgt: [c.x, 1.2, c.z] });
    } else {
      bm.push({ name: '입구(추정)', pos: [c.x, eye, box.min.z + 0.8], tgt: [c.x, 1.2, c.z] });
    }
    const fx = els.find((e) => e.type === 'fixture_candidate');
    if (fx) { const px = (fx.footprint.x[0] + fx.footprint.x[1]) / 2, pz = (fx.footprint.z[0] + fx.footprint.z[1]) / 2; bm.push({ name: '주방(설비 후보)', pos: [px + (c.x - px) * 0.6, eye, pz + (c.z - pz) * 0.6], tgt: [px, 1.0, pz] }); }
    const col = els.find((e) => e.id === this.meta.central_wide_column);
    if (col) { const px = (col.footprint.x[0] + col.footprint.x[1]) / 2, pz = (col.footprint.z[0] + col.footprint.z[1]) / 2; bm.push({ name: '큰 기둥', pos: [px + 2.6, eye, pz + 2.2], tgt: [px, 1.3, pz] }); }
    return bm;
  }
  goBookmark(b) {
    const from = this.camera.position.clone(), to = new THREE.Vector3(...b.pos); const t0 = this.controls.target.clone(), t1 = new THREE.Vector3(...b.tgt);
    let t = 0; const step = (dt) => { t = Math.min(1, t + dt * 2.2); const k = t * t * (3 - 2 * t); this.camera.position.lerpVectors(from, to, k); this.controls.target.lerpVectors(t0, t1, k); return t < 1; };
    this.onFrame.push(step);
  }

  // ---------------- 치수
  textSprite(text, color = '#ffd27a') {
    const cv = document.createElement('canvas'); const ctx = cv.getContext('2d'); cv.width = 512; cv.height = 128;
    ctx.font = 'bold 56px -apple-system, sans-serif'; ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 64);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false })); sp.scale.set(1.6, 0.4, 1); return sp;
  }
  buildDims() {
    this.dims.clear(); const box = this.roomBox(); const s = box.getSize(new THREE.Vector3()); const h = this.meta.ceiling_height_m || s.y;
    const mat = new THREE.LineBasicMaterial({ color: 0xffd27a });
    const line = (a, b) => this.dims.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]), mat));
    const y = 0.05; const m = box.min, M = box.max;
    line([m.x, y, m.z - 0.3], [M.x, y, m.z - 0.3]); line([m.x - 0.3, y, m.z], [m.x - 0.3, y, M.z]); line([m.x - 0.3, 0, m.z - 0.3], [m.x - 0.3, h, m.z - 0.3]);
    const a = this.textSprite(`가로 ${s.x.toFixed(2)} m`); a.position.set((m.x + M.x) / 2, 0.3, m.z - 0.5); this.dims.add(a);
    const b = this.textSprite(`세로 ${s.z.toFixed(2)} m`); b.position.set(m.x - 0.6, 0.3, (m.z + M.z) / 2); this.dims.add(b);
    const c = this.textSprite(`천장고 ${h.toFixed(2)} m (${this.meta.ceiling_height_status || '?'})`); c.position.set(m.x - 0.3, h / 2, m.z - 0.3); this.dims.add(c);
    for (const e of this.meta.elements || []) {
      if (!e.footprint) continue; const fx = e.footprint.x, fz = e.footprint.z; const w = (fx[1] - fx[0]).toFixed(2), d = (fz[1] - fz[0]).toFixed(2);
      const t = this.textSprite(`${e.type} ${w}×${d}`, e.status === 'measured' ? '#9be28a' : '#ffb27a'); t.scale.set(1.3, 0.32, 1); t.position.set((fx[0] + fx[1]) / 2, (e.y ? e.y[1] : h) + 0.25, (fz[0] + fz[1]) / 2); this.dims.add(t);
    }
  }
  setDims(on) { this.dims.visible = on; }

  // ---------------- 중앙 기둥 강조
  updateHighlight(on = this.highlightOn ?? true) {
    this.highlightOn = on; this.highlight.clear(); if (!on) return;
    const col = (this.meta.elements || []).find((e) => e.id === this.meta.central_wide_column); if (!col) return;
    const fx = col.footprint.x, fz = col.footprint.z, h = this.meta.ceiling_height_m || 3;
    const g = new THREE.BoxGeometry(fx[1] - fx[0] + 0.06, h + 0.02, fz[1] - fz[0] + 0.06);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0xff4fd8 }));
    edges.position.set((fx[0] + fx[1]) / 2, h / 2, (fz[0] + fz[1]) / 2); this.highlight.add(edges);
    const t = this.textSprite(`중앙 넓은 기둥 (${this.meta.central_wide_column}) — 확인 필요`, '#ff9be8'); t.scale.set(2.6, 0.5, 1); t.position.set((fx[0] + fx[1]) / 2, h + 0.4, (fz[0] + fz[1]) / 2); this.highlight.add(t);
  }

  // ---------------- 피킹
  pick(ev, filter) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(p, this.camera);
    const objs = []; this.scene.traverse((o) => { if (o.isMesh && o.visible && (!filter || filter(o))) objs.push(o); });
    const hits = rc.intersectObjects(objs, false); return hits[0] || null;
  }

  resize() { const w = window.innerWidth, h = window.innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  animate() {
    requestAnimationFrame(() => this.animate()); const dt = Math.min(this.clock.getDelta(), 0.05);
    this.onFrame = this.onFrame.filter((f) => f(dt)); this.controls.update(); this.renderer.render(this.scene, this.camera);
    this.frames = (this.frames || 0) + 1;
  }
}
