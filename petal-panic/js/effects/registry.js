// Petal Panic — effect registrations for the migrated M2 effects.
//
// Home for wiring the per-effect factories (task 2.1) into the engine's
// registry so fire() can instantiate them. Each entry is one line; M3–M7 add
// their own types here the same way (one import + one registerEffect call).
//
// Type names follow the effects.md catalog / trigger-table vocabulary
// (kebab-case, e.g. 'particle-burst', 'screen-flash'). The engine core
// (index.js) stays free of any concrete effect imports — this module depends
// outward on both the engine and the effect files, so there is no circular
// import: index.js never imports back from here.
//
// Importing this module has exactly one side effect: registering the eight
// migrated types. It is idempotent (registerEffect overwrites by key), so it
// is safe to import more than once.

import { registerEffect } from './index.js';
import { hitSparkle } from './hitSparkle.js';
import { deathSparkle } from './deathSparkle.js';
import { pickupPop } from './pickupPop.js';
import { explosion } from './explosion.js';
import { particleBurst } from './particleBurst.js';
import { vignette } from './vignette.js';
import { screenFlash } from './screenFlash.js';
import { spriteShake } from './spriteShake.js';

// --- Migrated effects (task 2.1) ---------------------------------------------
registerEffect('hit-sparkle', hitSparkle);
registerEffect('death-sparkle', deathSparkle);
registerEffect('pickup-pop', pickupPop);
registerEffect('explosion', explosion);
registerEffect('particle-burst', particleBurst);
registerEffect('vignette', vignette);
registerEffect('screen-flash', screenFlash);
registerEffect('sprite-shake', spriteShake);
