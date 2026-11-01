// Drawer contract: (ctx, entity) => void
//
// Petal saw — spinning blade: toothed disc with a hub. Spin is time-driven
// (the blade rotates regardless of travel direction); the entity frame itself
// stays axis-aligned so the spin reads correctly from any angle.

export function sawDrawer(ctx, e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const r = Math.min(e.w, e.h) / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(performance.now() * 0.012);

  // Blade body.
  ctx.fillStyle = '#e91e63';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
  ctx.fill();

  // Teeth: 8 triangular points around the rim.
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(r * 0.7, -r * 0.14);
    ctx.lineTo(r * 1.05, 0);
    ctx.lineTo(r * 0.7, r * 0.14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Hub.
  ctx.fillStyle = '#ad1457';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
