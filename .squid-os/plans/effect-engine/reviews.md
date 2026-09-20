# Reviews — effect-engine

Format: task → Review A (qwen3.8-27b, line-level) + Review B (openai-codex/gpt-5.6-sol, intent/doc-conformance) → resolution.

## Task 1.1 — Update effects.md to the data-object spec

**Review A:** PASS
- minor: effects.md:88 — trigger table row 25 "(experimental)" inconsistent with section 25 "out of scope for v1" scoping language

**Review B:** FAIL
- major: effects.md:30 — extensibility contract omits required demo (one file + one registration only)
- major: effects.md:69 — Trail/Afterimage "continuous while moving" activation outside fixed trigger vocabulary, no lifecycle semantics
- major: effects.md:526 — Beam orientation ambiguous: sampled at fire time vs follows hitbox every frame
- major: effects.md:540 — Beam origin default unspecified ("origin/corner"); no corner-selection/pivot/coordinate-space/facing rule

**Resolution:** ACCEPT (fix). Executor applied all five findings: consistent out-of-scope wording; demo added to extensibility contract; new Continuous Activation subsection defining `{ continuous: { condition } }` config shape + single-instance lifecycle (rows 6–7 updated); Beam origin captured once at fire time / orientation tracks hitbox continuously; Beam origin default = hitbox corner nearest carrier facing (center if no facing), world coords, orientation default = long axis (facing when square). Re-verify: greps pass, suite green. Committed.

## Task 1.2 — Effect core: registry, instance lifecycle, trigger bus

**Review A:** PASS (3 minor)
- minor: index.js:27 — CONTINUOUS_CONDITIONS duplicates spec vocabulary (accepted: engine validates known conditions; doc lists the current set)
- minor: test style — activeCount assertions could be tighter (accepted as-is)
- minor: unknown types silently ignored → fixed with console.warn + capture test

**Review B:** FAIL (3 major, 1 minor)
- major: index.js:144 — `fire(carrier, trigger)` reversed documented `fire(trigger, carrier)` contract
- major: index.js:164 — `fireManual` looked like a second public fire path
- major: index.js:224 — continuous tracking mutated carriers via `__effectId` (frozen carriers throw, ID collisions)
- minor: effectEngine.test.js:255 — reset coverage didn't prove continuous tracking state cleared

**Resolution:** ACCEPT (fix). fire() signature flipped to doc-conformant `fire(trigger, carrier, ctx)`; fireManual documented as the same spawn path per the doc's `manual` vocabulary entry (one mechanism); continuous tracking moved to a WeakMap keyed by carrier identity (zero carrier mutation, frozen-carrier test added); reset now proven to clear continuous state (new test); console.warn on unregistered types. Re-verify: 32/32 green ×3 runs. Committed.

Note: run-all.mjs has two pre-existing flaky files unrelated to this plan — contextualAim.test.js and barrel.solid.test.js each fail intermittently (~25%) even on the untouched baseline; both pass in isolation. Wave gates compare against baseline.txt with re-runs.

## Task 1.3 — Generic carrier interface for effect attachment

**Review A:** PASS (3 minor)
- minor: carrier.js:63 — makeCarrier dir dual input type (vector or radian) ambiguous → fixed vector-only
- minor: effectCarrier.test.js:5 — dead DT constant → now used
- minor: carrier.js:74 — zero-length dir silently falls back to +x → now surfaces via console.warn

**Review B:** FAIL (3 major)
- major: carrier.js:10 — contract required origin/facing/size though engine consumes only effects + isConditionMet; blocks arbitrary duck-typed carriers
- major: carrier.js:42 — rejects continuous-only declarations without `on`, contradicting effects.md "alongside or instead of discrete triggers"
- major: effectCarrier.test.js:107 — integration tests cover only makeCarrier objects, not projectile/hitbox/collision/marker/radius shapes

**Resolution:** ACCEPT (fix). Contract split into REQUIRED (effects; isConditionMet when continuous present) vs OPTIONAL geometry (origin/facing/size — consumed by effects like Beam, never by the engine); attachEffects accepts continuous-only entries (still rejects entries with neither); new Cross-kind section proves 5 plain-object carrier shapes fire through the real fire() path with zero engine change; dir vector-only; zero-length dir warns. Re-verify: 33/33 green (flake re-run confirmed pre-existing, see note above). Committed.

## Task 2.1 — Split the monolith into per-effect files

**Review A:** PASS (4 minor)
- minor: BLOOD_COLORS/FIRE_COLORS duplicated from monolith → shared palettes.js
- minor: magic numbers inline in pickupPop.js (100/80) and explosion.js (120/1.5) → named constants
- minor: decay tests only assert terminal zero → added mid-decay linear-curve assertion

**Review B:** FAIL (1 blocker, 3 major)
- blocker: index.js:42 — none of the 8 migrated factories registered; engine lookup cannot instantiate any migrated type
- major: spriteShake.js:38 — update never completes when carrier.hitFlash expires (inert instance forever)
- major: vignette.js:25 — negative strength not clamped to [0,1] as the monolith effectively did
- major: screenFlash.js:25 — same clamp gap

**Resolution:** ACCEPT (fix). New js/effects/registry.js registers all 8 types (kebab-case spec names mapped in one place; side-effect module, no circular imports) + effectsRegistry.test.js proves each resolves through real fire()/fireManual(); spriteShake marks done on hitFlash expiry; negative-strength clamp at fire time (both overlay effects); palettes.js single source for shared color arrays; magic numbers extracted; mid-decay epsilon assertion added. Re-verify: 35/35 green ×2. Committed.

## Task 2.2 — Re-point Effects.* API to the engine as a compat shim

**Review A:** FAIL (2 blocker, 1 major, 1 minor)
- blocker: effects.js:238 — Effects.update() advanced particles again; update.js already advances them → double/triple speed, half lifetime
- blocker: effects.js:247 — drawOverlay never passed viewW/viewH to instances → overlays silently invisible at runtime
- major: no shim-level end-to-end test (kick→step→read, drawOverlay mock ctx)
- minor: SHAKE_AMT duplicated between shim and spriteShake.js

**Review B:** FAIL (2 blocker, 2 major)
- blocker: effects.js:238 — same particle double-step (B counted three advances/frame given two Effects.update calls)
- blocker: effects.js:249 — drawOverlay ignores viewport dims, same root cause as A-blocker 2
- major: effects.js:249 — drawOverlay rendered only shim-tracked instances instead of delegating to engine drawEffects()
- major: effects.js:38 — SHAKE_AMT + jitter logic duplicate spriteShake.js (single-owner violation)

**Resolution:** ACCEPT (fix). Removed particles.updateAll from the shim's update() (pool advances exactly once per frame via update.js, proven by new test); drawOverlay now routes through the engine's drawEffects() with { view: { w, h } } ctx so declaratively fired renderable effects also complete their lifecycle; SHAKE_AMT exported from spriteShake.js as single owner, shim consumes it; new js/test/effectsShim.test.js (11 tests, fixed dt = 1/60): kick→step→read ≈0.5±ε after 15 frames, linear flash decay, never-lower merge rule, reset clears tracked overlays, drawOverlay issues real gradient/fill/alpha canvas calls via mock ctx, pool untouched by Effects.update, shake constant ownership. Re-verify: 36/36 green (barrel.solid pre-existing flake re-run clean ×3). Committed.

## Task 2.3 — Behavior-preservation regression for migrated effects

**Review A:** PASS (2 minor)
- minor: effect-reference.txt death-sparkle example "size=16 → 8" inconsistent with its own formula (yields 12) — reference-doc typo, test correctly asserts 12
- minor: effect-reference.txt explosion example "radius=20 → 12" inconsistent with formula (yields 15) — same class of typo

**Review B:** FAIL (3 major)
- major: effectRegression.test.js:55 — random-range asserts only check within-range; narrowed ranges would silently pass (exact bounds not locked)
- major: effectRegression.test.js:65 — death-sparkle max(4,...) floor never exercised
- major: effectRegression.test.js:96 — explosion speed range 120..(120+r·1.5) and FIRE/BLOOD palette values not asserted through the public shim

**Resolution:** ACCEPT (fix). Endpoint-coverage assertions over 2000 trials lock both extremes of hit-sparkle [60,140], pickup-pop [100,180], shake ±3px (flake prob ~e⁻⁵⁰; no seeded RNG in project); death-sparkle floor documented as unreachable-by-contract after verifying the monolith's param contract (caller passes Math.max(e.w,e.h)); explosion speed bounds + endpoint coverage added; BLOOD/FIRE palette-cycle tests import exact arrays from palettes.js (single source); both effect-reference.txt example typos corrected. Re-verify: 37/37 green (effectRegression alone 5× → 20/20 each; barrel.solid/contextualAim pre-existing flakes re-run clean). Committed.

## Wave 2 gate — M2 (2.1–2.3)

**Gate tests:** run-all.mjs 37/37 vs baseline 31/31 (+6 new suites/tests; no new failures). effectRegression.test.js 20→21 passed, deterministic, zero flakes ×5.
**Wave review (dual):** FAIL round 1 (1 blocker, 4 major, 1 minor):
- blocker: update.js legacy particles.spawnBurst/spawnOne/local spawnExplosionVFX sites + duplicated FIRE_COLORS/speeds helper
- major: duplicate Effects.update(dt) per frame → engine instances stepping twice
- major: vignette.js viewport dims factory-time only (draw-time view ignored)
- major: screenFlash.js same
- major: effectRegression probabilistic sampling instead of deterministic stubs
- minor: .plan-progress.json 2.3 status (verified already "done" — reviewer misread, no action)

**Fixes round 1:** all systems/ spawn sites re-pointed through Effects.* (grep particles.spawn* in systems/ now empty); duplicate Effects.update removed (one canonical call at update.js:1805); render(c2d, renderCtx) second arg threaded through index.js drawEffects so overlays prefer draw-time { view }; regression converted to fully deterministic Math.random stubs.
**Re-review:** FAIL (1 blocker, 1 minor):
- blocker: update.js:1429 — legacy explosion VFX used random 12–15 particles; re-pointing to the deterministic formula changed behavior (radius-scaled 12–24)
- minor: effects.md §Lifecycle still says render(ctx) while engine uses optional renderCtx second arg

**Fixes round 2:** explosion factory accepts optional params.count override (default = deterministic formula preserved); shim spawnExplosion(x, y, radius, count?) forwards it; all three former spawnExplosionVFX sites (bomb/enemy-death/barrel) roll the legacy `12 + floor(rand*4)` verbatim at the call site and pass explicit count; saw-fizzle + enemy-death sparkle confirmed already routed via Effects.fireParticleBurst; doc §Lifecycle updated to render(ctx, renderCtx?). New deterministic test pins the legacy roll (rand=0→12, rand=0.999→15 through the real shim path).
**Final gate verify:** 37/37 green (barrel.solid pre-existing flake re-run clean), effectRegression 21/21 ×5 zero flakes, no direct particles.spawn* in systems/. Gate commit: `effects: wave 2 gate`.

## Task 3.1 — Screen Overlay

**Review A:** PASS — No findings. (Spec §23 params/triggers/lifecycle all conform; single registration; conventions mirrored without copying; deterministic fixed-dt tests.)

**Review B:** FAIL (2 major, 2 minor)
- major: screenOverlay.js:40 — duration < fadeIn+fadeOut made actual lifetime exceed declared duration (doc defines duration as total lifetime); test codified the nonconformant behavior
- major: screenOverlay.test.js:123 — viewport tested via direct body.render(), not the documented fire → updateEffects → drawEffects(renderCtx) path
- minor: tests promoted viewW/viewH to params though §23 excludes them (viewport is renderCtx per Lifecycle)
- minor: registry.js:13 header still said "exactly eight types"

**Resolution:** ACCEPT (fix). Ramp scaling when fadeIn+fadeOut > duration so total lifetime always equals duration (doc §23 made explicit with one line); new end-to-end test proves draw-time viewport propagation through fireManual → updateEffects → drawEffects(mockCtx, {view}); viewW/viewH kept only as a clearly-labeled undocumented fallback (consistency with vignette/screenFlash), tests exercise renderCtx as primary; registry header now count-agnostic. Re-verify: 38/38 green. Committed.

## Task 3.2 — Sprite Flash

**Review A:** PASS (3 minor)
- minor: spriteFlash.js:41 — params.box fallback undocumented in §12
- minor: spriteFlash.js:57 — "Blend intensity" param listed in §12 not implemented
- minor: spriteFlash.test.js:48 — ±12 frame tolerance looser than rubric's exact-within-epsilon

**Review B:** FAIL (2 major)
- major: effects.md:306 — Blend intensity specified but neither implemented nor documented as absent
- major: spriteFlash.test.js:72 — ±12 frames around expectation of 6 lets grossly wrong cycle counts pass

**Resolution:** ACCEPT (fix). blendIntensity implemented as a real alpha-multiplier param (default 1.0 preserves behavior; effective alpha = opacity × blendIntensity clamped [0,1]) + documented in §12; params.box added to §12 param list (factory-time fallback geometry, world coords, no-op when absent); frequency test replaced with exact frame-set derivation at fixed dt (expected ON/OFF sets from the phase formula over frames 1..k−1, exactly 2*flashes−1 transitions, lifetime == 24 frames) + mutation test proving flashes=2 vs 3 yield different patterns. Re-verify: 39/39 green (spriteFlash 18/18 ×5 deterministic). Committed.

## Wave 1 gate — M1 (1.1–1.3)

**Gate tests:** run-all.mjs 33/33 vs baseline 31/31 (+2 new suites: effectEngine, effectCarrier; no new failures). Pre-existing flakes (contextualAim, barrel.solid) re-run clean.
**Wave review (dual):** PASS — No findings. Doc conformance, single mechanism, no duplication, behavior preservation (no game code touched), extensibility contract intact.
**Gate commit:** `effects: wave 1 gate`.
