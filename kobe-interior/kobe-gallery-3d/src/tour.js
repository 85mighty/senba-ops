// 둘러보기 투어(11/11) — 자동문으로 들어와 레지에서 계산하고, 홀 입구 아치를 지나 매장을 둘러보고 화장실 앞 포토 스폿에서 끝난다.
// 키프레임 {t 초, pos 카메라, tgt 주시점}. 사이는 에르미트 보간(멈춤 구간은 접선 0 → 자연스럽게 서고 출발)
import * as THREE from 'three';

export const TOUR_E = [
  { t: 0, pos: [-2.3, 1.5, 4.7], tgt: [-2.3, 1.25, 2.6], label: '자동문 밖' },
  { t: 2, pos: [-2.3, 1.5, 4.7], tgt: [-2.3, 1.25, 2.6] },
  { t: 6, pos: [-2.3, 1.5, 2.7], tgt: [-2.7, 1.2, 1.5], label: '들어와서 레지 쪽으로' },
  { t: 10, pos: [-2.35, 1.5, 1.55], tgt: [-3.25, 1.05, 1.45], label: '레지에서 계산' },
  { t: 14, pos: [-2.35, 1.5, 1.55], tgt: [-3.25, 1.05, 1.45] },
  { t: 16, pos: [-2.5, 1.5, 1.0], tgt: [-3.0, 1.3, 0.1], label: '뒤 벽 글씨·거울' },
  { t: 19, pos: [-2.3, 1.5, 0.55], tgt: [-1.71, 1.35, 0.3], label: '아치 입구로' },
  { t: 23, pos: [-1.71, 1.5, 0.3], tgt: [-0.2, 1.3, -0.6], label: '아치 통과' },
  { t: 27, pos: [-1.25, 1.5, 0.0], tgt: [-0.75, 1.1, 1.6], label: '사진 코너' },
  { t: 31, pos: [-1.4, 1.55, -0.9], tgt: [-3.2, 1.1, -1.7], label: '체험 스폿 ②' },
  { t: 35, pos: [-1.2, 1.55, -1.3], tgt: [-2.4, 1.15, -4.6], label: '체험 스폿 ①' },
  { t: 39, pos: [-0.6, 1.55, -1.6], tgt: [0.4, 1.15, -4.6], label: '체험 스폿 ③' },
  { t: 43, pos: [0.1, 1.55, -1.3], tgt: [2.3, 1.15, -1.5], label: '체험 스폿 ④' },
  { t: 47, pos: [0.5, 1.5, -0.2], tgt: [1.5, 1.1, 1.3], label: '화장실 앞 포토 스폿 쪽' },
  { t: 52, pos: [1.25, 1.5, 2.15], tgt: [1.79, 1.1, 1.62], label: '타원 거울 앞' },
  { t: 56, pos: [1.25, 1.5, 2.15], tgt: [1.79, 1.1, 1.62] },
];
export const tourDuration = (kf = TOUR_E) => kf[kf.length - 1].t;

function hermite(kf, t, key) {
  const n = kf.length; if (t <= kf[0].t) return [...kf[0][key]]; if (t >= kf[n - 1].t) return [...kf[n - 1][key]];
  let i = 0; while (i < n - 2 && t > kf[i + 1].t) i++;
  const a = kf[i], b = kf[i + 1], h = b.t - a.t, u = (t - a.t) / h;
  const tan = (k) => { const p = kf[Math.max(0, k - 1)], q = kf[Math.min(n - 1, k + 1)]; const dt = q.t - p.t || 1; return p[key].map((v, j) => (q[key][j] - v) / dt); };
  const ma = tan(i), mb = tan(i + 1);
  // 멈춤 구간(같은 위치)에서는 접선 0
  const still = (k) => kf[k][key].every((v, j) => Math.abs(v - (kf[k + 1] || kf[k])[key][j]) < 1e-6) || kf[k][key].every((v, j) => Math.abs(v - (kf[k - 1] || kf[k])[key][j]) < 1e-6);
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
  return a[key].map((v, j) => h00 * v + h10 * h * (still(i) ? 0 : ma[j]) + h01 * b[key][j] + h11 * h * (still(i + 1) ? 0 : mb[j]));
}
export function tourAt(t, kf = TOUR_E) { return { pos: hermite(kf, t, 'pos'), tgt: hermite(kf, t, 'tgt'), label: [...kf].reverse().find((k) => k.t <= t && k.label)?.label || '' }; }

// 뷰어에서 재생. 돌아오는 함수로 중지. onLabel(label) 로 자막, onEnd 로 끝 알림
export function playTour(viewer, { kf = TOUR_E, speed = 1, onLabel, onEnd } = {}) {
  let t = 0, done = false, last = ''; const ctrl = viewer.controls; const wasEnabled = ctrl.enabled; ctrl.enabled = false;
  const stop = () => { if (done) return; done = true; ctrl.enabled = wasEnabled; onEnd?.(); };
  viewer.onFrame.push((dt) => {
    if (done) return false; t += dt * speed; const k = tourAt(t, kf);
    viewer.camera.position.set(...k.pos); ctrl.target.set(...k.tgt); viewer.camera.lookAt(ctrl.target);
    if (k.label !== last) { last = k.label; onLabel?.(k.label); }
    if (t >= tourDuration(kf)) { stop(); return false; } return true;
  });
  return stop;
}
