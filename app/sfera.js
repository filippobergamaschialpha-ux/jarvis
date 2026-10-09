/* Sfera animata. Da ferma gira piano a pochi fotogrammi al secondo; quando Jarvis
   ascolta o parla va fluida e reagisce alla voce. Con "riduci movimento" resta immobile. */
(() => {
"use strict";
const J = window.J;
const cv = J.$("orb"), cx = cv.getContext("2d");
const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const N = 700, pts = [];
for (let i = 0; i < N; i++) { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963; pts.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
let rot = 0, energy = 0, last = 0, raf = 0;
J.orbLevel = () => 0;     /* la voce la sostituisce con il volume reale */
J.orbActive = () => false;

function size() { const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr); draw(performance.now()); }
function draw(t) {
  const w = cv.width, h = cv.height, R = Math.min(w, h) * 0.32, cxm = w / 2, cym = h / 2;
  const target = J.orbActive() ? Math.min(1, 0.25 + J.orbLevel() * 2.2) : 0.12;
  energy += (target - energy) * 0.15;
  if (!reduce) rot += 0.004 + energy * 0.02;
  cx.clearRect(0, 0, w, h);
  const g = cx.createRadialGradient(cxm, cym, R * 0.1, cxm, cym, R * 1.6);
  g.addColorStop(0, "rgba(63,208,240," + (0.18 + energy * 0.4) + ")"); g.addColorStop(1, "rgba(63,208,240,0)");
  cx.fillStyle = g; cx.beginPath(); cx.arc(cxm, cym, R * 1.6, 0, Math.PI * 2); cx.fill();
  cx.strokeStyle = "rgba(63,208,240," + (0.3 + energy * 0.4) + ")"; cx.lineWidth = Math.max(1, w / 500);
  const tt = reduce ? 0 : t;
  cx.beginPath(); cx.ellipse(cxm, cym, R * 1.3, R * 0.3, -0.25 + tt / 9000, 0, Math.PI * 2); cx.stroke();
  cx.beginPath(); cx.ellipse(cxm, cym, R * 1.18, R * 0.22, 0.6 - tt / 12000, 0, Math.PI * 2); cx.stroke();
  cx.beginPath(); cx.arc(cxm, cym, R * 1.06, 0, Math.PI * 2); cx.stroke();
  const cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(0.35), st = Math.sin(0.35);
  const s = R * (1 + energy * 0.08 * Math.sin(tt / 90));
  for (const p of pts) {
    const x = p[0] * cr - p[2] * sr, z = p[0] * sr + p[2] * cr, y = p[1];
    const y2 = y * ct - z * st, z2 = y * st + z * ct, depth = (z2 + 1) / 2;
    cx.fillStyle = "rgba(150,235,255," + (0.12 + depth * 0.78) + ")";
    const d = (0.6 + depth * 1.7 + energy) * (w / 420);
    cx.fillRect(cxm + x * s, cym + y2 * s, d, d);
  }
}
function frame(t) {
  raf = 0;
  const active = J.orbActive();
  if (active || t - last > 66) { last = t; draw(t); }     /* ~15 fotogrammi/s da ferma */
  if (!reduce || active) raf = requestAnimationFrame(frame);
}
J.orbWake = () => { if (!raf) raf = requestAnimationFrame(frame); };
size(); window.addEventListener("resize", size);
J.orbWake();
})();
