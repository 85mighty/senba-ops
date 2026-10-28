// 기기 간 자동 동기화 — kobe3d-sync 서버(sync-server/)에 A안·B안·C안을 올리고 받는다.
// 규칙: 편집하면 1.2초 뒤 올림. 열 때·탭으로 돌아올 때·15초마다 받아옴. 둘 다 바뀌었으면 나중에 편집한 쪽(editedAt)이 이김.
// 내 쪽이 지는 경우 덮어쓰기 전 로컬 사본을 kobe3d.design.v1.backup.* 에 남긴다. 오프라인이면 기기에 보관했다가 연결되면 올림.
import { SLOTS, STORAGE_KEY } from './design.js';

export const DEFAULT_SYNC_URL = 'https://blog.senbaartstudio.com/kobe3d-api';
const CFG = 'kobe3d.sync.cfg', META = 'kobe3d.sync.meta';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const device = () => { const u = navigator.userAgent; return /iPad/.test(u) ? 'iPad' : /iPhone/.test(u) ? 'iPhone' : /Android/.test(u) ? 'Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : 'browser'; };

export class Sync {
  constructor(store, { onApplied = () => {}, onStatus = () => {} } = {}) {
    this.store = store; this.onApplied = onApplied; this.onStatus = onStatus;
    this.cfg = load(CFG, { url: DEFAULT_SYNC_URL, token: '' }); this.meta = load(META, {});
    this.applying = false; this.timers = {}; this.unsupported = new Set(); this.status = this.enabled ? 'idle' : 'off'; this.lastSync = null;
    store.onChange((reason) => { if (this.applying || reason === 'switch' || reason === 'sync' || !this.enabled) return; this.touched(store.active); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.pull(); });
    window.addEventListener('online', () => this.pull());
    this.poll = setInterval(() => { if (document.visibilityState === 'visible') this.pull(); }, 15000);
  }
  get enabled() { return !!(this.cfg.url && this.cfg.token); }
  setStatus(s, detail = '') { this.status = s; this.detail = detail; this.onStatus(s, detail); }
  m(slot) { return this.meta[slot] || (this.meta[slot] = { rev: 0, dirty: false }); }
  saveMeta() { save(META, this.meta); }
  async connect(url, token) {
    this.cfg = { url: (url || DEFAULT_SYNC_URL).replace(/\/+$/, ''), token: token.trim() }; save(CFG, this.cfg); this.meta = {}; this.saveMeta();
    this.setStatus('idle', '연결 중…');   // 이전 '비밀번호 확인'·'오프라인' 표시를 바로 지운다
    return this.pull(true);
  }
  disconnect() { this.cfg = { url: this.cfg.url, token: '' }; save(CFG, this.cfg); this.meta = {}; this.saveMeta(); for (const t of Object.values(this.timers)) clearTimeout(t); this.setStatus('off'); }
  // 이 안이 바뀜 → 표시하고 잠시 뒤 올림
  touched(slot) { if (!this.enabled) return; this.m(slot).dirty = true; this.saveMeta(); clearTimeout(this.timers[slot]); this.timers[slot] = setTimeout(() => this.push(slot), 1200); this.setStatus('pending'); }
  async req(path, opt = {}) {
    const r = await fetch(this.cfg.url + path, { ...opt, cache: 'no-store', headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
    if (r.status === 401) { this.setStatus('auth', '동기화 비밀번호가 맞지 않습니다'); throw Object.assign(new Error('auth'), { auth: true }); }
    return r;
  }
  async push(slot) {
    if (!this.enabled) return; const design = this.store.getSlot(slot); if (!design) return;
    this.setStatus('pushing');
    try {
      const r = await this.req(`/designs/${slot}`, { method: 'PUT', body: JSON.stringify({ design, editedAt: design.editedAt || 0, device: device() }) });
      const j = await r.json();
      if (r.status === 404) { this.unsupported.add(slot); this.m(slot).dirty = false; this.saveMeta(); }   // 서버가 아직 이 안(D안 등)을 모름 → 이 기기에만 보관
      else if (r.status === 409) { this.apply(slot, j.current, true); }
      else if (r.ok) { const mm = this.m(slot); mm.rev = j.rev; if ((this.store.getSlot(slot)?.editedAt || 0) <= j.editedAt) mm.dirty = false; this.saveMeta(); }
      else throw new Error(j.error || r.status);
      this.done();
    } catch (e) { if (!e.auth) this.setStatus('offline', '연결되면 올립니다'); }
  }
  // 서버 내용을 이 기기에 적용 (덮어쓰기 전 다른 로컬 내용은 백업)
  apply(slot, rec, backup) {
    const local = this.store.getSlot(slot);
    if (backup && local && JSON.stringify(local) !== JSON.stringify(rec.design)) { try { localStorage.setItem(`${STORAGE_KEY}.backup.${slot}.${Date.now()}`, JSON.stringify(local)); } catch {} }
    this.applying = true; try { this.store.putSlot(slot, rec.design, true); } finally { this.applying = false; }
    const mm = this.m(slot); mm.rev = rec.rev; mm.dirty = false; this.saveMeta(); this.onApplied(slot, rec);
  }
  async pull(first = false) {
    if (!this.enabled || this._pulling) return; this._pulling = true;
    try {
      const r = await this.req('/designs'); if (!r.ok) throw new Error(r.status); const { slots } = await r.json();
      for (const s of SLOTS) {
        if (this.unsupported.has(s)) continue;
        const remote = slots[s]; const local = this.store.getSlot(s); const mm = this.m(s);
        if (!remote) { if (local) await this.push(s); continue; }
        if (remote.rev === mm.rev) { if (mm.dirty) await this.push(s); continue; }
        const localNewer = local && (local.editedAt || 0) > (remote.editedAt || 0);
        if (localNewer && (mm.dirty || !mm.rev)) { await this.push(s); continue; }
        if (local && JSON.stringify(local) === JSON.stringify(remote.design)) { mm.rev = remote.rev; mm.dirty = false; this.saveMeta(); continue; }
        this.apply(s, remote, true);
      }
      this.done();
      return true;
    } catch (e) { if (!e.auth) this.setStatus('offline', first ? '서버에 연결할 수 없습니다' : '연결되면 다시 맞춥니다'); return false; }
    finally { this._pulling = false; }
  }
  done() { if (SLOTS.some((s) => !this.unsupported.has(s) && this.m(s).dirty)) return this.setStatus('pending'); this.lastSync = new Date(); this.setStatus('ok'); }
}
