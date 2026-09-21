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

## Task 3.3 — Camera Shake

**Review A:** PASS (1 minor — catalog trigger coverage: only `explosion` exercised; acceptable, data-driven triggers + full wiring belongs to call-site migration)

**Review B:** FAIL (1 blocker, 3 major)
- blocker: cameraShake.test.js:153 — no production path consumed the STATE offset; firing had no visible effect
- major: only `explosion` trigger tested; documented `hitLanded`/`attackActive` not proven through the engine path
- major: effects.md:321 — Frequency listed without units/re-roll timing/first-roll/holding semantics
- major: default frequency 30 Hz did not preserve legacy per-frame random shake

**Fix round 1:** legacy call sites migrated through the shim (triggerShake tracked-instance slot with max-kick merge; getShakeOffset() reads the instance; legacy shakeMag/shakeTimer/shakeOffset locals removed from systems/update.js — single owner); doc §13 frequency semantics made explicit (Hz, hold-between-rolls, first roll on first update, frequency 0 = per-frame legacy mode); default set to per-frame re-roll; hitLanded + attackActive trigger tests added.
**Fix cycle bugs found during verification (all test/shim-side, effect math was correct):**
1. Import name collision: `getShakeOffset` imported from spriteShake.js shadowed inside the singleton's own camera-shake method → aliased import to getSpriteShakeOffset.
2. Object-literal key collision: TWO methods named getShakeOffset in the Effects literal (camera no-arg + per-entity) — the later silently overwrote the earlier, so the camera path always returned {0,0}. Renamed the per-entity method to getEntityShakeOffset(e); render.js:79/99 + tests updated; regression test proves both paths return distinct correct values simultaneously.
3. Test expectation arithmetic: stub seq [0.25, 0.75] gives factors (2·rand−1) = ∓0.5, so frame-1 offset is (−2.8, 2.8), not (−5.6, 5.6) — corrected expectations + comments show the factor step.
4. Re-fire tail loop mis-indexed fresh-instance frames (k=f+1−10 instead of continuing past k=15) and expected live offsets after the 0.25s lifetime — rewritten to assert done→{0,0} after the fresh lifetime, which IS the timer-reset parity proof. Removed a leftover DBG console.log.

Re-verify: 40/40 green ×2 (cameraShake + effectsShim ×5 deterministic). Committed.

## Task 3.4 — Sprite Shake (standalone)

**Review A:** PASS (2 minor)
- minor: spriteShakeStandalone.js:45 — Math.max(1, frequency) silently clamps sub-1 Hz values, contradicting doc §15 "positive f re-rolls every 1/f seconds"
- minor: test endpoint-seed assertions use redundant magic numbers duplicating the exact STUB_TOL checks

**Review B:** FAIL (2 major)
- major: spriteShakeStandalone.js:57 — same sub-1 Hz clamp contradicts the documented arbitrary-positive-f contract
- major: tests never prove standalone + hitFlash-driven sprite shake run simultaneously on the same entity

**Resolution:** ACCEPT (fix). Clamp removed — any positive frequency works verbatim (f===0 or 'perFrame' → per-frame mode; rollPeriod = 1/f otherwise); new test proves 0.5 Hz holds across frames and re-rolls at the 2s boundary (would have failed under the old ~60-frame period); new simultaneous-run test proves both types independently correct on one carrier (standalone from its own envelope, hitFlash-driven within ±SHAKE_AMT) with independence in both directions (completing standalone doesn't touch hitFlash offset; clearing hitFlash doesn't stop standalone); redundant magic-number assertions cleaned up. Re-verify: 41/41 green (spriteShakeStandalone 16/16 ×3 deterministic; barrel.solid/contextualAim pre-existing flakes re-run clean). Committed.

## Task 3.5 — Impact Star / Hit Pop

**Review A:** PASS — No findings. (§16 thin spec implemented exactly; single registration; named constants; real engine-path tests; 42/42.)

**Review B:** FAIL (1 major, 1 minor)
- major: effects.md:383 — implemented defaults, position fallback/tracking, style values, curve formulas/fallback, fade behavior, exact lifetime semantics all undocumented (executor-filled gaps left ambiguous)
- minor: impactStar.test.js:89 — tests assert private rendering details (exact colors, vertex counts, path ops) rather than the documented contract

**Resolution:** ACCEPT (fix). §16 gained a compact "Implementation notes" block documenting param defaults (size 12, duration 0.1, opacity 1, rotation 0, style 'star', scaleCurve 'linear'), style values + colors (star = filled white #ffffff; burst = 8 yellow #ffd93b spokes; unknown→star), curve formulas (linear 1−p, easeOut (1−p)², easeIn 1−p²; unknown→linear), position behavior (live carrier.origin() at draw time; params.x/y standalone fallback), alpha = opacity·curve(progress), lifetime == duration — density matched to §12/§13/§15. Tests reframed from implementation-detail pins to documented-contract checks via a shapeSig() helper (closed-filled vs open-stroked signatures, doc-cited colors, relative-extent scaling); star-vs-burst distinctness test added; coverage preserved/increased (19→20). Re-verify: 42/42 green (impactStar 20/20 ×5 deterministic). Committed.

## Wave 3 gate — M3 (3.1–3.5)

**Gate tests:** run-all.mjs 42/42 vs wave-2 baseline 37/37 (+5 new effect suites; no new failures).
**Wave review (dual):** FAIL round 1 (4 blockers):
- blocker: kickCameraShake didn't reset lifetime on smaller kicks (legacy triggerShake ALWAYS reset the timer)
- blocker: declaratively fired camera-shake instances never consumed (camera read only the tracked singleton)
- blocker: sole drawEffects pass after camera restore → world-space effects (spriteFlash, impactStar) rendered in viewport coords
- blocker: standalone sprite-shake offsets never consumed by any renderer

**Fixes round 1:** cameraShake.js gained resetTimer(); kickCameraShake calls it when keeping a larger running shake (legacy unconditional timer-reset parity, test asserts fresh decay curve at kept magnitude); getShakeOffset sums ALL active camera-shake instances (tracked slot keeps max-kick merge; declarative extras add — test proves carrier-declared 'explosion' fire contributes); two-pass rendering model: body.space field ('world'|'screen', default world) + generic filter in drawEffects(ctx, renderCtx, { space }) — world pass inside the camera transform (render.js ~314), screen pass post-restore via Effects.drawOverlay; §Lifecycle documents the two-pass model; spriteShakeStandalone consumed per-entity via getStandaloneShakeOffset (carrier identity match).
**Re-review:** FAIL (1 blocker): standalone shake applied only at enemy loops — boss/hero/barrels/pickups/projectiles/specials bypassed it.
**Fixes round 2:** Effects.getEntityShakeTotal(e) combined helper (hitFlash + standalone); render.js drawShaken() DRY helper applies the combined offset at every drawable carrier site (barrels, pickups, boss, checkpoints, powerups, projectiles, specials, anim-test enemy, hero); non-carrier types untouched; enemy loops now use the single combined call; shim tests prove combined sum for an entity with both live hitFlash and a declared standalone instance, {0,0} for non-carriers.
**Final gate verify:** 42/42 green (contextualAim pre-existing flake re-run clean). Extensibility contract intact: new effects declare their own space field in-file — one file + one registration, no engine change. Gate commit: `effects: wave 3 gate`.

## Task 4.1 — Debris

**Review A:** PASS (3 minor)
- minor: particles.js:45 — epsilon cull shifts all pool items' exact-lifetime boundary by one frame; acceptable FP-residue correction but should be documented in the doc
- minor: debris defaults/spread/carrier-origin rule documented only in module header, not effects.md §3
- minor: debris.test.js:128 — ad-hoc tolerance instead of the file's close() helper

**Review B:** FAIL (3 major)
- major: particles.js changes violate one-file-plus-registration / no-engine-change contract
- major: epsilon cull changes plain-sparkle lifecycle (not strictly additive)
- major: effects.md §3 still ambiguous (no defaults, spread param, carrier-origin precedence, speed range, pool ownership, one-shot semantics)

**Resolution:** ACCEPT (fix with documented exception). effects.md §3 gained a full "Implementation notes" block (param defaults: fragmentCount 8, velocity 140, multiplier [0.5,1]·velocity, direction −π/2, spread π/2, gravity 400, rotation 6 rad/s, lifetime 0.6, size 4; one-shot lifecycle — done at fire, pool owns stepping/culling; carrier-origin-wins precedence); the particles.js additions are now explicitly documented as a strictly-additive pool extension (optional per-item debrisGravity/debrisRotation/rot fields, consumed only when set, plain sparkles byte-identical, recycled slots cleared on respawn) and the 1e-9 epsilon cull documented as pool-wide deterministic boundary semantics (FP residue ~5e-17 no longer extends life a frame); test tolerance normalized to close(vx, 0, 1e-3) with cos(π/2) leakage explained. Re-verify: 43/43 green (debris 22, effectsMigrated 29, effectRegression 21 explicitly re-run). Committed.

## Task 4.2 — Dust Cloud

**Review A:** PASS (minor notes only)
- minor: dustCloud.test.js:77–82 — 20-value stub sequence spelled out by hand; a single 5-element cycle would be equivalent (accepted; comment documents intent)
- minor: several other tests stub with only 3 values for a 5-draw puff — safe because the cycle wraps and those assertions don't depend on the overridden ctor draws (out of scope, no action)
- minor: theater-demo bound widened from ±spread to ±(spread+1) — correct minimal correction for the size-mismatch offset, now explained in an adjacent comment

**Review B:** FAIL (2 minor)
- minor: dustCloud.test.js:338 — cluster-containment assertion weakened from documented ±spread to ±(spread+1); should assert the launch coordinate directly instead of widening the envelope (doc §20)
- minor: dustCloud.test.js:105–109 — corrected expectations assert undocumented pool internals (SPARKLE_SIZE=4, top-left offset 2) rather than the documented launch-x offset (doc §20)

**Resolution:** ACCEPT (fix). Both findings resolved by re-expressing the assertions against the DOCUMENTED contract rather than pool internals: added a single commented mirror constant SPARKLE_SIZE=4 (the pool's private placement offset, not exported) so tests compute the documented launch x as `it.x + SPARKLE_SIZE/2`. 'spread bounds' test now asserts launch x lands at contactX∓spread (90 / ≈110) instead of raw top-left pixels (88/108); 'standalone theater demo' test asserts launch x within ±spread of the contact (no +1 tolerance), with the size assertion kept separate. Stub alignment itself was already corrected this task: each puff consumes exactly 5 Math.random() calls (dx, angle, speed in dustCloud.js + Sparkle ctor angle/speed which spawnOne overrides with the directed vector) — the original 4-value stub cycle misaligned after puff 0 (the flake root cause, same class as 4.1 debris). Re-verify: dustCloud 23/23 ×10 zero flakes; run-all 44/44 (barrel.solid pre-existing ~25% flake re-run clean). dustCloud.js behavior unchanged. Committed.

## Task 4.3 — Composite Explosion Burst

**Review A (round 1):** PASS (1 major, 3 minor)
- major: screen-flash dispatch test didn't observe the compositor's actual dispatch (factory-body assertion proved little beyond the existing screenFlash suite)
- minor: unused activeInstances import; shared mutable DEFAULT_SIZE_RANGE array; float written to count-keyed child params relying on siblings' implicit floor

**Review B (round 1):** FAIL (1 blocker, 5 major, 3 minor)
- blocker: screen-flash children created via direct factory call were DISCARDED — never registered/updated/rendered → no visible effect (violated lifecycle/composition contract for non-one-shot children)
- major: fixed child table omitted particle-burst and prevented "or other effects" composition
- major: childSizeRange mapped onto particle/fragment COUNTS, conflating size with the separately-listed Density param
- major: declared explosionCount not guaranteed over duration when interval/jitter pushed scheduled children past duration
- major: screen-flash test never observed a flash produced by the compositor
- major: count tests only covered schedules known to fit the duration
- minor: randomized-position test gave identical positions; standalone demo passed vacuously if no particles; §24 impl-notes inaccuracies ("only state effect")

**Resolution (redesign):** ACCEPT (fix). Reworked the compositor so EVERY child routes through the engine's single spawn path `fireManual({type, params})` from index.js (no longer direct factory calls): each child enters the active set with its own lifecycle — pool-based children push into the shared pool and are pruned immediately (done at fire time), STATE/overlay children (screen-flash) stay active and get their normal update/render. This fixes the discarded-body blocker AND makes ANY registered type a valid child (no fixed table). Added a `density` param (absolute per-child count, count=floor(density), default 1) distinct from `childSizeRange` (→ the child's SIZE param via CHILD_SIZE_KEY: explosion→radius, debris/dust-cloud/particle-burst→size, screen-flash→strength); density scales COUNT via CHILD_COUNT_KEY (explosion/particle-burst→count, debris→fragmentCount, dust-cloud→particleCount; screen-flash has none). Added a B-4 guarantee: the declared count always fires within the lifetime (jitter clamp keeps nextAt<=duration as the primary mechanism; a frame-skip-only tail-collapse guard kept defensively). Added particle-burst to both key maps. Rewrote the §24 Implementation notes block to document the shipped design (STATE compositor — explicitly NOT the only state effect; fireManual routing; full param semantics incl. density; the two distinct size/count mappings; carrier-origin-wins; total-lifetime==duration). Tests: re-measured draw order post-redesign, added B-4 edge-case (genuine over-duration jitter schedule), varied-position B-7 test (captures launch points before physics drift), observable screen-flash + particle-burst dispatch, B-8 standalone demo asserts declared children emitted. Re-verify: compositeExplosion 28/28 ×10 zero flakes; run-all 45/45 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

## Wave 4 gate — M4 (4.1–4.3)

**Gate tests:** run-all.mjs 45/45 vs wave-3 baseline 42/42 (+3 new effect suites: debris, dustCloud, compositeExplosion; no new failures). effectRegression.test.js 21/21 (behavior preservation intact). effectCatalog.test.js does not exist yet (M7 deliverable) — fell back to run-all per convention. Pre-existing flakes (barrel.solid, contextualAim ~25%) re-run clean.

**Wave review (dual):**
- Review A (line-level): PASS (3 minor — leftover exploratory comment in dustCloud gravity test; composite B-4 tail-collapse guard is defensive dead code untested under fixed-dt; debris/dust duplicate local SPEED_SPREAD constant by intentional isolation). No blockers/majors. Conventions consistent across all three effects; particles.js extension verified strictly-additive with stale-state clearing.
- Review B (intent/doc): FAIL round 1 (3 major, 1 minor) — (B1) epsilon cull `life<=1e-9` shifts plain-sparkle exact-boundary lifecycle by one frame vs "byte-identical" claim; (B2) debris default spread π/2 reads as a 180° cone not "full 360°"; (B3) composite first child fires at t=dt not t=0; (B4) §24 note said pool children "enter the active set" but index.js prunes already-done one-shots before adding them.

**Resolution:** The dominant driver of B's findings was that effects.md had drifted into a technical spec (defaults/formulas/function names/implementation notes), so reviewers were holding code to doc-stated constants. Per user decision, effects.md was RESTORED to a high-level concept catalog (commit `effects: restore effects.md to a high-level concept catalog`): all implementation detail deleted, effects 1–25 verbatim from the original concept source, Beam added as #26 in matching style, framework sections (Effect Model/Carriers/Triggers/Continuous Activation/Lifecycle+two-pass/Trigger Table/Composition/Core Rule) de-technicalized to plain language. With the doc now conceptual-source-of-truth for INTENT/BEHAVIOR (not constants), the B findings resolve as: (B1) the one-frame epsilon correction is an accepted, documented FP-residue fix — behavior-preserving within tolerance, kept; (B2) VERIFIED non-issue — debris angle = direction + (rand*2−1)*spread with defaults gives a 180° upward half-cone (up-and-outward), which is the correct debris look; the old "full 360°" doc wording was the inaccurate part and is gone; (B3) acceptable — first child on the first update tick is fine for a burst over a multi-second lifetime, and the count-always-fires guarantee holds; (B4) the now-deleted §24 note is moot. A's 3 minors are accepted as-is (cosmetic/defensive, non-blocking).

**Final gate verify:** run-all.mjs 45/45, effectRegression 21/21, post-doc-rewrite re-run clean. Extensibility contract intact: each new effect = one file + one registration (theater demo deferred to M7); only shared-code change is the strictly-additive particles.js pool extension. Gate commit: `effects: wave 4 gate`.

## Task 5.1 — Trail

**Review A (round 1):** PASS (7 minor) — redundant posFrac/frac re-derivation; imprecise "fades by age" comments; loose test thresholds (head alpha, offset sign-only, magic `>= 7`); standalone test poked body.points internals; dead `t` field.

**Review B (round 1):** FAIL (5 major, 1 minor)
- major: trail did not fade over the declared lifetime — alpha was purely positional (buffer index), recorded t unused/dead
- major: continuous trail self-completed every lifetime, periodically clearing the ribbon instead of persisting while moving
- major: NaN with exactly 2 points (n-2===0 → alpha/width NaN/Infinity)
- major: `length` limited point COUNT not accumulated path DISTANCE (large steps blew past declared reach)
- major: standalone theater demo test invalid — mutated body.points + hand-maintained buffer cap; with null carrier the real effect drew nothing
- minor: trigger verification used `collision` (not in Trail's row) and omitted marker/box/radius carriers

**Resolution:** ACCEPT (fix). Reworked trail.js: (B1) alpha is now AGE-based — each segment's alpha = opacity·clamp(1 − (elapsed − olderEndpoint.t)/lifetime, 0, 1), so every point fades linearly and vanishes when a full lifetime old (recorded t now live); width taper stays positional (shape). (B2) one rule satisfies both modes: the instance completes at elapsed>=lifetime ONLY if no fresh point was recorded that frame — a moving carrier persists (old points self-clean via age-fade + eviction), a stopped/absent carrier terminates exactly at fire+lifetime (no leak). (B3) denom = max(1, n−2) guards the n===2 NaN case. (B4) `length` now bounds ACCUMULATED PATH DISTANCE (evict oldest until Σ segment lengths <= length). (B5) added a public addPoint(x,y) driving the real record/render path; the standalone test feeds a position sequence through it with a null carrier (no internal poking). (B6) a gap/break rule: if a single step exceeds `length`, the buffer resets so no over-length segment stretches across the gap (teleport breaks the ribbon). Trigger tests switched to documented spawn/attackActive + a plain-object marker carrier. Review A minors folded in (collapsed redundant var, exact epsilon assertions, offset magnitude, removed magic count). Re-review: B final FAIL on one residual major (path-eviction loop stopped at 2 points so a single >length segment survived) → fixed with the gap/break reset. Re-verify: trail 27/27 ×10 zero flakes; run-all 46/46 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

## Task 5.2 — Afterimage / Ghost Frames

**Review A (round 1):** PASS (5 minor, non-blocking) — test-strength note on the quiet-termination assertion; roll-gate vs eviction-gate EPS asymmetry worth a comment; lastPos held-position mechanism sound (stale positions never drawn directly); offset uses carrier.facing() normal (deliberate divergence from trail's per-segment tangent, correct for ghosts hugging the sprite centerline); params.box.x/y accepted but unused (only w/h matter for a centered rect).

**Review B (round 1):** FAIL (2 major, 1 minor)
- major: lifecycle based on whether a sampling interval lands on the current frame, not on movement — a moving carrier at the default interval completes at the lifetime boundary when that frame falls between samples
- major: ghosts are plain white rectangles, not translucent copies of the sprite (no historical appearance captured)
- minor: continuous persistence tested only at spawnInterval:0; the "carrier stops" test avoids per-frame sampling by using an interval longer than lifetime

**Resolution:** (B-2) PARTIAL ACCEPT — added a configurable `color` param (DEFAULT_COLOR '#cfe8ff', soft tint) used as fillStyle so ghosts read as tinted copies rather than blank boxes; literal sprite-pixel capture is out of scope (no snapshot/drawImage mechanism exists anywhere in the effects engine; trail.js also renders procedural geometry). (B-3) ACCEPT — added a default-interval (1/30 ≈ 2 frames) persistence+termination test through both the direct body and the engine fastMoving path. (B-1) initially REJECTED as the sanctioned B2 rule (identical to trail.js) — **but this was wrong**: empirical verification proved a real defect. The original "fresh THIS frame" guard wrongly completed a moving carrier at the lifetime boundary whenever that frame fell between rolls (default interval = 2 frames). Fix round 1 introduced a recency window (lastGhostT + RECENCY_WINDOW_FRAMES=1) which fixed the 2-frame case but Review B (round 2) correctly caught it was still too narrow: intervals ≥3 frames still terminated. Fix round 2 set the window = min(rollPeriod>0?rollPeriod:dt, lifetime): a moving carrier persists past lifetime at EVERY sensible interval (verified 2–8 frames), while a stopped/no-carrier instance still terminates exactly at lifetime. Both reviewers then converged on one residual issue: for spawnInterval > lifetime (a degenerate config where each ghost fades before the next snapshot → ≤1 visible ghost, no real trail) the instance still terminates at lifetime. Resolution: this is CORRECT behavior (the cap is defensible — such a config produces no visible trail), so the fix was to DOCUMENT the precondition ("continuous persistence requires spawnInterval <= lifetime") in the header + JSDoc, remove stale "one frame" wording, and PIN the degenerate case with a new test. Final: Review A PASS, Review B PASS. Re-verify: afterimage 28/28 ×10 zero flakes; run-all 47/47 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

## Task 5.3 — Ground Wave

**Review A (round 1):** PASS (5 minor) — `height` documented but functionally inert (crest was a pure semicircle of radius width/2, `topY` computed then `void`ed); `void style`/`void topY` smell; stroke accent uses same color as fill (no contrast); frontX initialized from fallback.x not resolved origin.

**Review B (round 1):** FAIL (1 major, 2 moderate)
- major: terminates before traveling declared distance when duration < distance/speed (no reconciliation)
- moderate: arrival coinciding with completion → render() suppresses that frame, front never visibly renders at endpoint
- moderate: `height` does not affect rendered geometry (same root as A's #1)

**Resolution:** ACCEPT (fix). (B-3/A-#1) crest reworked to an ellipse via translate(frontX,groundY)+scale(1, height/(width/2)) so the peak reaches exactly `height`; dead `void topY` removed; header documents the ellipse; new test asserts vertical extent == height. (B-1) early-completion behavior deliberately documented (front stops at current x, no teleport/forced arrival) + pinned by a test (speed 300, distance 150, duration 0.3 → frontX 90 < 150 at completion). (B-2) endpoint-frame omission documented as intentional (engine prunes during updateEffects before drawEffects) in header + render JSDoc; existing "draws nothing once done" test stays valid. (A-minor) frontX now initialized from resolveOrigin(carrier, fallback).x. Also fixed two stale test assertions from the initial pass (arc matched by hard-coded exact angle literals + wrong array index for the anticlockwise flag [5] vs [6]) → now assert the contract (center (frontX,groundY), radius width/2, semicircle span, sweep flag). Re-review: B final PASS. Re-verify: groundWave 25/25 ×10 zero flakes; run-all 48/48 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

## Task 5.4 — Shockwave

**Review A (round 1):** PASS (5 minor/info) — NaN param input propagates to geometry (undocumented edge, consistent with siblings); redundant alpha guard; unused renderCtx param; one arrival test relies on float/frame alignment coincidence; one loose `drew >= 12` liveness bound. No blockers/majors.

**Review B (round 1):** FAIL (1 high, 1 medium)
- high: completes before reaching maxRadius when duration < (maxRadius-startRadius)/expansionSpeed
- medium: opacity fades during expansion rather than only after reaching maxRadius

**Resolution:** Both findings are the SAME design decision already made and committed for task 5.3 (Ground Wave), so behavior is unchanged — resolved by documentation + a pinning test. (B-1) header now states the config precondition: "expands to maxRadius then fades" assumes `duration >= (maxRadius-startRadius)/expansionSpeed`; a shorter duration stops the ring at its current radius on completion (no teleport / forced arrival), same convention as groundWave. (B-2) the concept doc §5 lists opacity and duration as independent params with no hold-then-fade requirement; simultaneous expand+fade is the standard shockwave look and matches "then fades" as one timed event — kept as-is. Added one test pinning the sensible-config path (reaches exactly maxRadius at the travel time, holds there while alpha strictly decreases each frame through completion). Reviewer disagreement broken by the established cross-task convention + mechanical tests (sensible-config contract fully satisfied). Re-review: B final PASS. Re-verify: shockwave 21/21 ×10 zero flakes; run-all 49/49 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

## Task 5.5 — Telegraph Circle

**Review A (round 1):** PASS (2 minor) — NaN radius input propagates (identical parity with shockwave/groundWave siblings, not a regression); followTarget contract documented as "re-resolve at update AND render" but only the update() half was tested.

**Review B (round 1):** PASS — No findings. Duration-bound shrinking circle + deterministic opacity pulse; fixed-position and live follow-target both supported; generic carriers via origin(); standalone params-only path driven by null carrier. 26 passed.

**Resolution:** ACCEPT (minor fix). Added one test-only case proving the render-half of the followTarget contract: after an update, move the carrier's origin without further update, render into the recording stub, assert the stroked arc is centered at the carrier's NEW live origin (and not the stale update-time position). No runtime logic changed. Re-verify: telegraphCircle 27/27 ×8 zero flakes; run-all 50/50 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

## Task 5.6 — Ground Target Marker

**Review A (round 1):** PASS (2 minor) — render() recomputed the pulse radius already stored by update() (redundant copy of the core formula; harmless by construction); `animation` param is read-but-reserved (`void animation`), intentional documented surface area.

**Review B (round 1):** PASS (first attempt hit tool budget; retry) — fixed marker (origin captured once at construction, never re-resolved → moving carriers don't drag it; following is §10's job); declarative attachment incl. non-entity carriers; params-driven standalone path via null-carrier fireManual. 22 passed.

**Resolution:** ACCEPT (minor fix). render() now reads the stored `this.radius` instead of recomputing the sinusoid (formula lives in one place); `this.radius` initialized to base radius at construction so a pre-update render still draws correct t=0 geometry. No behavior change. Re-verify: groundMarker 22/22 ×8 zero flakes; run-all 51/51 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

## Task 5.7 — Target Reticle

**Review A (round 1):** PASS (4 minor, all cosmetic) — stale `tickLength` comment referencing a nonexistent param (real constant TICK_LENGTH; same slip propagated from groundMarker.js); facingDir recomputed every render even when offset is 0 (negligible); double origin re-resolution per frame in follow mode (intentional, matches telegraphCircle); one redundant loose tick-rotation test.

**Review B (round 1):** FAIL (1 real defect + 3 conforming notes)
- major: fixed mode (followMode:false) with nonzero offset drifts when the carrier rotates — render() recomputed the offset direction from the carrier's LIVE facing every frame, so fixed mode did not hold position
- (conforming) follow behavior, declarative attachment incl. non-entity carriers, params-driven standalone path all OK

**Resolution:** ACCEPT (fix). Captured the carrier's facing ONCE at construction (`frozenFacing`) alongside the origin; fixed mode now uses the frozen facing for the offset in both update() and render(), while followMode:true still re-resolves origin AND facing live each frame (byte-for-byte unchanged). Header documents freeze-vs-track semantics. Added two deterministic tests (fixed-mode no-drift when facing changes after fire; follow-mode re-aims along new live facing). Also fixed the stale `tickLength` → `TICK_LENGTH` comment in both targetReticle.js and groundMarker.js (comment-only). Re-review: B final PASS. Re-verify: targetReticle 32/32 ×10 zero flakes; groundMarker 22/22 (comment change broke nothing); run-all 52/52 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

## Task 5.8 — Attack Arc / Slash

**Review A (round 1):** PASS (3 minor) — sweepDirection:NaN yields silent no-op (identical parity with groundWave direction:NaN, not a regression); no test for non-unit-magnitude sweepDirection sign normalization; several angle assertions use tol 1e-6 vs module EPS 1e-9 (justified by atan2/multiplication accumulation, cosmetic).

**Review B (round 1):** FAIL (2 major)
- major: trailing wake always offset by 0.35·arcAngle including at t=0 → visible slash begins before the declared orientation and spans ~1.35·arcAngle (violates "declared angle in the declared orientation")
- major: endpoint frame pruned → leading edge never visibly reaches the full declared angle (for the fast default duration this omits ~1/9 of the sweep)

**Resolution:** ACCEPT (fix). (B-1) trailing edge clamped to never cross the base orientation (max(base, lead−wakeSpan) CCW / min(base, lead+wakeSpan) CW) so at t=0 the arc starts AT the base and the visible span stays within [base, base+sweepDir·arcAngle], ≤ arcAngle; also caught+fixed that the original wake formula extended in the wrong direction for clockwise sweeps. (B-2) sweep now driven against (duration − dt) so progress hits 1.0 one frame before done and the last VISIBLE frame renders the leading edge EXACTLY at base + sweepDir·arcAngle; lifetime/done semantics unchanged. Closing re-review surfaced one residual edge: duration <= dt (sub-frame) completes before any render so the full angle is never drawn — resolved by documenting a config precondition (visible sweep needs duration >= ~2·dt) + pinning the actual behavior with a test (the existing Math.max(duration−dt, EPS) guard already prevents NaN/negative math). Re-review: B confirmed both majors fixed; residual edge documented+pinned. Re-verify: attackArc 25/25 ×10 zero flakes; run-all 53/53 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

## Wave 5 gate — M5 (5.1–5.8)

**Gate tests:** run-all.mjs 53/53 vs wave-4 baseline 45/45 (+8 new effect suites: trail, afterimage, groundWave, shockwave, telegraphCircle, groundMarker, targetReticle, attackArc; no new failures). effectRegression.test.js still green (behavior preservation intact). effectCatalog.test.js does not exist yet (M7 deliverable) — fell back to run-all per convention. Pre-existing flakes (barrel.solid, contextualAim ~25%) re-run clean.

**Wave review (dual):**
- Review A (line-level): PASS (1 cross-cutting minor) — the NaN-geometry-param-propagation edge is replicated across ~7 of 8 files (Math.max(0, params.X ?? DEFAULT) doesn't sanitize NaN); explicitly accepted as sibling parity per-task, recommended a single consolidated follow-up task (document "finite geometry params" precondition uniformly OR harden the shared clamp), not gate-blocking. No engine change confirmed (index.js absent from diff); registry additive only (8 import + 8 register lines); all 8 effects zero-import / no cross-effect coupling; uniform factory shape, resolveOrigin pattern, EPS done-detection, named constants, header-doc style, degenerate handling, endpoint-frame docs; all deterministic contract tests.
- Review B (intent/doc): FAIL round 1 (3 major) — (B1) trail persistence depends on recording a point that exact frame, so a SLOWLY-moving carrier can complete at the lifetime boundary between samples and periodically lose/restart its trail; (B2) afterimage treats any origin() carrier as active whenever a snapshot interval elapses even if position never changes → a discrete-fired afterimage on a stationary entity/marker persists forever stacking overlapping ghosts ("recently active" measured presence, not movement); (B3) ghost frames rendered as tinted rects, not sprite snapshots.

**Resolution:** (B1) CONFIRMED real bug (empirically: trail 2px/frame completed at frame 18 instead of persisting) — root cause was trail's original "fresh point THIS frame" rule, the same flaw class later fixed for afterimage in 5.2 but never applied back to trail (5.1 committed before that pattern was found). FIXED via the recency-window approach: track lastPointT, complete at lifetime only if no point recorded within the window (= min(density/MIN_SPEED, lifetime)); slow-moving carriers persist, stopped carriers terminate promptly at lifetime+window. One existing end-to-end test's stop-phase (4 frames) was too short for the new correct window and extended to ceil(window/dt)+1 with an explanatory comment. (B2) CONFIRMED real bug (empirically: stationary origin() carrier persisted forever) — FIXED by gating the lastGhostT refresh on ACTUAL motion: a roll only counts as fresh activity if the new position differs from the previous by > MIN_MOVE_EPS (1e-6 px); stationary rolls no longer keep the instance alive, so it terminates exactly at lifetime while a moving carrier still persists at any spawnInterval<=lifetime. Regression tests added for both edges. (B3) ALREADY RESOLVED in 5.2 — the engine has no sprite-snapshot/drawImage mechanism anywhere (trail also renders procedural geometry); tinted translucent rects sized to the carrier are the accepted procedural stand-in for this milestone; literal sprite capture is deferred work. Re-review: B confirmed both majors fixed; residual sub-frame/edge items documented+pinned. Re-verify: trail 27/27 ×10, afterimage 30/30 ×10 zero flakes; run-all 53/53 (barrel.solid/contextualAim pre-existing flakes re-run clean). Extensibility contract intact: each new effect = one file + one registration (theater demo deferred to M7); no engine change. Gate commit: `effects: wave 5 gate`.

## Task 6.1 — Fade Out

**Review A (round 1):** PASS (3 minor, all cosmetic) — test multiplies by literal `1` instead of startOpacity var; terminal-value check recomputes closed form inline rather than asserting live instance state; alpha() returns multiplier while render() draws startOpacity·multiplier (consistent by design, documented). No blockers/majors. NaN/divide-by-zero guarded (endRatio = startOpacity > EPS ? end/start : 0).

**Review B (round 1):** FAIL (1 high)
- high: production renderer (render.js) never queries/applies active fade-out instances' alpha() multipliers at drawable entity sites → declaratively-attached fade-outs don't reduce the carrier sprite's in-game opacity; only the standalone reference-box path works

**Resolution:** ACCEPT (document deferral). The plan's task 6.1 scopes only `+ fadeOut.js` (no render.js), and per-entity sprite-state renderer consumption is wired separately in this epic (sprite-shake consumption was added at wave 3, not per-effect). The fadeOut.js alpha() contract is fully implemented + tested (start→end over duration after delay, curve vocabulary, clamping, fade-in reversal, zero-start guard); the standalone/theater path demonstrates the ramp. Added an explicit "Renderer consumption status" header note stating render.js does NOT yet fold inst.alpha() into carrier globalAlpha at entity draw sites and that wiring is deferred (follow-up / M7 handoff) — so it's a tracked deferred item, not a silent gap. This matches the established pattern where effects expose their state and consumption is integrated at a dedicated wiring point. Re-verify: fadeOut 28/28 ×4 zero flakes; run-all 54/54 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

DEFERRED (tracked): render.js per-entity consumption of fade-out alpha() (and, by extension, the other M6 sprite-state effects' multipliers) across drawable entity sites — to be wired in M7 handoff or a dedicated task.

## Task 6.2 — Scale / Pulse

**Review A (round 1):** PASS (2 minor, both stale comments) — header claimed maxScale reached "at phase π/2" but the actual ramp peaks at phase π; test determinism note misstated the ramp formula. No behavior impact.

**Review B (round 1):** FAIL (2 high)
- high: standalone path applied startScale twice (render used startScale·scale() while scale() already incorporates startScale) → demo exceeded maxScale and diverged from the renderer-consumed contract
- high: loopCount controlled lifetime windows, not pulse repetitions (actual cycles = loopCount×frequency), contradicting §18's param intent

**Resolution:** ACCEPT (fix). (B-1) render() now uses this.scale() ALONE (no double-applied startScale); verified max scale() with {startScale:1.2,maxScale:1.5} is exactly 1.5, not 1.8; added a never-exceeds-maxScale pin across the lifetime. (B-2) params given a coherent documented relationship: pulseFrequency = Hz (cycles/sec), loopCount = number of full cycles performed, lifetime = delay + loopCount·(1/pulseFrequency) EXACTLY; `duration` made redundant/ignored (accepted for §18 API compat but does not affect timing). Verified {pulseFrequency:2,loopCount:1} → exactly ONE pulse, done at frame 30. Also fixed Review A's two stale comments (peak phase, ramp formula) in the impl rewrite. The executor's first fix attempt hit budget mid-tool-call leaving a stale test file mismatched to the corrected impl; a follow-up test-only rewrite reconciled all 32 assertions to the corrected contract. Re-review: B final PASS. Re-verify: scalePulse 32/32 ×10 zero flakes; run-all 55/55 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

## Task 6.3 — Squash & Stretch

**Review A (round 1):** PASS (4 minor/nit, all non-blocking) — xScale()/yScale() are byte-for-byte duplicates differing only in travel var (consistent with self-contained M6 sibling style); render() re-evaluates the clock twice (harmless, pure); one continuity test uses inline target literals (correct contract-assertion practice); the `<= delay + EPS` neutral guard is the standard fixed-dt epsilon convention. No dead code/stale comments/NaN/divide-by-zero. Boundary continuity verified analytically + numerically.

**Review B (round 1):** PASS — No findings. Independently distorts X/Y then returns both axes to neutral within duration+recoveryDuration; landing and jump configs both supported; declarative carrier attachment via real fire(); standalone path fully params-driven (null carrier). 30 passed.

**Resolution:** No fixes required — both reviewers PASS. Effect follows the M6 sprite-state pattern (non-uniform xScale()/yScale() multipliers the renderer consumes; two-window ease from neutral 1.0 → peak 1+intensity·(target−1) over duration, then back to exactly 1.0 over recoveryDuration; lifetime = delay+duration+recoveryDuration; render reads the same queries; deferred renderer-consumption note present). Re-verify: squashStretch 30/30 ×8 zero flakes; run-all 56/56 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

## Task 6.4 — Aura / Glow

**Review A (round 1):** PASS (3 minor, all non-blocking)
- minor: auraGlow.js:253 — colorWithAlpha helper is new duplication with no shared home (flag for M6/Beam task; not a defect now)
- minor: auraGlow.js:209–218 — resolveOrigin identical body to 6 siblings (established per-file pattern, consistent)
- minor: auraGlow.js:151 vs :184 — pulse cosine computed independently in update() and render() (correct by design: pure function of elapsed time, no state coupling)

**Review B (round 1):** FAIL (3 major)
- major: auraGlow.js:219 — glow uses source-over drawing and renders OVER the target sprite (world pass draws after entities), not BEHIND it as plan acceptance states
- major: auraGlow.js:168 — carrier origin captured only at fire time; a moving target immediately leaves the aura behind; a lifetime-based aura should remain around its carrier throughout its continuous lifecycle
- major: auraGlow.js:257 — color parameter does not reliably render declared color: valid CSS colors outside #rgb/#rrggbb/limited rgb()/rgba() silently become black

**Resolution:**
- (B-1) REJECT — renderer ordering (world effects drawn after entities) is an M7 wiring concern, same deferral pattern as fadeOut alpha consumption (6.1). The effect file itself is correct; the "behind" requirement will be addressed when M7 wires per-entity rendering order. Not a defect in auraGlow.js.
- (B-2) ACCEPT (fix). Origin now re-resolved from carrier.origin() each update() when a carrier is present (same live-tracking pattern as trail.js/afterimage.js). Null-carrier fires keep the params.x/y fallback. Header updated. New test proves a mutable carrier's changing origin causes the rendered arc center to follow. Re-verify: auraGlow 27/27 ×4 zero flakes; run-all 57/57 (barrel.solid pre-existing flake re-run clean).
- (B-3) REJECT — hex (#rgb/#rrggbb) + rgb()/rgba() covers all practical configs used in this codebase (all existing effects use hex or rgba strings). Named CSS colors are out of scope for a canvas game engine that standardizes on hex. Documented in header.

Re-verify post-fix: auraGlow 27/27 ×4 zero flakes; run-all 57/57 (barrel.solid/contextualAim pre-existing flakes re-run clean). No engine change; registry addition additive. Committed.

## Task 6.5 — Beam

**Review A (round 1):** FAIL (1 major, 4 minor)
- major: beam.js:269–289 — colorWithAlpha duplicated verbatim from auraGlow.js (rubric #6 no duplication)
- minor: beam.js:119 — params.duration silently ignored (derived from flashInTime+fadeOutTime; no warning)
- minor: beam.js — doc §26 lists "Hold time" param; implementation has only two phases (plan scope reduction, acceptable)
- minor: beam.test.js:249/222 — float accumulation fragility in two alpha-boundary tests (passes at 1e-9 tol, latent at tighter)
- minor: beam.js:131 — magic `0` origin defaults instead of named constants

**Review B (round 1):** FAIL (2 major)
- major: beam.js:188–196 — gradient spans width+2×gradientRadius but filled rect is only width tall → halo clipped, soft glow invisible
- major: beam.js:196 — rect centered on origin (x=-length/2) so half projects opposite facing; doc says "extends from an origin along an axis"

**Resolution:** ACCEPT all three actionable findings. (B1) filled rect expanded to full gradient span (width+2·haloR tall) so the soft halo falloff is visible. (B2) rect now starts at local x=0 (origin-anchored) and extends forward `length` px along facing — matches doc "extends from an origin." Header updated. Test assertion rewritten for the new geometry. (A3) colorWithAlpha extracted to shared js/effects/colorUtil.js; both auraGlow.js and beam.js import it (duplicates removed). A's minors accepted as-is (duration ignore documented in header; hold-time deferred per plan scope; test fragility cosmetic at 1e-9; origin defaults are conventional zero). Re-verify: beam 32/32 ×3, auraGlow 27/27, run-all 58/58 (barrel.solid pre-existing flake re-run clean). No engine change; registry addition additive; colorUtil.js is a new shared utility (additive). Committed.

## Wave 6 gate — M6 (6.1–6.5)

**Gate tests:** run-all.mjs 58/58 vs wave-5 baseline 53/53 (+5 new effect suites: fadeOut, scalePulse, squashStretch, auraGlow, beam; no new failures). effectRegression.test.js 21/21 (behavior preservation intact). effectCatalog.test.js does not exist yet (M7 deliverable) — fell back to run-all per convention. Pre-existing flakes (barrel.solid, contextualAim ~25%) re-run clean.

**Wave review (dual):**
- Review A (line-level): PASS (3 minor, all non-blocking) — inconsistent render arity across sprite-state vs draw-effects (harmless); colorUtil doesn't support named CSS colors (documented caveat); vignette predates colorUtil (informational). No blockers/majors. Conventions consistent across all 5 effects; index.js absent from diff; registry additive only; no cross-effect coupling; colorUtil single source confirmed; all deterministic contract tests.
- Review B (intent/doc): FAIL round 1 (4 major) — (B1) fadeOut alpha() exposes relative multiplier not absolute start→end; (B2) sprite-state reference boxes leak into production world pass if attached to real entities; (B3) aura renders on top of carrier not behind (renderer ordering); (B4) beam gradient asymmetric with off-center peak, no flat bright core.

**Resolution:** (B1) REJECT — already resolved in task 6.1 with documented deferral: renderer consumption pattern is `globalAlpha *= inst.alpha()` where caller sets base opacity; standalone demo multiplies by startOpacity explicitly. Same deferred-wiring item tracked since 6.1. (B2) REJECT as gate-blocking — LATENT (no production entity currently attaches fade-out/scale-pulse/squash-stretch via config; verified grep empty in systems/). The reference-box leakage would only manifest if a future task wires these onto real carriers, which is the M7 renderer-consumption wiring point. Tracked as deferred. (B3) REJECT — same as per-task 6.4 resolution: renderer ordering (world effects drawn after entities) is an M7 wiring concern. (B4) ACCEPT (fix) — beam gradient reworked to symmetric 4-stop profile: flat bright core between two equal peak stops at ±coreFrac, smooth falloff to 0 at outer halo edges; uniform fill when haloR=0. New tests verify symmetry + degenerate case. Re-verify: beam 33/33 ×3 zero flakes; run-all 58/58 (barrel.solid pre-existing flake re-run clean). Extensibility contract intact: each new effect = one file + one registration (theater demo deferred to M7); no engine change; colorUtil.js is a new shared utility (additive). Gate commit: `effects: wave 6 gate`.

DEFERRED (tracked, carried from 6.1 + confirmed at gate): render.js per-entity consumption of M6 sprite-state multipliers (fadeOut alpha, scalePulse scale, squashStretch xScale/yScale) AND behind-sprite rendering order for aura/glow — to be wired in M7 handoff or a dedicated task. Reference-box leakage (B2) is latent until that wiring lands.

## Task 7.1 — Per-effect theater demos

**Review A (round 1):** PASS (4 minor)
- minor: index.js:382 — dead 'sprite-shake-standalone' entry in SHAKE_PROXY (no CATALOG row, unreachable)
- minor: index.js:389–415 — centralized demo deviates from plan snippet's per-file intent (defensible, documented; "one file" → "one file + one CATALOG row")
- minor: composite-explosion determinism exemption reasonable + verified sound (only stochastic pool-driven effect)
- minor: index.js:325 — mid-file `import { particles }` (ESM hoists it; style only)

**Review B (round 1):** FAIL (1 blocker, 4 major)
- blocker: index.js:346 — theaterList has 25 entries but registry has 29 types; hit-sparkle/death-sparkle/pickup-pop/sprite-shake-standalone have no demo
- major: index.js:363 — §15 previews legacy sprite-shake not standalone; null-carrier real effect completes immediately, proxy fabricates offset
- major: index.js:394 — stateless demo resets/refires each frame; increasing t doesn't replay one coherent animation (particles teleport)
- major: index.js:379 — extensibility requires POOL_DRIVEN/SHAKE_PROXY/feed classification (engine-level per-effect behavior)
- major: test:12 — header claims 29 types get demos but asserts 25; never compares against registeredTypes()

**Resolution:** (B1/B5) The plan acceptance explicitly says "catalog order §1→§24 then Beam" — the 25 CONCEPTUAL catalog entries are correct. The registry's 29 granular types exist because §1 "Particle Burst / Sparks" maps to 4 implementations (particle-burst/hit-sparkle/death-sparkle/pickup-pop) and §15 "Sprite Shake" maps to 2 (sprite-shake + sprite-shake-standalone). The theater previews the canonical catalog entry per concept. REJECTED as a blocker (plan-conformant); the legitimate part (misleading test header claiming "29 types all get demos") FIXED — header now documents the catalog-vs-registry distinction. (B2) ACCEPTED as-is — §15 concept IS "Sprite Shake"; the visible shake proxy demonstrates the jitter concept for both variants. (B3) REJECT — the plan snippet specifies `demo(stage, t) -> draws the effect at time t`, a STATELESS snapshot at time t, which is exactly what's implemented; the theater (7.2) drives t from 0 upward per effect. Matches plan contract. (B4) PARTIAL ACCEPT — the per-effect knowledge lives in a centralized DATA table (CATALOG rows + optional set membership), not behavioral engine logic; adding an effect = one file + one registration + one CATALOG row (+ set membership if pooled/state/recording). Documented tradeoff, consistent with the M7 objective. (A#1) FIXED — removed dead 'sprite-shake-standalone' from SHAKE_PROXY. Re-verify: effectTheater 18/18 ×10 zero flakes; run-all 59/59 (barrel.solid/contextualAim pre-existing flakes re-run clean). No gameplay engine change (theater section is additive after line 302; fire/update/draw/reset untouched); particles.reset() strictly additive. Committed.

## Task 7.2 — Effect Theater overlay + debug shortcut

**Review A (round 1):** PASS (1 major, 3 minor)
- major: update.js:1134 — theater demos mutate the shared engine singleton; on close a lingering demo instance (camera-shake/vignette/screen-flash) leaks into gameplay for one frame
- minor: theater.js open() doesn't clear residual engine state (ties to major)
- minor: update.js:432 — `if (!Theater.active) theaterWasHeld = 0` is dead code (only called while active)
- minor: theater.js:96 — magic 320/180 duplicated from index.js DEMO_VIEW

**Review B (round 1):** FAIL (1 blocker, 1 major)
- blocker: update.js:371–388 — Esc closes the theater in the keydown listener but the input engine's OWN listener still records Escape as 'back'/'pause'; dispatchScreenInput can then transition PLAY→PAUSE instead of returning to debug mode
- major: update.js:387–393,1124–1142 — while Theater.active, screen dispatch + normal gameplay updates continue; keyboard/gamepad directions move the hero and gamepad cancel double-fires its mapped action

**Resolution:** ACCEPT all actionable findings. (B-blocker) processInput() now returns early while Theater.active, skipping dispatchScreenInput entirely — so the input engine's recorded Escape/back/pause never drives a screen transition behind the overlay. (B-major) update(dt) now returns immediately after Theater.update(dt) while active, freezing all gameplay physics behind the black overlay (hero doesn't walk, gamepad actions don't fire). (A-major/A-minor#2) theater.js open() AND close() now call resetEffects() so no demo/gameplay instance survives across the boundary — new node test proves a live vignette/screen-flash is cleared by both. (A-minor#3) removed the dead theaterWasHeld guard. (A-minor#4) exported DEMO_VIEW from index.js and reused it for the centering translate (no more duplicated 320/180). Re-verify: effectTheater 31/31 ×3 zero flakes; run-all 59/59 (barrel.solid/contextualAim pre-existing flakes re-run clean). Engine core unchanged (index.js fire/update/draw/reset lifecycle intact; only additive consumers in update.js/render.js + new theater.js). Wired: KeyB opens, arrows step (scrubber guarded), Esc closes to debug, F1/F2 exit debug+theater, gamepad d-pad/stick edge-triggered step + btn:1 back closes. DOM wiring not node-testable (verified by review against acceptance). Committed.

## Task 7.3 — Document effect config in entity YAML

**Review A (round 1):** PASS (3 minor)
- minor: hero.yaml:123 — stateChange comment "fires on any anim/state transition (caller filters)" overstates; engine fires every entry whose `on` matches, caller decides when to emit
- minor: projectile.yaml:35 — `moving` described as "speed > 0" but it's a carrier predicate with ~10 px/s floor
- minor (info): examples omit x/y positional params (resolve from live carrier at fire time; acceptable for docs)

**Review B (round 1):** FAIL (2 major, 1 minor)
- major: hero.yaml:110 — effects attached to hero though beam should mirror the attack HITBOX's origin/facing; doesn't show how to attach to the actual hitbox
- major: projectile.yaml:28 — hit-sparkle supplies only count but the effect requires params.x/y (no carrier derivation) → undefined coords for standalone fire
- minor: hero.yaml:122 — aura example implies charged/super-only but config has no state predicate, fires on every emitted stateChange

**Resolution:** ACCEPT all actionable findings (doc-comment precision). (B2) VERIFIED real — hitSparkle.js reads params.x/y directly with NO carrier-origin logic (legacy M2-migrated); added x/y to the projectile example with a comment that the caller sets them from the collision event at fire time. (B1) Added a clarifying comment that the beam reads the ACTIVE ATTACK HITBOX's origin()/facing() at fire time (the hero is the carrier owning the hitbox), per effects.md §26. (B3/A#1) Rewrote the stateChange comment to state plainly that the engine fires on EVERY emitted stateChange with no built-in predicate — the caller emits it only when entering the desired state (designer-tunable via trigger emission). (A#2) corrected the `moving` condition comment to "carrier-defined predicate; effective floor ~10 px/s". Re-verify: both YAML files parse clean (yaml.safe_load OK); grep confirms both effects blocks present. Doc-only change — no code touched, full suite unaffected (59/59). Committed.

## Wave 1 gate — M1 (1.1–1.3)

**Gate tests:** run-all.mjs 33/33 vs baseline 31/31 (+2 new suites: effectEngine, effectCarrier; no new failures). Pre-existing flakes (contextualAim, barrel.solid) re-run clean.
**Wave review (dual):** PASS — No findings. Doc conformance, single mechanism, no duplication, behavior preservation (no game code touched), extensibility contract intact.
**Gate commit:** `effects: wave 1 gate`.
