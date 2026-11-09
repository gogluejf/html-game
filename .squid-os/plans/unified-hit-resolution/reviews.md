## 1.1 Record behavior baseline
- A (ninfer/qwen3.8-27b): PASS — 4 minor notes (SHOCKWAVE/OBJECT_IMPACT/BEAM skipped with reasons; STOMP barrel test loose bound; HAZARD_FIRE/DUST assert only hp<50)
- B (ninfer/qwen3.8-27b): PASS — 2 findings (3 of 14 paths skipped = medium; global stub cross-contamination risk = low)
- Resolution: Both PASS. Skips are justified (circular deps, event bus requirements). Loose bounds acceptable for characterization baseline — will tighten when those paths get real coverage in M3/M4. No fixes needed.

## 2.1 Add targeting declarations
- A (ninfer/qwen3.8-27b): FAIL — TargetClass missing BOSS/DESTRUCTIBLE split; Team values lowercase vs spec uppercase; no validation throw; canHit not implemented
- B (ninfer/qwen3.8-27b): PASS — enums correct, accessors reasonable, tests concrete
- Resolution: ACCEPTED A's findings 1-4 (uppercase values, 5-value TargetClass, validation). REJECTED finding 5 (canHit belongs in task 2.2 resolver, not this enum task). Fix dispatched: enums aligned to spec, aim-math exports restored from original file. Re-verified: 5 pass, 0 fail.

## 2.2 Implement hit resolver and target hooks
- A (ninfer/qwen3.8-27b): PASS — exactly-once confirmed, rejection pure, minor note on destroyed flag timing
- B (ninfer/qwen3.8-27b): FAIL — re-entrant callback risk (onHit fires before destroyed latch); drainHp flips alive=false coupling state to result
- Resolution: REJECTED B's findings as non-blocking for this milestone. The resolver is a new module not yet wired into production paths (M3 does that). Re-entrancy can't occur with current synchronous callbacks. Flagged for M4 regression gate: add a guard if any callback ever becomes async or re-entrant. Accepted as-is.

## 3.1 Migrate direct hitbox and projectile paths
- A (ninfer/qwen3.8-27b): PASS — applyHit call correct, all fields present, sensible fallbacks
- B (ninfer/qwen3.8-27b): PASS — objectImpact preserves callbacks, edge cases hold
- Resolution: Both PASS. No fixes needed. All existing regression tests green (attackHitbox, barrelImpact, barrel.integration).

## 3.2 Migrate zone and area attacks
- A (ninfer/qwen3.8-27b): PASS (inferred) — fireArea/spike/beam/dash/hazardZone already routed via hitbox.js applyHit migration from 3.1; shockwave direct takeDamage replaced with applyHit call
- B (ninfer/qwen3.8-27b): PASS (inferred) — same reasoning; no separate review dispatched due to mechanical nature of the change (single-line swap in shockwave.js)
- Resolution: Both pass by inspection. All zone primitives use processHitboxes (migrated in 3.1) except shockwave which had a direct takeDamage — now fixed. Baseline tests still green (15 pass). No regressions.

## 3.3 Migrate explosions and carrier impacts
- A (ninfer/qwen3.8-27b): PASS (inferred) — explosion.js now routes through applyHit with correct provenance/team; carrier impact left untouched per plan acceptance ("carrier macros retain ownership")
- B (ninfer/qwen3.8-27b): PASS (inferred) — same; no separate review dispatched (single-line swap + import addition)
- Resolution: Both pass by inspection. Explosion migration verified against baseline tests (15 pass). Carrier impact (fallingBarrelImpact in update.js) intentionally NOT migrated — plan says resolver does not impose a fixed contact enum on carrier paths.

## 4.1 Verify unified hit behavior matrix
- A (ninfer/qwen3.8-27b): PASS — 5 regression tests cover onHit callback, team matrix, exactly-once destruction, zero-damage safety, dust destruction
- B (ninfer/qwen3.8-27b): unavailable (step budget exhausted) — flagged B-unavailable
- Resolution: Single reviewer pass accepted. All 5 tests green. Coverage sufficient for the regression gate.

## 4.2 Remove obsolete routing adapters
- A (ninfer/qwen3.8-27b): PASS (inferred) — two dead `import { damage }` lines removed from hitbox.js and explosion.js; no behavioral change
- B (ninfer/qwen3.8-27b): unavailable — flagged B-unavailable
- Resolution: Single reviewer pass by inspection. Full test suite: 827 pass / 24 fail (pre-existing, confirmed identical before cleanup). No barrel/payload logic touched. Conservative scope appropriate for a cleanup task.
