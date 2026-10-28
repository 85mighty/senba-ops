// 소품·창·커튼 절차 생성. 모든 소품은 원점이 바닥 중심, +Z 가 정면.
import * as THREE from 'three';

const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts });
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
const cyl = (r0, r1, h, mat, x = 0, y = 0, z = 0, seg = 14) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat); m.position.set(x, y, z); return m; };
const WOOD = 0xb08a5a, DARK = 0x2a2a2a, CANVAS = 0xf4f1ea;
// 작은 글씨 판(캔버스 텍스처) — 서랍 안내 문구 등
function labelPlate(text, w, h, bg = '#2b2118', fg = '#e9d9b6') {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = Math.round(512 * h / w); const c = cv.getContext('2d');
  c.fillStyle = bg; c.fillRect(0, 0, cv.width, cv.height); c.strokeStyle = fg; c.lineWidth = 6; c.strokeRect(8, 8, cv.width - 16, cv.height - 16);
  c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; const lines = text.split('\n'); const fs = Math.min(cv.height / (lines.length + 0.8), 64);
  c.font = `600 ${fs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`; lines.forEach((t, i) => c.fillText(t, cv.width / 2, cv.height / 2 + (i - (lines.length - 1) / 2) * fs * 1.15));
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
}
// 라탄(등나무) 바구니 — 앞면 손잡이 구멍
function basket(w, h, d, x, y, z) {
  const g = new THREE.Group(); const rat = std(0xc9a46c, { roughness: 0.95 }); g.add(box(w, h, d, rat));
  for (let i = 1; i < 6; i++) g.add(box(w + 0.002, 0.004, d + 0.002, std(0xa8854f), 0, -h / 2 + (h * i) / 6, 0));
  g.add(box(w * 0.32, h * 0.18, 0.004, std(0x4a3a26), 0, h * 0.25, d / 2 + 0.002)); g.position.set(x, y, z); return g;
}

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
    case 'sideboard': {
      // 이케아 느낌 사이드보드(약 160×45×85 cm): 오크 상판·몰딩, 검은 철제 틀 유리문 4짝 + 라탄 바구니, 위쪽 서랍 2개는 살짝 열어
      // 왼쪽 = 소데커버(팔토시), 오른쪽 = 베레모 — 손님이 꺼내 쓰는 서랍. 앞에 안내 문구 판
      const oak = std(c || 0x9b7650, { roughness: 0.6 }), oakD = std(0x7a5a3a, { roughness: 0.65 }), iron = std(0x1d1d1d, { metalness: 0.5, roughness: 0.45 });
      const glass = new THREE.MeshStandardMaterial({ color: 0x9fb0a8, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false });
      const W = 1.6, D = 0.45, H = 0.86;
      g.add(box(W, 0.08, D - 0.04, oakD, 0, 0.04, -0.01));                                             // 받침
      g.add(box(0.03, H - 0.12, D, oak, -W / 2 + 0.015, 0.08 + (H - 0.12) / 2, 0)); g.add(box(0.03, H - 0.12, D, oak, W / 2 - 0.015, 0.08 + (H - 0.12) / 2, 0));
      g.add(box(W, H - 0.12, 0.02, oakD, 0, 0.08 + (H - 0.12) / 2, -D / 2 + 0.01)); g.add(box(0.025, H - 0.12, D - 0.03, oak, 0, 0.08 + (H - 0.12) / 2, 0));
      g.add(box(W - 0.06, 0.02, D - 0.04, oak, 0, 0.09, 0)); g.add(box(W - 0.06, 0.02, D - 0.04, oak, 0, 0.36, 0)); g.add(box(W - 0.06, 0.02, D - 0.04, oak, 0, 0.62, 0));
      g.add(box(W + 0.06, 0.035, D + 0.04, oak, 0, H - 0.02, 0.005)); g.add(box(W + 0.03, 0.02, D + 0.02, oakD, 0, H - 0.045, 0.005));   // 상판 + 몰딩
      // 유리문 4짝 (검은 틀) — 아래 두 칸에 라탄 바구니
      const dw = (W - 0.06) / 4, y0 = 0.1, y1 = 0.63, fz = D / 2 + 0.005;
      for (let i = 0; i < 4; i++) { const cx = -W / 2 + 0.03 + dw * (i + 0.5); const dg = new THREE.Group(); dg.position.set(cx, (y0 + y1) / 2, fz);
        dg.add(box(dw - 0.01, y1 - y0, 0.004, glass)); for (const sx of [-1, 1]) dg.add(box(0.018, y1 - y0, 0.02, iron, sx * (dw / 2 - 0.014), 0, 0)); for (const sy of [-1, 1]) dg.add(box(dw - 0.01, 0.018, 0.02, iron, 0, sy * ((y1 - y0) / 2 - 0.009), 0));
        dg.add(box(0.012, 0.12, 0.02, iron, (i % 2 === 0 ? 1 : -1) * (dw / 2 - 0.05), 0.02, 0.02)); g.add(dg);
        g.add(basket(dw - 0.08, 0.22, D - 0.12, cx, 0.21, -0.02)); if (i !== 2) g.add(basket(dw - 0.08, 0.2, D - 0.12, cx, 0.47, -0.02)); else { const vs = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), std(0xf3f1ec, { roughness: 0.3 })); vs.scale.y = 1.2; vs.position.set(cx, 0.48, -0.02); g.add(vs); } }
      // 위 서랍 2개(유리문 위) — 살짝 열려 안이 보인다
      const dh = 0.15, dy = 0.71, open = 0.16, half = (W - 0.06) / 2;
      for (const side of [-1, 1]) {
        const cx = side * half / 2; const dr = new THREE.Group(); dr.position.set(cx, dy, open);
        dr.add(box(half - 0.02, dh, 0.025, oak, 0, 0, D / 2)); dr.add(box(0.16, 0.014, 0.02, iron, 0, 0.02, D / 2 + 0.02));       // 앞판 + 손잡이
        dr.add(box(half - 0.06, 0.012, D - 0.06, oakD, 0, -dh / 2 + 0.01, 0)); for (const sx of [-1, 1]) dr.add(box(0.012, dh - 0.03, D - 0.06, oakD, sx * (half / 2 - 0.03), -0.01, 0));
        if (side < 0) {   // 소데커버(팔토시): 말아 둔 천 원통
          const cols = [0x1f2a3a, 0x2d2d2d, 0x6b4a33, 0x1f2a3a, 0x3d4b3a, 0x2d2d2d];
          cols.forEach((col, k) => { const t = cyl(0.035, 0.035, 0.26, std(col, { roughness: 0.95 }), -half / 2 + 0.1 + (k % 3) * 0.2, -dh / 2 + 0.05 + Math.floor(k / 3) * 0.06, 0); t.rotation.x = Math.PI / 2; dr.add(t); });
        } else {          // 베레모: 납작한 원형 모자 겹쳐 쌓기
          const cols = [0x8f1d22, 0x1c1c1c, 0xcdb79a, 0x2f4a3f, 0x8f1d22, 0x1c1c1c];
          cols.forEach((col, k) => { const b = cyl(0.11, 0.1, 0.035, std(col, { roughness: 0.95 }), -half / 2 + 0.15 + (k % 3) * 0.2, -dh / 2 + 0.035 + Math.floor(k / 3) * 0.035, 0.01 * (k % 2), 18); b.scale.z = 0.9; dr.add(b); dr.add(cyl(0.008, 0.008, 0.015, std(col), b.position.x, b.position.y + 0.025, b.position.z, 6)); });
        }
        const lp = labelPlate(side < 0 ? '소데커버 · 자유롭게 쓰세요' : '베레모 · 자유롭게 쓰세요', 0.4, 0.05); lp.position.set(0, -0.035, D / 2 + 0.0135); dr.add(lp);   // 서랍 앞판 안내
        g.add(dr);
      }
      break;
    }
    case 'wall_mirror': {   // 검은 틀 가로 거울(약 120×60 cm) — 중심 높이 1.55 m, 벽에 붙임
      const fr = std(c || 0x1a1a1a, { roughness: 0.5 }); const W = 1.2, H = 0.6, y = 1.55;
      g.add(box(W + 0.06, H + 0.06, 0.03, fr, 0, y, 0.015)); const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04, envMapIntensity: 1.3 }));
      m.position.set(0, y, 0.032); g.add(m); break;
    }
    case 'sculpture': {     // 흰 대리석 흉상 + 사각 받침 (높이 약 62 cm) — '높이' 값으로 선반 위에 올린다
      const mar = std(c || 0xebe8e1, { roughness: 0.35 });
      g.add(box(0.24, 0.1, 0.22, std(0x2a2a2a, { roughness: 0.4 }), 0, 0.05, 0)); g.add(box(0.2, 0.04, 0.18, mar, 0, 0.12, 0));
      const chest = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), mar); chest.scale.set(1.25, 0.75, 0.62); chest.position.set(0, 0.25, 0); g.add(chest);
      g.add(box(0.36, 0.04, 0.16, mar, 0, 0.165, 0)); g.add(cyl(0.05, 0.058, 0.12, mar, 0, 0.38, 0.005, 16));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 24, 18), mar); head.scale.set(0.92, 1.2, 1.02); head.position.set(0, 0.52, 0.012); g.add(head);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), std(c || 0xe2dfd7, { roughness: 0.6 })); hair.scale.set(0.95, 1.05, 1.05); hair.position.set(0, 0.55, 0.0); g.add(hair);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.045, 8), mar); nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.51, 0.115); g.add(nose);
      break;
    }
    case 'deco_set': {      // 상판 장식: 라탄 테이블 조명 + 유리 화병과 붉은 꽃 + 라탄 받침 (사진의 이케아 진열)
      const rat = std(0xc98b4a, { roughness: 0.9, emissive: 0xffa040, emissiveIntensity: 0.35 });
      g.add(cyl(0.12, 0.12, 0.01, std(0xb59466, { roughness: 1 }), -0.16, 0.005, 0, 24));
      const vase = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), new THREE.MeshStandardMaterial({ color: 0x55605c, transparent: true, opacity: 0.7, roughness: 0.1, metalness: 0.2 })); vase.scale.set(1, 1.15, 1); vase.position.set(-0.16, 0.12, 0); g.add(vase);
      for (let k = 0; k < 5; k++) { const a = k * 1.3; const st = cyl(0.004, 0.004, 0.32, std(0x3f5a32), -0.16 + Math.cos(a) * 0.03, 0.34, Math.sin(a) * 0.03, 5); st.rotation.z = Math.cos(a) * 0.25; g.add(st);
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), std(0x8f1022, { roughness: 0.8 })); fl.scale.y = 0.6; fl.position.set(-0.16 + Math.cos(a) * 0.09, 0.48 + (k % 2) * 0.05, Math.sin(a) * 0.08); g.add(fl); }
      g.add(cyl(0.012, 0.012, 0.24, std(0xd9c39a, { metalness: 0.4 }), 0.18, 0.12, 0)); g.add(cyl(0.06, 0.07, 0.02, std(0xd9c39a, { metalness: 0.4 }), 0.18, 0.01, 0));
      const shade = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), rat); shade.position.set(0.18, 0.2, 0); shade.material.side = THREE.DoubleSide; g.add(shade);
      break;
    }
    default: g.add(box(0.3, 0.3, 0.3, std(0xff00ff)));
  }
  g.position.set(p.x, p.y || 0, p.z); g.rotation.y = p.rot || 0;   // y: 선반 위에 올릴 때(바닥에서 높이) const s = p.scale || 1; g.scale.set(s, s, s);
  g.traverse((o) => { if (o.isMesh) o.userData.propId = p.id; });
  return g;
}

/** 창: 프레임 + 유리 + 중간 멀리언. placeFn(obj, t, y, off) 으로 벽 좌표계에 놓는다. */
// 간유리(망입 유리) 무늬 — 작은 캔버스 격자를 반복
let _frosted = null;
function frostedTexture() {
  if (_frosted) return _frosted;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#eef2f4'; g.fillRect(0, 0, 64, 64); g.strokeStyle = 'rgba(150,160,168,0.55)'; g.lineWidth = 1;
  for (let i = 0; i <= 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
  _frosted = new THREE.CanvasTexture(c); _frosted.wrapS = _frosted.wrapT = THREE.RepeatWrapping; _frosted.colorSpace = THREE.SRGBColorSpace; return _frosted;
}
// 일본식 알루미늄 미닫이창: 바깥 틀 + N짝(앞뒤 레일 번갈아) + 가로살 + 간유리 + 크레센트 잠금 + 커튼박스
function buildJpSliding(win, placeOnWall) {
  const g = new THREE.Group(); g.name = 'window'; g.userData.windowId = win.id;
  const W = win.to - win.from, H = win.y1 - win.y0; const n = Math.max(2, win.panes || 4); const fr = std(win.frame || '#9a9da0', { metalness: 0.55, roughness: 0.45 });
  const tex = frostedTexture().clone(); tex.needsUpdate = true; tex.repeat.set(W / 0.12, H / 0.12);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, emissive: 0xdde5ea, emissiveIntensity: 0.55, roughness: 0.9, transparent: true, opacity: 0.94, side: THREE.DoubleSide });
  const t = 0.045;                                                                                     // 바깥 틀
  g.add(box(W + t, t, 0.07, fr, 0, H / 2, 0)); g.add(box(W + t, t * 1.3, 0.09, fr, 0, -H / 2, 0.01)); g.add(box(t, H, 0.07, fr, -W / 2, 0, 0)); g.add(box(t, H, 0.07, fr, W / 2, 0, 0));
  const pw = (W - t) / n; const tr = win.transom ? (win.transom - win.y0) - H / 2 : null;           // 가로살 높이(창 중심 기준)
  for (let i = 0; i < n; i++) {
    const cx = -W / 2 + t / 2 + pw * (i + 0.5); const z = (i % 2 === 0 ? 0.0 : 0.028) + 0.005;        // 앞뒤 레일 번갈아
    const sash = new THREE.Group(); sash.position.set(cx, 0, z);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(pw - 0.04, H - t * 1.6), glassMat); sash.add(glass);
    sash.add(box(0.03, H - t, 0.03, fr, -pw / 2 + 0.015, 0, 0)); sash.add(box(0.03, H - t, 0.03, fr, pw / 2 - 0.015, 0, 0));   // 세로 틀
    sash.add(box(pw, 0.03, 0.03, fr, 0, H / 2 - t / 2 - 0.015, 0)); sash.add(box(pw, 0.03, 0.03, fr, 0, -H / 2 + t / 2 + 0.015, 0));
    if (tr !== null) sash.add(box(pw - 0.03, 0.028, 0.026, fr, 0, tr, 0));                              // 가로살
    g.add(sash);
  }
  for (let k = 1; k < n; k += 2) { const lx = -W / 2 + t / 2 + pw * (k + 0.5) - pw / 2; g.add(box(0.025, 0.06, 0.03, std(0x8d9195, { metalness: 0.6 }), lx, -0.05, 0.05)); }   // 크레센트
  if (win.valance) { const vb = std('#aeb0b2', { roughness: 0.7 }); g.add(box(W + 0.18, 0.16, 0.14, vb, 0, H / 2 + 0.1, 0.06)); }   // 커튼박스
  g.add(box(W + 0.06, 0.025, 0.07, std('#b7b8b9'), 0, -H / 2 - 0.02, 0.03));                          // 창턱
  placeOnWall(g, (win.from + win.to) / 2, (win.y0 + win.y1) / 2, 0.012);
  return g;
}

export function buildWindow(win, placeOnWall) {
  if (win.style === 'jp_sliding') return buildJpSliding(win, placeOnWall);
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
