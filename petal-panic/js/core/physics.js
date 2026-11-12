// Petal Panic — Shared rigid-body collision physics.
//
// The single home for "two boxes overlapped, what happens to their velocities".
// Barrel-on-barrel momentum transfer and wall bounce (previously inlined in
// systems/update.js) now live here as data-driven rules; the hero uses the
// same primitives so nothing re-implements impulse math a third time.
//
// Design:
//   - resolve() (core/collision.js) stays POSITIONAL ONLY: it separates boxes
//     and zeroes into-surface velocity. It never bounces or transfers.
//   - Impact rules run BEFORE resolve(), on the OVERLAPPING position, so the
//     impulse reads the true impact speed. resolve() then separates the boxes
//     (its zero-velocity rule cancels the into-surface component of whatever
//     velocity is left).
//   - Every rule is gated by a minimum closing speed: below the gate the
//     overlap is settling/resting, not an impact — untouched (stacking works).

import { GRAVITY, MAX_FALL_SPEED } from '../consts.js';
import { resolve } from './collision.js';

// ---------------------------------------------------------------------------
// Tunables (feel knobs — tune freely)
// ---------------------------------------------------------------------------

/** Horizontal friction for externally-impulsed motion (knockback), per second.
 *  Barrels are HEAVY: a hero push or bonk should shove them a short distance,
 *  not send them coasting. F = fraction of slide speed kept after ONE full
 *  second (frame-rate independent via Math.pow(F, dt)); LOWER = stronger.
 *  0.005 → ~80px roll in 0.5s (old, too floaty); 0.0001 → ~47px skid that
 *  dies in ~0.6s — still felt like butter on hard pushes. 0.000001 → a
 *  200px/s push skids ~10px and dies in ~0.3s; a 400px/s stomp-launch rolls
 *  ~20px. Heavy wooden thud-stop. */
export const DYNAMIC_SOLID_FRICTION_PER_SECOND = 0.0001;

/** Wood-on-wood thud: barrel striking another barrel. e=0 → move together;
 *  e=1 → Newton's cradle. 0.35 eats ~90% of KE — a thud, not a superball. */
export const BARREL_TRANSFER_RESTITUTION = 0.35;

/** Barrel striking static terrain at speed: rebound with energy absorbed. */
export const BARREL_WALL_BOUNCE_MIN_SPEED = 120;  // px/s — below = settle, not hit
export const BARREL_WALL_BOUNCE_RESTITUTION = 0.3; // wood-on-stone: ~70% KE absorbed

/** Hero head-bonk against a RESTING dynamic solid (barrel on a platform): the bonk
 *  must not be a hard stop. The hero keeps part of its fall speed (bounce)
 *  AND transfers part of it INTO the barrel (the barrel gets shoved along the
 *  impact axis — VERTICAL ONLY, see heroBonkDynamic — and skids to a stop
 *  under its own friction). Gated by min speed so gentle landings/settling
 *  are untouched. */
export const HERO_BONK_MIN_SPEED = 140;           // px/s closing before it's a bonk
export const HERO_BONK_RESTITUTION = 0.28;        // hero keeps ~28% of fall speed
export const HERO_BONK_TRANSFER = 0.6;            // share of closing speed given to the barrel

/** Hero walking into a RESTING barrel: no shove impulse (that felt like
 *  pushing), but a hard stop reads as a bug too. Instead the barrel creeps
 *  at this CONSTANT slow speed along X while the hero stays pressed against
 *  it — heavy-wood "it's moving... barely" feel. Capped well BELOW
 *  BARREL_WALL_BOUNCE_MIN_SPEED (120) so a creeping barrel that reaches a
 *  wall just settles there (no bounce), and far below any real impact
 *  impulse (super melee transfer, stomp launch, barrel-on-barrel) so those
 *  keep their full shove. */
export const HERO_PUSH_CREEP_SPEED = 24;          // px/s — constant, speed-independent

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Axis-overlap amounts for two AABBs. pen <= 0 on either axis = no overlap. */
export function penetration(a, b) {
  const penX = Math.min(a.x + a.w - b.x, b.x + b.w - a.x);
  const penY = Math.min(a.y + a.h - b.y, b.y + b.h - a.y);
  return { penX, penY };
}

/** Unit normal from box a's center toward box b's center, on one axis. */
export function axisNormal(a, b, axis) {
  if (axis === 'x') return Math.sign((b.x + b.w / 2) - (a.x + a.w / 2)) || 1;
  return Math.sign((b.y + b.h / 2) - (a.y + a.h / 2)) || 1;
}

/**
 * Equal-mass impulse along one axis (the barrel-on-barrel rule, generalized).
 * When `moving` closes on `peer` along `n`, each body takes (1+e)/2 of the
 * closing speed in opposite directions — momentum conserved exactly.
 * No-op unless actually closing (rel > 0) and above the speed gate.
 * @returns {boolean} true if an impulse was applied
 */
export function applyAxisImpulse(moving, peer, n, axis, e, minSpeed = 1) {
  const vM = moving[axis] ?? 0;
  const vP = peer[axis] ?? 0;
  const rel = (vM - vP) * n; // >0 when closing in on the peer
  if (rel <= 0 || rel < minSpeed) return false;
  const hand = ((1 + e) / 2) * rel;
  moving[axis] = vM - n * hand;
  peer[axis] = vP + n * hand;
  return true;
}

/**
 * Bounce one body off a STATIC surface along the minimum-penetration axis:
 * reflect the into-surface velocity with restitution, preserve the parallel
 * component. No-op below minSpeed (settling) or when already moving away.
 * @returns {boolean} true if a bounce was applied
 */
export function bounceOffStatic(body, surface, e, minSpeed) {
  const b = body.worldBox ? body.worldBox() : body;
  const { penX, penY } = penetration(b, surface);
  if (penX <= 0 || penY <= 0) return false;
  if (penX <= penY) {
    const v = body.vx ?? 0;
    if (Math.abs(v) < minSpeed) return false;
    const nx = axisNormal(surface, b, 'x'); // out of the wall, toward the body
    if (v * nx >= 0) return false;          // moving away — no impact
    body.vx = -v * e;
  } else {
    const v = body.vy ?? 0;
    if (Math.abs(v) < minSpeed) return false;
    const ny = axisNormal(surface, b, 'y');
    if (v * ny >= 0) return false;
    body.vy = -v * e;
  }
  return true;
}

/**
 * Hero head-bonk against a RESTING dynamic solid (barrel sitting on a
 * platform). Runs BEFORE resolve() so it sees the overlapping position:
 *   - hero keeps HERO_BONK_RESTITUTION of its closing speed (soft bounce,
 *     not a hard stop),
 *   - the barrel receives HERO_BONK_TRANSFER × closing speed along the
 *     impact axis (it skids; stepDynamicSolid's friction stops it).
 *
 * VERTICAL ONLY by design: the hero must NOT be able to push barrels around
 * horizontally — walking into one just blocks you like any wall (resolve()
 * handles the separation). Only impacts along Y get an impulse: falling onto
 * the top, or rising into the bottom (head bonk).
 *
 * Axis rule (intent-aware, NOT blind min-penetration) for the head case:
 * barrels are short boxes (32×48) and the hero is tall (91px standing), so a
 * head hit usually has LARGER horizontal penetration than vertical — blind
 * min-penetration would call it a side hit and skip the bonk entirely. The
 * physical intent decides instead: RISING with the hero's center inside the
 * barrel's lower half → HEAD HIT (Y), even when penX < penY. This is the
 * under-barrel jump case. Everything else resolves on the minimum-penetration
 * axis, and only acts when that axis is Y.
 * Gated by min closing speed so gentle contact is untouched (settling).
 * @returns {boolean} true if the bonk was applied
 */
export function heroBonkDynamic(hero, barrel, opts = {}) {
  const minSpeed = opts.minSpeed ?? HERO_BONK_MIN_SPEED;
  const rest = opts.restitution ?? HERO_BONK_RESTITUTION;
  const transfer = opts.transfer ?? HERO_BONK_TRANSFER;
  const hb = hero.worldBox();
  const bb = barrel.worldBox();
  const { penX, penY } = penetration(hb, bb);
  if (penX <= 0 || penY <= 0) return false;
  const v = hero.vy ?? 0;
  // Head-hit test: hero rising, and the hero's CENTER sits in the barrel's
  // lower half (the head is what's overlapping — not the feet).
  const heroCY = hb.y + hb.h / 2;
  const barrelMidY = bb.y + bb.h / 2;
  const headHit = v < 0 && heroCY < barrelMidY;
  if (!headHit && penX <= penY) return false; // side hit: static block, no shove
  // Vertical axis owns the impulse. ny points hero → barrel; rel > 0 when
  // the hero drives INTO the barrel along that axis (rising into its bottom,
  // or falling onto its top).
  const ny = axisNormal(hb, bb, 'y');
  const rel = v * ny;
  if (rel < minSpeed) return false;
  // Hero bounces back with RESTITUTION of the closing speed (soft bonk,
  // not a hard stop); the barrel takes TRANSFER of it along the same axis.
  hero.vy = -v * rest;
  barrel.vy = (barrel.vy ?? 0) + ny * rel * transfer;
  return true;
}

/**
 * Hero walk-push creep: while the hero is GENTLY pressed against a resting
 * barrel's side (below the bonk gate — no impact), the barrel creeps at a
 * constant HERO_PUSH_CREEP_SPEED along X in the direction the hero is
 * walking. This replaces the removed shove impulse: walking into a barrel no
 * longer stops dead, but it moves so slowly it reads as "heavy wood", not
 * "pushing".
 *
 * Rules:
 *   - Only when the hero's vertical velocity is negligible (grounded press,
 *     not a jump clipping the side) and the horizontal closing speed is below
 *     the bonk gate (a fast hit is an impact, handled by resolve() blocking).
 *   - The barrel's existing vx is preserved when it's faster than the creep
 *     (a real impulse from super melee / stomp / barrel-on-barrel always wins;
 *     the creep never overwrites or extends it).
 *   - stepDynamicSolid's friction still applies to the creep every frame, so
 *     the barrel settles the moment the hero stops pressing.
 * @returns {boolean} true if the creep was applied
 */
export function heroPushCreep(hero, barrel, opts = {}) {
  const creep = opts.creepSpeed ?? HERO_PUSH_CREEP_SPEED;
  const minSpeed = opts.minSpeed ?? HERO_BONK_MIN_SPEED;
  const hb = hero.worldBox();
  const bb = barrel.worldBox();
  const { penX, penY } = penetration(hb, bb);
  if (penX <= 0 || penY <= 0) return false;
  const vx = hero.vx ?? 0;
  if (Math.abs(vx) < 1) return false;                    // not pressing horizontally
  if (Math.abs(hero.vy ?? 0) > 40) return false;         // airborne clip, not a grounded press
  if (Math.abs(vx) >= minSpeed) return false;            // fast contact = impact, not a push
  const nx = Math.sign(vx);                              // direction the hero walks
  const cur = barrel.vx ?? 0;
  if (Math.abs(cur) >= creep) return false;              // a real impulse already owns the barrel
  barrel.vx = nx * creep;
  return true;
}

// ---------------------------------------------------------------------------
// Composite steps
// ---------------------------------------------------------------------------

/**
 * One fixed-timestep frame for a DYNAMIC solid (barrels today; anything that
 * falls, rolls, and stacks tomorrow). Owns movement + collision together:
 *   1. gravity + integrate
 *   2. horizontal friction (externally-impulsed motion bleeds off)
 *   3. wall bounce vs statics (restitution, min-speed gated)
 *   4. momentum transfer vs other dynamic solids (equal-mass impulse)
 *   5. positional resolve (separate boxes, zero into-surface velocity)
 *   6. landing snap (zero residual vy while resting on a surface)
 *
 * @param {object} e entity with worldBox(), x/y/vx/vy, alive
 * @param {number} dt seconds (fixed step)
 * @param {object[]} statics static AABBs {x,y,w,h}
 * @param {object[]} peers all dynamic solids INCLUDING e (self is filtered)
 */
export function stepDynamicSolid(e, dt, statics, peers) {
  if (!e.alive) return;
  const friction = e.dynamicFrictionPerSecond ?? DYNAMIC_SOLID_FRICTION_PER_SECOND;
  if (e.vy == null) e.vy = 0;
  const before = e.worldBox();
  const prevBottom = before.y + before.h;
  e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL_SPEED);
  e.x += (e.vx ?? 0) * dt;
  e.y += e.vy * dt;
  if (e.vx) {
    e.vx *= Math.pow(friction, dt);
    if (Math.abs(e.vx) < 2) e.vx = 0; // rest threshold: kill sub-pixel creep
  }
  const others = peers.filter(p => p !== e && p.alive);
  // Wall bounce (static version of the transfer below): runs BEFORE resolve()
  // so the impact speed is read from the OVERLAPPING position; resolve()'s
  // zero-velocity rule then cancels the into-wall part of the rebound.
  for (const s of statics) {
    bounceOffStatic(e, s, BARREL_WALL_BOUNCE_RESTITUTION, BARREL_WALL_BOUNCE_MIN_SPEED);
  }
  // Momentum transfer: a MOVING dynamic solid overlapping another pushes it
  // along the overlap axis instead of stopping dead. Equal-mass impulse with
  // restitution — see applyAxisImpulse. At rest this is a no-op, so stacking
  // and settling behavior is untouched.
  for (const p of others) {
    const evx = e.vx ?? 0, evy = e.vy ?? 0;
    if (!evx && !evy) break; // nothing to transfer
    const eb = e.worldBox(), pb = p.worldBox();
    const { penX, penY } = penetration(eb, pb);
    if (penX <= 0 || penY <= 0) continue;
    if (penX <= penY) {
      if (Math.abs(evx) < 1) continue; // moving vertically into a side wall
      applyAxisImpulse(e, p, axisNormal(eb, pb, 'x'), 'vx', BARREL_TRANSFER_RESTITUTION);
    } else {
      if (Math.abs(evy) < 1) continue;
      applyAxisImpulse(e, p, axisNormal(eb, pb, 'y'), 'vy', BARREL_TRANSFER_RESTITUTION);
    }
  }
  resolve(e, [...statics, ...others.map(p => p.worldBox())], { prevBottom });
  // Landing snap: zero fall velocity when resting on a surface.
  const wb = e.worldBox();
  for (const s of statics) {
    if (wb.x + wb.w <= s.x || wb.x >= s.x + s.w) continue;
    const gap = s.y - (wb.y + wb.h);
    if (gap >= -2 && gap <= 2 && e.vy > 0) { e.vy = 0; break; }
  }
}
