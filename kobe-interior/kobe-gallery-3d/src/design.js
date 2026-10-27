// 디자인 상태 — 면별 마감/몰딩/액자, 기둥 실측·거울, 창·커튼, 랜드마크, 소품. localStorage 자동 저장 + 슬롯 + JSON.
export const PALETTE_WALL = [
  ['현재 회색(스캔)', null], ['화이트', '#f3f1ec'], ['웜 화이트', '#efe6d6'], ['라이트 그레이', '#c9c7c1'], ['그레이지', '#b8ae9f'],
  ['세이지', '#9aa58d'], ['더스티 블루', '#8a9bab'], ['네이비', '#2f3a4f'], ['와인', '#7a2e2e'], ['테라코타', '#b8623f'], ['차콜', '#3a3a3a'], ['블랙', '#1c1c1c'],
];
export const PALETTE_FLOOR = [
  ['현재 우드(스캔)', null], ['현재 톤 · 밝게', '#866752'], ['현재 톤 · 어둡게', '#4f351d'], ['라이트 오크', '#c9a97a'], ['내추럴 오크', '#a98457'],
  ['월넛', '#5c3d26'], ['다크 월넛', '#3b2616'], ['그레이 우드', '#8a8178'], ['화이트 워시', '#d9cfc0'], ['블랙', '#222222'],
];
export const PALETTE_CEIL = [['현재(스캔)', null], ['화이트', '#f2efe9'], ['웜 화이트', '#ebe3d4'], ['라이트 그레이', '#cfcdc8'], ['차콜', '#333333']];
export const PALETTE_CURTAIN = [['밤색', '#5a3a22'], ['다크 브라운', '#3e2a1a'], ['베이지', '#c9b89a'], ['아이보리', '#ece4d4'], ['와인', '#6e2a2e'], ['차콜', '#3b3b3b'], ['네이비', '#2d3650']];
export const FRAME_STYLES = [['골드', 'gold'], ['블랙', 'black'], ['화이트', 'white'], ['내추럴 우드', 'natural']];
export const PROP_TYPES = [
  ['이젤', 'easel'], ['이젤+캔버스', 'easel_canvas'], ['작업 테이블', 'table'], ['스툴', 'stool'], ['벤치', 'bench'], ['전시 좌대', 'pedestal'],
  ['화분', 'plant'], ['파티션', 'partition'], ['러그', 'rug'], ['접수 카운터', 'counter'], ['안내판', 'sign'], ['펜던트 조명', 'pendant'],
];

export const STORAGE_KEY = 'kobe3d.design.v1';

export function emptyDesign() {
  return { version: 1, surfaces: {}, columns: {}, windows: null, landmarks: {}, props: [], global: {} };
}

export class DesignStore {
  constructor(meta) {
    this.meta = meta; this.listeners = []; this.design = emptyDesign();
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) this.design = this.migrate(JSON.parse(raw)); } catch {}
    if (!this.design.windows) this.design.windows = this.defaultWindows();
  }
  migrate(d) { const e = emptyDesign(); return { ...e, ...d, surfaces: d.surfaces || {}, columns: d.columns || {}, landmarks: d.landmarks || {}, props: d.props || [], global: d.global || {} }; }
  // 창 기본값: 메타데이터의 벽 개구부(window) → 편집 가능한 레코드
  defaultWindows() {
    const out = {};
    for (const e of this.meta.elements || []) {
      if (e.type !== 'wall') continue;
      const ws = (e.openings || []).filter((o) => o.kind === 'window').map((o, i) => ({
        id: `${e.id}_w${i}`, from: +o.from.toFixed(2), to: +o.to.toFixed(2), y0: +(o.y?.[0] ?? 0.95).toFixed(2), y1: +(o.y?.[1] ?? 2.0).toFixed(2),
        frame: '#8a8f94', curtain: { on: false, color: '#5a3a22', style: 'open' },
      }));
      if (ws.length) out[e.id] = ws;
    }
    return out;
  }
  onChange(fn) { this.listeners.push(fn); }
  commit(reason = '') { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.design)); } catch {} for (const fn of this.listeners) fn(reason); }
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
