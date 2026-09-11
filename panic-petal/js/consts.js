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
// Each entity sets `layer` to one or more of these bits; collision rules in
// js/collision.js AND the masks to decide whether a pair interacts.
export const LAYER = {
  NONE:       0b0000000000,
  HERO:       0b0000000001,
  ENEMY:      0b0000000010,
  BOSS:       0b0000000100,
  SOLID:      0b0000001000,   // platforms, barrels (destructible solids)
  PICKUP:     0b0000010000,   // powerups
  PROJ_ALLY:  0b0000100000,   // hero projectiles
  PROJ_FOE:   0b0001000000,   // enemy/boss projectiles
  COIN:       0b0010000000,
  CHECKPOINT: 0b0100000000,
  HAZARD:     0b1000000000,   // spikes, shockwaves, explosion AoE
};
