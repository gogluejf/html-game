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

## Wave 1 gate — M1 (1.1–1.3)

**Gate tests:** run-all.mjs 33/33 vs baseline 31/31 (+2 new suites: effectEngine, effectCarrier; no new failures). Pre-existing flakes (contextualAim, barrel.solid) re-run clean.
**Wave review (dual):** PASS — No findings. Doc conformance, single mechanism, no duplication, behavior preservation (no game code touched), extensibility contract intact.
**Gate commit:** `effects: wave 1 gate`.
