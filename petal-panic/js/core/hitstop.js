// Petal Panic — global hit-stop (time-layer hook, dash-combo-hitstop HANDOFF §B).
//
// A hard freeze of the ENTIRE fixed-step simulation for N frames on a connect
// frame. NOT an effect: effects are presentation-only; hit-stop changes the
// simulation clock itself. During frozen steps the game loop skips update()
// entirely (entities, pools, particles, camera decay) while render keeps
// drawing the frozen pose every rAF.
//
// Rules (HANDOFF Part B):
//   - 4–6 frames max (default 5 ≈ 83ms). Longer = lag feel.
//   - Math.max semantics: overlapping requests never stack past the larger.
//   - The fixed-step accumulator must NOT advance during frozen steps (no drift)
//     — the loop consumes one step's worth of time per frozen frame instead of
//     skipping the subtraction.

let remaining = 0;

/** Request a hit-stop of `frames` fixed steps (max-merge, never stacks). */
export function hitstop(frames) {
  if (frames == null) frames = 5; // default length when called bare
  if (!Number.isFinite(frames) || frames <= 0) return;
  remaining = Math.max(remaining, frames);
}

/**
 * Call at the TOP of the fixed-timestep step. Returns true when this step is
 * frozen (the caller must skip update() but still subtract FIXED_DT from the
 * accumulator so no time drifts). Decrements the counter on frozen steps.
 */
export function consumeHitstop() {
  if (remaining > 0) {
    remaining -= 1;
    return true;
  }
  return false;
}

/** True while a hit-stop window is active (debug overlay / tests). */
export function hitstopActive() {
  return remaining > 0;
}

/** Clear any pending freeze (zone transitions, resets, test hygiene). */
export function resetHitstop() {
  remaining = 0;
}
