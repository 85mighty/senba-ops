// 편집기 — 번호 매긴 면(벽 세그먼트·기둥·천장·바닥 타일) 선택, 마감/몰딩/액자/거울/실측, 창·커튼, 소품, 랜드마크, 측정, 저장.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PALETTE_WALL, PALETTE_FLOOR, PALETTE_CEIL, PALETTE_CURTAIN, PALETTE_TRIM, PALETTE_LOWER, FRAME_STYLES, PROP_TYPES } from './design.js';
import { buildProp, buildWindow, buildCurtain, measureLine } from './props.js';
import { disposeTree } from './viewer.js';
import { isFixtureWall, isExteriorWall, exteriorSpans, doorOpenings, openingOn, serviceOf, subtractRects, floorKept, inExterior, closureWallsAll, closureOn } from './scope.js';
import { buildFixtures, cutWallOpening, buildPassCurtain } from './fixtures.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TILE = 1.5;

export class Editor {
  static LONG_PRESS = 450;   // 소품을 옮기려면 이만큼(ms) 누르고 있어야 한다
  constructor(viewer, interior, store, toast) {
    this.v = viewer; this.i = interior; this.s = store; this.meta = viewer.meta; this.toast = toast;
    this.enabled = false; this.selected = null; this.placing = null; this.measuring = null;
    this.root = new THREE.Group(); this.root.name = 'editor'; viewer.scene.add(this.root);
    this.overlays = new THREE.Group(); this.picks = new THREE.Group(); this.labels = new THREE.Group(); this.hl = new THREE.Group();
    this.windows = new THREE.Group(); this.windows.name = 'windows'; this.props = new THREE.Group(); this.props.name = 'props'; this.marks = new THREE.Group(); this.measures = new THREE.Group();
    for (const g of [this.overlays, this.picks, this.labels, this.hl, this.windows, this.props, this.marks, this.measures]) this.root.add(g);
    this.labels.visible = false; this.picks.visible = false;
    this.intCeil = null;   // 내부 천장(단일). 위에서 볼 때는 뷰어 자동 클리핑으로 사라진다
    this.bands = new THREE.Group(); this.bands.name = 'bands'; this.root.add(this.bands);
    this.hidden = new Set(); try { const h = JSON.parse(localStorage.getItem('kobe3d.hidden') || '[]'); for (const x of h) if (!String(x).startsWith('ceiling_t')) this.hidden.add(x); } catch {}
    this.autoHide = true; try { this.autoHide = localStorage.getItem('kobe3d.autoHide') !== '0'; } catch {}   // 기본 켬, 끄면 기억
    this._autoHidden = new Set();
    viewer.controls.addEventListener('change', () => { if (this.autoHide) this.scheduleAutoHide(); });
    this.tc = new TransformControls(viewer.camera, viewer.renderer.domElement); this.tc.setSize(0.7); this.tc.showY = false; this.tc.enabled = false;   // 화살표 기즈모는 쓰지 않음(길게 눌러 끌기) — 포인터를 붙잡지 않게 끔
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
  allWalls() { return (this.meta.elements || []).filter((e) => e.type === 'wall').concat(closureWallsAll(this.meta)); }
  // 꾸밀 수 있는 벽 — 싱크대 앞면처럼 벽이 아닌 면, 입구 밖 벽은 뺀다(번호는 그대로 유지)
  walls() { return this.allWalls().filter((e) => !isFixtureWall(this.meta, e.id) && !isExteriorWall(this.meta, e) && (!e.virtual || closureOn(this.meta, this.s.design, e.id))); }
  columns() { return (this.meta.elements || []).filter((e) => ['wide_column', 'thin_column'].includes(e.type)); }

  // ---------------- 번호 매긴 항목
  buildItems() {
    this.items = []; let n = 0;
    const deco = new Set(this.walls().map((w) => w.id));
    for (const w of this.allWalls()) { n++; w.num = n; if (deco.has(w.id)) this.items.push({ kind: 'wall', id: w.id, label: `벽 ${n}`, el: w }); }
    let c = 0; for (const col of this.columns()) { c++; col.num = c; this.items.push({ kind: 'column', id: col.id, label: `기둥 ${c}${col.id === this.meta.central_wide_column ? ' (넓은 가벽)' : ''}`, el: col }); }
    // 천장/바닥 타일: 바닥 bbox 를 TILE 격자로
    const b = this.meta.bounds_world_m; const x0 = b.min[0], z0 = b.min[2]; const nx = Math.ceil((b.max[0] - x0) / TILE), nz = Math.ceil((b.max[2] - z0) / TILE);
    this.tiles = []; let t = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const tile = { i, j, x: [x0 + i * TILE, Math.min(x0 + (i + 1) * TILE, b.max[0])], z: [z0 + j * TILE, Math.min(z0 + (j + 1) * TILE, b.max[2])], last: { x: i === nx - 1, z: j === nz - 1 } };
      if (!this.tileOnFloor(tile)) continue; t++; tile.num = t; this.tiles.push(tile);
      this.items.push({ kind: 'floor', id: `floor_t${t}`, label: `바닥 ${t}`, tile });
    }
    this.items.push({ kind: 'ceiling', id: 'ceiling', label: '천장 전체' }); this.items.push({ kind: 'floor', id: 'floor', label: '바닥 전체' });
  }
  // 복원 바닥 격자(0.1 m 칸)의 삼각형 — 바닥 칠은 이 모양 그대로 덮어 벽 가장자리까지 빈틈이 없게 한다
  floorTris() {
    if (this._floorTris !== undefined) return this._floorTris; this._floorTris = null;
    let src = null; this.v.loaded?.reconstructed?.traverse((o) => { if (o.isMesh && o.name === 'floor') src = o; }); if (!src) return null;
    src.updateWorldMatrix(true, false); const g = src.geometry.index ? src.geometry.toNonIndexed() : src.geometry.clone(); g.applyMatrix4(src.matrixWorld);
    this._floorTris = g.attributes.position.array; return this._floorTris;
  }
  tileGeometry(tile, last, paintOnly = false) {
    const pos = this.floorTris(); if (!pos) return null; const out = [];
    for (let i = 0; i < pos.length; i += 9) {
      const cx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3, cz = (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3;
      if (paintOnly) { const bx = (Math.min(pos[i], pos[i + 3], pos[i + 6]) + Math.max(pos[i], pos[i + 3], pos[i + 6])) / 2, bz = (Math.min(pos[i + 2], pos[i + 5], pos[i + 8]) + Math.max(pos[i + 2], pos[i + 5], pos[i + 8])) / 2; if (floorKept(this.meta, bx, bz)) continue; }   // 칠: 입구 밖·주방·화장실 바닥은 그대로
      if (cx >= tile.x[0] && (cx < tile.x[1] || (last.x && cx <= tile.x[1] + 0.2)) && cz >= tile.z[0] && (cz < tile.z[1] || (last.z && cz <= tile.z[1] + 0.2))) for (let k = 0; k < 9; k++) out.push(pos[i + k]);
    }
    if (!out.length) return null;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3)); geo.computeVertexNormals(); return geo;
  }
  tileOnFloor(tile) { if (!this.floorTris()) return true; tile.geo = this.tileGeometry(tile, tile.last || {}); return !!tile.geo; }
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
  // 꾸밈을 하지 않을 벽면 구멍 [t0,t1,y0,y1]: 창(틀 포함), 문 개구부, 입구 밖 구간
  holesOf(w) {
    if (!w || w.key) return [];   // 기둥 면
    const H = [];
    for (const win of this.s.windowsOf(w.id)) H.push([win.from - 0.04, win.to + 0.04, win.y0 - 0.04, win.y1 + 0.04]);
    for (const d of doorOpenings(this.meta, w.id, this.s.design)) H.push([d.from - 0.03, d.to + 0.03, -1, d.y1 + 0.03]);
    for (const [a, b] of exteriorSpans(this.meta, w)) H.push([a, b, -1, 99]);
    return H;
  }
  // 벽면 사각형을 구멍을 피해 여러 장으로 — 각 조각마다 fn(t0, t1, y0, y1)
  eachPiece(w, t0, t1, y0, y1, fn) { for (const r of subtractRects([t0, t1, y0, y1], this.holesOf(w))) fn(...r); }
  zoneRange(zone) { return zone === 'upper' ? [this.chair, this.ceil] : zone === 'lower' ? [this.base, this.chair] : [0, this.ceil]; }

  // ---------------- 픽 메쉬 (투명) & 라벨
  buildPicks() {
    disposeTree(this.picks); const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide });
    for (const w of this.walls()) for (const seg of this.segmentsOf(w)) {
      const sides = w.two_sided ? [w.inward, -w.inward] : [w.inward];
      for (const sd of sides) { const q = this.wallQuad(w, seg.from, seg.to, 0, this.ceil, 0.03, mat, sd); q.userData.pick = { kind: 'wall', id: w.id, seg: seg.key }; this.picks.add(q); }
    }
    for (const col of this.columns()) { const fp = this.s.footprint(col); const m = new THREE.Mesh(new THREE.BoxGeometry(fp.x[1] - fp.x[0] + 0.06, this.ceil, fp.z[1] - fp.z[0] + 0.06), mat); m.position.set((fp.x[0] + fp.x[1]) / 2, this.ceil / 2, (fp.z[0] + fp.z[1]) / 2); m.userData.pick = { kind: 'column', id: col.id }; this.picks.add(m); }
    for (const tile of this.tiles) for (const [kind, y] of [['ceiling', this.ceil - 0.03], ['floor', 0.03]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(tile.x[1] - tile.x[0], tile.z[1] - tile.z[0]), mat); m.rotation.x = -Math.PI / 2; m.position.set((tile.x[0] + tile.x[1]) / 2, y, (tile.z[0] + tile.z[1]) / 2); m.userData.pick = { kind, id: kind === 'ceiling' ? 'ceiling' : `${kind}_t${tile.num}` }; this.picks.add(m);
    }
  }
  buildLabels() {
    disposeTree(this.labels);
    const add = (text, pos, color) => { const sp = this.v.textSprite(text, color); sp.scale.set(0.9, 0.22, 1); sp.position.copy(pos); this.labels.add(sp); };
    for (const w of this.walls()) { const p = new THREE.Vector3(); const t = (w.from + w.to) / 2; if (w.axis === 'x') p.set(w.offset + w.inward * 0.25, this.ceil - 0.25, t); else p.set(t, this.ceil - 0.25, w.offset + w.inward * 0.25); add(`벽 ${w.num}`, p, '#ffe08a'); }
    for (const col of this.columns()) { const fp = this.s.footprint(col); add(`기둥 ${col.num}`, new THREE.Vector3((fp.x[0] + fp.x[1]) / 2, this.ceil - 0.15, (fp.z[0] + fp.z[1]) / 2), '#ffb0b0'); }
    if (!this.tileLabels) { this.tileLabels = new THREE.Group(); this.tileLabels.visible = false; this.root.add(this.tileLabels); }
    disposeTree(this.tileLabels);
    const addT = (text, pos, color) => { const sp = this.v.textSprite(text, color); sp.scale.set(0.6, 0.15, 1); sp.position.copy(pos); this.tileLabels.add(sp); };
    for (const t of this.tiles) { const cx = (t.x[0] + t.x[1]) / 2, cz = (t.z[0] + t.z[1]) / 2; addT(`바닥 ${t.num}`, new THREE.Vector3(cx, 0.08, cz), '#d2ffc9'); }
  }
  setLabels(on) { this.labels.visible = on; }
  // ①②(스캔 비교)에서는 디자인·설비 그림을 숨기고 스캔만 보인다
  setModelVisible(on) { this.modelOn = on; for (const g of [this.overlays, this.bands, this.windows, this.doors, this.fixtures, this.props, this.closureG]) if (g) g.visible = on; this.applyHidden(); }
  setTileLabels(on) { if (this.tileLabels) this.tileLabels.visible = on; }

  // ---------------- 디자인 적용 (오버레이·창·커튼·소품·랜드마크)
  rebuildAll() {
    const keep = this.selected; this.tc.detach();           // 다시 그리기 전에 기즈모를 떼야 사라진 객체를 붙잡지 않는다
    this.buildOverlays(); this.buildWindows(); this.buildProps(); this.buildMarks(); this.buildPicks();
    this.i.rebuild('molding'); this.i.rebuild('gallery_art'); this.i.rebuild('mirror_4_sides'); this.applyColumnSizes(); this.buildLabels();
    this.v.updateHighlight(); this.refreshHighlight();
    if (keep?.kind === 'prop' || keep?.kind === 'landmark') this.reattach(keep);
    this.buildBands(); this.buildInteriorCeiling(); this.buildDoors(); this.buildClosures(); this.applyScanScope(); this.applyHidden();
  }
  // 막기 벽(주방 입구 등): 디자인에서 켠 것만 회색 벽지 벽으로 세운다. 켜고 끌 때 번호 목록도 다시 만든다
  buildClosures() {
    if (!this.closureG) { this.closureG = new THREE.Group(); this.closureG.name = 'closures'; this.root.add(this.closureG); }
    disposeTree(this.closureG); this.closureG.visible = this.modelOn !== false; const mat = new THREE.MeshStandardMaterial({ color: 0xa9a59f, roughness: 0.9 });
    const on = []; for (const c of this.meta.closures || []) { if (!this.s.design.closures?.[c.id]) continue; on.push(c.id); const w = c.wall, T = this.meta.wall_thickness_m || 0.1;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w.to - w.from, this.ceil, T), mat); m.userData.surface = w.id; this.placeOnWall(m, { ...w, sid: w.id }, (w.from + w.to) / 2, this.ceil / 2, -T / 2); this.closureG.add(m); }
    this.curtainOpen = this.curtainOpen || {};
    for (const d of this.meta.door_openings || []) if (d.curtain && openingOn(d, this.s.design)) this.closureG.add(buildPassCurtain(d, !!this.curtainOpen[d.id], (open) => { this.curtainOpen[d.id] = open; }));
    const key = on.join(','); if (this._closureKey !== undefined && key !== this._closureKey) { this.buildItems(); this.buildPicks(); this.buildLabels(); this.renderChips?.(); } this._closureKey = key;
  }
  // 스캔 복원 모델 정리(한 번): 싱크대 앞면·수납 상자처럼 잘못 잡힌 면은 숨기고 주방·화장실 설비로 대체, 화장실 문 구멍 내기.
  // 입구 밖 벽은 스캔 그대로(텍스처·창·띠 보임)
  applyScanScope() {
    const rec = this.v.loaded?.reconstructed; if (!rec) return;
    if (!this.fixtures) { this.fixtures = buildFixtures(this.meta); this.fixtures.visible = this.modelOn !== false; this.root.add(this.fixtures); }
    const hideIds = [...Object.keys(this.meta.fixture_walls || {}), ...Object.keys(this.meta.hidden_scan_blobs || {})];
    const ext = this.allWalls().filter((w) => isExteriorWall(this.meta, w)).map((w) => w.id);
    const owner = (name, ids) => ids.find((id) => name === id || name.startsWith(id + '_'));
    rec.traverse((o) => {
      if (!o.isMesh) return;
      if (owner(o.name, hideIds)) { o.userData.keepVisible = false; return; }
      if (owner(o.name, ext) && (o.name.includes('_tex') || /_window_\d+$/.test(o.name))) o.userData.keepVisible = true;
    });
    for (const d of this.meta.door_openings || []) {
      const w = this.allWalls().find((x) => x.id === d.wall); if (!w) continue; const on = openingOn(d, this.s.design); const meshes = [];
      rec.traverse((o) => { if (o.isMesh && owner(o.name, [d.wall])) meshes.push(o); });
      for (const o of meshes) {
        const cut = (o.userData.cut || []).includes(d.id);
        if (on && !cut) { if (d.when && !o.userData.base) o.userData.base = o.geometry.clone(); cutWallOpening(o, w.axis, d.from, d.to, -1, d.y1); (o.userData.cut = o.userData.cut || []).push(d.id); }
        else if (!on && cut && o.userData.base) { o.geometry.dispose(); o.geometry = o.userData.base.clone(); o.userData.cut = o.userData.cut.filter((x) => x !== d.id); }   // 막기 벽을 끄면 원래 벽으로
      }
    }
  }
  // ---------------- 문 열고 닫기: 화면에서 문짝을 누르면 경첩을 돌린다(가려진 문은 안 잡힘)
  // 화면에서 실제로 보이는 맨 앞 물체 — 숨김·라벨·투명 선택판은 건너뛰고, 위에서 볼 때 잘려 안 보이는 천장 위쪽도 건너뛴다
  frontHit(ev) {
    const r = this.v.renderer.domElement.getBoundingClientRect(); const p = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(p, this.v.camera);
    const shown = (o) => { for (let q = o; q; q = q.parent) if (!q.visible || q === this.picks || q === this.labels || q === this.hl) return false; return true; };
    const objs = []; this.v.scene.traverse((o) => { if (o.isMesh && shown(o)) objs.push(o); });
    const cut = this.v.clipPlane?.constant ?? Infinity;
    return rc.intersectObjects(objs, false).find((h) => h.point.y <= cut + 1e-3) || null;
  }
  doorAt(ev) { if (!this.fixtures?.visible) return null; return this.frontHit(ev)?.object.userData.doorPivot || null; }
  toggleDoor(pivot) {
    const sw = pivot.userData.swing; sw.isOpen = !sw.isOpen; sw.onToggle?.(sw.isOpen);
    const ps = sw.pivots || [pivot]; const get = () => (sw.kind === 'scale' ? ps[0].scale.x : ps[0].rotation.y), set = (v) => { for (const q of ps) { if (sw.kind === 'scale') q.scale.x = v; else q.rotation.y = v; } };
    const from = get(), to = sw.isOpen ? sw.open : sw.closed; let t = 0;
    this.v.onFrame.push((dt) => { t = Math.min(1, t + dt * 1.8); const k = t * t * (3 - 2 * t); set(from + (to - from) * k); return t < 1; });
    return sw.isOpen;
  }
  // ---------------- 띠(체어레일)·걸레받이: 벽/기둥별. 기본(검정·평면)과 다른 면만 GLB 띠를 숨기고 직접 그린다
  // 주방·화장실 안쪽 벽은 실제로 띠가 없다(타일·회색 벽) — 그 벽만의 띠 설정을 하지 않았으면 전체 설정(띠·하부 벽)을 적용하지 않는다
  plainService(id) { return !!serviceOf(this.meta, id) && !this.s.hasOwnTrim(id); }
  isDefaultTrim(t) { return t.rail.color === '#1c1c1c' && t.rail.style === 'flat' && t.base.color === '#1c1c1c' && t.base.style === 'flat'; }
  buildBands() {
    disposeTree(this.bands);
    const rec = this.v.loaded?.reconstructed;
    // 스캔 띠(GLB)는 기본(검정·평면) 띠이면서 창·문이 없는 벽에서만 쓴다. 창·문이 있으면 띠를 끊어야 해서 직접 그린다
    const byId = new Map(this.allWalls().map((w) => [w.id, w]));
    if (rec) rec.traverse((o) => { const m = o.isMesh && o.name.match(/^(.*)_(chairrail|baseboard)(_b)?$/); if (!m) return; const w = byId.get(m[1]);
      if (w && (isFixtureWall(this.meta, w.id) || this.plainService(w.id))) o.userData.keepVisible = false; else if (w && isExteriorWall(this.meta, w)) o.userData.keepVisible = true;
      else o.userData.keepVisible = this.isDefaultTrim(this.s.trimOf(m[1])) && !(w && this.holesOf(w).length); });
    const railT = this.meta.chair_rail_thickness_m || 0.08; const base = this.base, chair = this.chair;
    const mats = {}; const mk = (color) => mats[color] || (mats[color] = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: color === '#c9a24a' ? 0.6 : 0.0 }));
    // 창·문·입구 밖 구간은 띠를 끊는다(창 유리 뒤로 띠가 비치지 않게)
    const strip = (w, y0, y1, depth, mat, sd, sid) => { const ww = { ...w, inward: sd, sid }; this.eachPiece(w, w.from, w.to, y0, y1, (a, b, c, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, d - c, depth), mat); this.placeOnWall(m, ww, (a + b) / 2, (c + d) / 2, depth / 2 + 0.002); this.bands.add(m); }); };
    const addBands = (faces, sid, force = false) => {
      const g = this.s.trimOf(sid); if ((this.isDefaultTrim(g) && !force) || this.plainService(sid)) return;
      for (const f of faces) {
        const sides = f.two_sided ? [f.inward, -f.inward] : [f.inward];
        for (const sd of sides) {
          if (g.base.style === 'molding') { strip(f, 0, base, 0.014, mk(g.base.color), sd, sid); strip(f, base - 0.02, base, 0.022, mk(g.base.color), sd, sid); }
          else strip(f, 0, base, 0.012, mk(g.base.color), sd, sid);
          if (g.rail.style === 'molding') { strip(f, chair - railT, chair, 0.012, mk(g.rail.color), sd, sid); strip(f, chair - railT * 0.65, chair - railT * 0.35, 0.03, mk(g.rail.color), sd, sid); strip(f, chair - 0.006, chair, 0.02, mk(g.rail.color), sd, sid); }
          else strip(f, chair - railT, chair, 0.012, mk(g.rail.color), sd, sid);
        }
      }
    };
    for (const w of this.walls()) addBands([w], w.id, this.holesOf(w).length > 0 || !!w.virtual);   // 막기 벽은 스캔 띠가 없어 직접 그림
    for (const col of this.columns()) addBands(this.i.columnFaces(col).map((f) => ({ ...f, two_sided: false })), col.id);
  }
  // 하부 벽(띠 사이) 마감 오버레이 — 벽/기둥별
  addLower(face, sid, sides) {
    const lower = this.s.trimOf(sid).lower; if (!lower.paint || this.plainService(sid)) return;
    const top = this.chair - (this.meta.chair_rail_thickness_m || 0.08);
    const mat = this.paintMat(lower.paint), dark = lower.style === 'wood_panel' ? this.paintMat(this.shade(lower.paint, 0.7)) : null;
    for (const sd of sides) {
      this.eachPiece(face, face.from, face.to, this.base, top, (a, b, c, d) => { const q = this.wallQuad(face, a, b, c, d, 0.0012, mat, sd); q.userData.surface = sid; this.overlays.add(q); });
      if (dark) for (let t = face.from + 0.1; t < face.to - 0.02; t += 0.1) this.eachPiece(face, t, t + 0.006, this.base, top, (a, b, c, d) => { const line = this.wallQuad(face, a, b, c, d, 0.0014, dark, sd); line.userData.surface = sid; this.overlays.add(line); });
    }
  }
  // ---------------- 입구 자동문 (스캔의 문짝 블롭 → 문). 양옆 0.45 m 안의 벽까지 폭을 넓혀 복도를 막는다
  buildDoors() {
    if (!this.doors) { this.doors = new THREE.Group(); this.doors.name = 'doors'; this.root.add(this.doors); }
    disposeTree(this.doors); const doors = (this.meta.elements || []).filter((e) => e.type === 'door_panel');
    this.v.loaded?.reconstructed?.traverse((o) => { if (o.isMesh && doors.some((d) => o.name === d.id)) o.userData.keepVisible = false; });
    const frame = new THREE.MeshStandardMaterial({ color: 0x3b2a20, roughness: 0.55 }); const wood = new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xdfe9f2, transparent: true, opacity: 0.32, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    for (const d of doors) {
      const fx = d.footprint.x, fz = d.footprint.z; const alongX = (fx[1] - fx[0]) >= (fz[1] - fz[0]);
      let a0 = alongX ? fx[0] : fz[0], a1 = alongX ? fx[1] : fz[1]; const c = alongX ? (fz[0] + fz[1]) / 2 : (fx[0] + fx[1]) / 2;
      let lo = null, hi = null;
      for (const w of this.walls()) { if ((w.axis === 'x') !== alongX) continue; if (c < w.from - 0.05 || c > w.to + 0.05) continue;
        if (w.offset <= a0 + 0.05 && a0 - w.offset < 0.45 && (lo === null || w.offset > lo)) lo = w.offset; if (w.offset >= a1 - 0.05 && w.offset - a1 < 0.45 && (hi === null || w.offset < hi)) hi = w.offset; }
      if (lo !== null) a0 = lo; if (hi !== null) a1 = hi;
      const W = a1 - a0, H = 2.02, head = Math.min(0.2, this.ceil - H - 0.02); const g = new THREE.Group(); g.name = 'door'; g.userData.doorOf = d.id;
      const box = (w, h, dz, mat, x, y, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dz), mat); m.position.set(x, y, z); g.add(m); return m; };
      box(0.05, H, 0.07, frame, -W / 2 + 0.025, H / 2); box(0.05, H, 0.07, frame, W / 2 - 0.025, H / 2);           // 양옆 프레임
      if (head > 0.02) box(W, head, 0.14, frame, 0, H + head / 2);                                                       // 상부 헤더(도어 클로저)
      box(W, 0.03, 0.08, frame, 0, 0.015);                                                                                 // 하부 레일
      // 나무 고정 패널은 실내에서 문을 바라볼 때 왼쪽(사진 기준). 문이 X 방향이면 실내가 어느 쪽인지로 좌우를 정한다
      const bb = this.meta.bounds_world_m; const roomZ = (bb.min[2] + bb.max[2]) / 2; const sgn = alongX ? (c > roomZ ? 1 : -1) : 1;
      const side = Math.min(0.3, W * 0.3); const sx = (x) => sgn * x;
      box(side, H - 0.06, 0.04, wood, sx(W / 2 - 0.05 - side / 2), H / 2, -0.02);                                          // 나무 고정 패널
      const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.06, H - 0.4), glass); slit.position.set(sx(W / 2 - 0.05 - side + 0.06), H / 2, 0.001); g.add(slit);
      const gw = W - 0.1 - side; box(0.04, H - 0.06, 0.05, frame, sx(W / 2 - 0.05 - side - 0.02), H / 2, 0.01);           // 유리문 세로 틀
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(gw - 0.04, H - 0.12), glass); pane.position.set(sx(W / 2 - 0.05 - side - 0.04 - (gw - 0.04) / 2), H / 2, 0.01); g.add(pane);
      if (alongX) g.position.set((a0 + a1) / 2, 0, c); else { g.position.set(c, 0, (a0 + a1) / 2); g.rotation.y = Math.PI / 2; }
      g.traverse((o) => { o.userData.surface = 'door'; }); this.doors.add(g);
      const sp = this.v.textSprite('입구 (자동문)', '#9be28a'); sp.scale.set(0.9, 0.22, 1); sp.position.set(g.position.x, H + 0.35, g.position.z); this.labels.add(sp);
    }
  }
  // ---------------- 숨기기 / 보이기
  surfaceOfMesh(o) {
    if (o.userData.surface) return o.userData.surface;
    const n = o.name || ''; const m = n.match(/^(wall_[xz]_\d+|wide_column_\d+|thin_column_\d+|enclosure_\d+|door_panel_\d+|fixture_candidate_\d+)/); if (m) return m[1];
    if (n.startsWith('ceiling')) return 'ceiling'; if (n.startsWith('floor')) return 'floor'; return null;
  }
  isHidden(id) { return this.hidden.has(id) || this._autoHidden.has(id); }
  applyHidden() {
    const ceilHidden = this.isHidden('ceiling'); const scan = this.ceilPaint() === 'scan';
    const rec = this.v.loaded?.reconstructed;
    const visit = (o) => {
      if (!o.isMesh) return; const sid = this.surfaceOfMesh(o); if (!sid) return;
      // 천장: 기본은 편집기 내부 천장(단색). '스캔 원본'을 고르면 구운 천장 텍스처. 복원 회색 격자 천장은 항상 숨김
      if (sid === 'ceiling') { o.visible = o.name === 'ceiling_tex' ? (scan && !ceilHidden && !this.v.clipping) : false; return; }
      if (o.userData.windowOf) { o.visible = !this.isHidden(o.userData.windowOf); return; }
      o.visible = !this.isHidden(sid) && (o.userData.keepVisible ?? true);
    };
    if (rec) rec.traverse(visit); this.i.root.traverse(visit); this.overlays.traverse(visit); this.windows.traverse((o) => { if (o.isMesh) { const w = o.userData.windowOf; o.visible = !(w && this.isHidden(w)); } });
    if (this.intCeil) this.intCeil.visible = this.modelOn !== false && !scan && !ceilHidden && !this.v.clipping;
    this.renderHiddenChips?.();
  }
  ceilPaint() { const p = this.s.getSurface('ceiling').paint; return p === 'scan' ? 'scan' : (p || '#f2efe9'); }
  // 내부 천장: 복원 바닥 점유와 같은 모양(천장 높이)의 단일 면. 실내에서 올려다볼 때만 보이고, 카메라가 천장 위로 가면 뷰어가 잘라낸다
  buildInteriorCeiling() {
    if (this.intCeil) { this.intCeil.removeFromParent(); this.intCeil.geometry.dispose(); this.intCeil.material.dispose(); this.intCeil = null; }
    const rec = this.v.loaded?.reconstructed; if (!rec) return;
    let src = null; rec.traverse((o) => { if (o.isMesh && o.name === 'ceiling') src = o; }); if (!src) return;
    src.updateWorldMatrix(true, false);
    let geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
    if (this.meta.exterior_zones?.length) {   // 입구 밖(계단참) 천장은 칠하지 않는다
      const g = geo.index ? geo.toNonIndexed() : geo; const p = g.attributes.position.array; const keep = [];
      for (let i = 0; i < p.length; i += 9) if (!inExterior(this.meta, (p[i] + p[i + 3] + p[i + 6]) / 3, (p[i + 2] + p[i + 5] + p[i + 8]) / 3)) keep.push(i);
      const out = new Float32Array(keep.length * 9); keep.forEach((i, k) => out.set(p.subarray(i, i + 9), k * 9));
      if (g !== geo) g.dispose(); geo.dispose(); geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
    }
    // 복원 GLB 에는 법선이 없다(로더가 원본에만 flatShading 을 켜 준다) → 복제본은 직접 계산하지 않으면 조명이 NaN 이 되어 검게 나온다
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const paint = this.ceilPaint();
    // 천장 아랫면은 위에서 오는 조명(반구광·직사광)을 받지 못해 검게 나온다 → 자기 색으로 은은하게 발광시켜 실제 천장 밝기에 가깝게
    const col = paint === 'scan' ? '#f2efe9' : paint;
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.45, roughness: 0.92, side: THREE.DoubleSide, clippingPlanes: [this.v.clipPlane] });
    const m = new THREE.Mesh(geo, mat); m.name = 'interior_ceiling'; m.position.y -= 0.006; m.userData.surface = 'ceiling';
    this.root.add(m); this.intCeil = m;
  }
  setHidden(id, on) { if (on) this.hidden.add(id); else this.hidden.delete(id); try { localStorage.setItem('kobe3d.hidden', JSON.stringify([...this.hidden])); } catch {} this.applyHidden(); this.renderInspector(); }
  showAll() { this.hidden.clear(); this._autoHidden.clear(); try { localStorage.removeItem('kobe3d.hidden'); } catch {} this.applyHidden(); this.renderInspector(); }
  // 자동 숨김: 카메라가 벽의 바깥쪽에 있거나 벽이 카메라와 주시점 사이에 끼면 숨김. 카메라가 천장 가까이/위면 천장 숨김.
  setAutoHide(on) { this.autoHide = on; try { localStorage.setItem('kobe3d.autoHide', on ? '1' : '0'); } catch {} if (!on) { this._autoHidden.clear(); this.applyHidden(); } else this.runAutoHide(); }
  scheduleAutoHide() { if (this._ah) return; this._ah = setTimeout(() => { this._ah = null; this.runAutoHide(); }, 120); }
  runAutoHide() {
    const cam = this.v.camera.position, tgt = this.v.controls.target; const next = new Set();
    for (const w of this.walls()) {
      if (w.two_sided) continue; const ax = w.axis === 'x' ? 0 : 2; const other = 2 - ax; const c = [cam.x, cam.y, cam.z], t = [tgt.x, tgt.y, tgt.z];
      const sideCam = (c[ax] - w.offset) * w.inward, sideTgt = (t[ax] - w.offset) * w.inward;
      const inSpan = (p) => p[other] > w.from - 0.3 && p[other] < w.to + 0.3;
      // 카메라가 벽 바깥(안쪽 반대)이고 주시점이 안쪽이면 이 벽이 시야를 막는다
      if (sideCam < 0.05 && sideTgt > 0 && (inSpan(c) || inSpan(t))) next.add(w.id);
    }
    const changed = next.size !== this._autoHidden.size || [...next].some((x) => !this._autoHidden.has(x));
    if (changed) { this._autoHidden = next; this.applyHidden(); }
  }
  reattach() {}   // 소품·핀은 화살표 기즈모 대신 길게 눌러 끌어 옮긴다(dragTargetAt·beginDrag)
  // ---------------- 소품 끌어 옮기기: 화면 맨 앞에 보이는 것이 소품(편집 중이면 위치 핀도)일 때만 잡는다
  dragTargetAt(ev) {
    const hit = this.frontHit(ev); if (!hit) return null;
    for (let o = hit.object; o; o = o.parent) { const k = o.userData.pick?.kind; if (k === 'prop' || k === 'landmark') return o; if (o === this.props || o === this.marks) break; }
    return null;
  }
  // 길게 누르기(LONG_PRESS ms) 전에 손가락이 움직이면 화면 돌리기로 넘기고, 오래 누르고 있으면 그때부터 소품이 손가락을 따라온다
  beginDrag(g, ev) {
    const d = { g, x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY, active: false, moved: false };
    d.timer = setTimeout(() => { if (this.drag !== d) return; d.active = true; this.v.controls.enabled = false;
      const p = this.floorPoint({ clientX: d.lx, clientY: d.ly }); d.off = p ? g.position.clone().sub(p).setY(0) : new THREE.Vector3(); d.y0 = g.position.y; g.position.y = d.y0 + 0.04;   // 살짝 들어 올려 '잡힘' 표시
      this.toast('옮기는 중 — 손을 떼면 그 자리에 놓습니다'); }, Editor.LONG_PRESS);
    this.drag = d;
  }
  cancelDrag() { const d = this.drag; if (!d) return; clearTimeout(d.timer); if (d.active) d.g.position.y = d.y0; this.drag = null; }
  dragMove(ev) {
    const d = this.drag; if (!d) return; d.lx = ev.clientX; d.ly = ev.clientY;
    if (!d.active) { if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 8) this.cancelDrag(); return; }   // 짧게 누르고 끌면 화면 회전
    if (!d.moved) { d.moved = true; disposeTree(this.hl); }
    const p = this.floorPoint(ev); if (p) { d.g.position.x = p.x + d.off.x; d.g.position.z = p.z + d.off.z; }
  }
  // 손을 떼면: 움직였으면 위치 저장, 그냥 눌렀으면 선택. 편집 모드가 꺼져 있으면 켠다
  endDrag() {
    const d = this.drag; this.drag = null; if (!d) return false; clearTimeout(d.timer); if (d.active) d.g.position.y = d.y0; const pk = d.g.userData.pick;
    if (!this.enabled) { const cb = $('#editMode'); if (cb) cb.checked = true; this.setEnabled(true); }
    if (d.moved) {
      if (pk.kind === 'prop') { const p = this.s.design.props.find((x) => x.id === pk.id); if (p) { p.x = +d.g.position.x.toFixed(2); p.z = +d.g.position.z.toFixed(2); this.s.commit('prop-move'); } }
      else { this.s.design.landmarks[pk.id] = { x: +d.g.position.x.toFixed(2), z: +d.g.position.z.toFixed(2), status: 'user' }; this.s.commit('landmark'); this.onLandmarks?.(); }
    }
    this.select({ kind: pk.kind, id: pk.id }); return true;
  }
  shade(hex, k) { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); }
  paintMat(hex) { return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }); }
  buildOverlays() {
    disposeTree(this.overlays);
    for (const w of this.walls()) {
      const sides = w.two_sided ? [w.inward, -w.inward] : [w.inward];
      for (const seg of this.segmentsOf(w)) {
        const sf = this.s.getSurface(seg.key); if (!sf.paint) continue; const [y0, y1] = this.zoneRange(sf.zone || 'all');
        const mat = this.paintMat(sf.paint); for (const sd of sides) this.eachPiece(w, seg.from, seg.to, y0, y1, (a, b, c, d) => { const q = this.wallQuad(w, a, b, c, d, 0.0015, mat, sd); q.userData.surface = w.id; this.overlays.add(q); });
      }
      // 하부 벽(띠 사이) 마감 — 이 벽 설정. 벽 '색'을 띠 아래(하부)로 칠했으면 그쪽 우선, 상부/전체 칠과는 함께 쓴다(하부가 위에 그려짐)
      const sfw0 = this.s.getSurface(w.id);
      if (!(sfw0.paint && sfw0.zone === 'lower')) this.addLower(w, w.id, sides);
      // 벽 전체 설정(세그먼트 없이 칠한 경우)
      const sfw = this.s.getSurface(w.id); if (sfw.paint) { const [y0, y1] = this.zoneRange(sfw.zone || 'all'); const mat = this.paintMat(sfw.paint); for (const sd of sides) this.eachPiece(w, w.from, w.to, y0, y1, (a, b, c, d) => { const q = this.wallQuad(w, a, b, c, d, 0.001, mat, sd); q.userData.surface = w.id; this.overlays.add(q); }); }
    }
    for (const col of this.columns()) {
      const sf = this.s.getSurface(col.id);
      if (!(sf.paint && sf.zone === 'lower')) for (const f of this.i.columnFaces(col)) this.addLower(f, col.id, [f.inward]);
      if (!sf.paint) continue; const [y0, y1] = this.zoneRange(sf.zone || 'all'); const fp = this.s.footprint(col);
      for (const f of this.i.columnFaces({ footprint: fp })) { const q = this.wallQuad(f, f.from, f.to, y0, y1, 0.0015, this.paintMat(sf.paint)); q.userData.surface = col.id; this.overlays.add(q); }
    }
    // 바닥 칠: 칸마다 복원 바닥 모양 그대로(벽 가장자리 포함). 스캔 바닥 텍스처(y 0.003)보다 위(0.006)에 놓는다
    for (const t of this.tiles) {
      const sf = this.s.getSurface(`floor_t${t.num}`); const sfa = this.s.getSurface('floor'); const paint = sf.paint || sfa.paint; if (!paint) continue;
      if (t.pgeo === undefined) t.pgeo = t.geo ? this.tileGeometry(t, t.last || {}, true) : null;
      if (t.geo && !t.pgeo) continue;
      if (t.pgeo) { const m = new THREE.Mesh(t.pgeo, this.paintMat(paint)); m.position.y = 0.011; m.userData.surface = 'floor'; this.overlays.add(m); }
      else { const m = new THREE.Mesh(new THREE.PlaneGeometry(t.x[1] - t.x[0], t.z[1] - t.z[0]), this.paintMat(paint)); m.rotation.x = -Math.PI / 2; m.position.set((t.x[0] + t.x[1]) / 2, 0.006, (t.z[0] + t.z[1]) / 2); m.userData.surface = 'floor'; this.overlays.add(m); }
    }
    // 스캔 텍스처 끄기(단색 보기) — 면별 texture=false 면 해당 _tex 숨김
    const rec = this.v.loaded?.reconstructed; if (rec) rec.traverse((o) => {
      if (!o.isMesh) return; const base = o.name.replace(/_tex(_.*)?$/, '');
      if (o.name.includes('_tex')) { const sf = this.s.getSurface(base); const on = sf.texture !== false && !(base === 'floor' && sf.paint); o.userData.keepVisible = on; o.visible = on; }
      if (/_window_\d+$/.test(o.name)) { o.userData.keepVisible = false; o.visible = false; }   // 창은 편집기가 그린다 (숨김 처리에 덮이지 않게)
    });
  }
  buildWindows() {
    disposeTree(this.windows);
    for (const w of this.walls()) for (const win of this.s.windowsOf(w.id)) {
      const place = (obj, t, y, off) => this.placeOnWall(obj, w, t, y, off);
      const wm = buildWindow(win, place); wm.userData.pick = { kind: 'window', id: win.id, wall: w.id }; wm.traverse((o) => { o.userData.windowOf = w.id; }); this.windows.add(wm);
      if (win.curtain?.on) {
        const others = this.s.windowsOf(w.id).filter((x) => x !== win); let ext = 0.18;   // 옆 창과 봉이 겹치지 않게
        for (const o of others) { const gap = o.from >= win.to ? o.from - win.to : win.from >= o.to ? win.from - o.to : null; if (gap !== null) ext = Math.min(ext, gap / 2 - 0.015); }
        ext = Math.min(ext, win.from - w.from - 0.03, w.to - win.to - 0.03); this.curtainOpen = this.curtainOpen || {};
        const cm = buildCurtain(win, this.ceil, place, { ext: Math.max(0.02, ext), isOpen: this.curtainOpen[win.id] ?? (win.curtain.style !== 'closed'), onToggle: (open) => { this.curtainOpen[win.id] = open; } });
        cm.traverse((o) => { o.userData.windowOf = w.id; }); this.windows.add(cm);
      }
    }
  }
  buildProps() { disposeTree(this.props); for (const p of this.s.design.props) { const g = buildProp(p); g.userData.pick = { kind: 'prop', id: p.id }; this.props.add(g); } }
  buildMarks() {
    disposeTree(this.marks); const lm = { ...(this.meta.landmarks || {}), ...(this.s.design.landmarks || {}) }; this.meta.landmarks = lm;
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
    if (this.placing) { const p = this.floorPoint(ev); if (p) { const prop = this.s.addProp({ type: this.placing, x: +p.x.toFixed(2), z: +p.z.toFixed(2), rot: 0, scale: 1, color: null }); this.placing = null; $('#placingHint').textContent = ''; this.s.commit('prop'); this.select({ kind: 'prop', id: prop.id }); this.toast('놓았습니다 — 길게 누른 채 끌어 옮기고, 아래 버튼으로 회전·복제·삭제'); } return true; }
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
    const fab = $('#propFab'); if (fab) { fab.hidden = !(sel && (sel.kind === 'prop' || sel.kind === 'window')); const fh = $('#fabHint'); if (fh) fh.textContent = sel?.kind === 'window' ? '위치·폭·커튼은 ☰ 패널 아래에서' : '길게 누른 채 끌어서 옮기기'; if (sel?.kind === 'prop') { const p = this.s.design.props.find((x) => x.id === sel.id); $('#fabName').textContent = (PROP_TYPES.find((x) => x[1] === p?.type) || ['소품'])[0]; } if (sel?.kind === 'window') $('#fabName').textContent = '창'; }
  }
  onDragEnd() {
    const o = this.tc.object; if (!o) return; const pk = o.userData.pick;
    if (pk?.kind === 'prop') { const p = this.s.design.props.find((x) => x.id === pk.id); if (p) { p.x = +o.position.x.toFixed(2); p.z = +o.position.z.toFixed(2); this.s.commit('prop-move'); } }
    if (pk?.kind === 'landmark') { this.s.design.landmarks[pk.id] = { x: +o.position.x.toFixed(2), z: +o.position.z.toFixed(2), status: 'user' }; this.s.commit('landmark'); this.onLandmarks?.(); }
  }
  refreshHighlight() {
    disposeTree(this.hl); const sel = this.selected; if (!sel) return;
    const mat = new THREE.LineBasicMaterial({ color: 0x4fd8ff, depthTest: false }); const add = (geo, pos, rot) => { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat); e.position.copy(pos); if (rot) e.rotation.copy(rot); e.renderOrder = 999; this.hl.add(e); };
    if (sel.kind === 'wall') { const w = this.walls().find((x) => x.id === sel.id); const seg = sel.seg ? this.segmentsOf(w).find((s) => s.key === sel.seg) : { from: w.from, to: w.to }; const q = this.wallQuad(w, seg.from, seg.to, 0.02, this.ceil - 0.02, 0.05, mat); add(q.geometry, q.position, q.rotation); }
    if (sel.kind === 'column') { const col = this.columns().find((x) => x.id === sel.id); const fp = this.s.footprint(col); add(new THREE.BoxGeometry(fp.x[1] - fp.x[0] + 0.08, this.ceil, fp.z[1] - fp.z[0] + 0.08), new THREE.Vector3((fp.x[0] + fp.x[1]) / 2, this.ceil / 2, (fp.z[0] + fp.z[1]) / 2)); }
    if (sel.kind === 'ceiling' && this.intCeil) { const b = new THREE.Box3().setFromObject(this.intCeil); const sz = b.getSize(new THREE.Vector3()); add(new THREE.BoxGeometry(sz.x, 0.02, sz.z), b.getCenter(new THREE.Vector3())); }
    if (sel.kind === 'floor') { const t = this.tiles.find((x) => `${sel.kind}_t${x.num}` === sel.id); if (t) add(new THREE.BoxGeometry(t.x[1] - t.x[0], 0.02, t.z[1] - t.z[0]), new THREE.Vector3((t.x[0] + t.x[1]) / 2, sel.kind === 'ceiling' ? this.ceil - 0.02 : 0.02, (t.z[0] + t.z[1]) / 2)); }
    if (sel.kind === 'window') { const g = this.windows.children.find((c) => c.userData.pick?.id === sel.id); if (g) { const b = new THREE.Box3().setFromObject(g); const s = b.getSize(new THREE.Vector3()); add(new THREE.BoxGeometry(s.x + 0.05, s.y + 0.05, s.z + 0.05), b.getCenter(new THREE.Vector3())); } }
  }

  // ---------------- 패널
  renderChips() {
    const box = $('#itemChips'); if (!box) return; box.innerHTML = '';
    const mk = (label, sel, cls = '') => { const b = document.createElement('button'); b.textContent = label; b.className = 'chip ' + cls; b.dataset.id = sel.seg || sel.id; b.addEventListener('click', () => this.select(sel)); box.appendChild(b); };
    for (const w of this.walls()) { const segs = this.segmentsOf(w); if (segs.length === 1) mk(`벽 ${w.num}`, { kind: 'wall', id: w.id }); else segs.forEach((s) => mk(`벽 ${w.num}-${s.idx + 1}`, { kind: 'wall', id: w.id, seg: s.key })); }
    for (const c of this.columns()) mk(`기둥 ${c.num}`, { kind: 'column', id: c.id }, 'col');
    mk('천장', { kind: 'ceiling', id: 'ceiling' }, 'ceil');
    for (const t of this.tiles) mk(`바닥 ${t.num}`, { kind: 'floor', id: `floor_t${t.num}` }, 'floor'); mk('바닥 전체', { kind: 'floor', id: 'floor' }, 'floor');
    for (const w of this.walls()) for (const win of this.s.windowsOf(w.id)) mk(`창 (벽 ${w.num})`, { kind: 'window', id: win.id, wall: w.id }, 'win');
  }
  // 이 벽/기둥의 띠·걸레받이·흰 몰딩·하부 벽 편집 (인스펙터 안)
  renderTrimControls(box, id, noun) {
    const own = this.s.hasOwnTrim(id); const t = this.s.trimOf(id); const commit = () => this.s.commit('trim'); const ed = () => this.s.trimEdit(id);
    const h = document.createElement('h4'); h.innerHTML = `띠 · 몰딩 · 하부 벽 <small>${own ? `이 ${noun}만의 설정` : '기본값 따름 — 바꾸면 이 ' + noun + '만 적용'}</small>`; box.appendChild(h);
    const row = (label, node) => { const d = document.createElement('div'); d.className = 'irow'; const l = document.createElement('span'); l.textContent = label; d.append(l, node); box.appendChild(d); };
    const selectEl = (opts, val, onChange) => { const sEl = document.createElement('select'); for (const [tx, v] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = tx; if (v === val) o.selected = true; sEl.appendChild(o); } sEl.addEventListener('change', () => onChange(sEl.value)); return sEl; };
    const btn = (text, fn, cls = 'ghost') => { const b = document.createElement('button'); b.textContent = text; b.className = cls; b.addEventListener('click', fn); return b; };
    row('띠 색', this.palette(PALETTE_TRIM, t.rail.color, (hex) => { ed().rail.color = hex; commit(); }));
    row('띠 형태', selectEl([['평면 띠', 'flat'], ['액자 몰드(단 있음)', 'molding']], t.rail.style, (v) => { ed().rail.style = v; commit(); }));
    row('걸레받이 색', this.palette(PALETTE_TRIM, t.base.color, (hex) => { ed().base.color = hex; commit(); }));
    row('걸레받이 형태', selectEl([['평면', 'flat'], ['몰드', 'molding']], t.base.style, (v) => { ed().base.style = v; commit(); }));
    row('흰 몰딩 색', this.palette([['화이트', '#f4f1ea'], ['웜 화이트', '#efe6d6'], ['원목', '#a98457'], ['월넛', '#6b4a2e'], ['골드', '#c9a24a'], ['블랙', '#1c1c1c']], t.moldingColor, (hex) => { ed().moldingColor = hex; commit(); }));
    row('하부 벽(띠 사이)', this.palette(PALETTE_LOWER, t.lower.paint, (hex) => { const e = ed(); e.lower.paint = hex; if (hex && /#a98457|#6b4a2e/.test(hex)) e.lower.style = 'wood_panel'; commit(); }));
    row('하부 형태', selectEl([['단색', 'flat'], ['원목 패널(세로 홈)', 'wood_panel']], t.lower.style, (v) => { ed().lower.style = v; commit(); }));
    const r = document.createElement('div'); r.className = 'row wrap';
    if (own) r.appendChild(btn('기본값 따르기(이 설정 지우기)', () => { this.s.clearTrim(id); commit(); }));
    r.appendChild(btn(`이 ${noun} 설정을 모든 벽·기둥에`, () => { this.s.applyTrimToAll(id); commit(); this.toast('모든 벽·기둥에 적용'); }));
    r.appendChild(btn('모두 검정 띠·흰 몰딩으로', () => { this.s.resetAllTrim(); commit(); this.toast('모든 벽·기둥 초기화'); }));
    box.appendChild(r);
  }
  renderHiddenChips() {
    const box = $('#hiddenChips'); if (!box) return; box.innerHTML = '';
    const label = (id) => { const it = this.itemById(id); return it ? it.label : id; };
    for (const id of this.hidden) { const b = document.createElement('button'); b.className = 'chip'; b.textContent = `${label(id)} ✕`; b.title = '다시 보이기'; b.addEventListener('click', () => this.setHidden(id, false)); box.appendChild(b); }
    for (const id of this._autoHidden) if (!this.hidden.has(id)) { const b = document.createElement('button'); b.className = 'chip auto'; b.textContent = `${label(id)} (자동)`; b.disabled = true; box.appendChild(b); }
    if (!box.children.length) box.innerHTML = '<span class="hint">숨긴 면 없음</span>';
  }
  palette(list, cur, onPick) {
    const d = document.createElement('div'); d.className = 'swatches';
    for (const [name, hex, swatch] of list) { const b = document.createElement('button'); b.className = 'sw' + ((cur || null) === hex ? ' active' : ''); b.title = name; b.style.background = swatch || (hex && hex.startsWith('#') ? hex : 'linear-gradient(135deg,#9a9892,#6a4f35)'); b.addEventListener('click', () => onPick(hex)); d.appendChild(b); }
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = (cur && /^#[0-9a-f]{6}$/i.test(cur)) ? cur : '#c9c7c1'; inp.title = '직접 선택'; inp.addEventListener('input', () => onPick(inp.value)); d.appendChild(inp);
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
      const svc = serviceOf(this.meta, w.id); const dflt = (v) => v === true || (v !== false && !svc);
      if (svc) h(`<div class="hint">${svc} 안쪽 벽 — 몰딩·액자는 기본으로 달지 않습니다(체크하면 표시).</div>`);
      row('화이트 몰딩', check(dflt(sfw.molding), (v) => { sfw.molding = v; commit('molding'); }, '이 벽에 몰딩'));
      row('액자', check(dflt(sfw.art), (v) => { sfw.art = v; commit('art'); }, '이 벽에 작품 걸기'));
      row('액자 수', num(sfw.artCount ?? '', 1, (v) => { sfw.artCount = v || null; commit('art'); }, '개 (비우면 자동)'));
      row('액자 틀', selectEl(FRAME_STYLES, sfw.frame || 'gold', (v) => { sfw.frame = v; commit('frame'); }));
      this.renderTrimControls(box, w.id, '벽');
      box.appendChild(btn(this.hidden.has(w.id) ? '👁 이 벽 보이기' : '🙈 이 벽 숨기기', () => this.setHidden(w.id, !this.hidden.has(w.id)), 'ghost'));
      const wins = this.s.windowsOf(w.id); h(`<h4>창 (${wins.length})</h4>`);
      box.appendChild(btn('+ 이 벽에 창 추가', () => { const L = w.to - w.from; this.s.addWindow(w.id, { id: `${w.id}_w${Date.now() % 100000}`, from: +(w.from + L * 0.3).toFixed(2), to: +(w.from + L * 0.7).toFixed(2), y0: 0.55, y1: 1.78, frame: '#9a9da0', style: 'jp_sliding', panes: 4, transom: 0.93, valance: true, curtain: { on: false, color: '#5a3a22', style: 'open' } }); commit('window'); this.renderChips(); }));
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
      row('거울 범위', selectEl([['바닥 위~거울 높이, 좌우 여백', 'frame'], ['띠(몰드) 위~천장, 좌우 꽉 차게', 'upper']], c.mirrorFit || 'frame', (v) => { c.mirrorFit = v; if (v === 'upper') c.mirror = true; commit('mirror'); }));
      const faces = document.createElement('span'); for (const [k, t] of [['xn', '서(−X)'], ['xp', '동(+X)'], ['zn', '북(−Z)'], ['zp', '남(+Z)']]) faces.appendChild(check(c.mirrorFaces.includes(k), (v) => { c.mirrorFaces = v ? [...new Set([...c.mirrorFaces, k])] : c.mirrorFaces.filter((x) => x !== k); commit('mirror'); }, t)); row('거울 면', faces);
      row('칠할 영역', selectEl([['전체', 'all'], ['띠 위', 'upper'], ['띠 아래', 'lower']], sf.zone || 'all', (v) => { sf.zone = v; commit('zone'); }));
      row('색', this.palette(PALETTE_WALL, sf.paint, (hex) => { sf.paint = hex; commit('paint'); }));
      row('스캔 텍스처', check(sf.texture !== false, (v) => { sf.texture = v; commit('tex'); }, '보이기'));
      row('화이트 몰딩', check(sf.molding !== false, (v) => { sf.molding = v; commit('molding'); }, '이 기둥에 몰딩'));
      this.renderTrimControls(box, col.id, '기둥');
      box.appendChild(btn(this.hidden.has(col.id) ? '👁 이 기둥 보이기' : '🙈 이 기둥 숨기기', () => this.setHidden(col.id, !this.hidden.has(col.id)), 'ghost'));
    }
    if (sel.kind === 'ceiling' || sel.kind === 'floor') {
      const sf = this.s.surface(sel.id); const isFloor = sel.kind === 'floor'; const t = this.tiles.find((x) => `${sel.kind}_t${x.num}` === sel.id);
      h(isFloor ? `<h4>바닥 ${t ? t.num : '전체'} <small>${t ? `x ${t.x[0].toFixed(1)}~${t.x[1].toFixed(1)} · z ${t.z[0].toFixed(1)}~${t.z[1].toFixed(1)}` : '모든 타일 기본값'}</small></h4>` : `<h4>천장 <small>내부 천장 전체 · 기본 흰색 · 위에서 볼 때는 투명</small></h4>`);
      row('색', this.palette(isFloor ? PALETTE_FLOOR : PALETTE_CEIL, sf.paint, (hex) => { if (t) sf.paint = hex; else this.s.paintAll(sel.kind, hex); commit('paint'); }));
      if (!t && isFloor) h(`<div class="hint">전체 색을 고르면 타일별 색은 지워지고 한 번에 바뀝니다. 타일별로 다르게 하려면 바닥 N 번호를 고르세요.</div>`);
      if (!t && isFloor) row('스캔 텍스처', check(sf.texture !== false, (v) => { sf.texture = v; commit('tex'); }, '보이기 (끄면 복원 단색)'));
      if (t) box.appendChild(btn('이 타일 색 지우기(전체 설정 따름)', () => { sf.paint = null; commit('paint'); }, 'ghost'));
      if (!isFloor) box.appendChild(btn(this.hidden.has('ceiling') ? '👁 천장 보이기' : '🙈 천장 숨기기', () => this.setHidden('ceiling', !this.hidden.has('ceiling')), 'ghost'));
      if (isFloor) h(`<div class="hint">스캔 바닥 중간색 #${(this.meta.sampled_colors?.floor_wood?.median || [106, 79, 53]).map((v) => v.toString(16).padStart(2, '0')).join('')} 기준 밝게/어둡게 프리셋 제공</div>`);
    }
    if (sel.kind === 'window') {
      const w = this.walls().find((x) => x.id === sel.wall); const win = this.s.windowsOf(w.id).find((x) => x.id === sel.id); if (!win) return;
      h(`<h4>창 — 벽 ${w.num} <small>${esc(win.id)}</small></h4>`);
      row('시작 위치', num(Math.round((win.from - w.from) * 100), 1, (v) => { win.from = +(w.from + v / 100).toFixed(2); commit('window'); }, 'cm (벽 시작점부터)'));
      row('폭', num(Math.round((win.to - win.from) * 100), 1, (v) => { win.to = +(win.from + v / 100).toFixed(2); commit('window'); }));
      row('하단 높이', num(Math.round(win.y0 * 100), 1, (v) => { win.y0 = v / 100; commit('window'); }));
      row('상단 높이', num(Math.round(win.y1 * 100), 1, (v) => { win.y1 = v / 100; commit('window'); }));
      row('창 형태', selectEl([['알루미늄 미닫이(일본식)', 'jp_sliding'], ['단순 창', 'simple']], win.style || 'simple', (v) => { win.style = v; if (v === 'jp_sliding') { win.panes = win.panes || 4; win.transom = win.transom ?? +(win.y0 + (win.y1 - win.y0) * 0.3).toFixed(2); } commit('window'); }));
      if (win.style === 'jp_sliding') {
        row('짝 수', selectEl([['2짝', 2], ['4짝', 4], ['6짝', 6]], win.panes || 4, (v) => { win.panes = +v; commit('window'); }));
        row('가로살 높이', num(Math.round((win.transom ?? win.y0 + 0.4) * 100), 1, (v) => { win.transom = v / 100; commit('window'); }));
        row('커튼박스', check(!!win.valance, (v) => { win.valance = v; commit('window'); }, '창 위 박스'));
      }
      row('프레임 색', this.palette([['알루미늄', '#9a9da0'], ['실버', '#8a8f94'], ['블랙', '#1c1c1c'], ['화이트', '#f1f1f1'], ['브론즈', '#6b4b2a']], win.frame, (hex) => { win.frame = hex; commit('window'); }));
      h('<h4>커튼</h4>');
      row('커튼', check(win.curtain.on, (v) => { win.curtain.on = v; commit('curtain'); }, '달기'));
      row('커튼 색', this.palette(PALETTE_CURTAIN, win.curtain.color, (hex) => { win.curtain.color = hex; commit('curtain'); }));
      row('스타일', selectEl([['양쪽으로 걷음', 'open'], ['전체 닫음', 'closed']], win.curtain.style, (v) => { win.curtain.style = v; commit('curtain'); }));
      box.appendChild(btn('이 창 삭제', () => { this.s.removeWindow(w.id, win.id); commit('window'); this.renderChips(); this.select({ kind: 'wall', id: w.id }); }, 'danger'));
    }
    if (sel.kind === 'prop') {
      const p = this.s.design.props.find((x) => x.id === sel.id); if (!p) return; const name = (PROP_TYPES.find((x) => x[1] === p.type) || ['소품'])[0];
      h(`<h4>${esc(name)} <small>드래그로 이동 · ${esc(p.id)}</small></h4>`);
      const quick = document.createElement('div'); quick.className = 'row wrap'; quick.append(btn('↺ 15°', () => this.rotateProp(p, -15)), btn('↻ 15°', () => this.rotateProp(p, 15)), btn('복제', () => this.duplicateProp(p)), btn('🗑 삭제', () => this.deleteProp(p.id), 'danger')); box.appendChild(quick);
      const rot = document.createElement('input'); rot.type = 'range'; rot.min = -180; rot.max = 180; rot.step = 5; rot.value = Math.round((p.rot || 0) * 180 / Math.PI); rot.addEventListener('input', () => { p.rot = rot.value * Math.PI / 180; const g = this.props.children.find((c) => c.userData.pick?.id === p.id); if (g) g.rotation.y = p.rot; }); rot.addEventListener('change', () => commit('prop')); row('회전', rot);
      row('크기', num(Math.round((p.scale || 1) * 100), 5, (v) => { p.scale = v / 100; commit('prop'); }, '%'));
      row('위치 X', num(Math.round(p.x * 100), 1, (v) => { p.x = v / 100; commit('prop'); })); row('위치 Z', num(Math.round(p.z * 100), 1, (v) => { p.z = v / 100; commit('prop'); }));
      row('색', this.palette([['기본', null], ['우드', '#b08a5a'], ['월넛', '#5c3d26'], ['블랙', '#1c1c1c'], ['화이트', '#f3f1ec'], ['와인', '#7a2e2e'], ['네이비', '#2f3a4f'], ['세이지', '#9aa58d']], p.color, (hex) => { p.color = hex; commit('prop'); }));
      const r = document.createElement('div'); r.className = 'row'; r.append(btn('복제', () => { const q = this.s.addProp({ ...p, id: undefined, x: p.x + 0.6 }); commit('prop'); this.select({ kind: 'prop', id: q.id }); }), btn('삭제', () => { this.s.removeProp(p.id); commit('prop'); this.select(null); }, 'danger')); box.appendChild(r);
    }
    if (sel.kind === 'landmark') { const names = { entrance: '입구', kitchen: '주방', toilet: '화장실', windows: '창가', main: '메인' }; h(`<h4>📍 ${names[sel.id] || sel.id}</h4><div class="hint">핀을 드래그해 실제 위치로 옮기세요. 북마크와 라벨이 따라갑니다.</div>`); }
  }
  rotateProp(p, deg) { p.rot = (p.rot || 0) + deg * Math.PI / 180; this.s.commit('prop'); }
  duplicateProp(p) { const q = this.s.addProp({ ...p, id: undefined, x: p.x + 0.6 }); this.s.commit('prop'); this.select({ kind: 'prop', id: q.id }); }
  deleteProp(id) { this.s.removeProp(id); this.s.commit('prop'); this.select(null); this.toast('소품 삭제됨'); }
  // 소품 배치 시작
  startPlacing(type) { this.placing = type; const name = (PROP_TYPES.find((x) => x[1] === type) || [type])[0]; $('#placingHint').textContent = `${name}: 바닥을 눌러 놓을 자리를 고르세요`; this.toast(`${name} — 바닥에서 놓을 자리를 누르세요`); }
  startMeasure() { this.measuring = []; this.toast('두 점을 클릭하면 거리를 잽니다'); }
  clearMeasures() { disposeTree(this.measures); this.measuring = null; }
  screenshot() { this.v.renderer.render(this.v.scene, this.v.camera); const a = document.createElement('a'); a.href = this.v.renderer.domElement.toDataURL('image/png'); a.download = `kobe-design-${Date.now()}.png`; a.click(); }
}
