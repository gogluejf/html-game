// Petal Panic — shared effect palettes (single source of truth).
// The pre-refactor monolith (js/effects.js) kept BLOOD_COLORS and FIRE_COLORS
// as private consts; the per-effect files () each need them. Rather
// than duplicate the arrays across hitSparkle.js / explosion.js, they live
// here so every consumer reads one copy. The monolith still exists until task
// 2.2 re-points it onto the engine; it may adopt these exports then.
// Pure data module — no DOM, no dependencies.

// Blood-like palette for projectile→enemy hit sparkles (hitSparkle).
export const BLOOD_COLORS = ['#e74c3c', '#c0392b', '#ff6b6b'];

// Warm fire palette for barrel/bomb explosion bursts (explosion).
export const FIRE_COLORS = ['#e74c3c', '#f39c12', '#ff6ec7', '#ffffff'];

// Muted earthy palette for ground dust puffs (dustCloud, catalog #20).
export const DUST_COLORS = ['#b8a88a', '#a09070', '#c8b89a'];
