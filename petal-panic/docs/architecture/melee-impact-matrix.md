# Melee Impact Matrix

Current melee-family contract. No separate finisher attack or automatic
last-hit force bonus: **surviving hit = chip kick; death release = strong kick**.

Velocities below are px/s before victim resistance and direction resolution.
Ghost means intangible flight. Barrel fuse means a 0.6s cook before break/boom.

## Attack structure

| Move | Mode | Contact source | Hits per target | Plow | Full invincibility |
|---|---|---|---|---|---|
| Melee (standing / running / airborne) | Multi-hit | Sheet boxes named `hit` | Once per authored hit frame | Whole attack | No |
| Super melee (sweep) | Single-hit | Sheet boxes named `hit` | Once per attack | Whole attack | No |
| Supermove (dash) | Multi-hit | Sheet boxes named `hit` | Once per authored hit frame | Whole attack | Whole attack |

- `durUnits` controls animation duration only, never hit eligibility.
- Holding one hit frame for several updates does not repeat its hit.
- Adjacent authored hit frames are separate windows in multi-hit mode.
- Frames without a `hit` box cannot connect.
- The last hit window is the final authored frame containing a `hit` box.
  It controls pin release, not a force bonus for survivors.
- All three moves enable plow independently of single/multi-hit mode.
- Supermove lethal launch follows the attack-start facing, even when blocked.
- Plow controls body contact; full damage immunity is a separate setting.
  Existing clean-connect protection for melee/sweep remains separate too.

## Kick forces — enemies and barrels

| Move | Surviving hit | Earlier would-be lethal hit | Lethal release |
|---|---|---|---|
| Melee (all variants) | 450, −120 | Pin + 450, −120 | 750, −260 |
| Super melee (single-hit sweep) | 550, −180 | Not applicable | 750, −330 |
| Supermove | 300, −120 | Pin + 300, −120 | 850, −260 |

**Lethal release** means a single-hit attack kills, or the last window of a
multi-hit attack hits a pinned target or kills an unpinned target.
A survivor on the last window still receives the **surviving-hit** vector.
Existing damage and vector values are unchanged by the refactor.

## Multi-hit death sequence

| Event | Enemy | Barrel |
|---|---|---|
| Earlier hit survives | Damage + chip kick | Damage + chip kick |
| Earlier hit would kill | Pin; chip kick; no death animation or ghost | Pin; chip kick; no break, fuse, coins or boom |
| Later non-last hit touches pinned target | No further damage; chip kick | No further damage; chip kick |
| Last window hits a survivor | Damage + chip kick | Damage + chip kick |
| Last window kills or hits a pinned target | Strong kick + death animation + ghost | Strong kick + ghost + fuse, then break/boom |
| Attack ends with target still pinned | Death in place, no launch | Break/boom in place, no launch |

Pinned means **death is scheduled**, not frozen position or forced HP=0.
The body remains physical, hittable and chip-kickable. Pinning does not
itself set HP to zero in the implementation.

The owning attack releases its remaining pins on end, including cancellation
or owner death. A target already released by the last window is not released
again. Single-hit attacks never pin: lethal hits release immediately.

## Hitstop and screen shake

| Attack | Chip hitstop | Lethal hitstop | Chip shake | Lethal shake |
|---|---|---|---|---|
| Melee (all variants) | 0 | 0 | 2px | 6px |
| Super melee | 0 | 0 | 2px | 6px |
| Supermove | 4 frames | 8 frames | 4px | 6px |

Four configurable values per attack, selected per target by outcome—not by
frame position. The same profile applies to enemies and barrels.

- **Chip:** survivors (even on the last window), earlier would-be lethal hits
  that pin, and earlier contacts with pinned targets.
- **Lethal:** single-hit kill, or last-window contact that releases a pinned
  target or makes a fresh kill.
- Ending an attack with unreleased pins is cleanup, not a connecting hit; it
  does not award impact hitstop/shake.
- Shake and hitstop use max-merge, not additive stacking.
- Barrel detonation shake is separate from the lethal impact shake.

Tuning: `MELEE_IMPACTS` in `js/combat/meleeImpact.js`.

### Barrel detonation shake

| Barrel type | Detonation shake |
|---|---|
| Explosive / propane | 4px |
| Supercoin | 14px |
| Toxic | 6px |
| Wood / coin | None |

## Scope and implementation

Star touch and projectile attacks retain their separate behavior; this
refactor changes the three hero melee-family attacks only.

- `js/hero/attacks/baseAttack.js`: shared hit-window tracking, plow/protection lifecycle and owned-pin cleanup.
- `js/hero/attacks/meleeAttack.js`: melee, including run/air sheet selection.
- `js/hero/attacks/sweepAttack.js`: super melee.
- `js/hero/attacks/supermoveAttack.js`: supermove.
- `js/hero/heroDefs.js`: existing kick vectors.
- `js/combat/meleeImpact.js`: chip/lethal hitstop and shake tuning.
- `js/combat/hitbox.js`: impact, pin eligibility and lethal release.
- `js/combat/pin.js`: deferred death and release.
- `js/objects/barrelPhysics.js`: barrel fuse/launch lifecycle.

Some internal identifiers still use the old terminology (for example
`releaseFinisher` and `SUPERMOVE_FINISHER_HITSTOP`). These are legacy names
for last-window release/timing, not an additional attack mechanic.
