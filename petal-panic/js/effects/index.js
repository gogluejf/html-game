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
  render(ctx) {
    if (this.done) return;
    if (typeof this.body.render === 'function') this.body.render(ctx);
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
 * Draw all active instances. Screen-space effects should render after the
 * camera transform is restored (their responsibility, not the engine's).
 * @param {object} ctx CanvasRenderingContext2D
 */
export function drawEffects(ctx) {
  for (const inst of active) inst.render(ctx);
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
