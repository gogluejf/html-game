// Petal Panic — composite explosion burst (effects.md §24, catalog #24).
// Creates multiple explosion effects at randomized positions and times inside
// a defined area, for large boss deaths, machinery destruction, large objects,
// or Contra-style chained explosions.
//
// Compositor mechanism: this is a STATE effect — it stays active over its full
// `duration` and repeatedly fires SMALLER child effects at jittered points
// within its area. Every child is routed through the engine's SINGLE spawn
// path — `fireManual({ type, params })` from './index.js' — so each child
// enters the engine's active set with its own EffectInstance wrapper and gets
// its normal update/render lifecycle. This is what makes ANY registered effect
// type a valid child (the doc lists "Explosion, Particle Burst, Debris, Flash,
// or other effects"): pool-based children push into the shared pool AND their
// instance is pruned immediately (they report done at fire time); STATE /
// overlay children (e.g. screen-flash) stay in the active set and are updated
// and rendered by the engine for their own lifetime. Routing through fireManual
// also means an unregistered childType is handled gracefully: fireManual
// console.warns and returns null, which we simply ignore per tick (a config
// bug must never crash gameplay). One mechanism, no duplication, no engine
// change.
//
// params: { x, y, radius?, explosionCount?, spawnInterval?, timingVariance?,
//           posVariance?, childType?, childSizeRange?, density?, duration? }
//   x, y          — area center in world space. When the carrier exposes
//                   origin(), the FIRE-time carrier position wins over
//                   params.x/y (params are the standalone fallback the
//                   theater fires with a null carrier).
//   radius        — half-extent of the square spawn area in px (default 40);
//                   every child point lies within ±radius·posVariance of the
//                   center
//   explosionCount— number of child effects fired over the lifetime
//                   (default 6); 0 or negative fires nothing. The declared
//                   count ALWAYS fires within the lifetime: if explicit
//                   intervals or accumulated jitter would push a scheduled
//                   child past `duration`, the remaining children are
//                   compressed to land exactly at the end frame instead of
//                   being silently dropped
//   spawnInterval — base time between child spawns in s (default 1/3); when
//                   omitted, defaults to duration / explosionCount so the
//                   declared count always fits the duration
//   timingVariance— half-window of the uniform jitter added to each interval
//                   in s (default 0.1); 0 gives exact periodic spawning
//   posVariance   — fraction of `radius` used as the uniform per-axis offset
//                   range (default 1 → the full ±radius square; values < 1
//                   cluster spawns tighter around the center)
//   childType     — which registered effect type to fire per tick (default
//                   'explosion'). Any registered type is a valid child;
//                   unknown types are ignored per tick (a config bug must
//                   never crash gameplay)
//   childSizeRange— [min, max] SIZE envelope passed to the child (default
//                   [8, 24]); each child gets a uniform random value in the
//                   range mapped onto the child's actual SIZE param (see
//                   CHILD_SIZE_KEY below). This is distinct from density.
//   density       — the ABSOLUTE per-child particle/fragment/puff COUNT
//                   (default 1): count = floor(density). It is NOT a
//                   multiplier on a base count — it IS the count the child
//                   receives. Only applied when the child has a count key
//                   (see CHILD_COUNT_KEY); screen-flash has no count, so
//                   density is a no-op there. This keeps the doc's two
//                   distinct params ("Child size range" vs "Density")
//                   honored separately: size maps onto the child's size
//                   param, density sets its count.
//   duration      — total lifetime in s (default 2); the instance reports
//                   done exactly when elapsed >= duration - 1e-9 (the fixed-dt
//                   epsilon convention used across the project)

import { fireManual } from './index.js';

const DEFAULT_RADIUS = 40;          // px half-extent of the spawn area
const DEFAULT_COUNT = 6;            // child effects over the lifetime
const DEFAULT_DURATION = 2;         // s (doc example: "over two seconds")
const DEFAULT_INTERVAL = 1 / 3;     // s between spawns when not derived
const DEFAULT_TIMING_VARIANCE = 0.1;// s half-window of the interval jitter
const DEFAULT_POS_VARIANCE = 1;     // fraction of radius for the offset range
// Frozen so callers can't mutate the shared default array (copy-on-read:
// compositeExplosion copies it into its own local before use).
const DEFAULT_SIZE_RANGE = Object.freeze([8, 24]); // child size envelope
const DEFAULT_DENSITY = 1;          // absolute per-child count (1 = one particle)
const DONE_EPSILON = 1e-9;          // fixed-dt FP residue tolerance

/**
 * Which param carries the child's SIZE for a given registered type. The
 * uniform value drawn from childSizeRange is written here. Types without an
 * entry fall back to 'size' (a sensible generic default that most effects
 * understand; harmless if the child ignores it).
 */
const CHILD_SIZE_KEY = {
  'explosion':    'radius',
  'debris':       'size',
  'dust-cloud':   'size',
  'particle-burst': 'size',
  'screen-flash': 'strength',
};

/**
 * Which param carries the child's particle/fragment/puff COUNT for a given
 * registered type. `density` IS this count (count = floor(density)). Types
 * without an entry get no density scaling (e.g. screen-flash has no count).
 * A missing key is fine — the child uses its own default count.
 */
const CHILD_COUNT_KEY = {
  'explosion':    'count',
  'debris':       'fragmentCount',
  'dust-cloud':   'particleCount',
  'particle-burst': 'count',
};

/**
 * @param {{x?:number, y?:number, radius?:number, explosionCount?:number,
 *          spawnInterval?:number, timingVariance?:number, posVariance?:number,
 *          childType?:string, childSizeRange?:[number,number], density?:number,
 *          duration?:number}} params
 * @param {object} [carrier]
 * @returns {{update:Function, render:Function, done:boolean, complete:Function}}
 */
export function compositeExplosion(params = {}, carrier = null) {
  const radius = Math.max(0, params.radius ?? DEFAULT_RADIUS);
  const count = Math.max(0, Math.floor(params.explosionCount ?? DEFAULT_COUNT));
  const duration = Math.max(0, params.duration ?? DEFAULT_DURATION);
  // Interval: explicit param wins; otherwise derive it from the declared
  // count + duration so the burst spreads its children across the whole
  // lifetime (no clumping at t=0, no silent under-firing).
  const interval = Math.max(0, params.spawnInterval ?? (count > 0 ? duration / count : DEFAULT_INTERVAL));
  const timingVariance = Math.max(0, params.timingVariance ?? DEFAULT_TIMING_VARIANCE);
  const posVariance = Math.max(0, params.posVariance ?? DEFAULT_POS_VARIANCE);
  // Copy-on-read: never expose the shared frozen default to callers.
  const sizeRange = params.childSizeRange ?? [...DEFAULT_SIZE_RANGE];
  const density = Math.max(0, params.density ?? DEFAULT_DENSITY);
  const childType = params.childType ?? 'explosion';
  const sizeKey = CHILD_SIZE_KEY[childType] ?? 'size';
  const countKey = CHILD_COUNT_KEY[childType]; // undefined → no density scaling

  // Area center: prefer the live carrier anchor at fire time; params are the
  // standalone/fallback position (theater fires with a null carrier).
  let cx = params.x ?? 0;
  let cy = params.y ?? 0;
  if (carrier && typeof carrier.origin === 'function') {
    const o = carrier.origin();
    cx = o.x; cy = o.y;
  }

  let elapsed = 0;
  let spawned = 0;
  let nextAt = 0; // time of the next scheduled spawn (jittered per tick)

  /** Fire one child effect at a random point inside the area. */
  function spawnChild() {
    // Position variance: uniform per-axis offset within ±(posVariance·radius).
    const off = posVariance * radius;
    const px = cx + (Math.random() * 2 - 1) * off;
    const py = cy + (Math.random() * 2 - 1) * off;
    // Size variance: uniform value in the declared envelope, mapped onto the
    // child's actual SIZE param (distinct from density, which scales count).
    const size = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
    const childParams = { x: px, y: py, [sizeKey]: size };
    // Density: set the child's particle/fragment/puff count. `density` IS the
    // absolute count (not a multiplier), floored so it is always an integer.
    // Only applied when the child declares a count key.
    if (countKey != null) childParams[countKey] = Math.floor(density);
    // Route through the engine's single spawn path: the child enters the
    // active set with its own lifecycle. An unregistered type makes
    // fireManual warn + return null, which we ignore (no crash per tick).
    fireManual({ type: childType, params: childParams });
  }

  return {
    update(dt) {
      if (this.done) return;
      elapsed += dt;
      while (spawned < count && elapsed >= nextAt - DONE_EPSILON) {
        spawnChild();
        spawned++;
        if (spawned < count) {
          // B-4 guarantee: the LAST child must fire no later than `duration`.
          // The PRIMARY mechanism is the jitter clamp below: when a slot would
          // otherwise land past duration, the jitter window is bounded so
          // nextAt <= duration. Under bounded fixed-dt stepping that alone
          // guarantees every declared child fires within the lifetime.
          // The `nextAt = elapsed` collapse just below is a defensive
          // frame-skip-only fallback (a single update() with a large dt could
          // leap over a slot); it is unreachable under normal 1/60 stepping.
          let jitter = (Math.random() * 2 - 1) * timingVariance;
          if (elapsed + interval + jitter > duration) {
            jitter = Math.min(jitter, duration - elapsed - interval);
          }
          nextAt += interval + jitter;
          // Defensive frame-skip fallback only (see above): force-fire any
          // remaining children on this frame rather than dropping them.
          if (nextAt > duration) nextAt = elapsed;
        }
      }
      // Total lifetime == duration exactly: the fixed-dt epsilon makes the
      // done-frame deterministic at the boundary (elapsed lands on
      // duration ± ~1e-15 after n frames of 1/60).
      if (elapsed >= duration - DONE_EPSILON) this.done = true;
    },
    // Pure compositor: all visible work is delegated to the child effects
    // (shared pool / screen-space overlays via the engine), so render is a
    // no-op.
    render() {},
    done: false,
    complete() {
      // Early completion (resetEffects): stop scheduling; already-spawned
      // children keep their own lifetimes in the active set / shared pool.
      this.done = true;
    },
  };
}
