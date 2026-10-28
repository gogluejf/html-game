// Attack Engine — Drawer: circus ball (ballistic family).
// Contract: (ctx, entity) => void
//
// Renders the generated circus_ball bounce sheet (assets/projectiles/circus_ball/
// bounce_f1..f4.png) with phase-driven frame selection:
//   f1 = impact squash (ground contact), f2/f3 = flat roll, f4 = round mid-air.
// Frame logic: near the ground → squash frames; airborne → round frame.
// Lazy-loads the four frame images on first draw (same pattern as hud.js
// portraits); falls back to a striped circle until they are ready or in node.

const FRAME_PATHS = [1, 2, 3, 4].map(
  (n) => new URL(`../../../assets/projectiles/circus_ball/bounce_f${n}.png`, import.meta.url).href
);

/** @type {HTMLImageElement[]|null} */
let frames = null;

function ensureFrames() {
  if (frames || typeof Image === 'undefined') return frames;
  frames = FRAME_PATHS.map((src) => {
    const img = new Image();
    img.src = src;
    return img;
  });
  return frames;
}

function ready(f) {
  return f && f.complete && f.naturalWidth > 0;
}

/** Striped-circle fallback (pre-load / node). */
function drawFallback(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#d43a2f';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f5a623';
  for (let i = -1; i <= 1; i += 2) {
    ctx.beginPath();
    ctx.moveTo(i * r * 0.35, -r);
    ctx.quadraticCurveTo(i * r * 0.7, 0, i * r * 0.35, r);
    ctx.lineTo(i * r * 0.55, r);
    ctx.quadraticCurveTo(i * r * 0.9, 0, i * r * 0.55, -r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function circusBallDrawer(ctx, e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const r = e.w / 2;
  const fs = ensureFrames();
  if (!fs || !fs.every(ready)) {
    drawFallback(ctx, cx, cy, r);
    return;
  }
  // Phase: distance from the surface the carrier last touched (or its own
  // bottom vs a nominal ground line derived from the last surface Y).
  const surfY = e._bombSurfaceY;
  const airPx = surfY != null ? Math.max(0, surfY - (e.y + e.h)) : 0;
  // Near the ground → squash/roll frames; airborne → round frame.
  let idx;
  if (airPx < 6) idx = e.vy >= 0 ? 0 : 1;      // contact: squash on fall, flat on rise
  else if (airPx < 24) idx = 2;                 // low: still flat-ish
  else idx = 3;                                 // mid-air: round
  const img = fs[idx];
  // Draw at the entity box, preserving the frame's aspect (squash frames are
  // wider than tall — that IS the squash).
  const scale = (e.w * 1.15) / img.naturalWidth;
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2 + (dh - e.h) / 2, dw, dh);
}
