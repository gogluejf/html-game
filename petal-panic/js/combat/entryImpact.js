// Petal Panic — entry-edge impact point (tunneling correction).
//
// Per-frame AABB checks see a shot AFTER it moved, so a 700px/s bullet can be
// ~12px inside its victim when the hit registers — its center then reads as
// "victim middle". Rewinding along the velocity vector to where the box FIRST
// touched the target gives the true contact edge.
//
// Leaf module: zero game imports so both the gameplay collision handler AND
// the Attack Theater sandbox (which must stay importable in node) can use it.

/**
 * Compute the shot's center at first contact with the target box, and snap
 * the shot's rendered position back to that contact edge so its final frame
 * shows it TOUCHING the target face, not embedded in it.
 *
 * @param {object} proj entity with x/y/w/h/vx/vy (mutated: x/y snapped)
 * @param {object} box  target world box {x, y, w, h}
 * @returns {{x:number, y:number}|null} impact center, or null when no rewind
 *   is possible (zero velocity). Clamps to the raw center when the shot
 *   spawned already overlapping (no meaningful entry edge).
 */
export function entryImpactPoint(proj, box) {
  const vx = proj.vx ?? 0, vy = proj.vy ?? 0;
  if (!vx && !vy) return null;
  const pcx = proj.x + proj.w / 2, pcy = proj.y + proj.h / 2;
  // Time (in seconds of flight) back to first contact per MOVING axis. The
  // shot is caught AFTER moving, so rewind along -v until its LEADING face
  // just touches the box's face:
  //   vx > 0 (moving right): leading RIGHT edge reaches box.left
  //     → t = (pcx + proj.w/2 - box.x) / vx
  //   vx < 0 (moving left): leading LEFT edge reaches box.right
  //     → t = (box.x + box.w - pcx + proj.w/2) / (-vx)
  // Non-moving axes are already in contact (AABB overlap guarantees it) and
  // impose no constraint. For a diagonal shot both moving axes contribute;
  // the LATER one (max) is when the second face also arrives — true entry.
  let t = 0;
  if (vx > 0) t = Math.max(t, (pcx + proj.w / 2 - box.x) / vx);
  else if (vx < 0) t = Math.max(t, (box.x + box.w - pcx + proj.w / 2) / -vx);
  if (vy > 0) t = Math.max(t, (pcy + proj.h / 2 - box.y) / vy);
  else if (vy < 0) t = Math.max(t, (box.y + box.h - pcy + proj.h / 2) / -vy);
  if (!Number.isFinite(t)) return null;
  if (t < 0) {
    // Shot center already past BOTH entry faces (spawned overlapping or
    // extreme tunneling) — no meaningful entry edge. Clamp to NOW (raw
    // center) rather than rewinding into the past.
    return { x: pcx, y: pcy };
  }
  const ix = pcx - vx * t, iy = pcy - vy * t;
  // Snap the shot's rendered position back to the contact edge so its final
  // frame shows it TOUCHING the target face, not embedded in it. The entity
  // dies this frame (the handler culls it right after), so this is a pure
  // visual correction — physics never reads the moved corpse.
  proj.x = ix - proj.w / 2;
  proj.y = iy - proj.h / 2;
  return { x: ix, y: iy };
}
