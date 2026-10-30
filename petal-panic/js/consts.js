// Petal Panic — global tunable constants.
// All values are in logical units (960x540 space) unless noted.
// Tune freely; these are the "feel" knobs for physics and pacing.

// --- Physics ---------------------------------------------------------------

// Downward acceleration applied to entities with gravity > 0 (px/s²).
export const GRAVITY = 1500;

// Terminal velocity: vertical speed is clamped to this (px/s).
export const MAX_FALL_SPEED = 800;

// Impulse multiplier applied to the second (air) jump. The double jump is
// slightly weaker than the ground jump (design §4/§5). Single owner for the
// factor — hero.js launches with it and terrain.js derives tier reachability
// from it, so neither re-hardcodes the literal.
export const DOUBLE_JUMP_FACTOR = 0.85;

// Horizontal friction / air drag factor per second (multiplied into vx).
// 0.98 at 60fps ≈ gentle air resistance; tune per entity later if needed.
export const AIR_DRAG = 0.995;

// --- Time-to-live (TTL) -----------------------------------------------------
// Global multiplier for all entity TTLs. 1 = normal speed.
// Set via console: window.TTL_SPEED = 0.5 (slower expiry) or 2 (faster).
export let TTL_SPEED = 1;

// Default coin lifetime in seconds before it fades out if uncollected.
export const COIN_TTL = 8;

// --- Unit grid (single pixel-conversion point, pixel-hardcode-audit.md) -----
// Logical layout unit → px. X-unit = horizontal cell, Y-unit = vertical cell.
// SQUARE GRID CUTOVER: both axes are 48px — one square 48×48 cell everywhere.
// This is the single source of truth for the base grid; every consumer
// (runtime + macro editor) derives its scale from here.
// NOTE: movement/jump stats in heroDefs.js are authored as explicit PIXEL
// speeds (e.g. 250 px/s) divided by this constant so they stay unit-native.
// Changing the cell size rescales those derived unit values automatically —
// the underlying PIXEL measurements do not change (plan §"Physics").
export const UNIT_PX_X = 48; // horizontal cell width (px) — square grid
export const UNIT_PX_Y = 48; // vertical cell height (px) — square grid

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
  PLATFORM:   0b10000000000,  // one-way landing faces (thin; pass-through from below/sides)
};


// Supermove tuning (shared by hero runtime + validation)
export const SUPERMOVE_DUR = 0.6;
export const SUPERMOVE_BURST_FRAC = 0.6;
export const SUPERMOVE_SPEED = 920;
export const SUPERMOVE_RESIDUAL = 80;
