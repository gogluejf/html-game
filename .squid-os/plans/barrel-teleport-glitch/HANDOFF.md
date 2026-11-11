# Barrel Teleport Glitch — Handoff

**Status:** OPEN. Jump-air oscillator fixed & committed; barrel pop + camera hitch
remain. Multiple targeted crouch fixes were tried and REVERTED (wrong writer).
This doc is the full discovery trail so the next session doesn't re-derive it.

## Symptoms (as reported by user)
1. **Barrel pop/teleport:** hero visually pops up onto / through the barrel row
   after many super-melee swings, or while running into barrels.
2. **Camera hitch:** scroll level freezes a fraction of a second when landing
   (also noticed while running and jumping). User's own finding: the glitch
   persists with ALL debug code stashed → likely NOT caused by our WIP changes.

## What was FIXED (committed in this plan's work)
- **Jump-air height oscillator** (`heroSprites.js`): the air branch called
  `applyJumpHeight(false)` whenever `_targetHScale !== 1` — but a tucked air
  frame ALWAYS has scale 0.5, so it fired EVERY air frame: restore (+45.6px y)
  then tuck (−45.6px) twice per frame = ±48px jitter for the whole jump.
  Removed the misfiring restore; land-frame restore is owned by the grounded
  branch. Verified via `[pose] JUMP-HEIGHT` tripwire: before = spam every air
  frame, after = one clean tuck + one restore.

## What was tried and REVERTED (ineffective — wrong writer)
All from the crouch-flip-flop hypothesis. Reverted because the live log showed
the remaining flips come from a DIFFERENT path (plain input block, `anim=run`,
no melee active):
- Crouch gate extension: `!(swingLive && combatPhase !== 'recovery')` in
  `hero.update()` — blocked held-Down re-entry during live swings. No effect on
  the observed loop.
- `endSpecialMelee()` discarding pending crouch ENTRY instead of flushing it
  (sweep stand-up as authoritative pose). No effect on the observed loop.

## Evidence trail (tripwire logs, since stripped)
Tripwires used: `[crouch]` (setter, with stack), `[pose] CROUCH-HEIGHT` /
`JUMP-HEIGHT` (in applyCrouchHeight/applyJumpHeight), `[grounded]`
(setGrounded transitions), `[resolve] HERO Y-PUSH` (collision.js Y-axis pushes).

Key findings:
1. `[grounded]` fired exactly ONCE per jump (false→true at landing) — the
   grounded flag is NOT flickering mid-air.
2. `[air] enter ... scale=0.5` every air frame → proved the jump-restore bug
   (now fixed).
3. `[resolve] HERO Y-PUSH` never fired at pop moments → the pop is NOT a
   collision push-out. It is pure height-swap churn.
4. **THE UNEXPLAINED LOOP (current prime suspect):** while simply RUNNING
   (no melee, `sm=-`, `phase=null`, `anim=run`), the log showed:
   ```
   [crouch] false -> true   ... <- update@systems/update.js:1171
   [pose] CROUCH-HEIGHT down dy=45.6
   [crouch] true -> false   ... <- update@systems/update.js:1171
   [pose] CROUCH-HEIGHT UP   dy=45.6
   ```
   repeating EVERY frame. Stack points at the plain crouch entry/exit block in
   `Hero.update()` (the `input.down && grounded && !crouching` /
   `crouching && !input.down` pair), NOT startSpecialMelee/endSpecialMelee.
   Each flip moves hero center ±45.6px (feet stay planted) — that IS the pop
   when overlapping the barrel row.

## Camera hitch — mechanism (understood, cause unconfirmed)
- Camera follows hero CENTER (`heroCY = y + h/2`) with dead-zone follow
  (`core/camera.js`), render lerps between physics steps (`capturePrev` →
  `renderPos(alpha)`).
- `renderPos()` has a teleport guard: delta > 256px in one step → skip lerp,
  hard snap. Height flips tug the center ±45.6px/frame; if accumulated delta
  crosses 256px in a step (e.g. landing stacks a flip on the fall), smoothing
  dies for that frame = visible hitch.
- This theory PREDICTS the hitch dies once the crouch loop is fixed.
- CAVEAT: user observed the hitch still happens with everything stashed, so
  either (a) the baseline already has the crouch loop (likely — it's in
  committed code), or (b) the hitch has an additional/independent cause
  (e.g. landing itself moving the camera far in one step). Verify with the
  frame-trace tool below.

## Tooling left in place (committed, silent)
- `debugHarness.js`: `tickFrameTrace()` — per-frame ring buffer (1500 frames)
  of hero box/velocity/phase + live barrels; frames where hero y moved > 8px
  in one step are flagged `yJump`. Console output disabled (was too noisy).
- **Ctrl+E** downloads the ring as JSON — press it the moment the broken state
  appears; scan for `yJump: true` first. Wired in `update.js` (debug mode only).

## Next experiments (priority order)
1. **Reproduce the running-loop with input-state visibility.** The missing
   fact: on each `[crouch]` flip while running, what are `input.down`,
   `input.lockMove`, `grounded`, `wasCrouching`? One log line in the crouch
   block of `Hero.update()` settles it:
   - `input.down` flickering → bug is in the INPUT layer
     (`core/input.js`: `s.crouch = rawDown && Math.abs(dirX) < 0.2` — note the
     dirX threshold: stick/key noise near the 0.2 boundary could flap it).
   - `input.down` stable true but flips continue → gate logic mis-evaluates
     (check `grounded` timing: setGrounded runs AFTER hero.update, so the
     entry gate reads last frame's grounded).
2. **Ctrl+E frame-trace during a clean-baseline camera hitch** (no melee,
   just run+jump+land): if `yJump` frames align with the hitch and show
   crouch-height h values alternating (91↔46), the center-tug theory holds.
   If h is constant during the hitch, the camera cause is elsewhere (look at
   landing-step camera delta vs the 256px guard).
3. Only after the writer is identified: fix that ONE spot, verify the loop is
   gone in the log, then strip any new tripwires.

## Files of interest
- `petal-panic/js/hero/hero.js` — crouch entry/exit block in `update()`
  (~line 520-555), `applyCrouchHeight`, `applyJumpHeight`, `setGrounded`,
  `startSpecialMelee` (force stand-up), `endSpecialMelee`/`_flushPendingCrouch`
- `petal-panic/js/hero/heroSprites.js` — `updateHeroLocomotionAnim` (air
  branch ~line 245, grounded branch ~line 273, crouch branch re-asserts
  crouched height every frame)
- `petal-panic/js/core/input.js` — `s.crouch` derivation (~line 657),
  discrete-edge handling for melee (~line 673)
- `petal-panic/js/core/camera.js` — `update()` follow, `renderPos()` 256px
  teleport guard
- `petal-panic/js/systems/update.js` — frame order: hero.update → requestMelee
  → resolve → setGrounded → camera.update

## Session history (context crashes, all max_context 240k)
- `2026-11-11_16-40-08` — barrel momentum transfer (committed f176d85e etc.)
- `2026-11-11_17-19-01` — barrel removal offscreen
- `2026-11-11_17-43-57` — jump oscillator found+fixed, crouch fixes attempted
- `2026-11-11_18-19-17` — this handoff written; ineffective hunks reverted
