// Drawer contract: (ctx, entity) => void
//
// Homing missile — slim gray body, side fins, steady blue-white flame.
// Body along +x (nose right); the entity frame is already rotated to the
// travel direction by orientSprite() (the macro re-steers it every frame).

export function homingDrawer(ctx, e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(e.rotation ?? 0); // nose follows travel direction (thorn-rect contract)
  // Draw at ~75% of the box — missile reads inside its hitbox.
  const L = e.w * 0.75, H = e.h * 0.75;

  // Flame: steady core with a soft pulse (homing burns constant, no flicker).
  const pulse = 0.85 + 0.15 * Math.sin(performance.now() * 0.02);
  ctx.fillStyle = '#4fc3f7';
  ctx.beginPath();
  ctx.moveTo(-L * 0.3, -H * 0.22 * pulse);
  ctx.lineTo(-L * 0.62, 0);
  ctx.lineTo(-L * 0.3, H * 0.22 * pulse);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e1f5fe';
  ctx.beginPath();
  ctx.moveTo(-L * 0.3, -H * 0.1 * pulse);
  ctx.lineTo(-L * 0.45, 0);
  ctx.lineTo(-L * 0.3, H * 0.1 * pulse);
  ctx.closePath();
  ctx.fill();

  // Fins (rear): two swept-back triangles.
  ctx.fillStyle = '#90a4ae';
  ctx.beginPath();
  ctx.moveTo(-L * 0.3, -H * 0.35);
  ctx.lineTo(-L * 0.5, -H * 0.55);
  ctx.lineTo(-L * 0.28, -H * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-L * 0.3, H * 0.35);
  ctx.lineTo(-L * 0.5, H * 0.55);
  ctx.lineTo(-L * 0.28, H * 0.15);
  ctx.closePath();
  ctx.fill();

  // Body: slim gray tube.
  ctx.fillStyle = '#b0bec5';
  ctx.fillRect(-L * 0.3, -H * 0.28, L * 0.6, H * 0.56);
  // Red nose cone.
  ctx.fillStyle = '#ef5350';
  ctx.beginPath();
  ctx.moveTo(L * 0.3, -H * 0.28);
  ctx.lineTo(L * 0.5, 0);
  ctx.lineTo(L * 0.3, H * 0.28);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
