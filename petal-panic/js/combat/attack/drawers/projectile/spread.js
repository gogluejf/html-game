// Drawer contract: (ctx, entity) => void
//
// Spread pellet — small round shot with a directional tip. No spin: the
// pellet reads as a fast dart, distinct from the saw's spinning blade.
// Body along +x; the entity frame is rotated to travel direction by
// orientSprite().

export function spreadDrawer(ctx, e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const r = Math.min(e.w, e.h) / 2;
  ctx.save();
  ctx.translate(cx, cy);
  // Nose follows travel direction (thorn-rect contract); pellet drawn at ~70%
  // of the box so it reads inside its hitbox.
  ctx.rotate(e.rotation ?? 0);
  const s = 0.7;

  // Pellet body: rounded disc biased toward the rear.
  ctx.fillStyle = '#ffca28';
  ctx.beginPath();
  ctx.arc(-r * 0.15 * s, 0, r * 0.75 * s, 0, Math.PI * 2);
  ctx.fill();

  // Directional tip (front).
  ctx.fillStyle = '#fff59d';
  ctx.beginPath();
  ctx.moveTo(r * 0.35 * s, -r * 0.45 * s);
  ctx.lineTo(r * 0.95 * s, 0);
  ctx.lineTo(r * 0.35 * s, r * 0.45 * s);
  ctx.closePath();
  ctx.fill();

  // Core highlight.
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-r * 0.25 * s, -r * 0.2 * s, r * 0.2 * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
