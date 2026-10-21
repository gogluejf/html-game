// Pure swept-AABB contact query shared by gameplay and the Attack Theater.
// History is the actual pre-integration top-left, never inferred from velocity.
// Terrain corrections invalidate that segment before later collision queries.
export function invalidateImpactMotion(proj) {
  proj._impactPrevX = null;
  proj._impactPrevY = null;
  proj._impactPoint = null;
}

/** Return the projectile center at first contact within this integration step.
 * Missing/invalid history, initial overlap and no crossing use today's center.
 * This query never moves the entity (in particular, never rewinds live bombs).
 */
export function entryImpactPoint(proj, box) {
  const current = { x: proj.x + proj.w / 2, y: proj.y + proj.h / 2 };
  const px = proj._impactPrevX, py = proj._impactPrevY;
  if (![px, py, proj.x, proj.y, proj.w, proj.h,
    box?.x, box?.y, box?.w, box?.h].every(Number.isFinite) ||
    proj.w < 0 || proj.h < 0 || box.w < 0 || box.h < 0) return current;

  // Expand the target by the projectile's collision extents, then sweep its
  // top-left as a point through the two slabs. Respect offset world boxes.
  const shape = proj.box ?? { ox: 0, oy: 0, bw: proj.w, bh: proj.h };
  if (![shape.ox, shape.oy, shape.bw, shape.bh].every(Number.isFinite) ||
      shape.bw < 0 || shape.bh < 0) return current;
  const minX = box.x - shape.ox - shape.bw, maxX = box.x + box.w - shape.ox;
  const minY = box.y - shape.oy - shape.bh, maxY = box.y + box.h - shape.oy;
  if (px > minX && px < maxX && py > minY && py < maxY) return current;

  let entry = -Infinity, exit = Infinity;
  for (const [start, delta, min, max] of [
    [px, proj.x - px, minX, maxX], [py, proj.y - py, minY, maxY],
  ]) {
    if (delta === 0) {
      if (start < min || start > max) return current;
      continue;
    }
    const a = (min - start) / delta, b = (max - start) / delta;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  if (!Number.isFinite(entry) || entry < 0 || entry > 1 || entry > exit) return current;
  return { x: px + (proj.x - px) * entry + proj.w / 2,
    y: py + (proj.y - py) * entry + proj.h / 2 };
}

/** Only dying bombs need a position snap: their detonation reads x/y. */
export function snapToImpact(proj, ip) {
  if (proj.alive || !ip || !Number.isFinite(ip.x) || !Number.isFinite(ip.y)) return;
  proj.x = ip.x - proj.w / 2;
  proj.y = ip.y - proj.h / 2;
}
