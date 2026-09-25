// Hero physics helpers — grounded detection and one-way-platform standing.
// Tightly coupled to the per-frame resolve() result, so they read shared state
// (hero, solids, barrel solid boxes) through ctx (world/context.js).
import { ctx } from '../world/context.js';

/**
 * Grounded = resting on a solid's top surface. Combines the last resolve()
 * result (pushed down onto a floor this frame) with a small epsilon contact
 * probe so the flag stays true while standing still.
 */
export function isGrounded(hit) {
  const hero = ctx.hero;
  if (hit && hit.axis === 'y' && hit.dir === 1) return true; // landed on a surface
  const wb = hero.worldBox();
  // Static platforms + live barrels both count as floor surfaces (the probe
  // also covers the "standing on a barrel" case). One-way solids currently
  // being dropped through are excluded — the hero is intentionally passing
  // below them, not standing on them (design §13 drop-through).
  for (const s of [...ctx.solids, ...ctx.barrelSolidBoxes]) {
    if (s.oneWay && hero.droppingThrough) continue;
    if (wb.x + wb.w <= s.x || wb.x >= s.x + s.w) continue;
    const gap = s.y - (wb.y + wb.h);
    if (gap >= -2 && gap <= 4 && hero.vy >= 0) return true;
  }
  return false;
}

/**
 * True when the hero is grounded on a one-way platform (design §13): the
 * Down+Jump drop-through intent is only valid there. Solid terrain never
 * qualifies, so normal jumps over floors/barrels are unaffected.
 */
export function standingOnOneWay() {
  const hero = ctx.hero;
  if (!hero.grounded) return false;
  const wb = hero.worldBox();
  for (const s of ctx.solids) {
    if (!s.oneWay) continue;
    if (wb.x + wb.w <= s.x || wb.x >= s.x + s.w) continue;
    const gap = s.y - (wb.y + wb.h);
    if (gap >= -2 && gap <= 4) return true;
  }
  return false;
}
