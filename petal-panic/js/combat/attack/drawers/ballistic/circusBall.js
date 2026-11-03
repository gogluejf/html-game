// Drawer contract: (ctx, entity) => void

/**
 * Circus ball: striped red/orange circle. Default ballistic look.
 */
export function circusBallDrawer(ctx, e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const r = Math.min(e.w, e.h) / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(e.rotation ?? 0);
  // Body
  ctx.fillStyle = '#d43a2f';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Stripes
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
