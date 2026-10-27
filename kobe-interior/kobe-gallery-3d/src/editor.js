// 편집기 — 번호 매긴 면(벽 세그먼트·기둥·천장/바닥 타일) 선택, 마감/몰딩/액자/거울/실측, 창·커튼, 소품, 랜드마크, 측정, 저장.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PALETTE_WALL, PALETTE_FLOOR, PALETTE_CEIL, PALETTE_CURTAIN, FRAME_STYLES, PROP_TYPES } from './design.js';
import { buildProp, buildWindow, buildCurtain, measureLine } from './props.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TILE = 1.5;

export class Editor {
  constructor(viewer, interior, store, toast) {
    this.v = viewer; this.i = interior; this.s = store; this.meta = viewer.meta; this.toast = toast;
    this.enabled = false; this.selected = null; this.placing = null; this.measuring = null;
    this.root = new THREE.Group(); this.root.name = 'editor'; viewer.scene.add(this.root);
    this.overlays = new THREE.Group(); this.picks = new THREE.Group(); this.labels = new THREE.Group(); this.hl = new THREE.Group();
    this.windows = new THREE.Group(); this.windows.name = 'windows'; this.props = new THREE.Group(); this.props.name = 'props'; this.marks = new THREE.Group(); this.measures = new THREE.Group();
    for (const g of [this.overlays, this.picks, this.labels, this.hl, this.windows, this.props, this.marks, this.measures]) this.root.add(g);
    this.labels.visible = false; this.picks.visible = false;
    this.tc = new TransformControls(viewer.camera, viewer.renderer.domElement); this.tc.setSize(0.7); this.tc.showY = false;
    viewer.scene.add(this.tc.getHelper ? this.tc.getHelper() : this.tc);
    this.tc.addEventListener('dragging-changed', (e) => { viewer.controls.enabled = !e.value; if (!e.value) this.onDragEnd(); });
    this.tc.addEventListener('objectChange', () => { const o = this.tc.object; if (o) o.position.y = 0; });
    this.buildItems(); this.buildPicks(); this.buildLabels();
    this.rebuildAll();
    store.onChange(() => { this.rebuildAll(); this.renderInspector(); });
  }
  get ceil() { return this.meta.ceiling_height_m || 2.4; }
  get chair() { return this.meta.chair_rail_height_m || 0.9; }
  get base() { return this.meta.baseboard_height_m || 0.1; }
  walls() { return (this.meta.elements || []).filter((e) => e.type === 'wall'); }
  columns() { return (this.meta.elements || []).filter((e) => ['wide_column', 'thin_column'].includes(e.type)); }

  // ---------------- 번호 매긴 항목
  buildItems() {
    this.items = []; let n = 0;
    for (const w of this.walls()) { n++; w.num = n; this.items.push({ kind: 'wall', id: w.id, label: `벽 ${n}`, el: w }); }
    let c = 0; for (const col of this.columns()) { c++; col.num = c; this.items.push({ kind: 'column', id: col.id, label: `기둥 ${c}${col.id === this.meta.central_wide_column ? ' (넓은 가벽)' : ''}`, el: col }); }
    // 천장/바닥 타일: 바닥 bbox 를 TILE 격자로
    const b = this.meta.bounds_world_m; const x0 = b.min[0], z0 = b.min[2]; const nx = Math.ceil((b.max[0] - x0) / TILE), nz = Math.ceil((b.max[2] - z0) / TILE);
    this.tiles = []; let t = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const tile = { i, j, x: [x0 + i * TILE, Math.min(x0 + (i + 1) * TILE, b.max[0])], z: [z0 + j * TILE, Math.min(z0 + (j + 1) * TILE, b.max[2])] };
      if (!this.tileOnFloor(tile)) continue; t++; tile.num = t; this.tiles.push(tile);
      this.items.push({ kind: 'ceiling', id: `ceiling_t${t}`, label: `천장 ${t}`, tile }); this.items.push({ kind: 'floor', id: `floor_t${t}`, label: `바닥 ${t}`, tile });
    }
    this.items.push({ kind: 'ceiling', id: 'ceiling', label: '천장 전체' }); this.items.push({ kind: 'floor', id: 'floor', label: '바닥 전체' });
  }
  tileOnFloor(tile) {
    // 복원 바닥(격자 메쉬) 안에 중심이 있는지: 벽 선분 bbox 로 근사 — 타일 중심이 어떤 벽에서 2.5 m 이내면 실내로 간주
    const cx = (tile.x[0] + tile.x[1]) / 2, cz = (tile.z[0] + tile.z[1]) / 2;
    const fm = this.v.loaded?.reconstructed; if (fm) { let hit = false; const rc = new THREE.Raycaster(new THREE.Vector3(cx, 1, cz), new THREE.Vector3(0, -1, 0)); fm.traverse((o) => { if (!hit && o.isMesh && o.name === 'floor') hit = rc.intersectObject(o, false).length > 0; }); return hit; }
    return true;
  }
  itemById(id) { return this.items.find((x) => x.id === id); }

  // 벽 세그먼트: 분할 수에 따라 구간 나눔
  segmentsOf(w) {
    const sp = this.s.getSurface(w.id); const n = Math.max(1, Math.min(8, sp.splits || 1)); const L = w.to - w.from; const out = [];
    for (let k = 0; k < n; k++) out.push({ key: `${w.id}#${k}`, idx: k, from: w.from + (L * k) / n, to: w.from + (L * (k + 1)) / n });
    return out;
  }
  placeOnWall(obj, w, t, y, off) { this.i.placeOnWall(obj, w, t, y, off); }
  // 벽 안쪽(또는 양면) 사각형 메쉬
  wallQuad(w, t0, t1, y0, y1, off, mat, side = null) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(t1 - t0, y1 - y0), mat); const sw = side ? { ...w, inward: side } : w;
    this.placeOnWall(m, sw, (t0 + t1) / 2, (y0 + y1) / 2, off); return m;
  }
  zoneRange(zone) { return zone === 'upper' ? [this.chair, this.ceil] : zone === 'lower' ? [this.base, this.chair] : [0, this.ceil]; }

  // ---------------- 픽 메쉬 (투명) & 라벨
  buildPicks() {
    this.picks.clear(); const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide });
    for (const w of this.walls()) for (const seg of this.segmentsOf(w)) {
      const sides = w.two_sided ? [w.inward, -w.inward] : [w.inward];
      for (const sd of sides) { const q = this.wallQuad(w, seg.from, seg.to, 0, this.ceil, 0.03, mat, sd); q.userData.pick = { kind: 'wall', id: w.id, seg: seg.key }; this.picks.add(q); }
    }
    for (const col of this.columns()) { const fp = this.s.footprint(col); const m = new THREE.Mesh(new THREE.BoxGeometry(fp.x[1] - fp.x[0] + 0.06, this.ceil, fp.z[1] - fp.z[0] + 0.06), mat); m.position.set((fp.x[0] + fp.x[1]) / 2, this.ceil / 2, (fp.z[0] + fp.z[1]) / 2); m.userData.pick = { kind: 'column', id: col.id }; this.picks.add(m); }
    for (const tile of this.tiles) for (const [kind, y] of [['ceiling', this.ceil - 0.03], ['floor', 0.03]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(tile.x[1] - tile.x[0], tile.z[1] - tile.z[0]), mat); m.rotation.x = -Math.PI / 2; m.position.set((tile.x[0] + tile.x[1]) / 2, y, (tile.z[0] + tile.z[1]) / 2); m.userData.pick = { kind, id: `${kind}_t${tile.num}` }; this.picks.add(m);
    }
  }
  buildLabels() {
    this.labels.clear();
    const add = (text, pos, color) => { const sp = this.v.textSprite(text, color); sp.scale.set(0.9, 0.22, 1); sp.position.copy(pos); this.labels.add(sp); };
    for (const w of this.walls()) { const p = new THREE.Vector3(); const t = (w.from + w.to) / 2; if (w.axis === 'x') p.set(w.offset + w.inward * 0.25, this.ceil - 0.25, t); else p.set(t, this.ceil - 0.25, w.offset + w.inward * 0.25); add(`벽 ${w.num}`, p, '#ffe08a'); }
    for (const col of this.columns()) { const fp = this.s.footprint(col); add(`기둥 ${col.num}`, new THREE.Vector3((fp.x[0] + fp.x[1]) / 2, this.ceil - 0.15, (fp.z[0] + fp.z[1]) / 2), '#ffb0b0'); }
    if (!this.tileLabels) { this.tileLabels = new THREE.Group(); this.tileLabels.visible = false; this.root.add(this.tileLabels); }
    this.tileLabels.clear();
    const addT = (text, pos, color) => { const sp = this.v.textSprite(text, color); sp.scale.set(0.6, 0.15, 1); sp.position.copy(pos); this.tileLabels.add(sp); };
    for (const t of this.tiles) { const cx = (t.x[0] + t.x[1]) / 2, cz = (t.z[0] + t.z[1]) / 2; addT(`천장 ${t.num}`, new THREE.Vector3(cx, this.ceil - 0.08, cz), '#c9d7ff'); addT(`바닥 ${t.num}`, new THREE.Vector3(cx, 0.08, cz), '#d2ffc9'); }
  }
  setLabels(on) { this.labels.visible = on; }
  setTileLabels(on) { if (this.tileLabels) this.tileLabels.visible = on; }

  // ---------------- 디자인 적용 (오버레이·창·커튼·소품·랜드마크)
  rebuildAll() {
    const keep = this.selected; this.tc.detach();           // 다시 그리기 전에 기즈모를 떼야 사라진 객체를 붙잡지 않는다
    this.buildOverlays(); this.buildWindows(); this.buildProps(); this.buildMarks(); this.buildPicks();
    this.i.rebuild('molding'); this.i.rebuild('gallery_art'); this.i.rebuild('mirror_4_sides'); this.applyColumnSizes(); this.buildLabels();
    this.v.updateHighlight(); this.refreshHighlight();
    if (keep?.kind === 'prop' || keep?.kind === 'landmark') this.reattach(keep);
  }
  reattach(sel) {
    const list = sel.kind === 'prop' ? this.props.children : this.marks.children; const g = list.find((c) => c.userData.pick?.id === sel.id);
    if (g) { this.tc.attach(g); this.tc.setMode('translate'); }
  }
  paintMat(hex) { return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }); }
  buildOverlays() {
    this.overlays.clear();
    for (const w of this.walls()) {
      const sides = w.two_sided ? [w.inward, -w.inward] : [w.inward];
      for (const seg of this.segmentsOf(w)) {
        const sf = this.s.getSurface(seg.key); if (!sf.paint) continue; const [y0, y1] = this.zoneRange(sf.zone || 'all');
        for (const sd of sides) this.overlays.add(this.wallQuad(w, seg.from, seg.to, y0, y1, 0.0015, this.paintMat(sf.paint), sd));
      }
      // 벽 전체 설정(세그먼트 없이 칠한 경우)
      const sfw = this.s.getSurface(w.id); if (sfw.paint) { const [y0, y1] = this.zoneRange(sfw.zone || 'all'); for (const sd of sides) this.overlays.add(this.wallQuad(w, w.from, w.to, y0, y1, 0.001, this.paintMat(sfw.paint), sd)); }
    }
    for (const col of this.columns()) {
      const sf = this.s.getSurface(col.id); if (!sf.paint) continue; const [y0, y1] = this.zoneRange(sf.zone || 'all'); const fp = this.s.footprint(col);
      for (const f of this.i.columnFaces({ footprint: fp })) this.overlays.add(this.wallQuad(f, f.from, f.to, y0, y1, 0.0015, this.paintMat(sf.paint)));
    }
    for (const t of this.tiles) for (const [kind, y, rot] of [['ceiling', this.ceil - 0.002, Math.PI / 2], ['floor', 0.002, -Math.PI / 2]]) {
      const sf = this.s.getSurface(`${kind}_t${t.num}`); const sfa = this.s.getSurface(kind); const paint = sf.paint || sfa.paint; if (!paint) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(t.x[1] - t.x[0], t.z[1] - t.z[0]), this.paintMat(paint)); m.rotation.x = rot; m.position.set((t.x[0] + t.x[1]) / 2, y, (t.z[0] + t.z[1]) / 2); this.overlays.add(m);
    }
    // 스캔 텍스처 끄기(단색 보기) — 면별 texture=false 면 해당 _tex 숨김
    const rec = this.v.loaded?.reconstructed; if (rec) rec.traverse((o) => {
      if (!o.isMesh) return; const base = o.name.replace(/_tex(_.*)?$/, '');
      if (o.name.includes('_tex')) { const sf = this.s.getSurface(base); o.visible = sf.texture !== false; }
      if (/_window_\d+$/.test(o.name)) o.visible = false;   // 창은 편집기가 그린다
    });
  }
  buildWindows() {
    this.windows.clear();
    for (const w of this.walls()) for (const win of this.s.windowsOf(w.id)) {
      const place = (obj, t, y, off) => this.placeOnWall(obj, w, t, y, off);
      const wm = buildWindow(win, place); wm.userData.pick = { kind: 'window', id: win.id, wall: w.id }; this.windows.add(wm);
      if (win.curtain?.on) this.windows.add(buildCurtain(win, this.ceil, place));
    }
  }
  buildProps() { this.props.clear(); for (const p of this.s.design.props) { const g = buildProp(p); g.userData.pick = { kind: 'prop', id: p.id }; this.props.add(g); } }
  buildMarks() {
    this.marks.clear(); const lm = { ...(this.meta.landmarks || {}), ...(this.s.design.landmarks || {}) }; this.meta.landmarks = lm;
    const names = { entrance: '입구', kitchen: '주방', toilet: '화장실', windows: '창가', main: '메인' };
    for (const [k, label] of Object.entries(names)) { const p = lm[k]; if (!p) continue; const g = new THREE.Group(); g.name = 'mark'; g.userData.pick = { kind: 'landmark', id: k };
      const pin = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0xff4fd8 })); pin.rotation.x = Math.PI; pin.position.y = 0.2; g.add(pin);
      const sp = this.v.textSprite(`📍 ${label}`, '#ff9be8'); sp.scale.set(0.8, 0.2, 1); sp.position.y = 0.5; g.add(sp); g.position.set(p.x, 0, p.z); this.marks.add(g); }
    this.marks.visible = this.enabled;
  }
  applyColumnSizes() {
    const rec = this.v.loaded?.reconstructed; if (!rec) return;
    for (const col of this.columns()) {
      const c = this.s.getColumn(col.id); const fx = col.footprint.x, fz = col.footprint.z; const ow = fx[1] - fx[0], od = fz[1] - fz[0];
      const sx = (c.w || ow) / ow, sz = (c.d || od) / od; const cx = (fx[0] + fx[1]) / 2, cz = (fz[0] + fz[1]) / 2;
      rec.traverse((o) => {
        if (!o.isMesh || !(o.name === col.id || o.name.startsWith(col.id + '_'))) return;
        if (!o.userData.orig) o.userData.orig = { p: o.position.clone(), s: o.scale.clone() };
        const op = o.userData.orig.p; o.position.set(cx + (op.x - cx) * sx + (c.dx || 0), op.y, cz + (op.z - cz) * sz + (c.dz || 0)); o.scale.set(o.userData.orig.s.x * sx, o.userData.orig.s.y, o.userData.orig.s.z * sz);
      });
    }
  }

  // ---------------- 선택
  setEnabled(on) { this.enabled = on; this.marks.visible = on; if (!on) { this.select(null); this.tc.detach(); this.placing = null; } $('#editorPanel').classList.toggle('on', on); }
  onClick(ev) {
    if (!this.enabled) return false;
    if (this.placing) { const p = this.floorPoint(ev); if (p) { const prop = this.s.addProp({ type: this.placing, x: +p.x.toFixed(2), z: +p.z.toFixed(2), rot: 0, scale: 1, color: null }); this.placing = null; $('#placingHint').textContent = ''; this.s.commit('prop'); this.select({ kind: 'prop', id: prop.id }); } return true; }
    if (this.measuring) { const p = this.hitPoint(ev); if (p) { this.measuring.push(p); if (this.measuring.length === 2) { this.measures.add(measureLine(this.measuring[0], this.measuring[1], (t) => this.v.textSprite(t))); this.measuring = []; this.toast('두 점을 다시 찍으면 다른 거리를 잽니다'); } } return true; }
    const hit = this.pickAll(ev); this.select(hit ? hit.userData.pick : null); return true;
  }
  pickAll(ev) {
    const r = this.v.renderer.domElement.getBoundingClientRect(); const p = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(p, this.v.camera); const objs = [];
    for (const g of [this.props, this.marks, this.windows]) g.traverse((o) => { if (o.isMesh) objs.push(o); });
    this.picks.traverse((o) => { if (o.isMesh) objs.push(o); });
    const hits = rc.intersectObjects(objs, false).filter((h) => h.object.visible !== false);
    for (const h of hits) { let o = h.object; while (o && !o.userData.pick) o = o.parent; if (o) return o; }
    return null;
  }
  floorPoint(ev) { const r = this.v.renderer.domElement.getBoundingClientRect(); const p = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); const rc = new THREE.Raycaster(); rc.setFromCamera(p, this.v.camera); const pt = new THREE.Vector3(); return rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt) ? pt : null; }
  hitPoint(ev) { const h = this.v.pick(ev, (o) => o.userData.model === 'reconstructed' || o.userData.model === 'cleaned' || o.userData.model === 'original'); return h ? h.point.clone() : this.floorPoint(ev); }
  select(sel) {
    this.selected = sel; this.tc.detach();
    if (sel?.kind === 'prop' || sel?.kind === 'landmark') this.reattach(sel);
    this.refreshHighlight(); this.renderInspector();
    document.querySelectorAll('#itemChips button').forEach((b) => b.classList.toggle('active', !!sel && b.dataset.id === (sel.seg || sel.id)));
  }
  onDragEnd() {
    const o = this.tc.object; if (!o) return; const pk = o.userData.pick;
    if (pk?.kind === 'prop') { const p = this.s.design.props.find((x) => x.id === pk.id); if (p) { p.x = +o.position.x.toFixed(2); p.z = +o.position.z.toFixed(2); this.s.commit('prop-move'); } }
    if (pk?.kind === 'landmark') { this.s.design.landmarks[pk.id] = { x: +o.position.x.toFixed(2), z: +o.position.z.toFixed(2), status: 'user' }; this.s.commit('landmark'); this.onLandmarks?.(); }
  }
  refreshHighlight() {
    this.hl.clear(); const sel = this.selected; if (!sel) return;
    const mat = new THREE.LineBasicMaterial({ color: 0x4fd8ff, depthTest: false }); const add = (geo, pos, rot) => { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat); e.position.copy(pos); if (rot) e.rotation.copy(rot); e.renderOrder = 999; this.hl.add(e); };
    if (sel.kind === 'wall') { const w = this.walls().find((x) => x.id === sel.id); const seg = sel.seg ? this.segmentsOf(w).find((s) => s.key === sel.seg) : { from: w.from, to: w.to }; const q = this.wallQuad(w, seg.from, seg.to, 0.02, this.ceil - 0.02, 0.05, mat); add(q.geometry, q.position, q.rotation); }
    if (sel.kind === 'column') { const col = this.columns().find((x) => x.id === sel.id); const fp = this.s.footprint(col); add(new THREE.BoxGeometry(fp.x[1] - fp.x[0] + 0.08, this.ceil, fp.z[1] - fp.z[0] + 0.08), new THREE.Vector3((fp.x[0] + fp.x[1]) / 2, this.ceil / 2, (fp.z[0] + fp.z[1]) / 2)); }
    if (sel.kind === 'ceiling' || sel.kind === 'floor') { const t = this.tiles.find((x) => `${sel.kind}_t${x.num}` === sel.id); if (t) add(new THREE.BoxGeometry(t.x[1] - t.x[0], 0.02, t.z[1] - t.z[0]), new THREE.Vector3((t.x[0] + t.x[1]) / 2, sel.kind === 'ceiling' ? this.ceil - 0.02 : 0.02, (t.z[0] + t.z[1]) / 2)); }
    if (sel.kind === 'window') { const g = this.windows.children.find((c) => c.userData.pick?.id === sel.id); if (g) { const b = new THREE.Box3().setFromObject(g); const s = b.getSize(new THREE.Vector3()); add(new THREE.BoxGeometry(s.x + 0.05, s.y + 0.05, s.z + 0.05), b.getCenter(new THREE.Vector3())); } }
  }

  // ---------------- 패널
  renderChips() {
    const box = $('#itemChips'); if (!box) return; box.innerHTML = '';
    const mk = (label, sel, cls = '') => { const b = document.createElement('button'); b.textContent = label; b.className = 'chip ' + cls; b.dataset.id = sel.seg || sel.id; b.addEventListener('click', () => this.select(sel)); box.appendChild(b); };
    for (const w of this.walls()) { const segs = this.segmentsOf(w); if (segs.length === 1) mk(`벽 ${w.num}`, { kind: 'wall', id: w.id }); else segs.forEach((s) => mk(`벽 ${w.num}-${s.idx + 1}`, { kind: 'wall', id: w.id, seg: s.key })); }
    for (const c of this.columns()) mk(`기둥 ${c.num}`, { kind: 'column', id: c.id }, 'col');
    for (const t of this.tiles) mk(`천장 ${t.num}`, { kind: 'ceiling', id: `ceiling_t${t.num}` }, 'ceil'); mk('천장 전체', { kind: 'ceiling', id: 'ceiling' }, 'ceil');
    for (const t of this.tiles) mk(`바닥 ${t.num}`, { kind: 'floor', id: `floor_t${t.num}` }, 'floor'); mk('바닥 전체', { kind: 'floor', id: 'floor' }, 'floor');
    for (const w of this.walls()) for (const win of this.s.windowsOf(w.id)) mk(`창 (벽 ${w.num})`, { kind: 'window', id: win.id, wall: w.id }, 'win');
  }
  palette(list, cur, onPick) {
    const d = document.createElement('div'); d.className = 'swatches';
    for (const [name, hex] of list) { const b = document.createElement('button'); b.className = 'sw' + ((cur || null) === hex ? ' active' : ''); b.title = name; b.style.background = hex || 'linear-gradient(135deg,#9a9892,#6a4f35)'; b.addEventListener('click', () => onPick(hex)); d.appendChild(b); }
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = cur || '#c9c7c1'; inp.title = '직접 선택'; inp.addEventListener('input', () => onPick(inp.value)); d.appendChild(inp);
    return d;
  }
  renderInspector() {
    const box = $('#inspector'); if (!box) return; const sel = this.selected; box.innerHTML = '';
    if (!sel) { box.innerHTML = '<div class="hint">③/④ 화면에서 벽·기둥·천장·바닥·창·소품을 클릭하거나 위 번호를 누르세요.</div>'; return; }
    const h = (html) => { const d = document.createElement('div'); d.innerHTML = html; box.appendChild(d); return d; };
    const row = (label, node) => { const d = document.createElement('div'); d.className = 'irow'; const l = document.createElement('span'); l.textContent = label; d.append(l, node); box.appendChild(d); return d; };
    const num = (val, step, onChange, unit = 'cm') => { const w = document.createElement('span'); const i = document.createElement('input'); i.type = 'number'; i.step = step; i.value = val; i.addEventListener('change', () => onChange(+i.value)); w.append(i, document.createTextNode(' ' + unit)); return w; };
    const check = (val, onChange, text = '') => { const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!val; c.addEventListener('change', () => onChange(c.checked)); l.append(c, document.createTextNode(' ' + text)); return l; };
    const selectEl = (opts, val, onChange) => { const s = document.createElement('select'); for (const [t, v] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === val) o.selected = true; s.appendChild(o); } s.addEventListener('change', () => onChange(s.value)); return s; };
    const btn = (text, fn, cls = '') => { const b = document.createElement('button'); b.textContent = text; b.className = cls; b.addEventListener('click', fn); return b; };
    const commit = (why) => this.s.commit(why);

    if (sel.kind === 'wall') {
      const w = this.walls().find((x) => x.id === sel.id); const key = sel.seg || w.id; const sf = this.s.surface(key); const sfw = this.s.surface(w.id);
      h(`<h4>벽 ${w.num}${sel.seg ? '-' + (this.segmentsOf(w).find((s) => s.key === sel.seg).idx + 1) : ''} <small>길이 ${(w.to - w.from).toFixed(2)} m · ${w.two_sided ? '양면' : '단면'} · ${esc(w.id)}</small></h4>`);
      row('분할', selectEl([['1 (전체)', 1], ['2', 2], ['3', 3], ['4', 4], ['6', 6], ['8', 8]], sfw.splits || 1, (v) => { sfw.splits = +v; commit('split'); this.renderChips(); this.select({ kind: 'wall', id: w.id }); }));
      row('칠할 영역', selectEl([['전체', 'all'], ['띠 위(상부)', 'upper'], ['띠 아래(하부)', 'lower']], sf.zone || 'all', (v) => { sf.zone = v; commit('zone'); }));
      row('색', this.palette(PALETTE_WALL, sf.paint, (hex) => { sf.paint = hex; commit('paint'); }));
      row('스캔 텍스처', check(sfw.texture !== false, (v) => { sfw.texture = v; commit('tex'); }, '보이기 (끄면 단색)'));
      row('화이트 몰딩', check(sfw.molding !== false, (v) => { sfw.molding = v; commit('molding'); }, '이 벽에 몰딩'));
      row('액자', check(sfw.art !== false, (v) => { sfw.art = v; commit('art'); }, '이 벽에 작품 걸기'));
      row('액자 수', num(sfw.artCount ?? '', 1, (v) => { sfw.artCount = v || null; commit('art'); }, '개 (비우면 자동)'));
      row('액자 틀', selectEl(FRAME_STYLES, sfw.frame || 'gold', (v) => { sfw.frame = v; commit('frame'); }));
      const wins = this.s.windowsOf(w.id); h(`<h4>창 (${wins.length})</h4>`);
      box.appendChild(btn('+ 이 벽에 창 추가', () => { const L = w.to - w.from; this.s.addWindow(w.id, { id: `${w.id}_w${Date.now() % 100000}`, from: +(w.from + L * 0.3).toFixed(2), to: +(w.from + L * 0.7).toFixed(2), y0: 0.95, y1: 2.0, frame: '#8a8f94', curtain: { on: false, color: '#5a3a22', style: 'open' } }); commit('window'); this.renderChips(); }));
      for (const win of wins) box.appendChild(btn(`창 ${win.from.toFixed(2)}~${win.to.toFixed(2)} m 편집`, () => this.select({ kind: 'window', id: win.id, wall: w.id }), 'ghost'));
    }
    if (sel.kind === 'column') {
      const col = this.columns().find((x) => x.id === sel.id); const c = this.s.column(col.id); const sf = this.s.surface(col.id); const fx = col.footprint.x, fz = col.footprint.z;
      h(`<h4>기둥 ${col.num} <small>스캔 ${((fx[1] - fx[0]) * 100).toFixed(0)}×${((fz[1] - fz[0]) * 100).toFixed(0)} cm · ${esc(col.id)}</small></h4>`);
      row('실측 가로(X)', num(Math.round((c.w || fx[1] - fx[0]) * 100), 1, (v) => { c.w = v / 100; commit('size'); }));
      row('실측 세로(Z)', num(Math.round((c.d || fz[1] - fz[0]) * 100), 1, (v) => { c.d = v / 100; commit('size'); }));
      row('위치 보정 X', num(Math.round((c.dx || 0) * 100), 1, (v) => { c.dx = v / 100; commit('size'); }));
      row('위치 보정 Z', num(Math.round((c.dz || 0) * 100), 1, (v) => { c.dz = v / 100; commit('size'); }));
      box.appendChild(btn('스캔 치수로 되돌리기', () => { c.w = c.d = null; c.dx = c.dz = 0; commit('size'); }, 'ghost'));
      row('4면 거울', check(c.mirror ?? (col.id === this.meta.central_wide_column), (v) => { c.mirror = v; commit('mirror'); }, '이 기둥에 거울'));
      const faces = document.createElement('span'); for (const [k, t] of [['xn', '서(−X)'], ['xp', '동(+X)'], ['zn', '북(−Z)'], ['zp', '남(+Z)']]) faces.appendChild(check(c.mirrorFaces.includes(k), (v) => { c.mirrorFaces = v ? [...new Set([...c.mirrorFaces, k])] : c.mirrorFaces.filter((x) => x !== k); commit('mirror'); }, t)); row('거울 면', faces);
      row('칠할 영역', selectEl([['전체', 'all'], ['띠 위', 'upper'], ['띠 아래', 'lower']], sf.zone || 'all', (v) => { sf.zone = v; commit('zone'); }));
      row('색', this.palette(PALETTE_WALL, sf.paint, (hex) => { sf.paint = hex; commit('paint'); }));
      row('스캔 텍스처', check(sf.texture !== false, (v) => { sf.texture = v; commit('tex'); }, '보이기'));
      row('화이트 몰딩', check(sf.molding !== false, (v) => { sf.molding = v; commit('molding'); }, '이 기둥에 몰딩'));
    }
    if (sel.kind === 'ceiling' || sel.kind === 'floor') {
      const sf = this.s.surface(sel.id); const isFloor = sel.kind === 'floor'; const t = this.tiles.find((x) => `${sel.kind}_t${x.num}` === sel.id);
      h(`<h4>${isFloor ? '바닥' : '천장'} ${t ? t.num : '전체'} <small>${t ? `x ${t.x[0].toFixed(1)}~${t.x[1].toFixed(1)} · z ${t.z[0].toFixed(1)}~${t.z[1].toFixed(1)}` : '모든 타일 기본값'}</small></h4>`);
      row('색', this.palette(isFloor ? PALETTE_FLOOR : PALETTE_CEIL, sf.paint, (hex) => { sf.paint = hex; commit('paint'); }));
      if (!t) row('스캔 텍스처', check(sf.texture !== false, (v) => { sf.texture = v; commit('tex'); }, '보이기 (끄면 복원 단색)'));
      if (t) box.appendChild(btn('이 타일 색 지우기(전체 설정 따름)', () => { sf.paint = null; commit('paint'); }, 'ghost'));
      if (isFloor) h(`<div class="hint">스캔 바닥 중간색 #${(this.meta.sampled_colors?.floor_wood?.median || [106, 79, 53]).map((v) => v.toString(16).padStart(2, '0')).join('')} 기준 밝게/어둡게 프리셋 제공</div>`);
    }
    if (sel.kind === 'window') {
      const w = this.walls().find((x) => x.id === sel.wall); const win = this.s.windowsOf(w.id).find((x) => x.id === sel.id); if (!win) return;
      h(`<h4>창 — 벽 ${w.num} <small>${esc(win.id)}</small></h4>`);
      row('시작 위치', num(Math.round((win.from - w.from) * 100), 1, (v) => { win.from = +(w.from + v / 100).toFixed(2); commit('window'); }, 'cm (벽 시작점부터)'));
      row('폭', num(Math.round((win.to - win.from) * 100), 1, (v) => { win.to = +(win.from + v / 100).toFixed(2); commit('window'); }));
      row('하단 높이', num(Math.round(win.y0 * 100), 1, (v) => { win.y0 = v / 100; commit('window'); }));
      row('상단 높이', num(Math.round(win.y1 * 100), 1, (v) => { win.y1 = v / 100; commit('window'); }));
      row('프레임 색', this.palette([['실버', '#8a8f94'], ['블랙', '#1c1c1c'], ['화이트', '#f1f1f1'], ['브론즈', '#6b4b2a']], win.frame, (hex) => { win.frame = hex; commit('window'); }));
      h('<h4>커튼</h4>');
      row('커튼', check(win.curtain.on, (v) => { win.curtain.on = v; commit('curtain'); }, '달기'));
      row('커튼 색', this.palette(PALETTE_CURTAIN, win.curtain.color, (hex) => { win.curtain.color = hex; commit('curtain'); }));
      row('스타일', selectEl([['양쪽으로 걷음', 'open'], ['전체 닫음', 'closed']], win.curtain.style, (v) => { win.curtain.style = v; commit('curtain'); }));
      box.appendChild(btn('이 창 삭제', () => { this.s.removeWindow(w.id, win.id); commit('window'); this.renderChips(); this.select({ kind: 'wall', id: w.id }); }, 'danger'));
    }
    if (sel.kind === 'prop') {
      const p = this.s.design.props.find((x) => x.id === sel.id); if (!p) return; const name = (PROP_TYPES.find((x) => x[1] === p.type) || ['소품'])[0];
      h(`<h4>${esc(name)} <small>드래그로 이동 · ${esc(p.id)}</small></h4>`);
      const rot = document.createElement('input'); rot.type = 'range'; rot.min = -180; rot.max = 180; rot.step = 5; rot.value = Math.round((p.rot || 0) * 180 / Math.PI); rot.addEventListener('input', () => { p.rot = rot.value * Math.PI / 180; const g = this.props.children.find((c) => c.userData.pick?.id === p.id); if (g) g.rotation.y = p.rot; }); rot.addEventListener('change', () => commit('prop')); row('회전', rot);
      row('크기', num(Math.round((p.scale || 1) * 100), 5, (v) => { p.scale = v / 100; commit('prop'); }, '%'));
      row('위치 X', num(Math.round(p.x * 100), 1, (v) => { p.x = v / 100; commit('prop'); })); row('위치 Z', num(Math.round(p.z * 100), 1, (v) => { p.z = v / 100; commit('prop'); }));
      row('색', this.palette([['기본', null], ['우드', '#b08a5a'], ['월넛', '#5c3d26'], ['블랙', '#1c1c1c'], ['화이트', '#f3f1ec'], ['와인', '#7a2e2e'], ['네이비', '#2f3a4f'], ['세이지', '#9aa58d']], p.color, (hex) => { p.color = hex; commit('prop'); }));
      const r = document.createElement('div'); r.className = 'row'; r.append(btn('복제', () => { const q = this.s.addProp({ ...p, id: undefined, x: p.x + 0.6 }); commit('prop'); this.select({ kind: 'prop', id: q.id }); }), btn('삭제', () => { this.s.removeProp(p.id); commit('prop'); this.select(null); }, 'danger')); box.appendChild(r);
    }
    if (sel.kind === 'landmark') { const names = { entrance: '입구', kitchen: '주방', toilet: '화장실', windows: '창가', main: '메인' }; h(`<h4>📍 ${names[sel.id] || sel.id}</h4><div class="hint">핀을 드래그해 실제 위치로 옮기세요. 북마크와 라벨이 따라갑니다.</div>`); }
  }
  // 소품 배치 시작
  startPlacing(type) { this.placing = type; const name = (PROP_TYPES.find((x) => x[1] === type) || [type])[0]; $('#placingHint').textContent = `${name}: 바닥을 클릭해 놓으세요`; }
  startMeasure() { this.measuring = []; this.toast('두 점을 클릭하면 거리를 잽니다'); }
  clearMeasures() { this.measures.clear(); this.measuring = null; }
  screenshot() { this.v.renderer.render(this.v.scene, this.v.camera); const a = document.createElement('a'); a.href = this.v.renderer.domElement.toDataURL('image/png'); a.download = `kobe-design-${Date.now()}.png`; a.click(); }
}
