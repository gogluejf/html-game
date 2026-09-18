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

## Task 1.2 — Air control: ramp from rest, preserve jump momentum

### Review A (ninfer/qwen3.8-27b) — Round 1
**PASS** (2 minor cosmetic notes: test hardcodes AIR_ACCEL value; barrel test simulates blocking manually)

### Review B (openai-codex/gpt-5.6-sol) — Round 1
**FAIL** (1 blocker, 1 major)
1. BLOCKER: Horizontal branch runs before jump → blocked hero gets full vx on launch frame (§8).
2. MAJOR: Barrel test reset vx to zero, masking the bug.

**Resolution:** Both ACCEPTED. Executor added blocked-detection.

### Review B — Round 2
**FAIL** (1 blocker)
1. BLOCKER: |vx|<10 heuristic misclassifies ALL grounded heroes at rest as blocked → §7 instant-snap violated.

**Resolution:** ACCEPTED. Executor replaced with collision flag (_blockedX) stamped by resolve().

### Review B — Round 3 (final)
**PASS** — No findings. Grounded unblocked snaps instantly (§7); blocked+pinned uses ramp (§8); airborne ramps; running jump preserves momentum. Tests green.

### Verdict
Task 1.2 APPROVED. Both reviewers PASS. Committed post-review.

## Task 1.3 — Supermove: phase-aware jump cancellation + anim flag fix

### Review A (ninfer/qwen3.8-27b) — Round 1
**PASS** (1 major: intangibility not shortened on cancel; 2 minor: velocity formula convoluted, dual boolean nit)

### Review B (openai-codex/gpt-5.6-sol) — Round 1
**FAIL** (4 major, 2 minor)
1. MAJOR: Burst velocity reversed (starts 40%, accelerates to 100%)
2. MAJOR: endSupermove doesn't shorten intangible timer
3. MAJOR: triggerSupermove overwrites existing longer intangibility
4. MINOR: Respawn doesn't clear supermovePhase
5. MAJOR: No test for cancel-then-intangibility
6. MINOR: Async test wrapper

**Resolution:** All ACCEPTED. Executor fixed all six.

### Review B — Round 2
**FAIL** (3 major)
1. MAJOR: Velocity ramp still discontinuous at handoff (timer reset causes ~94→408 px/s jump)
2. MAJOR: Intangibility restore wrong for shorter pre-existing grants
3. MAJOR: Respawn sets intangible=false after granting timer (pre-existing §27 violation)

**Resolution:** All ACCEPTED. Executor added _supermoveElapsed accumulator, analytic restore, removed respawn bug.

### Review B — Round 3 (final)
**PASS** — No findings. 15/15 supermove tests, 10/10 heroAnim.

### Verdict
Task 1.3 APPROVED. Both reviewers PASS. Committed post-review.
