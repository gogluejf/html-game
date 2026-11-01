// Drawer contract: (ctx, entity) => void
//
// Explosive shot — firework rocket. Body along +x (nose right), flame tail
// trailing left. The entity frame is already rotated to the travel direction
// by orientSprite(), so the drawer draws in local space only.

export function explosiveDrawer(ctx, e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(e.rotation ?? 0); // nose follows travel direction (thorn-rect contract)
  // Draw at ~70% of the box so the rocket reads inside its hitbox, not edge-to-edge.
  const L = e.w * 0.7, H = e.h * 0.7;

  // Flame tail (left of center): flickering orange plume + hot core.
  const flick = 0.8 + 0.2 * Math.sin(performance.now() * 0.03);
  ctx.fillStyle = '#ff9f1c';
  ctx.beginPath();
  ctx.moveTo(-L * 0.1, -H * 0.35 * flick);
  ctx.lineTo(-L * 0.55, 0);
  ctx.lineTo(-L * 0.1, H * 0.35 * flick);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(-L * 0.1, -H * 0.18 * flick);
  ctx.lineTo(-L * 0.38, 0);
  ctx.lineTo(-L * 0.1, H * 0.18 * flick);
  ctx.closePath();
  ctx.fill();

  // Rocket body: red tube.
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(-L * 0.1, -H * 0.4, L * 0.55, H * 0.8);
  // Gold nose cone.
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(L * 0.45, -H * 0.4);
  ctx.lineTo(L * 0.5, 0);
  ctx.lineTo(L * 0.45, H * 0.4);
  ctx.closePath();
  ctx.fill();
  // White band.
  ctx.fillStyle = '#fff';
  ctx.fillRect(L * 0.05, -H * 0.4, L * 0.1, H * 0.8);

  ctx.restore();
}
