// 소품·창·커튼 절차 생성. 모든 소품은 원점이 바닥 중심, +Z 가 정면.
import * as THREE from 'three';

const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts });
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
const cyl = (r0, r1, h, mat, x = 0, y = 0, z = 0, seg = 14) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat); m.position.set(x, y, z); return m; };
const WOOD = 0xb08a5a, DARK = 0x2a2a2a, CANVAS = 0xf4f1ea;

export function buildProp(p) {
  const g = new THREE.Group(); g.name = 'prop'; g.userData.prop = p;
  const c = p.color ? new THREE.Color(p.color) : null; const wood = std(c || WOOD); const dark = std(c || DARK);
  switch (p.type) {
    case 'easel': case 'easel_canvas': {
      // 삼각 이젤: 다리는 위(꼭지점)에서 모이고 아래에서 벌어진다. 앞다리 2 + 뒷다리 1, 캔버스는 앞다리에 기대 살짝 뒤로 눕는다.
      const legMat = std(c || WOOD); const h = 1.75; const spread = 0.26;
      for (const [x, z, rz, rx] of [[-spread / 2, 0.06, -0.15, -0.06], [spread / 2, 0.06, 0.15, -0.06], [0, -0.3, 0, 0.36]]) {
        const l = cyl(0.014, 0.018, h, legMat, 0, h / 2, 0); l.rotation.set(rx, 0, rz); l.position.set(x, h / 2, z); g.add(l);
      }
      g.add(box(0.5, 0.03, 0.06, legMat, 0, 0.72, 0.1)); g.add(box(0.44, 0.025, 0.05, legMat, 0, 1.3, 0.03));
      if (p.type === 'easel_canvas') { const cv = box(0.5, 0.65, 0.03, std(CANVAS), 0, 1.07, 0.13); cv.rotation.x = -0.1; g.add(cv); const fr = box(0.54, 0.69, 0.02, std(0xd9c7a3), 0, 1.07, 0.12); fr.rotation.x = -0.1; g.add(fr); }
      break;
    }
    case 'chair': {   // 검은 철제 의자 (센바 세팅)
      const m = std(c || 0x1e1e1e, { metalness: 0.3, roughness: 0.6 });
      g.add(box(0.42, 0.02, 0.42, m, 0, 0.45, 0)); g.add(box(0.42, 0.4, 0.02, m, 0, 0.75, -0.2));
      for (const [dx, dz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) g.add(cyl(0.012, 0.012, 0.45, m, dx, 0.225, dz, 8));
      break;
    }
    case 'cart': {    // 3단 물감 카트
      const m = std(c || 0x1e1e1e, { metalness: 0.3, roughness: 0.6 });
      for (const y of [0.12, 0.42, 0.72]) g.add(box(0.45, 0.08, 0.35, m, 0, y, 0));
      for (const [dx, dz] of [[-0.2, -0.15], [0.2, -0.15], [-0.2, 0.15], [0.2, 0.15]]) g.add(cyl(0.008, 0.008, 0.8, m, dx, 0.4, dz, 8));
      for (let i = 0; i < 5; i++) g.add(cyl(0.025, 0.025, 0.12, std([0xffffff, 0xd94040, 0x3a6fd9, 0xf2c330, 0x3fa34d][i]), -0.15 + i * 0.075, 0.82, 0, 8));
      break;
    }
    case 'board': case 'couple_set': {
      // 센바 작업 보드: 약 90×130 cm 합판 보드(크라프트색)에 물감 묻은 짙은 틀, 낮은 받침에 기대어 벽에 비스듬히 세움
      const mkBoard = (x) => { const b = new THREE.Group(); const fr = box(0.9, 1.3, 0.035, std(0x3a4654, { roughness: 0.9 })); const face = box(0.74, 1.14, 0.01, std(0xc9a06a, { roughness: 0.95 }), 0, 0, 0.02);
        b.add(fr, face); b.add(box(0.74, 0.02, 0.012, std(0x5a6a7a), 0, 0.2, 0.025)); b.add(box(0.74, 0.02, 0.012, std(0x5a6a7a), 0, -0.25, 0.025));
        b.position.set(x, 0.72, 0); b.rotation.x = -0.14;                                    // 뒤로 8° 기댐
        const stand = box(0.6, 0.05, 0.5, std(c || 0x5a3e28), x, 0.025, 0.2); g.add(stand); g.add(box(0.06, 0.5, 0.05, std(c || 0x5a3e28), x - 0.25, 0.25, 0.15)); g.add(box(0.06, 0.5, 0.05, std(c || 0x5a3e28), x + 0.25, 0.25, 0.15));
        return b; };
      if (p.type === 'board') g.add(mkBoard(0));
      else {
        g.add(mkBoard(-0.75)); g.add(mkBoard(0.75));
        for (const [x, z, r] of [[-0.75, 0.75, 0.15], [0.75, 0.75, -0.15]]) { const ch = buildProp({ id: p.id, type: 'chair', x, z, rot: Math.PI + r, scale: 1, color: null }); ch.name = 'sub'; g.add(ch); }
        const cart = buildProp({ id: p.id, type: 'cart', x: 0, z: 0.55, rot: 0, scale: 1, color: null }); cart.name = 'sub'; g.add(cart);
      }
      break;
    }
    case 'table': { g.add(box(1.2, 0.04, 0.75, std(c || 0xdccbb0), 0, 0.72, 0)); for (const [dx, dz] of [[-0.55, -0.32], [0.55, -0.32], [-0.55, 0.32], [0.55, 0.32]]) g.add(cyl(0.02, 0.02, 0.7, dark, dx, 0.35, dz)); break; }
    case 'stool': { g.add(cyl(0.17, 0.17, 0.06, std(c || 0x3a3a3a), 0, 0.43, 0)); for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; g.add(cyl(0.012, 0.012, 0.42, dark, Math.cos(a) * 0.12, 0.21, Math.sin(a) * 0.12)); } break; }
    case 'bench': { g.add(box(1.4, 0.06, 0.4, std(c || 0x8b6b48), 0, 0.42, 0)); g.add(box(0.06, 0.4, 0.36, dark, -0.6, 0.2, 0)); g.add(box(0.06, 0.4, 0.36, dark, 0.6, 0.2, 0)); break; }
    case 'pedestal': { g.add(box(0.4, 1.0, 0.4, std(c || 0xf1efe9), 0, 0.5, 0)); g.add(box(0.42, 0.02, 0.42, std(0x2a2a2a), 0, 1.01, 0)); break; }
    case 'plant': { g.add(cyl(0.16, 0.13, 0.3, std(c || 0x6b5a4a), 0, 0.15, 0)); for (let i = 0; i < 7; i++) { const a = i * 0.9; const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.7, 6), std(0x4f7a46)); leaf.position.set(Math.cos(a) * 0.1, 0.6, Math.sin(a) * 0.1); leaf.rotation.z = Math.cos(a) * 0.5; leaf.rotation.x = Math.sin(a) * 0.5; g.add(leaf); } break; }
    case 'partition': { g.add(box(1.2, 1.8, 0.04, std(c || 0xe9e4da), 0, 0.9, 0)); g.add(box(1.24, 0.04, 0.3, dark, 0, 0.02, 0)); break; }
    case 'rug': { const r = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.4), std(c || 0x8a5a4a, { side: THREE.DoubleSide })); r.rotation.x = -Math.PI / 2; r.position.y = 0.006; g.add(r); break; }
    case 'counter': { g.add(box(1.6, 1.0, 0.6, std(c || 0x3b3b3b), 0, 0.5, 0)); g.add(box(1.7, 0.04, 0.7, std(0xd9c7a3), 0, 1.02, 0)); break; }
    case 'sign': { g.add(cyl(0.18, 0.18, 0.02, dark, 0, 0.01, 0)); g.add(cyl(0.012, 0.012, 1.3, dark, 0, 0.65, 0)); g.add(box(0.5, 0.35, 0.02, std(c || 0xf3f1ec), 0, 1.35, 0)); break; }
    case 'pendant': { g.add(cyl(0.004, 0.004, 1.0, dark, 0, 1.9, 0)); const sh = cyl(0.12, 0.2, 0.22, std(c || 0x1c1c1c, { side: THREE.DoubleSide }), 0, 1.35, 0); g.add(sh); const l = new THREE.PointLight(0xffd9b0, 2.5, 4, 1.5); l.position.set(0, 1.3, 0); g.add(l); break; }
    default: g.add(box(0.3, 0.3, 0.3, std(0xff00ff)));
  }
  g.position.set(p.x, 0, p.z); g.rotation.y = p.rot || 0; const s = p.scale || 1; g.scale.set(s, s, s);
  g.traverse((o) => { if (o.isMesh) o.userData.propId = p.id; });
  return g;
}

/** 창: 프레임 + 유리 + 중간 멀리언. placeFn(obj, t, y, off) 으로 벽 좌표계에 놓는다. */
export function buildWindow(win, placeOnWall) {
  const g = new THREE.Group(); g.name = 'window'; g.userData.windowId = win.id;
  const W = win.to - win.from, H = win.y1 - win.y0; const frame = std(win.frame || '#8a8f94', { metalness: 0.4, roughness: 0.5 });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshPhysicalMaterial({ color: 0xdfe9f2, transparent: true, opacity: 0.55, roughness: 0.35, transmission: 0, side: THREE.DoubleSide }));
  g.add(glass);
  const t = 0.04;
  g.add(box(W + t, t, 0.05, frame, 0, H / 2, 0)); g.add(box(W + t, t, 0.05, frame, 0, -H / 2, 0)); g.add(box(t, H, 0.05, frame, -W / 2, 0, 0)); g.add(box(t, H, 0.05, frame, W / 2, 0, 0));
  const n = Math.max(1, Math.round(W / 0.9)); for (let i = 1; i < n; i++) g.add(box(0.025, H, 0.04, frame, -W / 2 + (W / n) * i, 0, 0));
  g.add(box(W, 0.025, 0.04, frame, 0, -H * 0.1, 0));
  placeOnWall(g, (win.from + win.to) / 2, (win.y0 + win.y1) / 2, 0.02);
  return g;
}

/** 커튼: 봉 + 주름 패널(사인파 변위). style open = 양쪽으로 걷음, closed = 전체 */
export function buildCurtain(win, ceilH, placeOnWall) {
  const g = new THREE.Group(); g.name = 'curtain'; g.userData.windowId = win.id;
  const W = win.to - win.from; const top = Math.min(ceilH - 0.08, win.y1 + 0.18); const bottom = 0.12; const H = top - bottom;
  const rodMat = std(0x2a2a2a, { metalness: 0.6, roughness: 0.4 }); const rodLen = W + 0.5;
  const rod = cyl(0.014, 0.014, rodLen, rodMat); rod.rotation.z = Math.PI / 2; rod.position.set(0, H / 2 + 0.03, -0.08); g.add(rod);
  const mat = new THREE.MeshStandardMaterial({ color: win.curtain.color || '#5a3a22', roughness: 0.9, side: THREE.DoubleSide });
  const panel = (width, xc) => {
    const seg = Math.max(8, Math.round(width / 0.05)); const geo = new THREE.PlaneGeometry(width, H, seg, 4); const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, Math.sin((x / width) * Math.PI * 2 * Math.max(2, width / 0.18)) * 0.035); }
    geo.computeVertexNormals(); const m = new THREE.Mesh(geo, mat); m.position.set(xc, 0, -0.06); return m;
  };
  if (win.curtain.style === 'closed') g.add(panel(rodLen - 0.1, 0));
  else { const pw = Math.max(0.3, rodLen * 0.22); g.add(panel(pw, -rodLen / 2 + pw / 2)); g.add(panel(pw, rodLen / 2 - pw / 2)); }
  placeOnWall(g, (win.from + win.to) / 2, bottom + H / 2, 0.16);
  return g;
}

/** 거리 재기 선 + 라벨 */
export function measureLine(a, b, textSprite) {
  const g = new THREE.Group(); g.name = 'measure';
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false })));
  for (const p of [a, b]) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.02), std(0xffd27a)); s.position.copy(p); g.add(s); }
  const lbl = textSprite(`${a.distanceTo(b).toFixed(2)} m`); lbl.position.copy(a).lerp(b, 0.5).add(new THREE.Vector3(0, 0.12, 0)); g.add(lbl);
  return g;
}
