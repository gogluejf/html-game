# EPIC: Effect Engine — parameterized, attachable visual effects
Why: Visual effects are currently hardcoded as ad-hoc Effects.* methods called at scattered sites in update.js, so adding or reusing an effect means new branching code and there is no way to attach an effect declaratively to a projectile, hitbox, collision, marker, or radius. We build a generic Effect Engine where every effect is a self-contained data object (type + params) that registers once, attaches to any carrier via config, and fires on a trigger event.
Outcomes: A registry-driven engine where each of the 25 catalog effects lives in its own file under js/effects/; existing effects are migrated behavior-preservingly; effects are attached by declarative config on carriers (projectile/hitbox/collision/marker/radius) and fire on trigger events; a debug-mode Effect Theater demos every implemented effect with name+id+live animation; adding a new effect is one file + one registration with no engine changes; effects.md becomes the conceptual spec with a trigger table and the new Beam effect.

## MILESTONE: 1 - Architecture Spec and Engine Core
Pattern: Registry + data-object effects + trigger bus (property-on-carrier, single fire path)
Objective: Make effects.md the conceptual source of truth (data-object framing, trigger table, Beam section, extensibility rules) and build the generic engine: an EffectRegistry, an EffectInstance lifecycle, a fixed trigger vocabulary, and a carrier interface that projectiles/hitboxes/collisions/markers/radii all satisfy.
Success: An effect is described as { type, params } and attached to any carrier via declarative config; the engine fires it on a declared trigger event through one code path; adding a new effect requires no engine change; effects.md documents the model, the trigger table, and Beam.
Diagram: graph TD
  A[Carrier declares effect config] --> B[EffectRegistry lookup by type]
  B --> C{trigger event fired}
  C --> D[spawn EffectInstance with params]
  D --> E[lifecycle update and draw each frame]
  E --> F{finished}
  F --> E
  F --> G[recycle instance]

### TASK: 1.1 - Update effects.md to the data-object spec
Type: doc
What: Rewrite petal-panic/docs/architecture/effects.md so it is the conceptual source of truth: reframe every effect as a data object { type, params } attached to a carrier and fired on a trigger event; add a trigger table mapping each effect to what fires it; add section 26 Beam (directional rectangular beam with an alpha-gradient lightsaber halo, flash-in then fade-out, oriented to its attached hitbox); mark Heat Distortion experimental/out-of-scope.
Why: The arch doc must win over code (like knockback.md) and define the extensibility contract that makes adding/consuming effects trivial.
Files: ~ petal-panic/docs/architecture/effects.md
Snippet: # effects.md additions\n## Effect Model\n// an effect = { type, params }; carriers attach via config:\n// carrier.effects = [ { on: 'collision', type: 'beam', params: {...} } ]\n\n## Trigger Table\n| effect | trigger(s) |\n| particle-burst | collision, death, explosion |\n| beam | attackActive (matches attached hitbox) |\n\n## 26. Beam\n// directional rect, alpha-gradient halo, flash-in then fade-out,\n// origin + orientation from attached hitbox
Acceptance: effects.md frames all effects as { type, params } data objects attached to carriers
Acceptance: a trigger table lists each catalog effect and its firing trigger(s)
Acceptance: section 26 Beam is present with params including length, width, gradient radius, color, flash-in time, fade-out time, origin, orientation-from-hitbox
Acceptance: Heat Distortion is marked experimental and out of scope for v1
Verification: grep -n "Beam" petal-panic/docs/architecture/effects.md
Verification: grep -n "Trigger" petal-panic/docs/architecture/effects.md

### TASK: 1.2 - Effect core: registry, instance lifecycle, trigger bus
Type: feature
What: Create petal-panic/js/effects/index.js defining the engine: an EffectRegistry (register(type, factory)), an EffectInstance wrapper giving each spawned effect a uniform update(dt)/draw(ctx)/done lifecycle driven only by its params, and a trigger bus where a carrier's declarative effects config [{ on, type, params }] is resolved against a fixed trigger vocabulary (collision, attackActive, damageTaken, pickup, death, explosion, stateChange, spawn).
Why: One generic mechanism means any carrier can attach any effect by data with zero per-effect or per-call-site branching, which is the whole point of the engine.
Files: + petal-panic/js/effects/index.js
Snippet: // effects/index.js — pure, no DOM\nexport const TRIGGERS = ['collision','attackActive','damageTaken','pickup','death','explosion','stateChange','spawn'];\nconst registry = new Map();\nexport function registerEffect(type, factory) { registry.set(type, factory); }\n// factory(params, ctx) -> { update(dt), draw(ctx), done }\nexport function fire(carrier, trigger, ctx) {\n  // for each cfg in carrier.effects where cfg.on === trigger:\n  //   spawn EffectInstance(registry.get(cfg.type)(cfg.params, carrier, ctx))\n}\nexport function updateEffects(dt) { /* step active instances */ }\nexport function drawEffects(ctx) { /* draw active instances */ }\nexport function resetEffects() { /* clear between runs */ }
Acceptance: registering a type then firing a matching trigger spawns an instance that updates and draws until done
Acceptance: a carrier with no matching trigger config produces no instance
Acceptance: unknown effect types are ignored without throwing
Acceptance: the module imports cleanly under node (no DOM required)
Verification: node petal-panic/js/test/effectEngine.test.js

### TASK: 1.3 - Generic carrier interface for effect attachment
Type: feature
What: Define the carrier contract so a projectile, hitbox, collision, marker, box, or radius can all carry effects: expose a shared shape (origin(), facing(), size(), and an effects config array) and a helper attachEffects(carrier, list) that normalizes config onto that shape, keeping it decoupled from any specific entity class.
Why: The animation-studio revision will later produce multi-box/multi-radius/multi-marker data; making the carrier interface generic now means those can attach effects later with no engine change.
Files: + petal-panic/js/effects/carrier.js
Snippet: // effects/carrier.js\n// A carrier satisfies: { origin(): {x,y}, facing(): {x,y}, size(): {w,h}, effects: [] }\nexport function attachEffects(carrier, list) {\n  // normalize list into carrier.effects = [{ on, type, params }]\n  // validate on is in TRIGGERS; drop unknowns\n}\nexport function makeCarrier({ x, y, w, h, dir }) {\n  // minimal adapter for ad-hoc geometry (markers/radii/boxes)\n}
Acceptance: attachEffects stores normalized config and rejects unknown triggers
Acceptance: makeCarrier builds a working carrier from plain geometry (for markers/radii/boxes)
Acceptance: fire() from index.js works on a carrier produced by makeCarrier
Verification: node petal-panic/js/test/effectCarrier.test.js

## MILESTONE: 2 - Migrate Existing Effects onto the Engine
Pattern: Behavior-preserving refactor (existing API becomes a thin shim over registered types)
Objective: Move the currently-implemented effects (hit sparkles, death sparkle, pickup pop, explosion burst, damage vignette, screen flash, enemy shake) into js/effects/ as registered data-object types and re-point the existing Effects.* public API to them so current update.js call sites keep working unchanged.
Success: Every existing effect renders identically through the engine; the Effects.* compat shim still satisfies all current call sites; a regression test proves output parity with the pre-refactor monolith.
Diagram: graph LR
  A[Effects dot spawnHitSparkles call site] --> B[compat shim in effects/index.js]
  B --> C[registry type hit-sparkle]
  C --> D[EffectInstance fires on trigger]
  D --> E[same particles as before]

### TASK: 2.1 - Split the monolith into per-effect files
Type: refactor
What: Create one file per currently-implemented effect under petal-panic/js/effects/ (particleBurst.js, explosion.js, pickupPop.js, deathSparkle.js, hitSparkle.js, vignette.js, screenFlash.js, spriteShake.js), each exporting a factory(params, carrier, ctx) implementing update/draw/done using only its params and the shared particle pool.
Why: One file per effect is the agreed layout and makes each effect independently demoable and extensible.
Files: + petal-panic/js/effects/particleBurst.js
Files: + petal-panic/js/effects/explosion.js
Files: + petal-panic/js/effects/pickupPop.js
Files: + petal-panic/js/effects/deathSparkle.js
Files: + petal-panic/js/effects/hitSparkle.js
Files: + petal-panic/js/effects/vignette.js
Files: + petal-panic/js/effects/screenFlash.js
Files: + petal-panic/js/effects/spriteShake.js
Snippet: // effects/hitSparkle.js\nexport function hitSparkle(params = {}, carrier, ctx) {\n  const { count, speed, colors } = params;\n  // spawn particles from pool exactly as the old Effects.spawnHitSparkles did\n  return { update(dt){}, draw(ctx){}, done: true };\n}
Acceptance: each migrated effect's particle counts/colors/timers match the old Effects.* values for identical params
Acceptance: no effect file imports another effect file (only index.js + particles.js)
Verification: node petal-panic/js/test/effects.test.js

### TASK: 2.2 - Re-point Effects.* API to the engine as a compat shim
Type: refactor
What: Replace the body of petal-panic/js/effects.js with a thin shim that registers the new per-effect types and forwards every existing Effects.* method (heroDamaged, bigExplosion, spawnHitSparkles, spawnDeathSparkle, spawnPickupPop, spawnExplosion, beginEnemyShake, getShakeOffset, update, drawOverlay, reset) to the engine, so systems/update.js and systems/render.js call sites are untouched.
Why: Preserves behavior and keeps the app exactly as it is while the engine takes over underneath (knockback-3.4 pattern).
Files: ~ petal-panic/js/effects.js
Snippet: // effects.js — now a compat shim over js/effects/\nimport { registerEffect, fire, updateEffects, drawEffects, resetEffects } from './effects/index.js';\n// register all migrated types at import\nexport const Effects = {\n  spawnHitSparkles(x,y,count){ /* fire('collision','hit-sparkle',{x,y,count}) */ },\n  heroDamaged(s){ /* set vignette via engine */ },\n  update(dt){ updateEffects(dt); },\n  drawOverlay(ctx,w,h){ drawEffects(ctx); },\n  // ... remaining methods forward similarly\n};
Acceptance: all existing Effects.* methods still exist with the same signatures
Acceptance: systems/update.js and systems/render.js require no changes
Acceptance: the old inline tunables live in the effect files or named constants, not duplicated
Verification: node petal-panic/js/test/run-all.mjs

### TASK: 2.3 - Behavior-preservation regression for migrated effects
Type: test
What: Add petal-panic/js/test/effectRegression.test.js asserting the refactored engine produces the same observable output as the pre-migration monolith for each migrated effect: identical particle counts/ranges, identical vignette/flash decay curves, and identical shake offset bounds.
Why: Proves the migration is behavior-preserving so existing game feel does not silently change.
Files: + petal-panic/js/test/effectRegression.test.js
Snippet: // capture reference values from the OLD monolith first (record in a baseline note)\n// then assert the engine path yields the same:\n//   spawnHitSparkles default count in [3,5]\n//   vignette decays to ~0.5 after 0.25s\n//   screenFlash decays to ~0.5 after 0.075s\n//   getShakeOffset stays within +/-3px
Acceptance: a regression test covers each migrated effect and passes against captured reference values
Acceptance: full suite is green vs baseline with no new failures
Verification: node petal-panic/js/test/effectRegression.test.js
Verification: node petal-panic/js/test/run-all.mjs

## MILESTONE: 3 - Screen-Space and Overlay Effects
Pattern: One file per effect, registered type with params + update/draw + theater demo
Objective: Implement the remaining screen-space and full-viewport overlay effects as individual registered types: Screen Overlay, Sprite Flash, Camera Shake, Sprite Shake (as a standalone type), Impact Star / Hit Pop. (Damage Vignette and Screen Flash are already migrated in M2.)
Success: Each new overlay/screen effect is a self-contained file that renders from params alone, is attachable via config, and plays a correct standalone demo in the theater.
Diagram: graph LR
  A[overlay effect config] --> B[registry type]
  B --> C[EffectInstance update and draw]
  C --> D[theater demo shows it standalone]

### TASK: 3.1 - Screen Overlay
Type: feature
What: Implement Screen Overlay as a registered type: a long-lived full-viewport tinted layer that fades in/out and can hold steady (unlike the brief Screen Flash), for danger states, boss phases, or environmental mood.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/screenOverlay.js
Snippet: // params: color, opacity, duration, fadeIn, fadeOut, blendMode\nexport function screenOverlay(p, c, ctx){ /* timed viewport fill */ }
Acceptance: renders a sustained viewport overlay whose opacity follows the declared fade curve
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 3.2 - Sprite Flash
Type: feature
What: Implement Sprite Flash as a registered type: temporarily flashes/tints an attached sprite's pixels (damage feedback, invincibility, charging) with configurable frequency and count.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/spriteFlash.js
Snippet: // params: color, duration, flashFrequency, flashes, opacity\n// attaches to a carrier sprite; toggles a tint each frame
Acceptance: tints the target sprite on/off at the declared frequency for the declared number of flashes
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 3.3 - Camera Shake
Type: feature
What: Implement Camera Shake as a registered type: shakes the game camera (world objects move together, HUD stable) with intensity, frequency, and decay for explosions, stomps, and heavy impacts.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/cameraShake.js
Snippet: // params: intensity, duration, frequency, hStrength, vStrength, decay\n// exposes getOffset(t) consumed by the camera transform
Acceptance: returns decaying random offsets within the declared strength bounds and zeroes after duration
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 3.4 - Sprite Shake (standalone)
Type: feature
What: Promote the existing hit-shake into a standalone registered type (separate from the hitFlash-driven shim): localized jitter on a single sprite without moving the camera, combinable with Camera Shake.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/spriteShakeStandalone.js
Snippet: // params: hIntensity, vIntensity, frequency, duration, decay\n// getOffset(t) -> {x,y} within bounds
Acceptance: jitters only the target sprite within bounds and stops after duration+decay
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 3.5 - Impact Star / Hit Pop
Type: feature
What: Implement Impact Star / Hit Pop as a registered type: a very short stylized star/burst/flash at the exact impact point for punches, kicks, bullets, and light impacts.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/impactStar.js
Snippet: // params: size, duration, rotation, opacity, style, scaleCurve\n// draws a scaling star shape at origin then pops out
Acceptance: draws a brief pop at the impact origin that scales and fades over the declared duration
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

## MILESTONE: 4 - Particle and Burst Effects
Pattern: One file per effect, pooled-particle driven, params-only rendering + theater demo
Objective: Implement the remaining particle/burst/debris effects as individual registered types: Debris, Dust Cloud, Composite Explosion Burst. (Particle Burst / Sparks and Explosion are already migrated in M2.)
Success: Each burst effect spawns its particles from a pure params object through the shared pool, is attachable via config, and demos correctly in the theater.
Diagram: graph LR
  A[burst effect config] --> B[registry type]
  B --> C[EffectInstance spawns into particle pool]
  C --> D[theater demo shows the burst]

### TASK: 4.1 - Debris
Type: feature
What: Implement Debris as a registered type: projects small visual fragments away from an impact or destroyed object with configurable count, velocity, gravity, rotation, and lifetime for barrels, scenery, enemies, and boss components.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/debris.js
Snippet: // params: fragmentCount, velocity, direction, gravity, rotation, lifetime, size\n// spawns rotating fragments into the pool
Acceptance: spawns the declared number of fragments with the declared velocity spread and gravity
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 4.2 - Dust Cloud
Type: feature
What: Implement Dust Cloud as a registered type: dust/smoke/small ground particles around a contact point for landings, running starts, slides, stomps, and impacts.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/dustCloud.js
Snippet: // params: particleCount, spread, size, velocity, lifetime, opacity, gravity\n// low-speed soft particles near the ground line
Acceptance: spawns soft low-velocity particles clustered at the contact point
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 4.3 - Composite Explosion Burst
Type: feature
What: Implement Composite Explosion Burst as a registered compositor: repeatedly spawns smaller child effects (explosion, particle burst, debris, flash) at randomized positions/times within an area for large boss deaths and chained explosions.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/compositeExplosion.js
Snippet: // params: radius, explosionCount, spawnInterval, timingVariance, posVariance, childType, childSizeRange, duration\n// on each interval, fire a child effect at a random point inside the area
Acceptance: fires the declared number of child effects over the duration at randomized positions within the area
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

## MILESTONE: 5 - Motion, Telegraph and Marker Effects
Pattern: One file per effect, geometry-driven (origin/facing/radius), params-only + theater demo
Objective: Implement the motion and telegraph/marker effects as individual registered types: Trail, Afterimage / Ghost Frames, Ground Wave, Shockwave, Telegraph Circle, Ground Target Marker, Target Reticle, Attack Arc / Slash.
Success: Each motion/telegraph/marker effect renders from a named spatial origin or attached carrier (box/radius/marker) using only its params, is attachable via config, and demos correctly in the theater.
Diagram: graph LR
  A[marker or box carrier] --> B[effect config on trigger]
  B --> C[registry type reads origin and facing]
  C --> D[EffectInstance draws trail arc ring or marker]

### TASK: 5.1 - Trail
Type: feature
What: Implement Trail as a registered type: a fading visual trail behind a moving entity for projectiles, missiles, dashes, and fast movement.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/trail.js
Snippet: // params: length, width, lifetime, opacity, density, offset\n// records recent positions of the carrier; draws a fading ribbon
Acceptance: draws a ribbon along the carrier's recent path that fades over the declared lifetime
Acceptance: registered with the engine and attachable to a carrier or marker/box/radius via config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 5.2 - Afterimage / Ghost Frames
Type: feature
What: Implement Afterimage / Ghost Frames as a registered type: temporary translucent copies of a moving sprite behind its current position for dashes, supermoves, and exaggerated speed.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/afterimage.js
Snippet: // params: count, spawnInterval, lifetime, opacity, fadeRate, offset\n// snapshots the carrier sprite at intervals; draws fading ghosts
Acceptance: leaves the declared number of fading ghost frames spaced by the declared interval
Acceptance: registered with the engine and attachable to a carrier or marker/box/radius via config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 5.3 - Ground Wave
Type: feature
What: Implement Ground Wave as a registered type: a horizontal wave traveling along the ground for stomps, earthquakes, and ground attacks, commonly paired with a moving collision volume.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/groundWave.js
Snippet: // params: direction, speed, distance, height, width, duration, style\n// advances a wavefront along the ground line
Acceptance: advances a visible wavefront the declared distance in the declared direction
Acceptance: registered with the engine and attachable to a carrier or marker/box/radius via config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 5.4 - Shockwave
Type: feature
What: Implement Shockwave as a registered type: a circular ring expanding rapidly outward from a point for explosions, boss impacts, stomps, and power releases.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/shockwave.js
Snippet: // params: startRadius, maxRadius, expansionSpeed, thickness, opacity, duration\n// grows a ring from origin to maxRadius then fades
Acceptance: expands a ring from startRadius to maxRadius at the declared speed then fades
Acceptance: registered with the engine and attachable to a carrier or marker/box/radius via config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 5.5 - Telegraph Circle
Type: feature
What: Implement Telegraph Circle as a registered type: a warning circle before an attack that can shrink toward its center as the countdown completes, for boss attacks, stomps, and area hazards.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/telegraphCircle.js
Snippet: // params: radius, duration, shrinkRate, opacity, thickness, followTarget\n// draws a pulsing/shrinking circle until the countdown ends
Acceptance: displays a shrinking/pulsing warning circle for the declared duration
Acceptance: registered with the engine and attachable to a carrier or marker/box/radius via config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 5.6 - Ground Target Marker
Type: feature
What: Implement Ground Target Marker as a registered type: a fixed target marker at a world ground position for missiles, falling objects, bombs, and artillery arriving from above.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/groundMarker.js
Snippet: // params: position, radius, duration, animation, rotation, pulseRate, opacity\n// draws a fixed pulsing marker at the position
Acceptance: shows a fixed pulsing marker at the declared position for the declared duration
Acceptance: registered with the engine and attachable to a carrier or marker/box/radius via config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 5.7 - Target Reticle
Type: feature
What: Implement Target Reticle as a registered type: a targeting reticle at an arbitrary XY position or following a moving entity for homing missiles, lock-on, and tracking attacks.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/targetReticle.js
Snippet: // params: target, duration, size, rotationSpeed, pulseRate, offset, followMode\n// follows the target entity or stays fixed per followMode
Acceptance: tracks the target entity (or holds position in fixed mode) with a rotating reticle
Acceptance: registered with the engine and attachable to a carrier or marker/box/radius via config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 5.8 - Attack Arc / Slash
Type: feature
What: Implement Attack Arc / Slash as a registered type: a fast visual arc representing the path of a melee attack for claws, blades, ribbons, cymbals, and sweeping attacks.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/attackArc.js
Snippet: // params: arcAngle, radius, thickness, duration, orientation, opacity, followEntity\n// sweeps an arc segment from the carrier origin/orientation
Acceptance: sweeps an arc of the declared angle and radius in the declared orientation
Acceptance: registered with the engine and attachable to a carrier or marker/box/radius via config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

## MILESTONE: 6 - Sprite-State and Beam Effects
Pattern: One file per effect, sprite/camera-driven, params-only + theater demo
Objective: Implement the remaining sprite-state effects and the new Beam: Fade Out, Scale / Pulse, Squash & Stretch, Aura / Glow, and Beam (a directional rectangular beam with an alpha-gradient lightsaber-style halo that appears like a camera flash then fades out, oriented to match its attached hitbox).
Success: Each sprite-state effect and Beam render from params alone, are attachable via config, and demo correctly in the theater; Beam aligns its orientation and origin to the hitbox it is attached to.
Diagram: graph LR
  A[hitbox carrier] --> B[beam config on trigger]
  B --> C[registry type beam reads hitbox origin and facing]
  C --> D[flash-in then fade-out gradient rect]

### TASK: 6.1 - Fade Out
Type: feature
What: Implement Fade Out as a registered type: gradually reduces a sprite or visual object's opacity until it disappears, after death animations, destroyed objects, or temporary entities.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/fadeOut.js
Snippet: // params: startOpacity, endOpacity, duration, delay, curve\n// ramps the target's draw alpha over time
Acceptance: reduces the target opacity from start to end over the declared duration after the delay
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 6.2 - Scale / Pulse
Type: feature
What: Implement Scale / Pulse as a registered type: temporarily grows and/or shrinks a visual element for charging attacks, pickups, warnings, power-ups, and impacts.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/scalePulse.js
Snippet: // params: startScale, maxScale, minScale, duration, pulseFrequency, loopCount\n// multiplies the target draw scale over time
Acceptance: scales the target between the declared bounds at the declared pulse frequency
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 6.3 - Squash and Stretch
Type: feature
What: Implement Squash & Stretch as a registered type: temporarily distorts a sprite's X/Y scale for landings, jumps, stomps, impacts, and exaggerated cartoon movement.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/squashStretch.js
Snippet: // params: xScale, yScale, duration, recoveryDuration, intensity\n// distorts then recovers the target's non-uniform scale
Acceptance: distorts the target along X/Y then recovers within the declared durations
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 6.4 - Aura / Glow
Type: feature
What: Implement Aura / Glow as a registered type: a glow or aura around or behind a sprite for invincibility, power-ups, boss states, charged attacks, and supernatural effects.
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/auraGlow.js
Snippet: // params: radius, opacity, pulseRate, intensity, color, duration, offset\n// draws a soft radial glow behind the carrier sprite
Acceptance: renders a pulsing radial glow of the declared radius/color behind the target
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

### TASK: 6.5 - Beam
Type: feature
What: Implement Beam as a registered type: a directional rectangular beam with an alpha-gradient halo (lightsaber-style) that appears like a camera flash then fades out; its origin and orientation are read from the attached hitbox (carrier.origin()/facing()).
Why: Extends the catalog so the effect is consumable by config and demoable in the theater.
Files: + petal-panic/js/effects/beam.js
Snippet: // params: length, width, gradientRadius, color, flashInTime, fadeOutTime\n// reads carrier.origin() + carrier.facing();\n// phase 1 flash-in (bright core + expanding halo), phase 2 fade-out\n// draws a rotated rect with a radial/linear alpha gradient halo
Acceptance: aligns its rectangle origin and direction to the attached hitbox's origin and facing
Acceptance: registered with the engine and attachable via carrier config
Acceptance: has a standalone theater demo driven only by params
Verification: node petal-panic/js/test/effectCatalog.test.js

## MILESTONE: 7 - Effect Theater and Handoff
Pattern: Debug-mode overlay, catalog-ordered stepper, kbd + gamepad input, declarative demo per effect
Objective: Build the debug-mode Effect Theater that steps through every implemented effect in catalog order showing name, id/type, and a live standalone demo; wire it to a new debug shortcut with keyboard and gamepad navigation; document the effect-config shape in entity YAML; run the full suite green vs baseline as the final gate.
Success: A debug shortcut opens a black-screen theater; left/right (keyboard and gamepad) steps all 25 implemented effects each showing name+id+live demo; Esc or gamepad cancel returns to debug mode and F1 exits to gameplay; effects.md and YAML reflect the shipped engine.
Diagram: graph TD
  A[debug shortcut pressed] --> B[theater opens black screen]
  B --> C[show current effect name id and demo]
  C --> D{left or right}
  D --> E[next effect index]
  E --> C
  C --> F{esc cancel or f1}
  F --> G[back to debug or gameplay]

### TASK: 7.1 - Per-effect theater demos
Type: feature
What: Give every registered effect a small self-contained demo() that renders it standalone on a neutral stage (a basic collision-to-effect animation or whatever fits the effect), driven only by its params, so the theater can play any effect uniformly without real gameplay entities.
Why: The theater needs one uniform way to preview each effect; keeping the demo inside the effect file keeps adding an effect = one file.
Files: ~ petal-panic/js/effects/index.js
Snippet: // each factory also exposes: demo(stage, t) -> draws the effect at time t\n// index.js collects [ { type, name, demo } ] in catalog order for the theater\nexport function theaterList() { return orderedDemos; } // skips Heat Distortion
Acceptance: every implemented effect (all except Heat Distortion) exposes a working demo()
Acceptance: theaterList() returns effects in catalog order §1→§24 then Beam
Acceptance: each demo runs from params alone with no real entity required
Verification: node petal-panic/js/test/effectTheater.test.js

### TASK: 7.2 - Effect Theater overlay + debug shortcut
Type: feature
What: Add the Effect Theater as a debug-mode overlay: a new debug key (alongside L/U/G/T) opens it; the screen goes fully black with a title; left/right (keyboard arrows AND gamepad d-pad/left-stick via the existing input remap) steps the current effect index; the current effect's name and id/type are displayed while its demo plays; Esc or gamepad cancel returns to debug mode; F1/F2 exits debug entirely back to gameplay.
Why: This is the requested tool to visually inspect every effect's name, id, and behavior in one place.
Files: + petal-panic/js/effects/theater.js
Files: ~ petal-panic/js/debug.js
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/systems/render.js
Snippet: // theater.js\nexport const Theater = {\n  open(){ /* set active, reset index to 0 */ },\n  close(){ /* clear active */ },\n  step(dir){ this.index = clamp(this.index + dir); restart current demo clock */ },\n  update(dt){ /* advance current demo clock */ },\n  draw(ctx,w,h){ /* black fill, title, name + id, run current demo */ }\n};\n// debug.js: register a new key (e.g. KeyE) -> if(Debug.enabled) Theater.open()\n// update.js: while Theater.active, route left/right/cancel to Theater.step/close;\n//   F1/F2 still toggles Debug off (exits to gameplay)
Acceptance: pressing the debug shortcut during debug mode opens the black-screen theater
Acceptance: left/right via keyboard AND gamepad moves to the previous/next effect
Acceptance: the current effect's name and id/type are shown while its demo plays
Acceptance: Esc or gamepad cancel closes the theater and returns to debug mode
Acceptance: F1/F2 exits debug mode entirely back to gameplay even from the theater
Verification: node petal-panic/js/test/effectTheater.test.js

### TASK: 7.3 - Document effect config in entity YAML
Type: doc
What: Add an effects block to the relevant entity YAML files showing the attachable config shape ({ on, type, params }) and concrete examples (e.g. a projectile carrying hit-sparkle on collision, an attack hitbox carrying beam on attackActive), matching the actual field names from the implementation.
Why: YAML must reflect the engine so designers can attach/tune effects without reading JS, mirroring how knockback was documented.
Files: ~ petal-panic/docs/engine/base/projectile.yaml
Files: ~ petal-panic/docs/engine/base/hero.yaml
Snippet: # projectile.yaml\neffects:\n  - { on: collision, type: hit-sparkle, params: { count: 4 } }\n# hero.yaml — attack hitbox\neffects:\n  - { on: attack_active, type: beam, params: { length: 260, width: 18, color: '#7df' } }
Acceptance: YAML effects blocks match the implemented config field-for-field
Acceptance: at least one projectile and one hero attack example are present
Verification: grep -rn "effects:" petal-panic/docs/engine

### TASK: 7.4 - Final regression + scope handoff
Type: chore
What: Run the full suite green vs baseline, confirm effects.md matches the implemented engine (model, trigger table, Beam, extensibility rules), and record what is deferred (Heat Distortion, wiring effects onto future multi-box/radius/marker data) so the next epic picks it up cleanly.
Why: Closes the epic with a clean gate and an explicit handoff of deferred work.
Files: ~ petal-panic/docs/architecture/effects.md
Acceptance: full test suite passes at or better than baseline
Acceptance: effects.md scope note reflects exactly what shipped (25 implemented, Heat Distortion deferred)
Acceptance: the carrier interface is documented as ready for future marker/box/radius attachment
Verification: node petal-panic/js/test/run-all.mjs
