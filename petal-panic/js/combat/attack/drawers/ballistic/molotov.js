// Drawer contract: (ctx, entity) => void

/**
 * Molotov carrier in flight: glowing orange-red fireball with a trailing flicker.
 */
export function molotovDrawer(ctx, e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const r = e.w / 2;
  ctx.save();
  ctx.translate(cx, cy);

  // Outer glow.
  ctx.fillStyle = 'rgba(255,100,0,0.3)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.4, 0, Math.PI * 2);
  ctx.fill();

  // Core fireball.
  const t = performance.now() * 0.008;
  const wobble = Math.sin(t) * r * 0.1;
  ctx.fillStyle = '#ff6600';
  ctx.beginPath();
  ctx.arc(0, 0, r + wobble, 0, Math.PI * 2);
  ctx.fill();

  // Hot center.
  ctx.fillStyle = '#ffcc00';
  ctx.beginPath();
  ctx.arc(0, -r * 0.2, r * 0.5, 0, Math.PI * 2);
  ctx.fill();

  // Flickering top flame.
  const fh = r * (0.6 + Math.sin(t * 1.3) * 0.3);
  ctx.fillStyle = '#ff9900';
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, -r * 0.5);
  ctx.lineTo(0, -r * 0.5 - fh);
  ctx.lineTo(r * 0.3, -r * 0.5);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
