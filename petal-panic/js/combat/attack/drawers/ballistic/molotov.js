// Drawer contract: (ctx, entity) => void

/**
 * Molotov carrier in flight: a glass bottle with a burning tip at its bottom.
 * The art faces RIGHT; Projectile.update() rotates it along velocity and adds
 * the same per-entity tumble used by rocks.
 */
export function molotovDrawer(ctx, e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const r = Math.max(4, e.w / 2);
  const t = performance.now() * 0.01;
  const flameWobble = Math.sin(t) * r * 0.18;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(e.rotation ?? 0);

  // Bottle body (right-facing).
  ctx.fillStyle = 'rgba(157, 236, 255, 0.92)';
  ctx.beginPath();
  ctx.moveTo(-r * 1.1, -r * 0.34);
  ctx.lineTo(r * 0.55, -r * 0.34);
  ctx.quadraticCurveTo(r * 1.15, -r * 0.34, r * 1.15, 0);
  ctx.quadraticCurveTo(r * 1.15, r * 0.34, r * 0.55, r * 0.34);
  ctx.lineTo(-r * 1.1, r * 0.34);
  ctx.closePath();
  ctx.fill();

  // Glass highlight.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath();
  ctx.moveTo(-r * 0.85, -r * 0.16);
  ctx.lineTo(r * 0.35, -r * 0.16);
  ctx.stroke();

  // Cork/mouth.
  ctx.fillStyle = '#a56b3c';
  ctx.fillRect(-r * 1.35, -r * 0.2, r * 0.3, r * 0.4);

  // Burning tail/tip at the back-bottom of the bottle.
  const fx = -r * 1.25;
  const fy = r * 0.25;
  ctx.fillStyle = 'rgba(255,120,0,0.28)';
  ctx.beginPath();
  ctx.arc(fx, fy, r * 0.95 + flameWobble, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff6d00';
  ctx.beginPath();
  ctx.moveTo(fx + r * 0.25, fy - r * 0.45);
  ctx.quadraticCurveTo(fx - r * 0.95, fy - r * 0.55 + flameWobble, fx - r * 0.55, fy + r * 0.55);
  ctx.quadraticCurveTo(fx - r * 0.1, fy + r * 0.2, fx + r * 0.25, fy - r * 0.45);
  ctx.fill();
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath();
  ctx.arc(fx - r * 0.15, fy, r * 0.28 + flameWobble * 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
