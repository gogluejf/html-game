// Attack Engine — Drawers (re-export barrel).
// Contract: (ctx, entity) => void
//
// Families:
//   projectile/  — straight-line shots
//   ballistic/   — gravity arcs (rock, bomb, fireball...)
//   zone/        — persistent area effects (fire, dust, spike...)

// Projectile
export { spreadDrawer } from './projectile/spread.js';
export { boomerangDrawer } from './projectile/boomerang.js';

// Ballistic
export { rockDrawer } from './ballistic/rock.js';
export { bombDrawer } from './ballistic/bomb.js';
export { molotovDrawer } from './ballistic/molotov.js';
export { circusBallDrawer } from './ballistic/circusBall.js';

// Zone
export { fireZoneDrawer } from './zone/fire.js';
export { dustZoneDrawer } from './zone/dust.js';
export { spikeDrawer } from './zone/spike.js';
