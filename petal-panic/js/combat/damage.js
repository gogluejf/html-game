// Petal Panic — central damage routing (design §4/§8).
//
// EVERY combat source funnels through damage(): thorns, melee swings, enemy
// contact, boss attacks, explosions. Keeping HP math in one place means
// defense, telemetry, and death handling are defined exactly once instead of
// being scattered across every attack type.
//
// Contract:
//   - `amt` is the RAW attack value (e.g. hero.stats.attack).
//   - Defense reduces it; the result never drops below 1 (a hit always lands).
//   - The target's energy (hero) or hp (enemy) is drained by the real amount.
//   - Telemetry on the SOURCE is updated when present (traceStats).
//   - Death is flagged (alive = false); the CALLER owns the death pipeline
//     (death anim, sparkles, coin drop, world removal) so this stays pure.
//
// Returns the real (post-defense) damage dealt, or 0 if the target was already
// dead.

import { record } from '../stats.js';
import { fireManual } from '../effects/index.js';
import { VIEW_W, VIEW_H } from '../core/view.js';

const _srcName = (e) => e?.type ?? e?.id ?? 'blast';

/**
 * Damage → vignette intensity mapping (design §12). A hit dealing this much
 * real damage kicks the red vignette to full; lighter hits scale linearly.
 * Hero energy is 100, so ~30 = "a third of your bar" reads as a serious hit.
 */
export const VIGNETTE_FULL_DMG = 25;

/**
 * Kick the hero-damage vignette scaled by real damage dealt (design §12).
 * Single owner of the effect: EVERY route that damages the hero funnels
 * through heroDamage(), so no call site sprinkles its own vignette anymore.
 * No-op for non-hero targets and zero damage (absorbed/protected hits).
 * @param {object} target the damaged entity (hero check via energy pool)
 * @param {number} real   actual damage dealt after defense (>=1 if it landed)
 */
export function kickHeroVignette(target, real) {
  if (!target || target.energy == null || real <= 0) return;
  const strength = Math.min(1, real / VIGNETTE_FULL_DMG);
  // Engine's single fire path; viewport dims ride in ctx like every other
  // screen-space overlay fire (vignette also reads them at draw time).
  fireManual({ type: 'vignette', params: { strength } }, null,
    { view: { w: VIEW_W, h: VIEW_H } });
}

/** Hit-landed method buckets that damage() may write (subset of stats HIT_METHODS). */
const HITS_LANDED_METHODS = new Set(['melee', 'projectile', 'special', 'specialMelee', 'superMove', 'explosion']);

/**
 * Apply a single hit from `source` to `target`.
 *
 * @param {object} source   attacker (hero, enemy, explosion...). May carry
 *                          `.traceStats` for telemetry; optional.
 * @param {object} target   victim. Reads `.stats?.defense`, drains `.energy`
 *                          (heroes) or `.hp` (enemies), sets `.alive=false` on
 *                          death.
 * @param {number} amt      raw attack value before defense.
 * @param {string} [method] 'projectile' | 'melee' | 'contact' | 'explosion'...
 * @returns {number} real damage dealt (>=1 if the target was alive), else 0.
 */
/** Reject malformed damage before it can poison HP or energy. */
export function assertDamageAmount(amount, source, target, method) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    const identify = (entity) => entity?.type ?? entity?.id ?? entity?.constructor?.name ?? 'unknown';
    throw new TypeError(`Invalid damage ${String(amount)} (${typeof amount}); method=${method}; source=${identify(source)}; target=${identify(target)}. Expected a finite non-negative number.`);
  }
}

/**
 * Pure kill prediction — would `amt` raw damage kill this target RIGHT NOW?
 * Same three lines as heroDamage() (defense read → max(1, amt-def) → pool
 * compare), zero side effects: no HP write, no telemetry, no vignette, no
 * death flag. Callers use it to BRANCH before applying (e.g. barrels: a
 * lethal melee hit arms the fuse instead of draining inline). Safe because
 * the engine is single-threaded per frame and hitSet dedupe prevents two
 * sources damaging the same target between probe and apply.
 * @param {object} target victim (reads .hp / .energy / .defense / .stats)
 * @param {number} amt raw attack value before defense
 * @returns {boolean} true when the hit would take the pool to <= 0
 */
export function wouldKill(target, amt) {
  if (!target?.alive) return true; // already dead — anything "kills"
  const def = target.defense != null ? target.defense : (target.stats?.defense ?? 0);
  const real = Math.max(1, amt - def);
  const pool = target.energy != null ? target.energy : (target.hp ?? 0);
  return pool - real <= 0;
}

export function heroDamage(source, target, amt, method = 'projectile') {
  assertDamageAmount(amt, source, target, method);
  if (!target.alive) return 0;

  // GHOST-HUNTER TRACE (temporary): every energy drain on the hero logs at the
  // DEEPEST level — the exact moment energy leaves the body. Source identity,
  // method, amount, guard state, and BOTH positions (victim + attacker) so a
  // "ghost" hit with no visible enemy nearby gets pinned: if srcPos is far
  // from pos, or source has no type/id, that's our phantom.
  // LAYER.HERO === 1 (consts.js) — compared by value to sidestep any
  // module-init ordering edge in the browser bundle.
  if (target.layer === 1 /* LAYER.HERO */) {
    const sx = typeof source?.x === 'number' ? source.x.toFixed(0) : '?';
    const sy = typeof source?.y === 'number' ? source.y.toFixed(0) : '?';
    console.log(`[dmg] ${_srcName(source)} → Hero | method=${method} amt=${amt}` +
      ` | plow=${!!target.plow} invincible=${!!target.invincible} dying=${!!target.dying}` +
      ` | heroPos=(${target.x.toFixed(0)},${target.y.toFixed(0)}) srcPos=(${sx},${sy})` +
      ` | srcAlive=${source?.alive ?? '?'} srcHp=${typeof source?.hp === 'number' ? source.hp : '?'}`);
  }

  // Defense mitigation, floored at 1 so a hit always registers.
  // Defense belongs to the TARGET: it reads the victim's own stat sheet
  // (`stats.defense`) or an explicit `defense` override (used by placeholder
  // targets / barrels before they have a full stat sheet). A hero's defense
  // protects IT from being hit — it never weakens the hero's own attacks.
  const def = target.defense != null ? target.defense : (target.stats?.defense ?? 0);
  const real = Math.max(1, amt - def);

  // Drain the right resource: heroes use energy (shield first), enemies use hp.
  // Shield absorbs damage before energy; energy only drains once shield is 0.
  let energyLost = 0; // tracks actual energy drain for vignette gating
  let shieldAbsorbed = 0; // tracks shield absorption for blue vignette
  if (target.energy != null) {
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, real);
      target.shield -= absorbed;
      shieldAbsorbed = absorbed;
      const remaining = real - absorbed;
      if (remaining > 0) { target.energy -= remaining; energyLost = remaining; }
    } else {
      target.energy -= real;
      energyLost = real;
    }
  } else if (target.hp != null) {
    target.hp -= real;
  } else {
    target.hp = -real; // brand-new placeholder with no pool: mark as damaged
  }

  // --- Telemetry (only when the source tracks it) ---------------------------
  // Hits-landed is recorded into the trace via record(). damageDealt is no
  // longer tracked in the stats model (dropped per design). Map the raw
  // method onto a known hit-landed bucket; unknown methods are ignored so a
  // new attack type can't throw. `source` may be null (e.g. killAttacker's
  // self-destruct pass) — telemetry is optional, never fatal.
  if (source?.traceStats && HITS_LANDED_METHODS.has(method)) {
    record(source, { kind: 'hitLanded', method });
  }

  // --- Death flag (caller runs the actual death pipeline) --------------------
  const remaining = target.energy != null ? target.energy : (target.hp ?? 0);
  if (remaining <= 0) {
    target.alive = false;
  }

  // Hero-damage vignette (design §12): owned HERE, at the single damage
  // funnel. Gated on actual ENERGY loss — shield-only absorption produces no
  // red flash (the shield pulse is sufficient feedback). Red = "your health
  // is going down." Scaled by the energy actually drained.
  if (energyLost > 0) kickHeroVignette(target, energyLost);

  // Shield-absorption vignette: cyan flash when the shield soaks a hit.
  // Same intensity algorithm as the red vignette, just a different color.
  // Cyan = "shield took it, you're fine."
  if (shieldAbsorbed > 0 && energyLost === 0) {
    const strength = Math.min(1, shieldAbsorbed / VIGNETTE_FULL_DMG) * 0.5;
    fireManual({ type: 'vignette', params: { strength, color: 'shield' } }, null,
      { view: { w: VIEW_W, h: VIEW_H } });
  }

  // Expose energyLost so callers can gate hit reactions (knockback/hitstun)
  // on actual HP loss vs shield-only absorption.
  target._lastEnergyLost = energyLost;

  return real;
}

/**
 * Single owner of the white hit-flash: any target whose HP/energy actually
 * decreases from an attack gets `hitFlash = 0.1` set exactly once, here.
 * Callers (heroDamage(), Enemy.takeDamage(), GameObj.takeDamage()) invoke this instead of
 * assigning the field themselves; render paths read it unchanged.
 *
 * No-op for null targets or targets without a `hitFlash` field (e.g. plain
 * projectiles). Idempotent: setting the same value twice is harmless.
 *
 * @param {object} target entity carrying a `hitFlash` timer
 */
export function flashTarget(target) {
  if (target == null || !('hitFlash' in target)) return;
  target.hitFlash = 0.1; // sprite-shake still rides on this timer
  // Effect-engine hit feedback: the sprite-flash instance tints the carrier's
  // box over a short blink cycle (world-space pass, drawn after entities).
  fireManual({ type: 'sprite-flash', params: { duration: 0.15, flashes: 2, opacity: 0.7 } }, target);
}
