// Drawer contract: (ctx, entity) => void

/**
 * Rock/pebble: irregular lopsided polygon with nicks. Default ballistic look.
 */
export function rockDrawer(ctx, e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const r = e.w / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(e.rotation ?? 0);
  ctx.fillStyle = '#8d7b6b';
  ctx.beginPath();
  ctx.moveTo(-r * 0.9, -r * 0.3);
  ctx.lineTo(-r * 0.4, -r * 0.9);
  ctx.lineTo(r * 0.3, -r * 0.8);
  ctx.lineTo(r * 0.9, -r * 0.2);
  ctx.lineTo(r * 0.7, r * 0.6);
  ctx.lineTo(r * 0.1, r * 0.9);
  ctx.lineTo(-r * 0.7, r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#6b5d50';
  ctx.fillRect(-r * 0.3, -r * 0.2, r * 0.3, r * 0.2);
  ctx.fillRect(r * 0.1, r * 0.2, r * 0.25, r * 0.15);
  ctx.restore();
}
