// D안 '이케아 코너' — 주방 입구를 막고(벽 18) 벽 15와 이어지는 약 2 m 짙은 초록 벽 앞에
// 사이드보드(유리문·라탄 바구니, 위 서랍: 소데커버·베레모) + 검은 틀 가로 거울 + 상판 위 흉상·조명·꽃병.
// 바탕 디자인(보통 C안)을 복사해 이 코너만 바꾼다. 좌표는 geometry_metadata.json(closures·벽 15 앞면 z=1.761) 기준.
const GREEN = '#3f5a52';
const WALL_FACE_Z = 1.761, CX = -0.745;   // 벽 15(-1.75…-0.86) + 막은 입구(-0.86…0.26) 가운데
const ZONE = { x: [-1.9, 0.4], z: [0.9, 1.76] };   // 이 안에 있던 소품은 치운다

export function applyIkeaCorner(base) {
  const d = JSON.parse(JSON.stringify(base || {}));
  d.surfaces = d.surfaces || {}; d.props = (d.props || []).filter((p) => !(p.x > ZONE.x[0] && p.x < ZONE.x[1] && p.z > ZONE.z[0] && p.z < ZONE.z[1]));
  d.closures = { ...(d.closures || {}), kitchen: true };
  // 두 벽을 한 면처럼: 초록 칠, 띠도 같은 초록(보이지 않게), 걸레받이만 짙게, 몰딩·액자 없음
  const trim = { rail: { color: GREEN, style: 'flat' }, base: { color: '#2a2a2a', style: 'flat' }, moldingColor: GREEN, lower: { paint: GREEN, style: 'flat' } };
  for (const id of ['wall_z_14', 'wall_kitchen_close']) {
    const prev = d.surfaces[id] || {}; d.surfaces[id] = { ...prev, paint: GREEN, zone: 'all', texture: false, molding: false, art: false, artCount: null, frame: prev.frame || 'gold', splits: 1, trim };
  }
  const z = WALL_FACE_Z, rot = Math.PI;   // 소품 정면(+Z)이 큰방 쪽(−Z)을 보게
  d.props.push(
    { id: 'ik_sideboard', type: 'sideboard', x: CX, z: +(z - 0.235).toFixed(3), rot, scale: 1, color: null },
    { id: 'ik_mirror', type: 'wall_mirror', x: CX, z: +(z - 0.005).toFixed(3), rot, scale: 1, color: null },
    { id: 'ik_sculpture', type: 'sculpture', x: +(CX - 0.42).toFixed(3), y: 0.86, z: +(z - 0.24).toFixed(3), rot, scale: 1.25, color: null },
    { id: 'ik_deco', type: 'deco_set', x: +(CX + 0.45).toFixed(3), y: 0.86, z: +(z - 0.22).toFixed(3), rot, scale: 1, color: null },
  );
  d.editedAt = Date.now();
  return d;
}

// 기둥 거울(10/28 요청): 큰방 기둥 3개(4·11·18)에 띠(몰드) 위부터 천장까지 사방 꽉 차게
export const UPPER_MIRROR_COLUMNS = ['thin_column_4', 'wide_column_11', 'thin_column_18'];
export function applyUpperMirrors(base) {
  const d = JSON.parse(JSON.stringify(base || {})); d.columns = d.columns || {};
  for (const id of UPPER_MIRROR_COLUMNS) d.columns[id] = { w: null, d: null, dx: 0, dz: 0, ...(d.columns[id] || {}), mirror: true, mirrorFit: 'upper', mirrorFaces: ['xn', 'xp', 'zn', 'zp'] };
  d.editedAt = Date.now(); return d;
}

// 창 커튼(10/28 요청): 큰 미닫이창 두 세트에 각각 통로 커튼과 같은 짙은 회색 암막 — 양쪽으로 걷힌 상태로 시작
export const CURTAIN_GRAY = '#5c5955';
export function applyWindowCurtains(base, store) {
  const d = JSON.parse(JSON.stringify(base || {})); if (!d.windows && store) d.windows = store.defaultWindows();
  for (const list of Object.values(d.windows || {})) for (const w of list) if (w.style === 'jp_sliding') w.curtain = { ...(w.curtain || {}), on: true, color: CURTAIN_GRAY, style: 'open' };   // 사진의 큰 미닫이창(북쪽 2세트)만
  d.windowsEdited = true; d.editedAt = Date.now(); return d;   // 창 버전은 건드리지 않음 — 실측으로 창이 바뀌면 refreshWindowsVersion 이 커튼을 이어받아 새 창으로 바꾼다
}

// 바닥(10/28 요청): 실제 바닥 사진으로 만든 원목 마루 텍스처 — 칸별 칠은 지우고 전체에
export function applyRealFloor(base) {
  const d = JSON.parse(JSON.stringify(base || {})); d.surfaces = d.surfaces || {};
  for (const k of Object.keys(d.surfaces)) if (k.startsWith('floor_t')) d.surfaces[k].paint = null;
  d.surfaces.floor = { ...(d.surfaces.floor || {}), paint: 'tex:wood_real', texture: true }; d.editedAt = Date.now(); return d;
}

// 벽 초록 → STYLE ダルグリーン(11/06 요청). 색값은 판매 페이지 색 견본 사진에서 뽑은 근사값 — 실물 견본을 칠해 보고 맞출 것
export const DULL_GREEN = '#39433a';
const OLD_GREENS = /#(2f4a3f|3f5a52)/gi;   // 포레스트 그린 · 딥 그린
export function applyDullGreen(base) {
  const d = JSON.parse(JSON.stringify(base || {}).replace(OLD_GREENS, DULL_GREEN)); d.editedAt = Date.now(); return d;
}

// 아래 벽 방법 ③(11/06): エアサーモパネルlite(월넛 계열)를 바닥~검은 띠 위끝까지, 위끝은 전용 見切り材. 액자 몰딩 없음
export const AIR_PANEL_COLOR = '#8b5e3c';
export function applyAirPanel(base) {
  const d = JSON.parse(JSON.stringify(base || {})); d.global = { ...(d.global || {}), lower: { paint: AIR_PANEL_COLOR, style: 'air_panel' } };
  d.editedAt = Date.now(); return d;
}

// 1인용 레지 배치안(11/07 제안) — 소품 'register' 한 개를 놓는다(이미 있던 레지는 치움). 정면(+Z)이 손님 쪽
export const REGISTER_PLANS = {
  r1: { name: '레지 ① 입구 왼쪽 구석 (추천)', x: -3.1, z: 1.25, rot: Math.PI / 2, why: '통로를 나오자마자 왼쪽, 정면이 통로 출구를 봄 — 인사·접수·결제, 동선 밖, 직원(벽 2 등짐)이 입구·홀 전체를 봄' },
  r2: { name: '레지 ② 입구 정면 리셉션', x: -2.35, z: 0.75, rot: 0, why: '통로 정면 1 m — 첫눈에 보이는 안내 데스크. 대신 홀 쪽 동선을 조금 가림' },
  r3: { name: '레지 ③ 사이드보드 옆 · 직원 통로 앞', x: 0.62, z: 1.38, rot: Math.PI, why: '뒤 커튼 통로로 주방 재고·세면대 바로 — 직원이 편함. 입구에서 약 3 m, 포토 스폿과 붙어 줄이 사진에 걸릴 수 있음' },
};
export function applyRegister(base, key) {
  const r = REGISTER_PLANS[key]; const d = JSON.parse(JSON.stringify(base || {}));
  d.props = (d.props || []).filter((p) => p.type !== 'register'); d.props.push({ id: 'reg_' + key, type: 'register', x: r.x, z: r.z, rot: r.rot, scale: 1, color: null });
  d.editedAt = Date.now(); return d;
}

// 포토 스폿 → 동쪽 벽(벽 1) 남쪽 절반(11/07 제안). 사이드보드·거울·흉상·장식을 벽 1 앞으로 옮김(정면 = 서쪽, 홀 쪽).
// 벽 1 앞면 x≈2.354 + 판·見切り材 여유 3 cm. 앞 3 m 가 비어 있고 입구에서 대각선으로 바로 보임
const EAST_FACE = 2.354 - 0.03, PZ = -0.15, WEST = -Math.PI / 2;   // 화장실 문이 사진에 안 들어오게 북쪽으로
export function applyPhotoEast(base) {
  const d = JSON.parse(JSON.stringify(base || {})); d.props = d.props || [];
  const put = (type, x, z, y) => { let p = d.props.find((q) => q.type === type && String(q.id).startsWith('ik_')) || d.props.find((q) => q.type === type);
    if (!p) { p = { id: 'ik_' + type, type, scale: type === 'sculpture' ? 1.25 : 1, color: null }; d.props.push(p); } Object.assign(p, { x: +x.toFixed(3), z: +z.toFixed(3), rot: WEST }); if (y != null) p.y = y; };
  put('sideboard', EAST_FACE - 0.235, PZ); put('wall_mirror', EAST_FACE - 0.005, PZ);
  put('sculpture', EAST_FACE - 0.24, PZ - 0.42, 0.86); put('deco_set', EAST_FACE - 0.22, PZ + 0.45, 0.86);
  d.editedAt = Date.now(); return d;
}

// E안 '리셉션 알코브'(11/08): 레지 ② + 뒤·오른쪽 ㄱ자 벽(안쪽 크림슨, 홀 쪽은 홀과 같은 ダルグリーン·판) + 자동문 안쪽부터 레지까지 레드 카펫
// + 뒤 벽에 船場美術館 세로 금박 글씨와 금테 원형 거울. 경성미술관(서울) 레드 월 분위기
export const CRIMSON = '#8a1f2b';
export function applyReception(base) {
  let d = applyRegister(base, 'r2'); d.surfaces = d.surfaces || {}; d.closures = { ...(d.closures || {}), reception: true };
  const red = { paint: CRIMSON, zone: 'all', texture: false, molding: false, art: false, artCount: null, frame: 'gold', splits: 1,
    trim: { rail: { color: CRIMSON, style: 'none' }, base: { color: CRIMSON, style: 'none' }, moldingColor: CRIMSON, lower: { paint: null, style: 'flat' } } };
  for (const id of ['wall_rec_back_in', 'wall_rec_east_in']) d.surfaces[id] = { ...(d.surfaces[id] || {}), ...JSON.parse(JSON.stringify(red)) };
  const hallGreen = d.surfaces.wall_x_1?.paint || d.surfaces.wall_z_14?.paint || DULL_GREEN;   // 홀 쪽 면은 홀 벽과 같은 색(띠·판은 전체 설정 따름)
  for (const id of ['wall_rec_back_out', 'wall_rec_east_out']) d.surfaces[id] = { ...(d.surfaces[id] || {}), paint: hallGreen, zone: 'all', texture: false, molding: false, art: id === 'wall_rec_east_out' ? null : false, splits: 1 };
  d.props = d.props.filter((p) => !['brand_sign', 'round_mirror'].includes(p.type));
  d.props.push({ id: 'rec_sign', type: 'brand_sign', x: -1.98, y: 1.12, z: -0.494, rot: 0, scale: 1, color: null },
               { id: 'rec_mirror', type: 'round_mirror', x: -2.62, y: 1.42, z: -0.494, rot: 0, scale: 1, color: null });
  d.editedAt = Date.now(); return d;
}

// 2인 세트(보드 2·의자 2·카트, 공간 2.657 × 1.935 m) 최대 배치(11/08): 창 벽에 2팀 + 동쪽 벽(벽 1)에 1팀 = 3팀 6명.
// 기준: 세트 뒤는 벽에서 3 cm, 기둥은 사람 뒤 통로 쪽에만 걸림, 가운데 2.4 × 2 m 와 화장실 길(벽 1 남쪽) 비움
export const COUPLE_LAYOUT_3 = [
  { id: 'cs_n1', x: -2.60, z: -4.72, rot: 0, note: '창 벽 서쪽' },
  { id: 'cs_n2', x: 0.087, z: -4.72, rot: 0, note: '창 벽 동쪽' },
  { id: 'cs_e1', x: 2.237, z: -1.50, rot: -Math.PI / 2, note: '동쪽 벽(벽 1) — 보드가 벽, 사람은 서쪽을 등짐' },
];
export function applyCoupleLayout(base) {
  const d = JSON.parse(JSON.stringify(base || {})); d.props = (d.props || []).filter((p) => p.type !== 'couple_set');
  for (const c of COUPLE_LAYOUT_3) d.props.push({ id: c.id, type: 'couple_set', x: c.x, z: c.z, rot: c.rot, scale: 1, color: null });
  d.editedAt = Date.now(); return d;
}
