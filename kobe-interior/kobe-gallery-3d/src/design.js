// 디자인 상태 — 면별 마감/몰딩/액자, 기둥 실측·거울, 창·커튼, 랜드마크, 소품. localStorage 자동 저장 + 슬롯 + JSON.
export const PALETTE_WALL = [
  ['현재 회색(스캔)', null], ['화이트', '#f3f1ec'], ['웜 화이트', '#efe6d6'], ['라이트 그레이', '#c9c7c1'], ['그레이지', '#b8ae9f'],
  ['세이지', '#9aa58d'], ['딥 그린(경성미술관)', '#3f5a52'], ['포레스트 그린', '#2f4a3f'], ['다크 틸', '#2b4a4c'], ['올리브', '#5a6240'],
  ['더스티 블루', '#8a9bab'], ['네이비', '#2f3a4f'], ['와인', '#7a2e2e'], ['테라코타', '#b8623f'], ['차콜', '#3a3a3a'], ['블랙', '#1c1c1c'],
];
export const PALETTE_TRIM = [['블랙(현재)', '#1c1c1c'], ['원목(오크)', '#a98457'], ['원목(월넛)', '#6b4a2e'], ['다크 월넛', '#4a3220'], ['화이트', '#f3f1ec'], ['웜 화이트', '#efe6d6'], ['차콜', '#3a3a3a'], ['골드', '#c9a24a']];
export const PALETTE_LOWER = [['벽지 그대로', null], ['원목 패널(오크)', '#a98457'], ['원목 패널(월넛)', '#6b4a2e'], ['화이트 패널', '#f3f1ec'], ['딥 그린', '#3f5a52'], ['네이비', '#2f3a4f'], ['와인', '#7a2e2e'], ['차콜', '#3a3a3a'], ['블랙', '#1c1c1c']];
export const DEFAULT_GLOBAL = () => ({ rail: { color: '#1c1c1c', style: 'flat' }, base: { color: '#1c1c1c', style: 'flat' }, moldingColor: '#f4f1ea', lower: { paint: null, style: 'flat' } });
export const PALETTE_FLOOR = [
  ['현재 우드(스캔)', null], ['현재 톤 · 밝게', '#866752'], ['현재 톤 · 어둡게', '#4f351d'], ['라이트 오크', '#c9a97a'], ['내추럴 오크', '#a98457'],
  ['월넛', '#5c3d26'], ['다크 월넛', '#3b2616'], ['그레이 우드', '#8a8178'], ['화이트 워시', '#d9cfc0'], ['블랙', '#222222'],
];
export const PALETTE_CEIL = [['화이트(기본)', null, '#f2efe9'], ['웜 화이트', '#ebe3d4'], ['라이트 그레이', '#cfcdc8'], ['딥 그린', '#3f5a52'], ['원목', '#a98457'], ['차콜', '#333333'], ['블랙', '#1c1c1c'], ['스캔 원본(현재 천장)', 'scan']];
export const PALETTE_CURTAIN = [['밤색', '#5a3a22'], ['다크 브라운', '#3e2a1a'], ['베이지', '#c9b89a'], ['아이보리', '#ece4d4'], ['와인', '#6e2a2e'], ['차콜', '#3b3b3b'], ['네이비', '#2d3650']];
export const FRAME_STYLES = [['골드', 'gold'], ['블랙', 'black'], ['화이트', 'white'], ['내추럴 우드', 'natural']];
export const PROP_TYPES = [
  ['센바 커플 세팅(보드2+의자2+카트)', 'couple_set'], ['센바 작업 보드', 'board'], ['검은 의자', 'chair'], ['물감 카트', 'cart'],
  ['이젤', 'easel'], ['이젤+캔버스', 'easel_canvas'], ['작업 테이블', 'table'], ['스툴', 'stool'], ['벤치', 'bench'], ['전시 좌대', 'pedestal'],
  ['화분', 'plant'], ['파티션', 'partition'], ['러그', 'rug'], ['접수 카운터', 'counter'], ['안내판', 'sign'], ['펜던트 조명', 'pendant'],
];

export const STORAGE_KEY = 'kobe3d.design.v1';
export const SLOTS = ['A', 'B', 'C'];

export function emptyDesign() {
  return { version: 1, surfaces: {}, columns: {}, windows: null, landmarks: {}, props: [], global: DEFAULT_GLOBAL() };
}

export class DesignStore {
  constructor(meta) {
    this.meta = meta; this.listeners = []; this.design = emptyDesign(); this.undoStack = []; this.redoStack = []; this.dirty = false;
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) this.design = this.migrate(JSON.parse(raw)); } catch {}
    // 창 기본값: 메타데이터가 갱신됐고 사용자가 창을 손대지 않았으면 새 기본값으로 교체
    if (!this.design.windows || (this.design.windows_src !== meta.generated && !this.design.windowsEdited)) { this.design.windows = this.defaultWindows(); this.design.windows_src = meta.generated; }
    this.refreshWindowsVersion();
    this._last = this.snapshot();
    // 현재 작업 중인 안 (처음이면 A안 = 지금 디자인)
    try { this.active = localStorage.getItem(STORAGE_KEY + '.active') || 'A'; } catch { this.active = 'A'; }
    if (!this.hasSlot(this.active)) this.saveSlot(this.active);
  }
  // 다른 안으로 전환: 지금 안을 저장하고 대상 안을 연다. 비어 있으면 지금 디자인을 복사해 새로 만든다
  switchSlot(name) {
    if (name === this.active) return 'same';
    this.saveSlot(this.active); let raw = null; try { raw = localStorage.getItem(STORAGE_KEY + '.slot.' + name); } catch {}
    if (raw) { this.design = this.migrate(JSON.parse(raw)); if (!this.design.windows) this.design.windows = this.defaultWindows(); this.refreshWindowsVersion(); }
    this.active = name; try { localStorage.setItem(STORAGE_KEY + '.active', name); } catch {}
    this.undoStack = []; this.redoStack = []; this.dirty = false; this.commit('switch', false); return raw ? 'loaded' : 'new';
  }
  copyTo(name) { this.saveSlot(name); }
  putSlot(name, obj) {
    const d = this.migrate(JSON.parse(JSON.stringify(obj)));
    if (name === this.active) { this.design = d; if (!this.design.windows) this.design.windows = this.defaultWindows(); this.refreshWindowsVersion(); this.commit('import'); return; }
    try { localStorage.setItem(STORAGE_KEY + '.slot.' + name, JSON.stringify(d)); } catch {}
  }
  // 창 기본값 버전(사진 확인 등)이 올라가면 창을 새 기본값으로 바꾸고, 같은 벽에 달았던 커튼 설정은 이어받는다
  refreshWindowsVersion() {
    const ver = this.meta.windows_version || 1; if ((this.design.windows_ver || 1) >= ver) return;
    const old = this.design.windows || {}; const fresh = this.defaultWindows();
    for (const [wid, list] of Object.entries(fresh)) { const c = (old[wid] || []).find((x) => x.curtain?.on)?.curtain; if (c) for (const x of list) x.curtain = { ...c }; }
    for (const [wid, list] of Object.entries(old)) if (!fresh[wid] && list.some((x) => String(x.id).match(/_w\d{3,}$/))) fresh[wid] = list.filter((x) => String(x.id).match(/_w\d{3,}$/));   // 사용자가 직접 추가한 창은 유지
    this.design.windows = fresh; this.design.windows_ver = ver; this.design.windows_src = this.meta.generated;
  }
  snapshot() { return JSON.stringify(this.design); }
  undo() { if (!this.undoStack.length) return false; this.redoStack.push(this.snapshot()); this.design = this.migrate(JSON.parse(this.undoStack.pop())); this.commit('undo', false); return true; }
  redo() { if (!this.redoStack.length) return false; this.undoStack.push(this.snapshot()); this.design = this.migrate(JSON.parse(this.redoStack.pop())); this.commit('redo', false); return true; }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  saveExplicit() { try { localStorage.setItem(STORAGE_KEY + '.saved.' + this.active, this.snapshot()); } catch {} this.dirty = false; }
  hasExplicit() { try { return !!localStorage.getItem(STORAGE_KEY + '.saved.' + this.active); } catch { return false; } }
  revertToSaved() { try { const raw = localStorage.getItem(STORAGE_KEY + '.saved.' + this.active); if (!raw) return false; this.undoStack.push(this.snapshot()); this.design = this.migrate(JSON.parse(raw)); this.commit('revert', false); this.dirty = false; return true; } catch { return false; } }
  resetWindows() { this.design.windows = this.defaultWindows(); this.design.windows_src = this.meta.generated; this.design.windows_ver = this.meta.windows_version || 1; this.design.windowsEdited = false; this.commit('windows-reset'); }
  migrate(d) { const e = emptyDesign(); const g = DEFAULT_GLOBAL(); const dg = d.global || {}; if (d.surfaces) for (const k of Object.keys(d.surfaces)) if (k.startsWith('ceiling_t')) delete d.surfaces[k]; return { ...e, ...d, surfaces: d.surfaces || {}, columns: d.columns || {}, landmarks: d.landmarks || {}, props: d.props || [], global: { ...g, ...dg, rail: { ...g.rail, ...(dg.rail || {}) }, base: { ...g.base, ...(dg.base || {}) }, lower: { ...g.lower, ...(dg.lower || {}) } } }; }
  get global() { return this.design.global; }
  // 띠·걸레받이·흰 몰딩·하부 벽: 벽/기둥별 설정(surfaces[id].trim)이 있으면 그것, 없으면 기본값(global)
  trimOf(id) { const g = this.design.global; const t = this.design.surfaces[id]?.trim; if (!t) return g; return { rail: { ...g.rail, ...(t.rail || {}) }, base: { ...g.base, ...(t.base || {}) }, moldingColor: t.moldingColor ?? g.moldingColor, lower: { ...g.lower, ...(t.lower || {}) } }; }
  hasOwnTrim(id) { return !!this.design.surfaces[id]?.trim; }
  // 편집용: 현재 유효 값을 복사해 개별 설정으로 만든 뒤 돌려준다
  trimEdit(id) { const sf = this.surface(id); if (!sf.trim) { const e = this.trimOf(id); sf.trim = JSON.parse(JSON.stringify({ rail: e.rail, base: e.base, moldingColor: e.moldingColor, lower: e.lower })); } return sf.trim; }
  clearTrim(id) { if (this.design.surfaces[id]) delete this.design.surfaces[id].trim; }
  // 이 벽 설정을 모든 벽·기둥에: 기본값으로 올리고 개별 설정을 모두 지운다
  applyTrimToAll(id) { const e = JSON.parse(JSON.stringify(this.trimOf(id))); this.design.global = { ...this.design.global, ...e }; for (const k of Object.keys(this.design.surfaces)) delete this.design.surfaces[k].trim; }
  resetAllTrim() { const d = DEFAULT_GLOBAL(); Object.assign(this.design.global, d); for (const k of Object.keys(this.design.surfaces)) delete this.design.surfaces[k].trim; }
  // 전체 바닥/천장 색: 타일별 설정을 지우고 전체에 적용
  paintAll(kind, hex) { for (const k of Object.keys(this.design.surfaces)) if (k.startsWith(kind + '_t')) this.design.surfaces[k].paint = null; this.surface(kind).paint = hex; }
  // 창 기본값: 메타데이터의 벽 개구부(window) → 편집 가능한 레코드
  defaultWindows() {
    const out = {};
    for (const e of this.meta.elements || []) {
      if (e.type !== 'wall') continue;
      const ws = (e.openings || []).filter((o) => o.kind === 'window').map((o, i) => ({
        id: `${e.id}_w${i}`, from: +o.from.toFixed(2), to: +o.to.toFixed(2), y0: +(o.y?.[0] ?? 0.95).toFixed(2), y1: +(o.y?.[1] ?? 2.0).toFixed(2),
        frame: o.frame || '#8a8f94', style: o.style || 'simple', panes: o.panes || 2, transom: o.transom ?? null, valance: o.valance ?? false,
        curtain: { on: false, color: '#5a3a22', style: 'open' },
      }));
      if (ws.length) out[e.id] = ws;
    }
    return out;
  }
  onChange(fn) { this.listeners.push(fn); }
  // 변경 적용. 호출 측이 design 을 바꾼 뒤 commit — undo 스택에는 직전 commit 시점 스냅샷을 쌓는다
  commit(reason = '', track = true) {
    if (track) { if (this._last !== undefined) { this.undoStack.push(this._last); if (this.undoStack.length > 60) this.undoStack.shift(); this.redoStack = []; } this.dirty = true; }
    if (/window|curtain/.test(reason) && reason !== 'windows-reset') this.design.windowsEdited = true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.design)); if (this.active) localStorage.setItem(STORAGE_KEY + '.slot.' + this.active, JSON.stringify(this.design)); } catch {}
    this._last = this.snapshot();
    for (const fn of this.listeners) fn(reason);
  }
  // ---- 면
  surface(id) { return this.design.surfaces[id] || (this.design.surfaces[id] = { paint: null, texture: true, molding: null, art: null, artCount: null, frame: 'gold' }); }
  getSurface(id) { return this.design.surfaces[id] || { paint: null, texture: true, molding: null, art: null, artCount: null, frame: 'gold' }; }
  // ---- 기둥
  column(id) { return this.design.columns[id] || (this.design.columns[id] = { w: null, d: null, dx: 0, dz: 0, mirror: null, mirrorFaces: ['xn', 'xp', 'zn', 'zp'] }); }
  getColumn(id) { return this.design.columns[id] || { w: null, d: null, dx: 0, dz: 0, mirror: null, mirrorFaces: ['xn', 'xp', 'zn', 'zp'] }; }
  // 유효 footprint (실측 입력 반영)
  footprint(el) {
    const c = this.getColumn(el.id); const fx = el.footprint.x, fz = el.footprint.z;
    const cx = (fx[0] + fx[1]) / 2 + (c.dx || 0), cz = (fz[0] + fz[1]) / 2 + (c.dz || 0);
    const w = c.w || (fx[1] - fx[0]), d = c.d || (fz[1] - fz[0]);
    return { x: [cx - w / 2, cx + w / 2], z: [cz - d / 2, cz + d / 2] };
  }
  // ---- 창
  windowsOf(wallId) { return this.design.windows[wallId] || []; }
  addWindow(wallId, rec) { (this.design.windows[wallId] = this.design.windows[wallId] || []).push(rec); }
  removeWindow(wallId, id) { this.design.windows[wallId] = (this.design.windows[wallId] || []).filter((w) => w.id !== id); }
  // ---- 소품
  addProp(p) { p.id = p.id || ('p' + Math.random().toString(36).slice(2, 8)); this.design.props.push(p); return p; }
  removeProp(id) { this.design.props = this.design.props.filter((p) => p.id !== id); }
  // ---- 슬롯 / JSON
  saveSlot(name) { try { localStorage.setItem(STORAGE_KEY + '.slot.' + name, JSON.stringify(this.design)); } catch {} }
  loadSlot(name) { try { const raw = localStorage.getItem(STORAGE_KEY + '.slot.' + name); if (!raw) return false; this.design = this.migrate(JSON.parse(raw)); this.commit('load'); return true; } catch { return false; } }
  hasSlot(name) { try { return !!localStorage.getItem(STORAGE_KEY + '.slot.' + name); } catch { return false; } }
  exportJSON() { return JSON.stringify(this.design, null, 1); }
  importJSON(text) { const d = JSON.parse(text); if (!d || typeof d !== 'object') throw new Error('JSON 형식이 아닙니다'); this.design = this.migrate(d); if (!this.design.windows) this.design.windows = this.defaultWindows(); this.commit('import'); }
  reset() { this.design = emptyDesign(); this.design.windows = this.defaultWindows(); this.commit('reset'); }
}
