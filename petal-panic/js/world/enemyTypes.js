// Petal Panic — enemy type registry (typed spawn, plan task 1.2 / 2.1).
//
// LEAF MODULE: no imports. This is the single source of truth for "which enemy
// types exist" — an ordered [{id, label}] list plus lookup helpers. It lives in
// its own file so both world/build.js (factory map) and world/macros.js (typed
// spawn resolution) can import it WITHOUT creating a module cycle:
//   macros.js → enemyTypes.js ← build.js → level.js → macros.js
// would TDZ-crash if the ids lived in build.js (macros.js already sits at the
// bottom of that chain via terrain.js/level.js).
//
// The `make` factory functions stay in build.js (they need the Enemy classes);
// this module only carries the declarative id/label data.

/** Ordered list of all spawnable enemy types — {id, label}. Ids must match
 * ENEMY_FACTORIES keys in world/build.js exactly. */
export const ENEMY_TYPES = [
  { id: 'jester',              label: 'Jester' },
  { id: 'explosive_monkey',    label: 'Explosive Monkey' },
  { id: 'vine_hound',          label: 'Vine Hound' },
  { id: 'violetta_marionetta', label: 'Violetta Marionetta' },
  { id: 'jackolantern',        label: 'Jack-O-Lantern' },
  { id: 'boris_loon',          label: 'Boris Loon' },
  { id: 'boris_loon_baby',     label: 'Boris Loon Baby' },
];

/** Enemy type ids only (stable order) — for enum option lists. */
export const ENEMY_TYPE_IDS = ENEMY_TYPES.map((t) => t.id);

/** Lookup map: id → enemy meta. O(1) access. */
export const enemyById = Object.fromEntries(ENEMY_TYPES.map((t) => [t.id, t]));

/** True when `id` is a known enemy type. */
export function isEnemyType(id) {
  return id != null && enemyById[id] != null;
}
