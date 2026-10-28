// Drawer contract: (ctx, entity) => void
//
// Mine body — ONE drawer for both phases of throwMine/mine:
//   flying  — entity is the ballistic carrier's pooled Special (x/y/w/h live,
//             rotation set by the arc integrator); drawn at its flight pose.
//   landed  — entity is a plain { x, y, w, h } snapshot of the resting box
//             (the mine macro's state.box); same art, no rotation.
// The red arming pulse is NOT drawn here — it is the blink-transition effect
// overlaying the same box, so the drawer stays phase-agnostic and the warning
// layer owns its own clock.

export function mineDrawer(ctx, e) {
  const { x, y, w, h } = e;
  ctx.save();
  if (e.rotation != null) {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(e.rotation);
    ctx.translate(-w / 2, -h / 2);
  }
  // Dark casing base.
  ctx.fillStyle = '#222b32';
  ctx.fillRect(x, y, w, h);
  // Olive top plate with a lighter rim line.
  ctx.fillStyle = '#879878';
  ctx.fillRect(x + 2, y + 1, w - 4, h - 3);
  ctx.fillStyle = '#c7d2ac';
  ctx.fillRect(x + 3, y + 1, w - 6, 1);
  // Fuse cap — the readable "this is a mine" marker.
  ctx.fillStyle = '#e6bf55';
  ctx.fillRect(x + w * 0.42, y + 2, 4, 3);
  ctx.restore();
}
