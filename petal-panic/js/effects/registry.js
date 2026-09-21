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
// Importing this module has one side effect per type: registering each
// migrated type. It is idempotent (registerEffect overwrites by key), so it
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
import { screenOverlay } from './screenOverlay.js';
import { spriteFlash } from './spriteFlash.js';
import { cameraShake } from './cameraShake.js';
import { spriteShakeStandalone } from './spriteShakeStandalone.js';
import { impactStar } from './impactStar.js';
import { debris } from './debris.js';
import { dustCloud } from './dustCloud.js';
import { compositeExplosion } from './compositeExplosion.js';
import { trail } from './trail.js';
import { afterimage } from './afterimage.js';
import { groundWave } from './groundWave.js';

// --- Migrated effects (task 2.1) ---------------------------------------------
registerEffect('hit-sparkle', hitSparkle);
registerEffect('death-sparkle', deathSparkle);
registerEffect('pickup-pop', pickupPop);
registerEffect('explosion', explosion);
registerEffect('particle-burst', particleBurst);
registerEffect('vignette', vignette);
registerEffect('screen-flash', screenFlash);
registerEffect('sprite-shake', spriteShake);

// --- M3 screen-space / overlay effects ----------------------------------------
registerEffect('screen-overlay', screenOverlay);
registerEffect('sprite-flash', spriteFlash);
registerEffect('camera-shake', cameraShake);
registerEffect('sprite-shake-standalone', spriteShakeStandalone);
registerEffect('impact-star', impactStar);

// --- M4 particle / burst effects -------------------------------------------------
registerEffect('debris', debris);
registerEffect('dust-cloud', dustCloud);
registerEffect('composite-explosion', compositeExplosion);

// --- M5 motion / ribbon effects -------------------------------------------------
registerEffect('trail', trail);
registerEffect('afterimage', afterimage);
registerEffect('ground-wave', groundWave);
