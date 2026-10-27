// 인테리어 범위 — 사진으로 확인한 범위 정보(geometry_metadata.json)를 편집기·A안이 같이 쓴다.
//  exterior_zones : 입구 자동문 바깥(계단참). 칠·띠·몰딩·액자를 하지 않고 스캔 그대로 둔다
//  fixture_walls  : 복원 때 벽으로 잡혔지만 실제로는 가구·설비인 면(싱크대 앞면 등) → 벽 목록에서 뺀다
//  service_walls  : 주방·화장실 안쪽 벽 → 몰딩·액자를 기본으로 달지 않는다(직접 켜면 표시)
//  door_openings  : 스캔에서 막혀 버린 문 개구부(화장실 문)
export const isFixtureWall = (meta, id) => !!(meta.fixture_walls || {})[id];
export const serviceOf = (meta, id) => (meta.service_walls || {})[id] || null;
export const doorOpenings = (meta, wallId) => (meta.door_openings || []).filter((d) => d.wall === wallId);

// 벽 길이방향(t) 구간 중 입구 밖에 해당하는 구간들
export function exteriorSpans(meta, w) {
  const out = [];
  for (const z of meta.exterior_zones || []) {
    const perp = w.axis === 'x' ? z.x : z.z, along = w.axis === 'x' ? z.z : z.x;
    if (w.offset < perp[0] - 0.02 || w.offset > perp[1] + 0.02) continue;
    const a = Math.max(w.from, along[0]), b = Math.min(w.to, along[1]); if (b - a > 0.01) out.push([a, b]);
  }
  return out;
}
export function isExteriorWall(meta, w) { return exteriorSpans(meta, w).reduce((s, [a, b]) => s + (b - a), 0) >= (w.to - w.from) - 0.05; }
export function inExterior(meta, x, z) { return (meta.exterior_zones || []).some((r) => x >= r.x[0] && x <= r.x[1] && z >= r.z[0] && z <= r.z[1]); }
// 바닥 칠을 하지 않는 곳: 입구 밖 + 주방·화장실 바닥(실제는 아이보리 장판)
export function floorKept(meta, x, z) { return inExterior(meta, x, z) || (meta.service_floors || []).some((r) => x >= r.x[0] && x <= r.x[1] && z >= r.z[0] && z <= r.z[1]); }

// 사각형 r=[t0,t1,y0,y1] 에서 구멍들을 뺀 나머지 사각형들
export function subtractRects(r, holes) {
  let out = [r];
  for (const h of holes) {
    const next = [];
    for (const [a, b, c, d] of out) {
      if (h[1] <= a || h[0] >= b || h[3] <= c || h[2] >= d) { next.push([a, b, c, d]); continue; }
      const ha = Math.max(a, h[0]), hb = Math.min(b, h[1]), hc = Math.max(c, h[2]), hd = Math.min(d, h[3]);
      if (ha > a) next.push([a, ha, c, d]);
      if (hb < b) next.push([hb, b, c, d]);
      if (hc > c) next.push([ha, hb, c, hc]);
      if (hd < d) next.push([ha, hb, hd, d]);
    }
    out = next;
  }
  return out.filter(([a, b, c, d]) => b - a > 0.005 && d - c > 0.005);
}
