// Drawer contract: (ctx, entity) => void

/**
 * Bomb: orange circle + blinking fuse spark.
 */
export function bombDrawer(ctx, e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const r = e.w / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#f39c12';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  const ttlFrac = typeof e.ttlFrac === 'number' ? e.ttlFrac : (e.life > 0 ? e.life / 1.5 : 0);
  const blinkRate = ttlFrac < 0.3 ? 0.05 : 0.15;
  if (Math.floor(performance.now() * blinkRate) % 2 === 0) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, -r - 3, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
