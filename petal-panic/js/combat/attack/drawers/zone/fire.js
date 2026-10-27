// Drawer contract: (ctx, zone) => void
// Zone provides x, y, w, h, t, duration, alive, color, label, etc.

/**
 * Fire zone: flickering orange gradient with rising ember particles.
 */
export function fireZoneDrawer(ctx, z) {
  if (!z.alive) return;
  const frac = 1 - z.t / z.duration;
  const alpha = frac < 0.2 ? frac / 0.2 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;

  // Base glow.
  const grad = ctx.createLinearGradient(z.x, z.y + z.h, z.x, z.y);
  grad.addColorStop(0, 'rgba(255,80,0,0.7)');
  grad.addColorStop(0.5, 'rgba(255,160,0,0.4)');
  grad.addColorStop(1, 'rgba(255,220,0,0.1)');
  ctx.fillStyle = grad;
  ctx.fillRect(z.x, z.y, z.w, z.h);

  // Flicker columns (cheap fake flames).
  const t = performance.now() * 0.003;
  ctx.fillStyle = 'rgba(255,120,0,0.5)';
  const cols = Math.floor(z.w / 12);
  for (let i = 0; i < cols; i++) {
    const fx = z.x + i * 12 + 4;
    const fh = (Math.sin(t + i * 1.7) * 0.5 + 0.5) * z.h * 0.7;
    ctx.fillRect(fx, z.y + z.h - fh, 6, fh);
  }

  ctx.restore();
}
