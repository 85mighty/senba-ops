// UI 배선 — 모드/북마크/토글/편집/내보내기. 테스트 하네스를 위해 window.__viewer* 를 노출한다.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Viewer } from './viewer.js';
import { InteriorA, LAYERS } from './interior.js';
import { DesignStore, PROP_TYPES, SLOTS } from './design.js';
import { Editor } from './editor.js';
import { encodeDesign, decodeDesign, shareCodeFromHash } from './share.js';
import { Sync, DEFAULT_SYNC_URL } from './sync.js';
import presetCPhone from './presets/c_phone_20261027.json';

// 저장소에 보관된 디자인 — 어느 기기에서든 불러올 수 있다. seedSlot: 그 안이 비어 있으면 처음 열 때 자동으로 채움
const PRESETS = [{ id: 'c_phone_20261027', name: 'C안 (폰에서 만든 것, 10/27)', seedSlot: 'C', design: presetCPhone }];
import meta from './geometry_metadata.json';

const $ = (s) => document.querySelector(s);
const errors = []; window.__viewerErrors = errors; window.__viewerReady = false;
function showError(msg) { errors.push(msg); const d = document.createElement('div'); d.className = 'e'; d.innerHTML = `<b>로딩 오류</b>\n${escapeHtml(msg)}`; $('#errors').appendChild(d); console.error(msg); }
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove('show'), 1800); }
window.addEventListener('error', (e) => showError(`JS: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => showError(`Promise: ${e.reason?.message || e.reason}`));

if (!meta.elements) showError('geometry_metadata.json 에 elements 가 없습니다. scripts/inspect_scan.py → clean_scan.py → reconstruct_room.py 를 먼저 실행하세요.');

const viewer = new Viewer($('#c'), meta, { onError: showError, onProgress: (p) => { $('#loading .bar i').style.width = `${Math.round(p * 100)}%`; } });
window.__viewer = viewer;
const store = new DesignStore(meta); window.__store = store;
const interior = new InteriorA(viewer, store); window.__interior = interior;
let editor = null; // 모델 로드 후 생성 (바닥 타일 판정에 복원 바닥 메쉬 필요)

// ---- 모드
const modeBtns = [...document.querySelectorAll('#modes button[data-mode]')];
function setMode(m) { viewer.setMode(m); editor?.applyHidden(); modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === m)); $('#interiorPanel').style.opacity = m === 'interior' ? 1 : 0.45; }
modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
window.__setMode = setMode;

// ---- 북마크
for (const b of viewer.bookmarks) { const btn = document.createElement('button'); btn.textContent = b.name; btn.addEventListener('click', () => viewer.goBookmark(b)); $('#bookmarks').appendChild(btn); }
$('#panelToggle').addEventListener('click', () => $('#panel').classList.toggle('hidden'));

// ---- 보기
const sectionY = $('#sectionY');
const applySection = () => { viewer.setCeilingHidden($('#hideCeiling').checked, +sectionY.value); $('#sectionYv').textContent = `${(+sectionY.value).toFixed(2)} m`; editor?.applyHidden(); };
$('#hideCeiling').addEventListener('change', applySection); sectionY.addEventListener('input', applySection);
sectionY.max = ((meta.ceiling_height_m || 3) + 0.3).toFixed(2); sectionY.value = ((meta.ceiling_height_m || 3) - 0.4).toFixed(2); $('#sectionYv').textContent = `${(+sectionY.value).toFixed(2)} m`;
$('#showDims').addEventListener('change', (e) => viewer.setDims(e.target.checked));
$('#ghostScan').addEventListener('change', (e) => viewer.setGhost(e.target.checked));
$('#highlightColumn').addEventListener('change', (e) => viewer.updateHighlight(e.target.checked));

// ---- 인테리어 레이어
for (const cb of document.querySelectorAll('[data-layer]')) cb.addEventListener('change', () => interior.setLayer(cb.dataset.layer, cb.checked));
const bind = (id, key, fmt, rebuild) => { const el = $(id); const out = $(id + 'v'); const f = () => { interior.opts[key] = +el.value; if (out) out.textContent = fmt(+el.value); rebuild(); }; el.addEventListener('input', f); };
bind('#mirrorH', 'mirrorH', (v) => `${v.toFixed(2)} m`, () => interior.rebuild('mirror_4_sides'));
bind('#mirrorInset', 'mirrorInset', (v) => `${v.toFixed(2)} m`, () => interior.rebuild('mirror_4_sides'));
bind('#lightI', 'lightI', (v) => v.toFixed(1), () => interior.applyLight());
bind('#lightK', 'lightK', (v) => `${v} K`, () => interior.applyLight());
$('#mirrorMode').addEventListener('change', (e) => { interior.opts.mirrorMode = e.target.value; interior.rebuild('mirror_4_sides'); toast(e.target.value === 'reflector' ? '실시간 반사: 면당 1회 추가 렌더 (4면=4회). 모바일에선 환경맵 권장' : '환경맵 반사: 가볍지만 주변이 정확히 비치진 않음'); });

// ---- 기둥 선택 → 거울 대상 변경
function setCentral(id, status) {
  interior.opts.central = id; meta.central_wide_column = id; viewer.updateHighlight(); interior.rebuild('mirror_4_sides'); interior.rebuild('molding');
  $('#centralId').textContent = id || '-'; $('#centralStatus').textContent = status || '';
  try { localStorage.setItem('kobe3d.central', id); } catch {}
}
try { const saved = localStorage.getItem('kobe3d.central'); if (saved && meta.elements?.some((e) => e.id === saved)) setCentral(saved, '(이 브라우저에 저장된 선택)'); else setCentral(meta.central_wide_column, `(${meta.central_wide_column_status || 'inferred'})`); } catch { setCentral(meta.central_wide_column, ''); }
const canvas = $('#c'); let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return; downAt = null;
  if (editor && editor.enabled && (viewer.mode === 'reconstructed' || viewer.mode === 'interior')) { editor.onClick(e); return; }
  if ($('#pickColumn').checked) {
    const hit = viewer.pick(e, (o) => o.userData.model === 'reconstructed' && /^(wide_column|thin_column|partition)_\d+$/.test(o.name));
    if (hit) { setCentral(hit.object.name, '(사용자 선택 — 메타데이터 반영: reconstruct_room.py --central-column ' + hit.object.name + ')'); toast(`거울 대상: ${hit.object.name}`); }
    else toast('기둥을 클릭하세요 (③/④ 모드의 복원 모델 기둥만 선택 가능)');
  } else if ($('#editFurniture').checked && viewer.mode === 'interior') {
    const hit = viewer.pick(e, (o) => { let p = o; while (p) { if (p.name === 'table') return true; p = p.parent; } return false; });
    if (hit) { let p = hit.object; while (p && p.name !== 'table') p = p.parent; tc.attach(p); } else tc.detach();
  }
});
// ---- 가구 이동 (TransformControls)
const tc = new TransformControls(viewer.camera, canvas); tc.setSize(0.8); tc.showY = false; viewer.scene.add(tc.getHelper ? tc.getHelper() : tc);
tc.addEventListener('dragging-changed', (e) => { viewer.controls.enabled = !e.value; });
tc.addEventListener('objectChange', () => { const o = tc.object; if (o) { o.position.y = 0; } });
window.addEventListener('keydown', (e) => { if (e.key === 'g') tc.setMode('translate'); if (e.key === 'r') { tc.setMode('rotate'); tc.showX = tc.showZ = false; tc.showY = true; } if (e.key === 'g') { tc.showX = tc.showZ = true; tc.showY = false; } if (e.key === 'Escape') tc.detach(); });
$('#editFurniture').addEventListener('change', (e) => { if (!e.target.checked) tc.detach(); else { $('[data-layer=furniture]').checked = true; interior.setLayer('furniture', true); } });
$('#copyLayout').addEventListener('click', async () => { const j = JSON.stringify({ tables: interior.furnitureLayout(), central_wide_column: interior.opts.central }, null, 1); try { await navigator.clipboard.writeText(j); toast('가구 배치 JSON 복사됨'); } catch { prompt('복사:', j); } });

// ---- 내보내기 (복원 모델 + 인테리어 A안 → interior_A.glb)
$('#exportGlb').addEventListener('click', () => {
  const g = new THREE.Group(); const recon = viewer.loaded.reconstructed; if (recon) g.add(recon.clone(true));
  const int = interior.root.clone(true); int.traverse((o) => { if (o.isSpotLight || o.name === 'mirror' && o.isReflector) o.removeFromParent?.(); }); g.add(int);
  new GLTFExporter().parse(g, (buf) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' })); a.download = 'interior_A.glb'; a.click(); toast('interior_A.glb 다운로드'); },
    (err) => showError('GLB 내보내기 실패: ' + err?.message), { binary: true, onlyVisible: true });
});

// ---- 치수 텍스트
(function dims() {
  const b = meta.bounds_world_m; if (!b) return; const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
  const els = meta.elements || [];
  $('#dimsText').innerHTML = `가로 ${w.toFixed(2)} m × 세로 ${d.toFixed(2)} m × 천장고 ${(meta.ceiling_height_m || 0).toFixed(2)} m <span class="hint">(${meta.ceiling_height_status || '?'})</span><br>` +
    `외벽 ${els.filter((e) => e.type === 'wall').length} · 넓은 기둥 ${els.filter((e) => e.type === 'wide_column').length} · 얇은 기둥 ${els.filter((e) => e.type === 'thin_column').length} · 창/문 후보 ${els.filter((e) => e.type === 'wall').reduce((n, e) => n + e.openings.length, 0)} · 설비 후보 ${els.filter((e) => e.type === 'fixture_candidate').length}<br>` +
    `체어레일 ${meta.chair_rail_height_m} m (${meta.chair_rail_status || '?'}) · 걸레받이 ${meta.baseboard_height_m} m (${meta.baseboard_status || '?'})<br>` +
    `원본: ${meta.source_file || '?'} · 단위 ${meta.unit_guess || '?'} · 정렬 회전 ${(meta.wall_yaw_deg ?? 0).toFixed(1)}°`;
})();

// ---- 시작
setMode('original');
// 시작 시점: 방 안 눈높이(메인 북마크) — 바깥에서 닫힌 상자만 보이는 것을 방지
{ const m = viewer.bookmarks[0]; viewer.camera.position.set(...m.pos); viewer.controls.target.set(...m.tgt); viewer.controls.update(); }
viewer.loadAll().then((loaded) => {
  $('#loading').classList.add('hidden');
  const ok = Object.keys(loaded); if (!ok.length) showError('불러온 모델이 없습니다. 위 오류를 확인하세요.');
  else if (!loaded.reconstructed) showError('reconstructed_room.glb 가 없어 ③④ 모드가 비어 있습니다.');
  editor = new Editor(viewer, interior, store, toast); window.__editor = editor; setupEditorUI();
  window.__viewerReady = true; window.__loadedModels = ok;
});

// ---- 편집기 UI
function refreshBookmarks() { viewer.bookmarks = viewer.computeBookmarks(); const box = $('#bookmarks'); box.innerHTML = ''; for (const b of viewer.bookmarks) { const btn = document.createElement('button'); btn.textContent = b.name; btn.addEventListener('click', () => viewer.goBookmark(b)); box.appendChild(btn); } }
function setupEditorUI() {
  editor.onLandmarks = refreshBookmarks; editor.renderChips(); editor.renderInspector();
  const curProp = () => { const sel = editor.selected; return sel?.kind === 'prop' ? store.design.props.find((x) => x.id === sel.id) : null; };
  $('#fabRotL').addEventListener('click', () => { const p = curProp(); if (p) editor.rotateProp(p, -15); });
  $('#fabRotR').addEventListener('click', () => { const p = curProp(); if (p) editor.rotateProp(p, 15); });
  $('#fabDup').addEventListener('click', () => { const p = curProp(); if (p) editor.duplicateProp(p); });
  $('#fabDel').addEventListener('click', () => { const sel = editor.selected; if (sel?.kind === 'prop') editor.deleteProp(sel.id); else if (sel?.kind === 'window') { store.removeWindow(sel.wall, sel.id); store.commit('window'); editor.renderChips(); editor.select(null); toast('창 삭제됨'); } });
  $('#fabClose').addEventListener('click', () => editor.select(null));
  $('#editMode').addEventListener('change', (e) => { editor.setEnabled(e.target.checked); if (e.target.checked && viewer.mode !== 'interior' && viewer.mode !== 'reconstructed') setMode('interior'); });
  $('#showLabels').addEventListener('change', (e) => editor.setLabels(e.target.checked));
  $('#showTileLabels').addEventListener('change', (e) => editor.setTileLabels(e.target.checked));
  $('#autoHide').addEventListener('change', (e) => editor.setAutoHide(e.target.checked));
  $('#showAll').addEventListener('click', () => { editor.showAll(); toast('모든 면 보이기'); });
  editor.renderHiddenChips();
  const bar = $('#propBar'); for (const [name, type] of PROP_TYPES) { const b = document.createElement('button'); b.textContent = name; b.addEventListener('click', () => { if (!editor.enabled) { $('#editMode').checked = true; editor.setEnabled(true); } editor.startPlacing(type); }); bar.appendChild(b); }
  $('#measureBtn').addEventListener('click', () => { if (!editor.enabled) { $('#editMode').checked = true; editor.setEnabled(true); } editor.startMeasure(); });
  $('#measureClear').addEventListener('click', () => editor.clearMeasures());
  $('#shotBtn').addEventListener('click', () => editor.screenshot());
  const saveState = () => { $('#undoBtn').disabled = !store.canUndo(); $('#redoBtn').disabled = !store.canRedo(); $('#revertBtn').disabled = !store.hasExplicit(); $('#saveState').textContent = store.dirty ? '저장되지 않은 변경 있음 (자동 보관 중)' : (store.hasExplicit() ? '저장됨' : '변경 사항은 자동 보관됩니다. 저장을 누르면 그 시점이 저장본이 됩니다.'); $('#saveNow').classList.toggle('active', store.dirty); };
  store.onChange(saveState); saveState();
  $('#saveNow').addEventListener('click', () => { store.saveExplicit(); saveState(); toast('저장됨'); });
  $('#undoBtn').addEventListener('click', () => { if (store.undo()) { editor.renderChips(); refreshBookmarks(); toast('되돌림'); } });
  $('#redoBtn').addEventListener('click', () => { if (store.redo()) { editor.renderChips(); refreshBookmarks(); toast('다시 실행'); } });
  $('#revertBtn').addEventListener('click', () => { if (store.revertToSaved()) { editor.renderChips(); refreshBookmarks(); toast('저장본으로 복원'); } });
  $('#resetWindows').addEventListener('click', () => { store.resetWindows(); editor.renderChips(); toast('창을 스캔 기본값으로 재설정'); });
  window.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'z' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); editor.renderChips(); } if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); store.saveExplicit(); saveState(); toast('저장됨'); } });
  // 디자인 안 A/B/C — 위쪽 바에서 전환
  const renderSlotBar = () => { const bar = $('#slotBar'); bar.innerHTML = ''; for (const sl of SLOTS) { const b = document.createElement('button'); const has = store.hasSlot(sl); b.textContent = has ? `${sl}안` : `${sl}안 +`; b.className = (sl === store.active ? 'on' : '') + (has ? '' : ' empty'); b.title = has ? `${sl}안 열기` : `${sl}안 새로 만들기(지금 디자인 복사)`; b.addEventListener('click', () => switchTo(sl)); bar.appendChild(b); } };
  const switchTo = (sl) => { if (viewer.mode !== 'interior' && viewer.mode !== 'reconstructed') setMode('interior'); const r = store.switchSlot(sl); if (r === 'same') return; if (r === 'new') window.__sync?.touched(sl); editor.renderChips(); refreshBookmarks(); renderSlotBar(); saveState(); toast(r === 'new' ? `${sl}안을 새로 만들었습니다 (지금 디자인 복사)` : `${sl}안 열림`); };
  window.__switchSlot = switchTo;
  for (const sl of SLOTS) { const btn = $(`#copy${sl}`); btn.addEventListener('click', () => { if (sl === store.active) { toast(`지금 ${sl}안입니다`); return; } if (store.hasSlot(sl) && !btn.dataset.arm) { btn.dataset.arm = '1'; btn.textContent = `${sl}안 덮어쓰기? (다시 누름)`; setTimeout(() => { delete btn.dataset.arm; btn.textContent = `→ ${sl}안`; }, 4000); return; } delete btn.dataset.arm; btn.textContent = `→ ${sl}안`; store.copyTo(sl); window.__sync?.touched(sl); renderSlotBar(); toast(`지금 디자인을 ${sl}안으로 복사`); }); }
  // 보관 디자인 자동 채우기 + 버튼
  for (const p of PRESETS) { const flag = 'kobe3d.seed.' + p.id; let seeded = false; try { seeded = !!localStorage.getItem(flag); } catch {}
    if (p.seedSlot && !seeded && !store.hasSlot(p.seedSlot)) { store.putSlot(p.seedSlot, p.design); try { localStorage.setItem(flag, '1'); } catch {} } }
  for (const p of PRESETS) { const b = document.createElement('button'); b.className = 'ghost'; b.textContent = `${p.name} → 지금 안에 불러오기`;
    b.addEventListener('click', () => { if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = `지금 ${store.active}안을 덮어씁니다. 다시 누르세요`; setTimeout(() => { delete b.dataset.arm; b.textContent = `${p.name} → 지금 안에 불러오기`; }, 4000); return; }
      delete b.dataset.arm; b.textContent = `${p.name} → 지금 안에 불러오기`; store.putSlot(store.active, p.design); editor.renderChips(); refreshBookmarks(); toast(`${p.name}을 ${store.active}안에 불러옴`); });
    $('#presetList').appendChild(b); }
  // 공유 링크
  $('#shareLink').addEventListener('click', async () => {
    try { const code = await encodeDesign(store.design); const url = `${location.origin}${location.pathname}#d=${code}`; $('#shareUrl').value = url;
      try { await navigator.clipboard.writeText(url); toast(`${store.active}안 공유 링크 복사됨`); } catch { $('#shareUrl').select(); toast('아래 칸의 링크를 복사하세요'); } }
    catch (e) { toast('링크 만들기 실패: ' + e.message); } });
  $('#shareUrl').addEventListener('focus', (e) => e.target.select());
  const incoming = shareCodeFromHash();
  if (incoming) {
    decodeDesign(incoming).then((d) => {
      const banner = $('#shareBanner'); banner.hidden = false;
      banner.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const to = b.dataset.to; banner.hidden = true; history.replaceState(null, '', location.pathname + location.search);
        if (!to) return; store.putSlot(to, d); window.__sync?.touched(to); switchTo(to); if (store.active === to) { editor.renderChips(); refreshBookmarks(); } renderSlotBar(); toast(`링크 디자인을 ${to}안에 넣었습니다`);
      }));
    }).catch((e) => toast('공유 링크를 읽지 못했습니다: ' + e.message));
  }
  window.__share = { encodeDesign, decodeDesign };
  renderSlotBar();
  // ---- 기기 간 자동 동기화
  const SYNC_TEXT = { off: '꺼짐', idle: '연결 중', ok: '동기화됨', pending: '저장 대기', pushing: '올리는 중…', offline: '오프라인', auth: '비밀번호 확인' };
  const sync = new Sync(store, {
    onApplied: (slot) => { renderSlotBar(); if (slot === store.active) { editor.renderChips(); refreshBookmarks(); saveState(); } },
    onStatus: (st, detail) => { const pill = $('#syncPill'); pill.hidden = st === 'off'; pill.className = 'syncpill ' + st; pill.textContent = '☁ ' + SYNC_TEXT[st];
      $('#syncState').textContent = SYNC_TEXT[st] + (detail ? ` — ${detail}` : '') + (st === 'ok' && sync.lastSync ? ` · ${sync.lastSync.toLocaleTimeString()}` : ''); },
  });
  window.__sync = sync;
  $('#syncUrl').value = sync.cfg.url || DEFAULT_SYNC_URL; if (sync.cfg.token) $('#syncToken').value = sync.cfg.token;
  $('#syncConnect').addEventListener('click', async () => { const tok = $('#syncToken').value; if (tok.trim().length < 8) { toast('비밀번호는 8자 이상'); return; } const ok = await sync.connect($('#syncUrl').value, tok); toast(ok ? '동기화 연결됨' : '연결 실패 — 주소·비밀번호를 확인하세요'); });
  $('#syncNow').addEventListener('click', async () => { const ok = await sync.pull(); toast(ok ? '최신으로 맞춤' : '연결 실패'); });
  $('#syncOff').addEventListener('click', () => { sync.disconnect(); $('#syncToken').value = ''; toast('동기화 끔 (이 기기에는 그대로 남아 있습니다)'); });
  if (sync.enabled) { sync.setStatus('idle'); sync.pull(); } else sync.setStatus('off');
  $('#exportDesign').addEventListener('click', async () => { const j = store.exportJSON(); $('#designJson').value = j; try { await navigator.clipboard.writeText(j); toast('디자인 JSON 복사됨 (아래 칸에도 표시)'); } catch { toast('아래 칸의 JSON 을 복사하세요'); } });
  $('#importDesign').addEventListener('click', () => { try { store.importJSON($('#designJson').value); editor.renderChips(); refreshBookmarks(); toast('디자인 불러옴'); } catch (e) { toast('불러오기 실패: ' + e.message); } });
  $('#resetDesign').addEventListener('click', () => { if ($('#resetDesign').dataset.arm) { store.reset(); editor.renderChips(); refreshBookmarks(); toast('초기화됨'); delete $('#resetDesign').dataset.arm; $('#resetDesign').textContent = '디자인 초기화'; } else { $('#resetDesign').dataset.arm = '1'; $('#resetDesign').textContent = '정말 초기화? (다시 클릭)'; setTimeout(() => { delete $('#resetDesign').dataset.arm; $('#resetDesign').textContent = '디자인 초기화'; }, 4000); } });
  window.addEventListener('keydown', (e) => { if (!editor.enabled) return; if (e.key === 'Delete' || e.key === 'Backspace') { const s = editor.selected; if (s?.kind === 'prop' && document.activeElement.tagName !== 'INPUT') { store.removeProp(s.id); store.commit('prop'); editor.select(null); } } if (e.key === 'Escape') { editor.placing = null; $('#placingHint').textContent = ''; editor.select(null); } });
  // 레이어 토글에 창/소품 추가
  $('#toggleWindows').addEventListener('change', (e) => { editor.windows.visible = e.target.checked; });
  $('#toggleProps').addEventListener('change', (e) => { editor.props.visible = e.target.checked; });
}
