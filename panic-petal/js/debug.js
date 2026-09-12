// Petal Panic — Debug & Test Harness (design §19).
//
// A developer sandbox toggled with the unified debug mode. Every feature is gated behind
// `if (Debug.enabled)` in the update/render systems, so normal play pays zero
// cost: when disabled the only work done is a single boolean check per frame.
//
// The module itself is a plain state container + a handful of pure helpers. It
// deliberately has NO imports of game entities so it stays unit-testable in
// node (no DOM, no canvas). The integration glue (spawning real entities,
// wiring keys, drawing overlays) lives in systems/update.js and
// systems/render.js, which import this module.
//
// Features (v1 = keybinds + console, no UI):
//   - Free-spawn any entity in a chosen AI state        (keys 1-9 while debug)
//   - God mode (invincible + infinite ammo)             (G while debug)
//   - Slow-mo / freeze cycle                            (T while debug)
//   - Hero swap Scarlet <-> Balthazhar                  (Y while debug)
//   - Force an enemy's AI state on demand               (click enemy while debug)
//   - Aggro radius + facing arrow + state label viz     (always when debug)
//   - Anim frame scrubber + collision-box overlay       (arrows + select)
//   - Live §4.1 telemetry HUD                           (when debug)
//   - Event log ring buffer                             (L toggles display)

export const Debug = {
  // Master toggle. Everything below is dead code when false.
  enabled: false,

  // --- God mode -------------------------------------------------------------
  // Hero invincible + infinite ammo. Applied each frame by the update system
  // while enabled; cleared by reset().
  god: false,

  // --- Time control ---------------------------------------------------------
  // Multiplies the fixed dt before it reaches the physics step.
  //   1.0 = normal, 0.5 = half speed, 0.25 = slow, 0 = freeze-frame.
  timeScale: 1.0,
  // Ordered cycle for the T key (index advances modulo length).
  TIME_STEPS: [1.0, 0.5, 0.25, 0],

  // --- Selected entity (for inspection / anim scrubbing) --------------------
  selected: null,

  // --- Spawn table ----------------------------------------------------------
  // Populated at init() with factory functions keyed by spawn id. Each entry:
  //   { name, states: [...], make(x, y, state) -> Entity }
  // `states` lists the valid AI states for that type (used by the state-force
  // cycler and shown in the HUD). Empty array = not an AI-driven entity.
  spawnTable: {},

  // --- Event log (ring buffer) ----------------------------------------------
  log: [],
  LOG_MAX: 50,
  showLog: false, // L toggles the on-screen tail of the log
  showStats: false, // T toggles the telemetry panel (default OFF)
  viewMode: 0, // V cycles: 0=sprites+overlay, 1=collision-only (opaque), 2=no-visuals

  // --- Transform-debug detail level -----------------------------------------
  // Cycles with C: 0=vectors only, 1=vectors+labels+mirror icons, 2=inspect
  // selected entity (numeric panel). Drives drawEntityTransformDebug in render.
  detailLevel: 0,

  // --- Toggle master switch -------------------------------------------------
  toggle() { this.enabled = !this.enabled; return this.enabled; },

  /**
   * Append a message to the event log ring buffer. No-op-safe even when the
   * harness is off (callers gate on `enabled`, but this never throws).
   * @param {string} msg human-readable event line
   */
  logEvent(msg) {
    this.log.push({ t: performance.now(), msg });
    if (this.log.length > this.LOG_MAX) this.log.shift();
  },

  /**
   * Cycle the time scale through TIME_STEPS (1x → 0.5x → 0.25x → freeze → 1x).
   * @returns {number} the new timeScale
   */
  cycleTimeScale() {
    const i = this.TIME_STEPS.indexOf(this.timeScale);
    const next = this.TIME_STEPS[(i + 1) % this.TIME_STEPS.length];
    this.timeScale = next;
    return next;
  },

  /**
   * Cycle the transform-debug detail level (0 → 1 → 2 → 0).
   * @returns {number} the new detailLevel
   */
  cycleDetailLevel() {
    this.detailLevel = (this.detailLevel + 1) % 3;
    return this.detailLevel;
  },

  /**
   * Force an entity into a given AI state. Handles both regular enemies
   * (`aiState`) and the boss (which drives its phase machine via `phase`).
   * Returns true if the state was applied.
   *
   * @param {object} ent an Enemy / Elephant instance
   * @param {string} state target state name
   */
  forceState(ent, state) {
    if (!ent) return false;
    // Boss uses a separate `phase` field; map 'dead' onto aiState too.
    if (ent.isBoss && typeof ent.startPhase === 'function') {
      if (state === 'dead') { ent.aiState = 'dead'; ent.die?.(); return true; }
      ent.startPhase(state);
      return true;
    }
    ent.aiState = state;
    // Clear transient timers so the forced state actually takes hold rather
    // than being immediately overwritten by a stale cooldown this frame.
    if (state === 'attack' || state === 'lunge' || state === 'melee') {
      if (typeof ent.whipTimer !== 'undefined') ent.whipTimer = Math.max(ent.whipTimer ?? 0, 0.05);
    }
    return true;
  },

  /**
   * Advance to the next valid AI state for an entity (the "force-state" click
   * cycles through them). Falls back to a generic list when the entity's type
   * isn't in the spawn table.
   * @param {object} ent
   * @returns {string|null} the newly-forced state, or null if none available
   */
  nextState(ent) {
    const states = this.statesFor(ent);
    if (!states.length) return null;
    const cur = ent.isBoss ? ent.phase : ent.aiState;
    const i = states.indexOf(cur);
    const next = states[(i + 1) % states.length];
    this.forceState(ent, next);
    return next;
  },

  /** Valid AI states for an entity, looked up from the spawn table by type. */
  statesFor(ent) {
    if (!ent) return [];
    const key = ent.type ?? ent.id;
    const entry = this.spawnTable[key];
    if (entry && Array.isArray(entry.states)) return entry.states;
    // Generic fallback for unknown types.
    return ['idle', 'chase', 'attack'];
  },

  /**
   * Reset all debug flags to defaults (called when debug turns off and on re-enable).
   */
  reset() {
    this.god = false;
    this.timeScale = 1.0;
    this.selected = null;
    this.showLog = false;
    this.showStats = false;
    this.detailLevel = 0;
    this.log = [];
  },
};

// ---------------------------------------------------------------------------
// Spawn-table registration. Kept as a function (not run at import) so the
// module can be imported in node without pulling in every entity class. The
// update system calls initSpawnTable(deps) once after its own entities exist.
// ---------------------------------------------------------------------------

/**
 * Populate Debug.spawnTable with factories for every spawnable type.
 *
 * @param {object} deps entity constructors/factories:
 *   { Jester, VineHound, Violetta, JackOLantern, BorisLoon, makeBorisBaby,
 *     makeBarrel, makeCoinBarrel, Powerup, POWERUP_TYPES, floorTop, levelLength }
 */
export function initSpawnTable(deps) {
  const {
    Jester, VineHound, Violetta, JackOLantern,
    BorisLoon, BORIS_DEF, makeBorisBaby,
    makeBarrel, makeCoinBarrel, Powerup, POWERUP_TYPES,
  } = deps;

  // Helper to build an enemy entry.
  const enemy = (key, name, ctor, states) => ({
    name, states,
    make: (x, y, state) => {
      const e = ctor(x, y);
      if (state) Debug.forceState(e, state);
      return e;
    },
  });

  const table = {};

  // Enemies (keys 1-6).
  table.jester = enemy('jester', 'Jester', (x, y) => new Jester(x, y),
    ['idle', 'chase', 'attack']);
  table.vine_hound = enemy('vine_hound', 'VineHound', (x, y) => new VineHound(x, y),
    ['idle', 'chase', 'lunge', 'recover']);
  table.violetta = enemy('violetta', 'Violetta', (x, y) => new Violetta(x, y),
    ['idle', 'pace', 'melee']);
  table.jackolantern = enemy('jackolantern', 'JackOLantern', (x, y) => new JackOLantern(x, y),
    ['idle', 'roll', 'launch', 'explode']);
  table.boris_loon = enemy('boris_loon', 'BorisLoon', (x, y) => new BorisLoon(BORIS_DEF, x, y),
    ['idle', 'hover', 'dive', 'recover']);
  table.boris_loon_baby = enemy('boris_loon_baby', 'BorisBaby', (x, y) => makeBorisBaby(x, y),
    ['idle', 'hover', 'dive', 'recover']);

  // Barrels (keys 7-8). Not AI-driven; no states.
  table.barrel = {
    name: 'Barrel', states: [],
    make: (x, y) => makeBarrel(x, y),
  };
  table.coinBarrel = {
    name: 'CoinBarrel', states: [],
    make: (x, y) => makeCoinBarrel(x, y),
  };

  // Random powerup (key 9). Spawns a random type from POWERUP_DEFS.
  table.powerup = {
    name: 'Powerup', states: [],
    make: (x, y) => {
      const types = POWERUP_TYPES;
      const t = types[Math.floor(Math.random() * types.length)];
      return new Powerup(t, x, y);
    },
  };

  Debug.spawnTable = table;
  return table;
}

// Key → spawn-id mapping for the free-spawn hotkeys (1-9).
export const SPAWN_KEYS = {
  Digit1: 'jester',
  Digit2: 'vine_hound',
  Digit3: 'violetta',
  Digit4: 'jackolantern',
  Digit5: 'boris_loon',
  Digit6: 'boris_loon_baby',
  Digit7: 'barrel',
  Digit8: 'coinBarrel',
  Digit9: 'powerup',
};
