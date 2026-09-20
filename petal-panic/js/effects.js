// Petal Panic — central effects module (design §12) — COMPAT SHIM.
//
// Task 2.2: this file used to be the monolith that owned every visual effect
// inline. It is now a thin compatibility layer over the Effect Engine
// (js/effects/): importing this module registers the eight migrated effect
// types, and every legacy Effects.* method forwards to the engine's single
// fire path (fireManual / updateEffects / drawEffects / resetEffects).
// systems/update.js and systems/render.js call sites are untouched.
//
// Behavior parity with the pre-refactor monolith (reference:
// .squid-os/plans/effect-engine/effect-reference.txt) is preserved by routing
// through the migrated per-effect files, which own all tunables:
//   - hitSparkle.js    count roll [3,5], speed [60,140], BLOOD_COLORS
//   - deathSparkle.js  count = max(4, round(8 + size*0.25))
//   - pickupPop.js     fixed 8, evenly spaced ring, speed [100,180]
//   - explosion.js     count = min(24, 12 + round(radius*0.15)) unless an
//                       explicit `count` param overrides it (legacy bomb /
//                       enemy-death / barrel roll 12–15, owned by the call
//                       sites), FIRE_COLORS
//   - vignette.js      linear decay over 0.5s, radial gradient stops
//   - screenFlash.js   linear decay over 0.15s, white fill at alpha=value
//   - spriteShake.js   ±3px while carrier.hitFlash > 0
// No tunable constants live in this file anymore.
//
// Screen-space state (read via the `vignette` / `screenFlash` getters for
// tests/debug): mirrors the engine's active instance values each frame —
// the singleton semantics of the old API, backed by one engine instance per
// overlay type (max() kick on fire, linear decay, zero when faded). The
// camera-shake slot works the same way: Effects.triggerShake(mag) fires a
// tracked 'camera-shake' instance through the engine with the legacy
// max-kick merge rule, and Effects.getShakeOffset() reads its current offset.

import { particles } from './particles.js';
import { VIEW_W, VIEW_H } from './view.js'; // viewport dims for screen-space overlay fires
import {
  fireManual,
  updateEffects as stepEngine,
  drawEffects,
  resetEffects,
} from './effects/index.js';
import { SHAKE_AMT, getShakeOffset as getSpriteShakeOffset } from './effects/spriteShake.js'; // single owner of the ±3px tunable + jitter math (aliased: the singleton below defines its own camera-shake getShakeOffset())
import './effects/registry.js'; // side effect: registers the eight migrated types

// --- Screen-space singleton mirror ---------------------------------------------
// The engine owns the instances; these slots expose the same read surface the
// old monolith had (Effects.vignette / Effects.screenFlash) and drive the
// "kick, never lower" merge rule: a new fire only replaces the running
// instance when it would raise the value (monolith: Math.max(current, s)).
let vignetteInstance = null;
let flashInstance = null;
let shakeInstance = null; // camera-shake singleton (legacy triggerShake semantics)

/** Live intensity 0..1 of a tracked overlay instance (body holds the value). */
function overlayValue(inst) {
  return inst ? inst.body.value : 0;
}

/** Current vignette intensity 0..1 (0 when no active instance). */
export function getVignetteValue() {
  return vignetteInstance && !vignetteInstance.done ? overlayValue(vignetteInstance) : 0;
}

/** Current screen-flash intensity 0..1 (0 when no active instance). */
export function getScreenFlashValue() {
  return flashInstance && !flashInstance.done ? overlayValue(flashInstance) : 0;
}

/**
 * Fire a screen-space overlay through the engine with the old singleton
 * semantics: if an instance of the same type is still active and its current
 * value is >= the new strength, keep it (never lower); otherwise complete the
 * old one and spawn a fresh instance kicked to the clamped strength. The
 * viewport dims ride in the fire-time ctx ({ view: { w, h } }) so the migrated
 * factories can read them (they also accept draw-time renderCtx).
 * @param {'vignette'|'screen-flash'} type
 * @param {number} strength desired intensity (clamped 0..1 by the factory)
 * @param {(type:string, params:object)=>object|null} fireFn
 * @param {object|null} current the currently tracked instance
 * @returns {object|null} the instance now being tracked
 */
function kickOverlay(type, strength, fireFn, current) {
  const clamped = Math.min(1, Math.max(0, strength));
  if (current && !current.done && overlayValue(current) >= clamped) return current;
  if (current) current.complete();
  const next = fireFn(type, { strength });
  return next ?? current; // unknown type → keep whatever was there (no throw)
}

/**
 * Kick the camera-shake singleton through the engine with the legacy
 * triggerShake(mag) merge rule: `shakeMag = Math.max(shakeMag, mag)` plus an
 * unconditional timer reset. That is exactly "re-fire a fresh full-lifetime
 * instance whenever mag >= the running instance's original intensity; keep
 * the running one when mag is smaller" — the monolith's max() never lowers
 * the amplitude envelope, and its timer reset only extends the tail at the
 * unchanged peak magnitude (which a kept instance already does).
 * @param {number} mag desired shake magnitude in px
 * @returns {object|null} the instance now being tracked
 */
function kickCameraShake(mag) {
  const cur = shakeInstance;
  if (cur && !cur.done && mag < cur.body.intensity) return cur; // never lower the peak
  if (cur) cur.complete();
  const next = fireManual({ type: 'camera-shake', params: { intensity: mag } }, null,
    { view: { w: VIEW_W, h: VIEW_H } });
  return next ?? cur;
}

// --- Entity-space spawners ------------------------------------------------------

/**
 * Spawn a one-shot burst effect and report how many particles actually
 * entered the shared pool (pool exhaustion caps the count — monolith parity).
 * @param {{x:number,y:number}} p point
 * @param {number} before particle count before firing
 * @param {() => void} fire fn that fires the effect once
 * @returns {number} particles actually spawned
 */
function spawnCounted(p, before, fire) {
  fire();
  return particles.count - before;
}

// ---------------------------------------------------------------------------
// Effects singleton (compat facade — every legacy method keeps its signature)
// ---------------------------------------------------------------------------

export const Effects = {
  // --- Screen-space state (legacy read surface) -------------------------------
  get vignette() { return getVignetteValue(); },
  get screenFlash() { return getScreenFlashValue(); },

  /**
   * Hero took damage → kick the red vignette to full. Decays in update().
   * @param {number} [strength=1] 0..1 initial intensity
   */
  heroDamaged(strength = 1) {
    vignetteInstance = kickOverlay('vignette', strength,
      (t, params) => fireManual({ type: t, params }, null, { view: { w: VIEW_W, h: VIEW_H } }), vignetteInstance);
  },

  /**
   * Big explosion (barrel / bomb) → brief white screen flash.
   * @param {number} [strength=1] 0..1 initial intensity
   */
  bigExplosion(strength = 1) {
    flashInstance = kickOverlay('screen-flash', strength,
      (t, params) => fireManual({ type: t, params }, null, { view: { w: VIEW_W, h: VIEW_H } }), flashInstance);
  },

  /**
   * Explosion / stomp / heavy impact → screen shake of `mag` px for the
   * camera-shake default duration (0.25s). Legacy triggerShake(mag) merge
   * rule: max-kick on magnitude — a smaller trigger while a larger shake is
   * live keeps the bigger one; an equal-or-larger trigger re-fires a fresh
   * full-lifetime instance (the monolith's unconditional timer reset).
   * @param {number} mag shake magnitude in px
   */
  triggerShake(mag) {
    shakeInstance = kickCameraShake(mag);
  },

  /**
   * Current camera-shake offset {x,y} in px; {0,0} when idle or done.
   * render.js adds this to the camera translate each frame (monolith parity:
   * the same per-frame random draw cadence, now owned by the engine instance).
   * @returns {{x:number,y:number}}
   */
  getShakeOffset() {
    if (shakeInstance && !shakeInstance.done) {
      const o = shakeInstance.body.getOffset();
      return { x: o.x, y: o.y };
    }
    return { x: 0, y: 0 };
  },

  // --- Entity-space spawners --------------------------------------------------

  /**
   * Small red sparkle at a projectile→enemy impact point (design §12
   * "Projectile hit on enemy: small red sparkle (blood-like)").
   * @param {number} x world x of the impact
   * @param {number} y world y of the impact
   * @param {number} [count] overrides the random 3–5 roll
   * @returns {number} sparkles actually spawned
   */
  spawnHitSparkles(x, y, count) {
    const before = particles.count;
    return spawnCounted({ x, y }, before, () => {
      fireManual({ type: 'hit-sparkle', params: { x, y, ...(count != null ? { count } : {}) } });
    });
  },

  /**
   * Sprite-sized death sparkle burst (design §12 "sparkle burst (sized to
   * sprite)"). Count scales with the sprite's pixel area so a big boss pops
   * harder than a small flyer.
   * @param {number} x center x
   * @param {number} y center y
   * @param {number} [size=32] representative sprite dimension (px)
   * @returns {number} sparkles actually spawned
   */
  spawnDeathSparkle(x, y, size = 32) {
    const before = particles.count;
    return spawnCounted({ x, y }, before, () => {
      fireManual({ type: 'death-sparkle', params: { x, y, size } });
    });
  },

  /**
   * Powerup pickup pop: a ring of colored sparkles radiating outward
   * (design §12 "Powerup pickup: pop/sparkle").
   * @param {number} x center x
   * @param {number} y center y
   * @param {string} [color='#fff'] the powerup's theme color
   * @returns {number} sparkles actually spawned
   */
  spawnPickupPop(x, y, color = '#ffffff') {
    const before = particles.count;
    return spawnCounted({ x, y }, before, () => {
      fireManual({ type: 'pickup-pop', params: { x, y, color } });
    });
  },

  /**
   * Barrel / bomb explosion VFX: warm-colored particles scaled to the AoE
   * radius (design §12 "multiple random bomb-explosion frames scaled to the
   * collision-box area"). Pair with bigExplosion() for the screen flash.
   * @param {number} x blast center x
   * @param {number} y blast center y
   * @param {number} [radius=60] explosion radius (px) — scales spread + count
   * @param {number} [count] explicit particle count; overrides the engine's
   *   deterministic formula when provided (legacy call sites pass their own
   *   roll). Omitted → formula min(24, 12 + round(radius*0.15)).
   * @returns {number} particles actually spawned
   */
  spawnExplosion(x, y, radius = 60, count) {
    const before = particles.count;
    return spawnCounted({ x, y }, before, () => {
      fireManual({ type: 'explosion', params: { x, y, radius, ...(count != null ? { count } : {}) } });
    });
  },

  /**
   * Plain sparkle burst from a point — the engine-side home of the legacy
   * `particles.spawnBurst(x, y, n)` calls that used to live inline in
   * systems/update.js (coin pickup, powerup pickup, checkpoint, saw fizzle,
   * barrel break, boss death). Routes through the engine's single fire path
   * (the 'particle-burst' type) so no call site spawns particles directly.
   * Behavior is identical to the old direct call: the shared pool's
   * spawnBurst() picks random warm colors and outward velocities.
   * @param {number} x center x
   * @param {number} y center y
   * @param {number} [count=6] how many sparkles (pool default when omitted)
   * @returns {number} particles actually spawned
   */
  fireParticleBurst(x, y, count = 6) {
    const before = particles.count;
    return spawnCounted({ x, y }, before, () => {
      fireManual({ type: 'particle-burst', params: { x, y, count } });
    });
  },

  /**
   * Mark an entity as shaking (design §12 "Enemy damaged: fast shake"). The
   * shake rides on the entity's existing hitFlash timer (0.1s), so just set
   * hitFlash — render reads getEntityShakeOffset(e) each frame for the random
   * offset. Firing the engine's sprite-shake type also tracks the instance so
   * it prunes itself once the flash decays.
   * @param {object} e any entity with a hitFlash timer
   */
  beginEnemyShake(e) {
    if (!e) return;
    fireManual({ type: 'sprite-shake', params: {} }, e);
  },

  /**
   * Per-frame random shake offset for an entity whose hitFlash is running.
   * Returns {x,y} in [-SHAKE_AMT, +SHAKE_AMT] while hitFlash > 0, else {0,0}.
   * Callers add this to the entity's draw position. Thin stateless read
   * helper (monolith parity): it reads carrier.hitFlash directly — the same
   * expiry signal the engine instance uses — so no engine lookup is needed
   * here; the computation and SHAKE_AMT live in spriteShake.js (single owner).
   * Named getEntityShakeOffset to keep the no-arg getShakeOffset() name free
   * for the camera-shake read path (object-literal key collision would make
   * the later definition silently win).
   * @param {object} e entity with a hitFlash timer
   * @returns {{x:number,y:number}}
   */
  getEntityShakeOffset(e) {
    return getSpriteShakeOffset(e);
  },

  // --- Frame step --------------------------------------------------------------

  /**
   * Step the engine (all active effect instances). The shared particle pool is
   * NOT advanced here: systems/update.js advances it exactly once per frame via
   * particles.updateAll(dt) at its own call site. The monolith's update() did
   * not advance particles either, and the engine prunes completed one-shot
   * instances from its active set on this step, so nothing lingers.
   * @param {number} dt seconds
   */
  update(dt) {
    stepEngine(dt);
    // The engine prunes completed instances from its active set, so the shim's
    // tracked overlay slots must clear themselves once their instance is done —
    // otherwise a stale slot would keep serving reads (and kickOverlay's
    // "never lower" rule would compare against a dead instance).
    if (vignetteInstance && vignetteInstance.done) vignetteInstance = null;
    if (flashInstance && flashInstance.done) flashInstance = null;
    if (shakeInstance && shakeInstance.done) shakeInstance = null;
  },

  /**
   * Draw the screen-space overlays (vignette + white flash) in VIEWPORT space.
   * Must be called AFTER the camera translate has been restored, so it covers
   * the whole logical viewport regardless of scroll. Delegates to the engine's
   * drawEffects() so every active renderable instance (including declaratively
   * fired ones) completes its lifecycle; the viewport dims are handed to each
   * instance via a { view: { w, h } } context because the migrated screen-space
   * factories read their viewport from fire-time params/ctx.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} viewW logical viewport width (VIEW_W)
   * @param {number} viewH logical viewport height (VIEW_H)
   */
  drawOverlay(ctx, viewW, viewH) {
    // Screen-space effects own their "draw after camera restore" ordering
    // (render.js calls this post-restore); entity-space instances have no-op
    // renders here, so one engine pass covers both without changing order.
    // The viewport dims ride in renderCtx because the migrated screen-space
    // factories read their viewport from fire-time params/ctx.
    drawEffects(ctx, { view: { w: viewW, h: viewH } });
  },

  /**
   * Reset all state (used between runs / retries so a stale vignette doesn't
   * bleed into the next life).
   */
  reset() {
    resetEffects();
    vignetteInstance = null;
    flashInstance = null;
    shakeInstance = null;
  },
};
