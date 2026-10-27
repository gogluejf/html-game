// Drawer contract: (ctx, entity) => void
// Entity provides x, y, w, h, rotation, scale, mirrorX/Y, alive, etc.

/**
 * Spread pellet: small spinning disc with teeth.
 */
export function spreadDrawer(ctx, e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const r = e.w / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(performance.now() * 0.01);
  ctx.fillStyle = '#e67e22';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.fillRect(Math.cos(a) * r * 0.7 - 2, Math.sin(a) * r * 0.7 - 2, 4, 4);
  }
  ctx.restore();
}
