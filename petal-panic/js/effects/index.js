// Petal Panic — Effects Engine core (spec: docs/architecture/effects.md).
//
// Generic, registry-driven effect system. Every effect is a data object
// `{ type, params }` attached declaratively to a carrier; the engine fires it
// when a trigger event occurs and runs the instance through one uniform
// lifecycle: fire → update(dt) → render(ctx) → complete.
//
// Carriers are anything that owns state an effect needs at fire time
// (projectile, hitbox, collision event, marker, radius). A carrier declares
// its effects in `carrier.effects`:
//
//   carrier.effects = [
//     { on: 'collision',    type: 'particle-burst', params: { count: 12 } },
//     { on: 'attackActive', type: 'beam',           params: { length: 120 } },
//     { on: 'spawn',        type: 'trail',          continuous: { condition: 'moving' } },
//   ];
//
// Pure module — no DOM required. Effect factories may use Canvas 2D APIs at
// render time; the engine itself never touches document/window.

// --- Trigger vocabulary -------------------------------------------------------
// Fixed set of trigger events. The spec (effects.md §Triggers) is the source
// of truth; adding a trigger is a spec change, not an engine change.
export const TRIGGERS = [
  'spawn',
  'death',
  'collision',
  'explosion',
  'pickup',
  'damageTaken',
  'hitLanded',
  'attackActive',
  'stateChange',
  'manual',
];

// Continuous activation conditions (effects.md §Continuous Activation).
const CONTINUOUS_CONDITIONS = ['moving', 'fastMoving'];

// --- Registry -------------------------------------------------------------------
// type -> factory(params, carrier, ctx) -> { update(dt), render(ctx), done }
const registry = new Map();

/**
 * Register an effect type with its factory.
 * @param {string} type unique effect type name (e.g. 'beam')
 * @param {(params:object, carrier:object, ctx:object) => object} factory
 *   Returns an instance exposing update(dt), render(ctx), and a `done` flag
 *   (or a `complete()` method the engine calls when duration elapses).
 */
export function registerEffect(type, factory) {
  if (typeof type !== 'string' || !type) throw new Error('registerEffect: type must be a non-empty string');
  if (typeof factory !== 'function') throw new Error('registerEffect: factory must be a function');
  registry.set(type, factory);
}

/** True if an effect type has been registered. */
export function hasEffect(type) {
  return registry.has(type);
}

/** Number of registered effect types (for debug theater / tests). */
export function registeredTypes() {
  return [...registry.keys()];
}

// --- Active instances -----------------------------------------------------------
// Each spawned effect lives here until its lifecycle completes.
const active = [];

/** Number of currently active (not yet completed) effect instances. */
export function activeCount() {
  return active.filter(i => !i.done).length;
}

/**
 * Snapshot of the currently active (not-yet-completed) instances. Read-only
 * view for tests/debug tooling — never mutate the returned array or the
 * instances through it (use complete()/resetEffects() for lifecycle).
 * @returns {EffectInstance[]}
 */
export function activeInstances() {
  return active.filter(i => !i.done);
}

// --- EffectInstance -------------------------------------------------------------
// Uniform wrapper so every effect — regardless of type — advances through
// the same update/draw/complete path driven only by its own params.

class EffectInstance {
  constructor(type, body, carrier, trigger) {
    this.type = type;
    this.body = body;       // the object the factory returned
    this.carrier = carrier; // carrier the effect was fired from (may be null for manual)
    this.trigger = trigger; // trigger event that fired it ('manual' for explicit fires)
    this.done = false;
  }

  /** Advance internal timers. Marks done when the effect reports completion. */
  update(dt) {
    if (this.done) return;
    if (typeof this.body.update === 'function') this.body.update(dt);
    if (this.body.done) this.complete();
  }

  /** Render. No-op once done. (Spec §Lifecycle names this step `render`.) */
  render(ctx, renderCtx = {}) {
    if (this.done) return;
    if (typeof this.body.render === 'function') this.body.render(ctx, renderCtx);
  }

  /** Force-complete (used by resetEffects and continuous deactivation). */
  complete() {
    if (this.done) return;
    this.done = true;
    if (typeof this.body.complete === 'function') this.body.complete();
  }
}

// --- Firing ---------------------------------------------------------------------

/**
 * Instantiate one effect from config and add it to the active set.
 * Unknown types are ignored without throwing (a missing registration must
 * never crash gameplay). An instance already reporting `done` at spawn time
 * is completed immediately rather than added to the active set.
 * @returns {EffectInstance|null} the spawned instance, or null if unknown type
 */
function spawnFromConfig(cfg, carrier, trigger, ctx) {
  const factory = registry.get(cfg.type);
  if (!factory) {
    // Surface config bugs without crashing gameplay (spec: a missing
    // registration must never throw).
    console.warn(`[effects] unregistered effect type "${cfg.type}" (trigger "${trigger}") — ignored`);
    return null;
  }
  const body = factory(cfg.params ?? {}, carrier, ctx);
  if (!body || typeof body !== 'object') return null;
  // The engine does not mutate the factory-returned body: the instance owns
  // the trigger record (inst.trigger), so effect-owned state stays untouched.
  const inst = new EffectInstance(cfg.type, body, carrier, trigger);
  if (body.done) { inst.complete(); return inst; } // never enters the active set
  active.push(inst);
  return inst;
}

/**
 * Fire all of a carrier's declared effects whose `on` matches the trigger.
 * This is the engine's single fire path: carrier emits a trigger event, the
 * engine looks up matching configs, instantiates them, and they run their
 * lifecycle via updateEffects/drawEffects. Signature follows the spec's
 * lifecycle contract (effects.md §Lifecycle): fire(trigger, carrier).
 *
 * @param {string} trigger one of TRIGGERS
 * @param {object} [carrier] object with an optional `effects` array of
 *   `{ on, type, params, continuous? }` entries. May be null (manual fires).
 * @param {object} [ctx] context handed to factories (e.g. { canvas, view })
 * @returns {number} number of instances spawned
 */
export function fire(trigger, carrier = null, ctx = {}) {
  // Deterministic policy: a trigger outside the fixed TRIGGERS vocabulary is
  // ignored (returns 0) rather than throwing. The vocabulary is the spec's
  // source of truth; an unknown event name is a config bug we surface by
  // simply not firing, never by crashing gameplay.
  if (!TRIGGERS.includes(trigger)) return 0;
  const cfgs = Array.isArray(carrier?.effects) ? carrier.effects : [];
  let spawned = 0;
  for (const cfg of cfgs) {
    if (!cfg || cfg.on !== trigger) continue;
    if (spawnFromConfig(cfg, carrier, trigger, ctx)) spawned++;
  }
  return spawned;
}

/**
 * Fire an effect explicitly by data (debug theater, scripted sequences).
 * This is NOT a second fire path: it routes through the exact same
 * spawnFromConfig lifecycle as carrier-triggered fires. The spec's trigger
 * vocabulary (effects.md §Triggers) includes `manual — fired explicitly by
 * game code (debug theater, scripted sequences)`, so explicit firing is part
 * of the single declarative mechanism; only the trigger value differs.
 * @returns {EffectInstance|null}
 */
export function fireManual({ type, params = {} }, carrier = null, ctx = {}) {
  return spawnFromConfig({ on: 'manual', type, params }, carrier, 'manual', ctx);
}

// --- Continuous activation --------------------------------------------------------
// carriers with a continuous declaration get one instance kept alive while
// the carrier satisfies the condition. Keyed by carrier identity + the
// *declaration's* index, so two declarations sharing one condition each keep
// their own instance instead of collapsing into one. Carrier identity lives
// in a WeakMap (keyed by the carrier object itself) so the engine never
// mutates carriers — frozen or externally-owned objects are safe, and no
// preexisting/duplicate IDs can collide.
const continuous = new Map();
const carrierIds = new WeakMap(); // carrier -> stable numeric id
let carrierSeq = 0;

function carrierKey(carrier) {
  let id = carrierIds.get(carrier);
  if (id == null) {
    id = ++carrierSeq;
    carrierIds.set(carrier, id);
  }
  return String(id);
}

/**
 * Evaluate continuous declarations on a carrier and maintain instances.
 * Call once per frame per tracked carrier (or pass several carriers).
 * Spawns the instance when the condition starts holding, completes it when
 * the condition stops. One instance per (carrier, declaration) at a time.
 * @param {object|object[]} carriers
 */
export function updateContinuous(carriers) {
  const list = Array.isArray(carriers) ? carriers : [carriers];
  for (const carrier of list) {
    const cfgs = Array.isArray(carrier?.effects) ? carrier.effects : [];
    const wanted = new Set();
    let idx = 0;
    for (const cfg of cfgs) {
      const cont = cfg?.continuous;
      if (!cont || !CONTINUOUS_CONDITIONS.includes(cont.condition)) continue;
      // Declaration identity: stable per declared entry (index within the
      // carrier's effects array), independent of the shared condition string.
      const key = `${carrierKey(carrier)}:${idx}`;
      const met = typeof carrier.isConditionMet === 'function' && carrier.isConditionMet(cont.condition);
      if (met) {
        wanted.add(key);
        const existing = continuous.get(key);
        if (!existing || existing.done) {
          // A completed instance is dropped from the cache so the next update
          // re-spawns it while the condition still holds (keep-one-alive).
          if (existing) existing.complete();
          const inst = spawnFromConfig(cfg, carrier, cont.condition, {});
          if (inst) continuous.set(key, inst);
        }
      } else if (continuous.has(key)) {
        continuous.get(key).complete();
        continuous.delete(key);
      }
      idx++;
    }
    // Drop stale keys for this carrier (config removed mid-run or instance done).
    for (const key of [...continuous.keys()]) {
      const entry = continuous.get(key);
      if (entry.carrier === carrier && !wanted.has(key)) {
        entry.complete();
        continuous.delete(key);
      }
    }
  }
}

// --- Frame step --------------------------------------------------------------------

/**
 * Step all active instances. Completed ones are pruned.
 * @param {number} dt seconds
 */
export function updateEffects(dt) {
  for (const inst of active) inst.update(dt);
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i].done) active.splice(i, 1);
  }
}

/**
 * Draw all active instances whose `body.space` matches the pass. Two-pass
 * render model (effects.md §Lifecycle): world-space effects (default; e.g.
 * spriteFlash, impactStar) are drawn inside the camera translate, and
 * screen-space effects (`space: 'screen'`; e.g. vignette, screenFlash,
 * screenOverlay) are drawn after the camera transform is restored. A body
 * without a `space` field defaults to `'world'`. One generic check — no
 * per-effect branching.
 * @param {object} ctx CanvasRenderingContext2D
 * @param {object} [renderCtx] optional context handed to each instance's
 *   render() as its second argument (e.g. { view: { w, h } } for screen-space
 *   overlays that need viewport dims at draw time)
 * @param {{space?:'world'|'screen'}} [pass] which coordinate space this pass
 *   draws; omit to draw every active instance (legacy single-pass behavior).
 */
export function drawEffects(ctx, renderCtx = {}, pass = {}) {
  const space = pass.space ?? null; // null → no filtering (all instances)
  for (const inst of active) {
    if (inst.done) continue;
    if (space && (inst.body.space ?? 'world') !== space) continue;
    inst.render(ctx, renderCtx);
  }
}

/**
 * Clear all state between runs (active instances + continuous tracking).
 */
export function resetEffects() {
  for (const inst of active) inst.complete();
  active.length = 0;
  for (const [, inst] of continuous) inst.complete();
  continuous.clear();
}

// --- Effect Theater -------------------------------------------------------------
// A uniform, debug-only preview surface: every registered effect gets a small
// self-contained `demo(ctx, t)` that renders it standalone on a neutral stage,
// driven ONLY by its params — no real gameplay entity required. The theater
// (task 7.2) steps through `theaterList()` in catalog order and calls the
// current entry's demo each frame with an increasing elapsed time `t`.
//
// Design choice (documented per task 7.1): the demo logic is CENTRALIZED here
// rather than duplicated across the 25 effect files. Each demo reuses the
// engine's own record/render path — fireManual(type, null carrier, default
// params) → step updateEffects/drawEffects to reach time `t` → draw — so the
// preview exercises exactly the code the game uses, and "adding an effect"
// stays one file (the factory) plus one CATALOG row below. The only per-effect
// knowledge lives in this table (default params + a few presentation hooks),
// which is data, not behavior.
//
// Per-demo clock model: `demo(ctx, t)` is STATELESS and deterministic — it
// clears the engine, fires the effect fresh at t=0, advances it to elapsed
// time `t`, then draws the single frame at `t`. The theater therefore just
// passes an increasing `t` (or restarts at 0 when stepping); no hidden
// per-entry mutable clock exists. Fixed dt = 1/60 (project convention).

import { particles } from '../particles.js';

const DEMO_DT = 1 / 60;          // fixed step (project convention)
export const DEMO_VIEW = { w: 320, h: 180 }; // neutral-stage viewport for screen-space overlays
const STAGE_X = 160;             // world origin for standalone demos (center-ish)
const STAGE_Y = 90;
const BOX = { x: STAGE_X - 16, y: STAGE_Y - 16, w: 32, h: 32 }; // reference sprite box

/**
 * Catalog-ordered list of theater entries. Order follows effects.md §1→§24
 * (Heat Distortion §25 is deferred/out-of-scope and NOT registered, so it is
 * absent) then §26 Beam. `params` are the defaults a bare fire would use; they
 * exist only so the demo is VISIBLE (real entities pass their own params at
 * fire time — these never affect gameplay).
 *
 * Optional per-entry hooks (all presentation-only, applied inside the demo):
 *   feed(inst, i)  — drive a recording effect (trail/afterimage) with synthetic
 *                    motion so its ribbon/ghosts actually appear.
 *   render(ctx, inst, body) — replace the standard draw for non-canvas effects
 *                             (camera/sprite shake) with a visible proxy.
 */
const CATALOG = [
  { type: 'particle-burst',        name: 'Particle Burst / Sparks', section: 1,  params: { x: STAGE_X, y: STAGE_Y, count: 16 } },
  { type: 'explosion',             name: 'Explosion',               section: 2,  params: { x: STAGE_X, y: STAGE_Y, radius: 60 } },
  { type: 'debris',                name: 'Debris',                  section: 3,  params: { x: STAGE_X, y: STAGE_Y, fragmentCount: 14, velocity: 220, lifetime: 0.8 } },
  { type: 'ground-wave',           name: 'Ground Wave',             section: 4,  params: { x: STAGE_X, y: STAGE_Y, duration: 0.8 } },
  { type: 'shockwave',             name: 'Shockwave',               section: 5,  params: { x: STAGE_X, y: STAGE_Y, duration: 0.6 } },
  { type: 'trail',                 name: 'Trail',                   section: 6,  params: { lifetime: 0.6 },
    feed(inst, i) { const b = inst.body; if (typeof b.addPoint === 'function') b.addPoint(STAGE_X - 80 + i * 8, STAGE_Y); } },
  { type: 'afterimage',            name: 'Afterimage / Ghost Frames', section: 7, params: { box: BOX, spawnInterval: 1 / 30, lifetime: 0.6 },
    feed(inst, i) { const b = inst.body; if (typeof b.addGhost === 'function') b.addGhost(STAGE_X - 30 + i * 3, STAGE_Y); } },
  { type: 'telegraph-circle',      name: 'Telegraph Circle',        section: 8,  params: { x: STAGE_X, y: STAGE_Y, duration: 1.0 } },
  { type: 'ground-target-marker',  name: 'Ground Target Marker',    section: 9,  params: { x: STAGE_X, y: STAGE_Y, duration: 1.0 } },
  { type: 'target-reticle',        name: 'Target Reticle',          section: 10, params: { x: STAGE_X, y: STAGE_Y, duration: 1.0 } },
  { type: 'vignette',              name: 'Damage Vignette',         section: 11, params: { strength: 1, viewW: DEMO_VIEW.w, viewH: DEMO_VIEW.h } },
  { type: 'sprite-flash',          name: 'Sprite Flash',            section: 12, params: { box: BOX, duration: 0.5 } },
  { type: 'camera-shake',          name: 'Camera Shake',            section: 13, params: { intensity: 6, duration: 0.25 } },
  { type: 'screen-flash',          name: 'Screen Flash',            section: 14, params: { strength: 1, viewW: DEMO_VIEW.w, viewH: DEMO_VIEW.h } },
  { type: 'sprite-shake',          name: 'Sprite Shake',            section: 15, params: { amount: 3 } },
  { type: 'impact-star',           name: 'Impact Star / Hit Pop',   section: 16, params: { x: STAGE_X, y: STAGE_Y } },
  { type: 'fade-out',              name: 'Fade Out',                section: 17, params: { box: BOX, duration: 0.6 } },
  { type: 'scale-pulse',           name: 'Scale / Pulse',           section: 18, params: { box: BOX, duration: 0.8 } },
  { type: 'squash-stretch',        name: 'Squash & Stretch',        section: 19, params: { box: BOX, duration: 0.6 } },
  { type: 'dust-cloud',            name: 'Dust Cloud',              section: 20, params: { x: STAGE_X, y: STAGE_Y, particleCount: 18, lifetime: 0.8 } },
  { type: 'attack-arc',            name: 'Attack Arc / Slash',      section: 21, params: { x: STAGE_X, y: STAGE_Y, duration: 0.4 } },
  { type: 'aura-glow',             name: 'Aura / Glow',             section: 22, params: { x: STAGE_X, y: STAGE_Y, duration: 1.0 } },
  { type: 'screen-overlay',        name: 'Screen Overlay',          section: 23, params: { color: '#ff5a5a', opacity: 0.5, duration: 1.0, fadeIn: 0.2, fadeOut: 0.2 } },
  { type: 'composite-explosion',   name: 'Composite Explosion Burst', section: 24, params: { x: STAGE_X, y: STAGE_Y, radius: 60, explosionCount: 6, duration: 1.0 } },
  { type: 'beam',                  name: 'Beam',                    section: 26, params: { x: STAGE_X, y: STAGE_Y, length: 120, width: 18, gradientRadius: 14, color: '#7df', flashInTime: 0.05, fadeOutTime: 0.15 } },
];

// Effects whose visual lives in the SHARED particle pool (one-shot bursts):
// the instance completes immediately, so the demo must also advance + draw the
// pool to show the particles flying.
const POOL_DRIVEN = new Set(['particle-burst', 'explosion', 'debris', 'dust-cloud', 'composite-explosion']);
// State effects with no canvas render (render() is a no-op): the demo paints a
// visible proxy driven by the instance's getOffset() so the jitter reads.
const SHAKE_PROXY = new Set(['camera-shake', 'sprite-shake']);

/**
 * Build a stateless, deterministic demo for one catalog entry.
 * @param {object} entry a CATALOG row
 * @returns {(ctx:object, t:number) => void}
 */
function makeDemo(entry) {
  return function demo(ctx, t) {
    // Pre-roll: theater clock is negative. Show nothing — the effect hasn't
    // been fired yet. This avoids the "frozen flash" where the effect sits
    // fully visible before its animation plays.
    if (!Number.isFinite(t) || t < 0) return;
    const target = t;
    // Fresh start every call: clear any prior effect/pool state so the demo is
    // fully self-contained and independent of what the theater drew before.
    resetEffects();
    particles.reset(); // clear live particles for a clean slate
    const inst = fireManual({ type: entry.type, params: { ...entry.params } }, null, {});
    if (!inst) return; // unregistered type — nothing to show (never throws)
    const frames = Math.round(target / DEMO_DT);
    for (let i = 1; i <= frames; i++) {
      updateEffects(DEMO_DT);
      particles.updateAll(DEMO_DT);
      if (entry.feed) entry.feed(inst, i);
    }
    if (SHAKE_PROXY.has(entry.type)) {
      drawShakeProxy(ctx, inst.body, entry.type, target);
    } else {
      // Standard draw: world-space effects (no view needed) + screen-space
      // overlays (fed the neutral-stage viewport via renderCtx.view).
      drawEffects(ctx, { view: DEMO_VIEW });
      if (POOL_DRIVEN.has(entry.type)) {
        for (const s of particles.activeItems) s.draw(ctx);
      }
    }
  };
}

/**
 * Visible proxy for the non-drawing shake effects. Draws a clear visual that
 * shows the jitter without relying on the effect instance's carrier (which is
 * null in the theater). Uses its own internal random offset driven by the demo
 * clock so it's deterministic per-frame and always visible.
 */
function drawShakeProxy(ctx, body, entryType, t) {
  const isCamera = entryType === 'camera-shake';
  const amt = isCamera ? 6 : 3; // px — match in-game values (explosion / projectile hit)
  const duration = isCamera ? 0.25 : 0.1; // s — match in-game (SHAKE_DURATION / hitFlash)
  // Stop shaking after the duration elapses.
  const active = t < duration;
  let off = { x: 0, y: 0 };
  if (active) {
    // Use the live offset if available (non-zero), otherwise generate our own.
    const live = typeof body?.getOffset === 'function' ? body.getOffset() : null;
    if (live && (live.x !== 0 || live.y !== 0)) {
      off = live;
    } else {
      off = { x: (Math.random() * 2 - 1) * amt, y: (Math.random() * 2 - 1) * amt };
    }
  }

  ctx.save();
  if (isCamera) {
    // Camera shake: show 3 sprites at fixed positions, ALL offset together.
    // A dashed rectangle shows the "unshaken" frame boundary.
    const positions = [
      { x: BOX.x - 40, y: BOX.y, w: 24, h: 24 },
      { x: BOX.x + BOX.w / 2 - 12, y: BOX.y - 30, w: 24, h: 24 },
      { x: BOX.x + BOX.w + 16, y: BOX.y + 10, w: 24, h: 24 },
    ];
    // Unshaken reference frame (dashed).
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(BOX.x - 50, BOX.y - 40, BOX.w + 100, BOX.h + 60);
    ctx.setLineDash([]);
    // Shaken sprites.
    ctx.fillStyle = '#fff';
    for (const p of positions) {
      ctx.fillRect(p.x + off.x, p.y + off.y, p.w, p.h);
    }
    // Label.
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('all sprites move together', BOX.x + BOX.w / 2, BOX.y + BOX.h + 35);
  } else {
    // Sprite shake: show 3 sprites, ONLY the middle one jitters.
    const positions = [
      { x: BOX.x - 40, y: BOX.y, w: 24, h: 24 },
      { x: BOX.x + BOX.w / 2 - 12, y: BOX.y - 30, w: 24, h: 24 },
      { x: BOX.x + BOX.w + 16, y: BOX.y + 10, w: 24, h: 24 },
    ];
    // Static sprites (no offset).
    ctx.fillStyle = '#666';
    ctx.fillRect(positions[0].x, positions[0].y, positions[0].w, positions[0].h);
    ctx.fillRect(positions[2].x, positions[2].y, positions[2].w, positions[2].h);
    // Shaken sprite (middle, with offset).
    ctx.fillStyle = '#fff';
    const mid = positions[1];
    ctx.fillRect(mid.x + off.x, mid.y + off.y, mid.w, mid.h);
    // Crosshair at nominal center of shaken sprite.
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mid.x + mid.w / 2 - 6, mid.y + mid.h / 2);
    ctx.lineTo(mid.x + mid.w / 2 + 6, mid.y + mid.h / 2);
    ctx.moveTo(mid.x + mid.w / 2, mid.y + mid.h / 2 - 6);
    ctx.lineTo(mid.x + mid.w / 2, mid.y + mid.h / 2 + 6);
    ctx.stroke();
    // Label.
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('only this sprite jitters', BOX.x + BOX.w / 2, BOX.y + BOX.h + 35);
  }
  ctx.restore();
}

/**
 * Uniform theater entry point (task 7.1). Returns every implemented effect as
 * `{ type, name, demo }` in catalog order (§1 Particle Burst → §24 Composite
 * Explosion Burst → §26 Beam), skipping Heat Distortion (§25, deferred).
 * @returns {{type:string, name:string, demo:Function}[]}
 */
export function theaterList() {
  return [...CATALOG].sort((a, b) => a.section - b.section)
    .map(entry => ({ type: entry.type, name: entry.name, demo: makeDemo(entry) }));
}
