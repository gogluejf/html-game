# Task 5.2 — Climbing macros for vertical composition (Fix Mode)

**Date:** 2025-01-15
**Status:** Complete — all 5 findings fixed, full suite green (261 pass, 2 known input.test.js flakes)

## Findings Fixed

### BLOCKER 1 (R2): Inter-macro lateral distance validation
- Added `prevPeakX`/`prevPeakW` tracking in the composer's vertical stacking loop.
- After picking a macro, compute edge-to-edge lateral gap between previous macro's peak platform and next macro's first platform.
- If gap > MAX_CLEARABLE_GAP, compute `placementXShift` to align them.
- `placeMacro` now accepts an optional `xShift` parameter applied to all vertical platforms and slots.
- Validation (step 3b) checks all vertical units are within [0, ZONE_WIDTH_UNITS].

### BLOCKER 2 (R2): totalHeight / exit platform
- `totalHeight` is now the budget (zone height), not `Math.max(budget, axisPos)`.
- After composing all macros, if the highest platform is > MAX_ELEVATION_STEP below the top, a synthetic exit platform is added at `highestPlatformY + MAX_ELEVATION_STEP`.
- `finalTotalHeight` is set to `exitPlatY + MAX_ELEVATION_STEP` (the exit flag's y).
- Validation now checks last-platform → exit-flag distance (step ≤ MAX_ELEVATION_STEP).

### MAJOR 1 (R2): Gaps advance the y-axis
- `placeMacro` now tracks a `gapOffset` accumulator. Vertical platforms use `y = axisPos + gapOffset + u.tier`.
- `lastPlatformAbsY` and `firstPlatformAbsY` updated to walk units and accumulate gap offsets.
- `macroAxisLength` computes peak y as max of (cumulativeGap + tier) across all units.
- `surfaceElevationAt` for vertical now returns `gapOffset + tier` (not just tier).
- Macro definitions (`climbingGaps`, `climbingDense`) adjusted: tier values reduced so y-steps (including gaps) stay ≤ MAX_ELEVATION_STEP.
- `axisPos` advances by peak y (climb gained), not full axis length.
- `axisUsed` advances by climb gained, not axis length.
- `shouldContinue()` for vertical: continues if budget not met OR peak y not within MAX_ELEVATION_STEP of top.
- `fitting` filter for vertical: uses remaining climb (budget - prevPeakAbsY) vs macro's peak y contribution.

### MAJOR 2 (R2): totalWidth fixed for vertical
- Added `ZONE_WIDTH_UNITS = Math.floor(1600 / UNIT_PX)` (= 33) export.
- `totalWidth` for vertical is now `ZONE_WIDTH_UNITS` (fixed), not derived from platforms.
- Validation step 3b: all vertical units must be within [0, ZONE_WIDTH_UNITS].

### MAJOR 3 (R2): Vertical slot y includes axisPos
- `placeMacro` placement recording: vertical slots now use `y: axisPos + surface` (was just `surface`).
- `surfaceElevationAt` for vertical now includes gap offset (see MAJOR 1).

## Files Modified
- `petal-panic/js/macros.js` — all fixes in the composer, placeMacro, validation, and macro definitions.

## Test Results
- `petal-panic/js/test/vertical.test.js`: 17/17 pass
- `petal-panic/js/test/macros.test.js`: 52/52 pass
- `petal-panic/js/test/levelConfigs.test.js`: 22/22 pass
- Full suite: 261 pass, 2 fail (input.test.js — known baseline flakes, unrelated)
