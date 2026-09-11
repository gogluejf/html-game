// Petal Panic — global tunable constants.
// All values are in logical units (960x540 space) unless noted.
// Tune freely; these are the "feel" knobs for physics and pacing.

// --- Physics ---------------------------------------------------------------

// Downward acceleration applied to entities with gravity > 0 (px/s²).
export const GRAVITY = 1500;

// Terminal velocity: vertical speed is clamped to this (px/s).
export const MAX_FALL_SPEED = 800;

// Horizontal friction / air drag factor per second (multiplied into vx).
// 0.98 at 60fps ≈ gentle air resistance; tune per entity later if needed.
export const AIR_DRAG = 0.995;

// --- Collision layers (bitmask) --------------------------------------------
// Each entity sets `layer` to one or more of these bits; collision checks
// AND the two masks to decide whether a pair interacts.
export const LAYER = {
  NONE:       0b00000000,
  PLAYER:     0b00000001,
  ENEMY:      0b00000010,
  PROJECTILE: 0b00000100,
  OBJECT:     0b00001000,   // barrels, coins, powerups, terrain
  HAZARD:     0b00010000,
};
