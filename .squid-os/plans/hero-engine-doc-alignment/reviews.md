# Reviews — hero-engine-doc-alignment

## Task 1.1 — Contextual Down: crouch vs downward aim resolution

### Review A (ninfer/qwen3.8-27b) — Round 1
**PASS** (3 minor findings, no blockers)
- contextualAim.test.js:139 — pipeline wiring block is redundant with direct-intent tests above; self-skips silently. Minor.
- contextualAim.test.js:129 — AC#2 assertion restates implementation formula (tautology-ish). Minor.
- render.js:353 — pre-existing `h.superActive` flag bug (owned by task 1.3). Awareness only.

### Review B (openai-codex/gpt-5.6-sol) — Round 1
**FAIL** (2 blockers, 3 major)
1. BLOCKER: Airborne hero retains crouching=true → resolveAim fires horizontal instead of down (§4).
2. BLOCKER: Raw input.down overrides frozen aimX/aimY from Lock Direction (§5).
3. MAJOR: Airborne test missed crouch→air composition.
4. MAJOR: No test for AC#6 (Lock Direction freeze).
5. MAJOR: Crouched-origin test didn't verify actual projectile Y.

**Resolution:** All 5 ACCEPTED. Executor fixed all five.

### Review B — Round 2
**FAIL** (1 blocker, 1 major)
1. BLOCKER: Lock Direction captures raw aimX/aimY in input.js, not the resolved aim (§5). Grounded crouch + I locks down instead of horizontal.
2. MAJOR: AC#6 test injected already-frozen vector; never exercised real engagement from grounded Down.

**Resolution:** Both ACCEPTED. Executor fixed via resolver hook (input.js setResolveAim wired to hero.resolveAim in update.js).

### Review B — Round 3 (final)
**PASS** — No findings. Lock Direction captures resolved aim on engagement; all prior findings confirmed fixed. Tests green (contextualAim 16, input 16).

### Verdict
Task 1.1 APPROVED. Both reviewers PASS. Committed post-review.
