// Petal Panic — Explosion (design: docs/architecture/explosion.md).
//
// An explosion is ONE generic structure resolved by ONE path, regardless of what
// detonated it. A blast describes five independent knobs: where (center), how far
// (radius), how much it hurts (damage), which side it hurts (team), and how
// hard it shoves (a knockback setting from knockback.md §7). No source type is
// special-cased at the moment of detonation — a barrel, a rolling enemy that blows
// up, and a hero-thrown bomb are all the same resolveExplosion() call with a
// different team + knockback character.
//
// This module owns WHAT an explosion is and WHO it affects. The shove/stun math
// belongs to applyKnockback() (knockback.js); damage mitigation/death belongs to
// damage()/takeDamage(). resolveExplosion() is deliberately PURE with respect to
// the world: it mutates HP/energy + velocity/timers on targets and returns a
// summary, leaving VFX / screen shake / telemetry / world removal to the caller.
// That keeps the acceptance criteria unit-testable in node without a DOM.

import { applyHit } from './hitResolution.js';
import { AttackProvenance } from './targeting.js';
import { Debug } from '../debug/debug.js';

const _srcName = (e) => e?.type ?? e?.id ?? 'blast';
const _tgtName = (e) => e?.type ?? e?.id ?? e?.constructor?.name ?? '?';

// --- Alignment (explosion.md §2) --------------------------------------------
// Which side does the blast hurt? This is the single field that decides target
// eligibility before anything else is applied.
// `team` is the engine-wide side vocabulary (same values as the hitbox
// system's TEAM_TARGETS routing): 'ally' | 'foe' | 'neutral'.
export const TEAMS = Object.freeze(['ally', 'foe', 'neutral']);

// --- Knockback characters (explosion.md §4; each lives on the blast, never inline) ---
// The DEFAULT explosion character: any blast that doesn't declare its own
// knockback inherits this one (barrels, hero bombs/projectiles/mines, monkeys).
// A neutral hazard shoves everyone radially. 380 px/s matches the hero's
// pre-refactor 'explosion' profile strength so the hero's feel is preserved
// exactly when routed through takeHit(); enemies get shoved by this same
// radial shove. PURE RADIAL (y: 0): the radial line itself is the launch
// direction — a victim above the blast flies UP, one beside flies sideways.
// Do NOT add a y bias here: oriented per-component (normal.y × KB.y) it pushes
// far-side victims INWARD toward the center (sign flip), not outward.
export const DEFAULT_EXPLOSION_KNOCKBACK = Object.freeze({
  impulse: { x: 450, y: 0 }, hitstun: 0.50, iFrames: 0.60, dirMode: 'radial',
  ignoreVictimResistance: true,
});

/**
 * Build the radial push normal for a victim: the unit vector pointing FROM the
 * blast center TO the victim's center. A zero-length offset (victim exactly at
 * center) yields {x:0,y:0} — applyKnockback then adds no directional impulse
 * (only any fixed pop), which is the correct "at the epicenter" degenerate case.
 *
 * @param {{cx:number,cy:number}} center blast center
 * @param {{cx:number,cy:number}} targetCenter victim center
 * @returns {{x:number,y:number}} normalized outward direction (or zero)
 */
function radialNormal(center, targetCenter) {
  const dx = targetCenter.cx - center.cx;
  const dy = targetCenter.cy - center.cy;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

/** Center point of an entity's box. */
function centerOf(e) {
  return { cx: e.x + e.w / 2, cy: e.y + e.h / 2 };
}

/** True when two centers are within `radius` px (center-to-center, circular AoE). */
function withinRadius(aCx, aCy, bCx, bCy, radius) {
  const dx = aCx - bCx;
  const dy = aCy - bCy;
  return Math.sqrt(dx * dx + dy * dy) <= radius;
}

/**
 * Is `target` a valid target for this explosion? Encodes the team filter
 * (explosion.md §2) plus self-exclusion, dead-skip, and i-frame absorption.
 * Radius is checked separately by the caller (it needs the computed centers).
 *
 * - FOE    → only the hero (and hero-owned objects) are valid; other enemies never are.
 * - ALLY   → only enemies are valid; the hero never is.
 * - NEUTRAL→ everyone is valid except the detonator itself.
 *
 * Self-damage is excluded by construction across all teams: the thing that
 * detonated is never a target for its own blast.
 *
 * @param {object} explosion { cx, cy, radius, damage, team, knockback }
 * @param {object} target candidate entity
 * @param {object} source the detonating entity (self-exclusion reference)
 * @returns {boolean}
 */
export function isValidTarget(explosion, target, source) {
  if (!target || target === source) return false;   // never self-hit
  if (target.alive === false) return false;          // skip already-dead
  if (target.invincible) return false;               // i-frames absorb the blast

  const hero = ctxHero(explosion);
  // `team` is the engine-wide side vocabulary (same key as the hitbox
  // system's TEAM_TARGETS routing): ally | foe | neutral.
  switch (explosion.team) {
    case 'foe':
      // Enemy-side: only the hero is a valid target.
      return target === hero;
    case 'ally':
      // Hero-side: only enemies are valid; the hero is spared.
      return target !== hero && isEnemy(target);
    case 'neutral':
    default:
      // No side: everyone in range except self (already excluded above).
      return true;
  }
}

/** Pull the hero out of the explosion's ctx (may be undefined in pure tests). */
function ctxHero(explosion) {
  return explosion.ctx?.hero ?? null;
}

/** Heuristic: is this entity an enemy (as opposed to the hero)? */
function isEnemy(target) {
  // Real enemies carry bodyKnockback (set in Enemy ctor) and/or takeDamage(); the
  // hero carries neither. This mirrors how the rest of the code distinguishes them.
  return !!(target.bodyKnockback || typeof target.takeDamage === 'function');
}

/**
 * Resolve a single explosion against a set of candidate targets.
 *
 * For each valid target within the radius (per team + self/dead/invincible
 * filters):
 *   1. Apply damage through the central damage system — real enemies route via
 *      their own takeDamage() (which runs their internal death pipeline); every
 *      other target routes via damage(). Defense mitigation, resource pools
 *      (energy vs hp), telemetry, and death flagging all apply uniformly.
 *   2. If the target was actually damaged, apply radial knockback:
 *        - HERO: routed through hero.takeHit({source:'explosion', dirX, dirY}) so
 *          the existing rec + invincible timer semantics are preserved EXACTLY
 *          (behavior preservation — see knockbackRegression.test.js).
 *        - ENEMY: routed through applyKnockback() with the blast's radial knockback
 *          setting (shove + stun + pop via hitstunTimer/iFrameTimer).
 *
 * Pure with respect to the world: mutates HP/energy + velocity/timers, returns a
 * summary. VFX / screen shake / telemetry / coin drops / world.remove stay with
 * the caller.
 *
 * @param {object} explosion
 *   { cx, cy, radius, damage, team, knockback, [ctx] }
 *   - cx/cy   : blast center (world coords)
 *   - radius  : blast reach (px)
 *   - damage  : raw damage dealt to each valid target
 *   - team: 'ally' | 'foe' | 'neutral' (engine-wide side vocabulary)
 *   - knockback: a KnockbackSetting (knockback.md §7) with dirMode 'radial'
 *   - ctx     : { hero } — the live hero, used for hero-target detection + routing
 * @param {Array<object>} targets candidate entities (hero, enemies, ...)
 * @returns {{center:{cx,cy}, radius:number, hit:object[]}} explosion summary
 */
export function resolveExplosion(explosion, targets) {
  const { cx, cy, radius, damage: dmg, team, knockback } = explosion;
  const hit = [];

  for (const t of targets) {
    if (!isValidTarget(explosion, t, /* source */ explosion.self)) continue;

    const tc = centerOf(t);
    if (!withinRadius(cx, cy, tc.cx, tc.cy, radius)) continue;

    // Damage + shove through the SINGLE choke point. applyHit() owns every
    // "who gets hit" decision (eligibility, alive, i-frames) — the shove just
    // rides along as context.knockback and lands exactly when damage lands.
    // The radial normal is pure geometry (blast center → this victim), so it
    // is computed here where the blast position is known; the vector is the
    // whole strength scaled by that unit normal (strength along the radial
    // line). When the blast character sets ignoreVictimResistance (both
    // current characters do), mass is skipped: every victim — heavy boss,
    // light monkey, barrel — flies at exactly face value. That uniform
    // launch is the juice; per-victim mass differences no longer apply to
    // blasts (they still apply to melee/contact shoves).
    const source = explosion.self ?? null;
    const normal = radialNormal({ cx, cy }, tc);
    // Fixed force along the radial direction. The vector IS the launch:
    // angle from blast to victim × fixed magnitude. No special cases.
    // The entity's accel/lerp in update() handles deceleration naturally.
    const mag = knockback?.impulse?.x ?? 0;
    const kx = normal.x * mag, ky = normal.y * mag;
    // CONSOLE TRACE (temporary feel-debugging): launch state per victim —
    // start position, both centers, direction, final velocity + its length.
    // Proves every victim gets |v| = mag along the center-to-center line.
    console.log(`[blast] ${_srcName(source)} → ${_tgtName(t)}` +
      ` | START pos=(${t.x.toFixed(0)},${t.y.toFixed(0)})` +
      ` | blastC=(${cx.toFixed(0)},${cy.toFixed(0)}) tgtC=(${tc.cx.toFixed(0)},${tc.cy.toFixed(0)}) R=${radius}` +
      ` | dir=(${normal.x.toFixed(2)},${normal.y.toFixed(2)})` +
      ` | v0=(${kx.toFixed(0)},${ky.toFixed(0)}) |v0|=${Math.hypot(kx, ky).toFixed(0)}` +
      ` | ignoreResist=${knockback?.ignoreVictimResistance ?? false}`);
    const res = applyHit({
      provenance: AttackProvenance.EXPLOSION,
      source,
      target: t,
      damage: dmg,
      team,
      knockback: { impulse: { x: kx, y: ky }, hitstun: knockback?.hitstun ?? 0, iFrames: knockback?.iFrames ?? 0, ignoreVictimResistance: knockback?.ignoreVictimResistance ?? false },
    });
    const dealt = res.dealt;
    if (dealt <= 0) continue;

    // FLIGHT TRACE (temporary feel-debugging): simulate the victim's arc
    // frame-by-frame (gravity + ground friction, same model as enemy.js) and
    // log the path. Shows exactly how long they hang in the air vs skid on
    // the ground — the real reason a vertical launch reads "bigger" than a
    // horizontal one at identical |v|.
    _traceFlight(t, kx, ky, `${_tgtName(t)}`);

    hit.push(t);
  }

  return { center: { cx, cy }, radius, hit };
}

/** Simulate + log a victim's post-blast flight: every 3rd frame (20Hz) until
 * it stops or 3s elapse. Mirrors enemy.js physics: GRAVITY 1500, no air x-decay,
 * GROUND_SETTLE_FRICTION 0.9/frame while grounded. Ground plane = the victim's
 * starting feet height (blast can happen above a platform). */
function _traceFlight(t, vx0, vy0, label) {
  const GRAVITY = 1500, FRICTION = 0.9, DT = 1 / 60;
  const groundY = t.y + t.h; // feet at launch = local floor
  let x = t.x, y = t.y, vx = vx0, vy = vy0;
  let apex = 0, landedAt = null, frame = 0;
  const rows = [`[flight:${label}] t=0.00s pos=(${x.toFixed(0)},${y.toFixed(0)}) v=(${vx.toFixed(0)},${vy.toFixed(0)}) h=0px (LAUNCH)`];
  while (frame < 180) { // 3s max
    vy += GRAVITY * DT;
    x += vx * DT; y += vy * DT;
    const onGround = y + t.h >= groundY;
    if (onGround) {
      if (landedAt == null) landedAt = frame * DT;
      y = groundY - t.h; vy = 0; vx *= FRICTION;
      if (Math.abs(vx) < 1) vx = 0;
    }
    apex = Math.max(apex, groundY - (y + t.h));
    frame++;
    if (frame % 3 === 0) {
      rows.push(`[flight:${label}] t=${(frame * DT).toFixed(2)}s pos=(${x.toFixed(0)},${y.toFixed(0)}) v=(${vx.toFixed(0)},${vy.toFixed(0)}) h=${Math.max(0, groundY - (y + t.h)).toFixed(0)}px${onGround ? ' [GROUND]' : ''}`);
    }
    if (onGround && vx === 0) {
      rows.push(`[flight:${label}] ⛔ STOP t=${(frame * DT).toFixed(2)}s pos=(${x.toFixed(0)},${y.toFixed(0)}) travelX=${(x - t.x).toFixed(0)}px apex=${apex.toFixed(0)}px airtime=${(landedAt ?? 0).toFixed(2)}s`);
      break;
    }
  }
  console.log(rows.join('\n'));
}
