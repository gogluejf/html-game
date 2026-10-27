// Drawer contract: (ctx, zone) => void

/**
 * Dust/toxic cloud: soft grey-green billowing circle with drifting puffs.
 */
export function dustZoneDrawer(ctx, z) {
  if (!z.alive) return;
  const frac = 1 - z.t / z.duration;
  const alpha = frac < 0.2 ? frac / 0.2 : 1;
  ctx.save();
  ctx.globalAlpha = alpha * 0.6;

  // Main cloud body (soft ellipse).
  const cx = z.x + z.w / 2;
  const cy = z.y + z.h / 2;
  const rx = z.w / 2;
  const ry = z.h / 2;
  ctx.fillStyle = 'rgba(120,140,80,0.5)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // Drifting puffs (cheap sine-based wobble).
  const t = performance.now() * 0.002;
  ctx.fillStyle = 'rgba(90,110,60,0.4)';
  const puffs = 5;
  for (let i = 0; i < puffs; i++) {
    const px = z.x + (i / puffs) * z.w + Math.sin(t + i * 2.1) * 6;
    const py = cy + Math.cos(t + i * 1.4) * ry * 0.4;
    const pr = 6 + Math.sin(t + i) * 3;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
