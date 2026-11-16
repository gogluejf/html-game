// Petal Panic — barrel physics reactions (extracted from systems/update.js).
//
// The three per-frame barrel interactions that need the hero + live enemies +
// collision results: rolling-barrel impacts, falling-barrel stomps on the
// hero's head, and the cook-and-detonate fuse. update() calls these once per
// live barrel after integration; everything else about barrels (entity model,
// world sync, destroyed aftermath) lives in objects/object.js + barrelSync.js.
import { ctx } from '../world/context.js';
import { aabbOverlap } from '../core/collision.js';
import { applyHit } from '../combat/hitResolution.js';
import { calculateKnockback } from '../combat/knockback.js';
import { AttackProvenance, Team } from '../combat/targeting.js';
import { Effects } from '../effects.js';
import { record } from '../stats.js';

// --- Rolling-barrel impacts (declaration of impact) ---------------------------
// A knocked barrel is a physical object with momentum: when it is MOVING fast
// enough and overlaps an enemy, that overlap is an IMPACT — the barrel deals
// damage to the enemy, knocks the enemy back in the barrel's travel direction,
// and loses part of its own speed (momentum transfer). One impact per enemy
// per barrel until the barrel slows below the threshold or separates, so a
// rolling barrel does not machine-gun an enemy every frame.
const BARREL_IMPACT_MIN_SPEED = 120;   // px/s — slower than this = gentle roll, no hit
const BARREL_IMPACT_DAMAGE = 15;       // flat impact damage (speed-scaled below)
const BARREL_IMPACT_KNOCKBACK = { x: 260, y: -30, hitstun: 0.25 };
const BARREL_IMPACT_MOMENTUM_LOSS = 0.45; // barrel keeps 55% of speed per impact

/**
 * Impact sweep for one moving barrel against live enemies. Called from the
 * dynamic-solid step AFTER integration so positions are final for this frame.
 * @param {GameObj} b the barrel (any type — wood/coin/propane all roll)
 */
export function barrelImpactSweep(b) {
  if (!b.alive || b.destroyed) return;
  const speed = Math.abs(b.vx ?? 0);
  if (speed < BARREL_IMPACT_MIN_SPEED) { b._impactCooldown = 0; return; }
  if (b._impactCooldown > 0) { b._impactCooldown -= 1 / 60; return; }

  const bb = b.worldBox();
  const dirX = Math.sign(b.vx) || 1;
  for (const e of ctx.realEnemies ?? []) {
    if (!e || e.alive === false || e.aiState === 'dead') continue;
    const eb = e.worldBox ? e.worldBox() : { x: e.x, y: e.y, w: e.w, h: e.h };
    if (!aabbOverlap(bb, eb)) continue;

    // Damage + shove through the single choke point: applyHit() owns the
    // eligibility decision (i-frames/invuln absorb → no damage, no shove) and
    // applies the knockback vector after damage lands. The barrel's live speed
    // adds a motion term (a fast barrel shoves harder).
    const dmg = Math.round(BARREL_IMPACT_DAMAGE * (0.5 + speed / 400));
    const kb = calculateKnockback(b, 0);
    const res = applyHit({
      provenance: AttackProvenance.PROJECTILE,
      source: b,
      target: e,
      damage: dmg,
      team: Team.NEUTRAL,
      method: 'barrelImpact',
      knockback: {
        impulse: {
          x: dirX * (BARREL_IMPACT_KNOCKBACK.x + (kb?.x ?? 0) * dirX),
          y: BARREL_IMPACT_KNOCKBACK.y,
        },
        hitstun: BARREL_IMPACT_KNOCKBACK.hitstun,
      },
    });
    if (!res.accepted || res.dealt <= 0) continue; // absorbed — no impact reaction
    Effects.beginEnemyShake(e);

    // Momentum transfer: the barrel slows down — it did NOT pass through.
    b.vx *= (1 - BARREL_IMPACT_MOMENTUM_LOSS);
    b._impactCooldown = 0.35; // re-arm window: no second hit on the same body
    break; // one enemy per barrel per impact event
  }
}

// --- Falling-barrel impacts (stomp / bonk) -----------------------------------
// A barrel falling FAST onto a head is a physical impact, not a pass-through.
// The stomp gate + kick-and-cook response apply to BOTH the hero and enemies:
//   - target's head is in the lower half of the barrel and the barrel is moving
//     down → STOMP: the barrel gets knocked up + away and a short fuse arms.
//     It stays alive and arcs under gravity; it detonates when the fuse expires
//     OR it lands on a surface — whichever first. The blast fires at its CURRENT
//     position, so the explosion travels with the launched barrel.
//   - any other fast overlap (barrel hits you from the side/above while you're
//     under it) → the barrel is destroyed on impact and detonates normally;
//     whoever stands in the blast radius takes the blast's own damage. No
//     special stomp rule, no flat "bonk" number — the detonation IS the damage.
//     One rule for every way a barrel dies.
// Below FALLING_MIN_VY the barrel is just settling — no impact (stacking and
// gentle drops keep working). One impact per barrel per short window so a
// resting-on-head frame doesn't machine-gun.
const FALLING_BARREL_MIN_VY = 260;   // px/s downward before it counts as "falling"
const FALLING_BARREL_COOLDOWN = 0.3; // re-arm window per barrel
// Head-hit response: the barrel gets a knockback launch (away from the hero's
// head) and a short fuse. It stays alive and arcs under gravity; it
// detonates when the fuse expires OR it lands on a surface — whichever first.
// The blast fires at its CURRENT position, so the explosion travels with the
// launched barrel (kick-a-barrel-and-it-blows-up feel).
// ONE RULE (same as enemy stomp / bumper): normalize the line between the
// two bodies' centers × fixed force + ignoreVictimResistance — the kick IS
// the final velocity, geometry picks the angle. No up/away special-casing.
const STOMP_FORCE = 493;    // px/s (≈ the old 260/420 vector length)
const STOMP_FUSE = 0.45;             // seconds of cooking after the head-hit
// STAR POWER barrel pop: shove the barrel in front of the hero like an enemy
// knockback — a horizontal push with a SMALL fixed `pop` lobe (the same shape
// as enemy body-contact knockback: dirMode fromAttacker + modest pop). That's
// what reads as "pushed" instead of "launched into orbit". Barrels have
// knockbackResist 0.5, so impulses land at 2× face value.
// ignoreResist: true on the call site → these values are FINAL px/s on every
// target (no mass division) — the star kick hits barrels and enemies with the
// same force by design.
export const STAR_BARREL_KNOCKBACK = { x: 840, y: -320, hitstun: 0, iFrames: 0 };
export const STAR_BARREL_FUSE = 0.6; // long enough to SEE the arc: launch up, hang, fall, boom

/**
 * Impact check for one falling barrel against the hero AND live enemies.
 * Called from the dynamic-solid step AFTER integration (positions final for
 * this frame). First valid head-stomp target wins; the barrel gets ONE launch
 * per impact window regardless of how many heads it overlaps.
 *
 * Kick-and-cook model: a fast-falling barrel that overlaps a head gets a
 * small knockback launch (up + away) and a short fuse instead of dying
 * instantly. It stays alive and arcs under gravity (stepDynamicSolid handles
 * the physics each frame); it detonates when the fuse expires OR it lands —
 * whichever comes first — via tickFallingBarrelFuse(). The blast fires at the
 * barrel's CURRENT position, so the explosion travels with the launched barrel.
 * @param {GameObj} b the barrel
 */
export function fallingBarrelImpact(b) {
  if (!b.alive || b.destroyed) return;
  const vy = b.vy ?? 0;
  if (vy < FALLING_BARREL_MIN_VY) { b._fallCd = 0; return; } // settling, not falling
  if (b._fallCd > 0) { b._fallCd -= 1 / 60; return; }

  const bb = b.worldBox();
  // Candidate targets: the hero first (player stomp is the primary interaction),
  // then live enemies. Dead/dying bodies are skipped — no stomping corpses.
  const candidates = [];
  const h = ctx.hero;
  if (h && h.alive && !h.dying) candidates.push(h);
  for (const e of ctx.realEnemies ?? []) {
    if (e && e.alive !== false && e.aiState !== 'dead') candidates.push(e);
  }

  let target = null;
  let tb = null;
  for (const c of candidates) {
    const box = c.worldBox ? c.worldBox() : { x: c.x, y: c.y, w: c.w, h: c.h };
    if (!aabbOverlap(bb, box)) continue;
    // STOMP GATE — the barrel must be driving DOWN onto the target's HEAD from
    // above. Two geometric tests (both required):
    //   1. The target's HEAD REGION (top 25% of the body) overlaps the barrel's
    //      LOWER half — the head is under the barrel's midline, i.e. it fell
    //      ONTO them, not past/beside them. Using a region (not just the top
    //      edge) matters for tall heroes: with a 91px hero and a 48px barrel,
    //      "top edge inside lower half" needs ≥33px of overlap, which a fast
    //      barrel can skip in one frame.
    //   2. barrel's BOTTOM edge at or below the target's TOP edge — the barrel
    //      is still arriving from above. If its bottom is already ABOVE their
    //      head they're level with it in the air: a side touch, NOT a stomp.
    //      This is the case that used to cook barrels on mid-air contact.
    const headBottom = box.y + box.h * 0.25; // head region: top quarter of body
    const barrelMidY = bb.y + bb.h / 2;
    const barrelBottom = bb.y + bb.h;
    if (headBottom <= barrelMidY) continue;   // head not under the barrel
    if (barrelBottom < box.y) continue;       // barrel still above the head
    target = c;
    tb = box;
    break;
  }
  if (!target) return;

  // Launch the barrel off the head: ONE RULE — normalize the line from the
  // target's center → the barrel's center, fixed force, ignoreVictimResistance
  // (the kick IS the final velocity — fall speed and mass don't dilute the
  // bounce). Pure impulse (no damage), rides the single door with damage: 0;
  // stepDynamicSolid carries the arc.
  const bcx = bb.x + bb.w / 2, bcy = bb.y + bb.h / 2;
  const tcx = tb.x + tb.w / 2, tcy = tb.y + tb.h / 2;
  const dx = bcx - tcx, dy = bcy - tcy;
  const len = Math.hypot(dx, dy) || 1;
  applyHit({
    provenance: AttackProvenance.STOMP,
    source: target,
    target: b,
    damage: 0,
    team: Team.NEUTRAL,
    method: 'stomp',
    knockback: { impulse: { x: (dx / len) * STOMP_FORCE, y: (dy / len) * STOMP_FORCE }, ignoreVictimResistance: true },
  });
  // Arm the fuse. It cooks while airborne; landing or fuse-expiry detonates.
  b._fuse = STOMP_FUSE;
  if (ctx.hero) record(ctx.hero, { kind: 'enemyStomped' });
  b._fallCd = FALLING_BARREL_COOLDOWN;
}

/**
 * Per-frame fuse tick for a cooking barrel (armed by fallingBarrelImpact).
 * Call once per live barrel in the dynamic-solid loop, AFTER stepDynamicSolid
 * so positions/velocity are final for the frame. Detonates when the fuse hits
 * zero OR the barrel has come to rest on a surface (vy ~ 0 and grounded), so a
 * launched barrel always blows up — at its current spot — rather than cooking
 * forever. No-op for barrels without an armed fuse.
 * @param {GameObj} b the barrel
 * @param {number} dt seconds
 */
export function tickFallingBarrelFuse(b, dt) {
  if (!b.alive || b.destroyed || b._fuse == null) return;
  b._fuse -= dt;
  // Landed? stepDynamicSolid zeroes vy on a surface; treat "no longer falling"
  // as the detonation trigger so a short hop still blows where it settles.
  // Intangible flight (star launch) NEVER lands — terrain is phased — so the
  // fuse timer is its only clock there.
  const landed = !b.intangible && (b.vy ?? 0) <= 1;
  if (b._fuse <= 0 || (landed && (b.vy ?? 0) >= 0)) {
    b._fuse = null;
    b.clearIntangible(); // back in the collision world at detonation
    const dealt = b.takeDamage(Number.MAX_SAFE_INTEGER, b, 'stomp');
    if (b.destroyed && !b._destroyHandled) {
      b.onDestroyed?.({ source: b, provenance: 'STOMP' }, { accepted: true, dealt, destroyed: true });
    }
  }
}

