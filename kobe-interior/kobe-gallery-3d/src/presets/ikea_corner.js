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
