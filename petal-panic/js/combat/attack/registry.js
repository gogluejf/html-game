// Attack Engine — registration tables (Task 1.1).
//
// Two flat registries: primitives (single mechanical actions) and macros
// (named compositions of primitives). Registration is explicit — each
// primitive/macro module calls registerPrimitive/registerMacro at load time,
// and the engine's index files import them for their side effect. This keeps
// "add a new macro = one file + one registry entry" true without any build
// step or dynamic discovery.

/** @type {Map<string, object>} id → { impl, params?, meta? } */
const _primitives = new Map();
/** @type {Map<string, object>} id → { impl, params?, meta? } */
const _macros = new Map();

/**
 * Register a primitive.
 * @param {string} id            e.g. 'projectile'
 * @param {object} def           { impl(params, ctx) → handle, params?: defaultParams, meta? }
 */
export function registerPrimitive(id, def) {
  if (_primitives.has(id)) throw new Error(`attack: duplicate primitive '${id}'`);
  _primitives.set(id, def);
}

/**
 * Register a macro.
 * @param {string} id            e.g. 'spread_shot'
 * @param {object} def           { impl(params, ctx) → handle, params?: defaultParams, meta? }
 */
export function registerMacro(id, def) {
  if (_macros.has(id)) throw new Error(`attack: duplicate macro '${id}'`);
  _macros.set(id, def);
}

export function getPrimitive(id) { return _primitives.get(id) ?? null; }
export function getMacro(id) { return _macros.get(id) ?? null; }

/** All registered primitive ids, sorted (stable order for the Theater list). */
export function listPrimitives() { return [..._primitives.keys()].sort(); }
/** All registered macro ids, sorted. */
export function listMacros() { return [..._macros.keys()].sort(); }

/** Test helper: wipe both tables between suites. */
export function resetRegistries() {
  _primitives.clear();
  _macros.clear();
}
