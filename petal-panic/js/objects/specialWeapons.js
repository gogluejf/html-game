// Petal Panic — Special Weapon Registry (special-weapons.md).
//
// Single source of truth for every hero special weapon. Each entry is a plain
// data object; all code that needs to know "what is this weapon?" reads from
// here instead of branching on string literals. Adding a new weapon = append
// one object to SPECIAL_WEAPONS. No other file changes required.
//
// Fields:
//   id            – unique string key used in slots / collision checks
//   name          – display label (HUD, debug log)
//   icon          – placeholder glyph (real sprite later)
//   color         – debug / placeholder tint
//   speed         – launch speed px/s
//   damage        – raw damage per hit (before target defense)
//   lifetime      – seconds before auto-cull (saw) or fuse (bomb)
//   size          – collision box w/h (square)
//   fireCooldown  – seconds between shots of THIS weapon (hero-side gate)
//   gravity       – 0 = straight line, >0 = ballistic arc
//   solidBehavior – 'pass' | 'absorb' | 'bounce' (terrain interaction policy)
//   explode       – true if detonation triggers AoE (bomb); false otherwise
//   radius        – AoE blast radius (only meaningful when explode=true)
//   spread        – null | { count, angle } for multi-shot fan (spread weapon)
//                   count = number of projectiles, angle = total fan width (rad)

export const SPECIAL_WEAPONS = [
  {
    id: 'saw',
    name: 'Petal Saw',
    icon: '⚙',
    color: '#ff6ec7',
    speed: 800,
    damage: 25,
    lifetime: 0.6,
    size: 40,
    fireCooldown: 1 / 3,
    gravity: 0,
    solidBehavior: 'absorb',
    explode: false,
    radius: 0,
    spread: null,
  },
  {
    id: 'bomb',
    name: 'Bomb',
    icon: '💣',
    color: '#f39c12',
    speed: 550,
    damage: 40,
    lifetime: 1.5,
    size: 18,
    fireCooldown: 1,
    gravity: 800,
    solidBehavior: 'bounce',
    explode: true,
    radius: 100,
    spread: null,
  },
  {
    id: 'spread',
    name: 'Spread',
    icon: '•••',
    color: '#e67e22',
    speed: 800,
    damage: 10,
    lifetime: 0.4,
    size: 14,
    fireCooldown: 1 / 4,
    gravity: 0,
    solidBehavior: 'pass',
    explode: false,
    radius: 0,
    spread: { count: 3, angle: Math.PI / 3 }, // 3 shots, ±30° fan
  },
];

/** Ordered list of all valid special weapon ids. */
export const SPECIAL_TYPES = SPECIAL_WEAPONS.map(w => w.id);

/** Lookup map: id → weapon definition. O(1) access. */
export const specialById = Object.fromEntries(SPECIAL_WEAPONS.map(w => [w.id, w]));

/** True when `id` is a known special weapon type. */
export function isSpecialType(id) {
  return id != null && specialById[id] != null;
}
