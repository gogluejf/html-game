# Movement Model — Goal-Based Velocity (Design)

## Core Principle

All entity movement uses ONE pattern: **set a velocity or a velocity goal, the update loop lerps toward the goal at an accel rate.**

No scattered friction constants. No 10 special cases for vx. One rule.

## The Math

```js
// In update() — ONE place, applies to all entities:
vx += (vxGoal - vx) * accel * dt
vy += (vyGoal - vy) * gravAccel * dt
x += vx * dt
y += vy * dt
```

- `vx` / `vy` = current speed (what you're actually doing)
- `vxGoal` / `vyGoal` = target speed (what you're aiming for)
- `accel` = how fast you approach the goal (entity property, weight-based)
- `gravAccel` = how fast vy approaches vyGoal (gravity "pull")

That's it. No `vx *= 0.85`. No `vx = targetVx` snap. No separate friction branch.

## Who Sets What

| Event | What gets set | Why |
|-------|---------------|-----|
| Player input (run right) | `vxGoal = +runSpeed` | "I want to be moving right" |
| Player releases input | `vxGoal = 0` | "I want to stop" |
| Jump | `vy = -jumpSpeed` (direct) | Instant impulse, not a goal |
| Gravity (always) | `vyGoal = +terminalVelocity` | "The universe wants me falling at terminal" |
| Knockback (explosion) | `vx = 800`, `vy = -800` (direct) | Slap the velocity, goal stays 0 or terminal |
| Wall bounce | `vx = -vx * bounceDamping` (direct flip) | Goal unchanged, lerp bleeds it off |
| Stunned / hitstun | `vxGoal = 0` | "I can't move," lerp decays velocity naturally |
| Supermove | `vx = SUPERMOVE_SPEED` (direct override) | Committed trajectory, bypasses goal |
| Carrying / riding | `vx = carrier.vx` (direct) | Locked to another entity |
| Teleport | `x = newX`, `vx = 0` | Position jump, velocity reset |

## Accel Comes From Entity + Surface

```js
// Entity properties:
entity.weight        // 1 = normal, 0.5 = light, 2 = heavy
entity.baseAccel     // tuning knob per character type

// Surface modifier:
surface.grip        // ground = 1.0, ice = 0.3, metal = 0.7

// Effective accel:
accel = entity.baseAccel * surface.grip / entity.weight
```

- Light hero on ground: high accel → snappy start/stop
- Heavy hero on ice: low accel → slidy, floaty
- Barrel on ground: medium accel → natural roll-to-stop
- Projectile in air: no surface → just gravity applies to vy

## Ground vs Air

Not a separate code path. Just different surface:
- `grounded` → `surface.grip = 1.0` (or whatever the floor material is)
- `!grounded` → `surface.grip = airGrip` (low, like 0.1-0.2 → floaty glide)

Same math. Different number. No `if (grounded) vx *= 0.85 else coast`.

## Gravity Is a Goal Too

```
vyGoal = +terminalVelocity   // e.g. +800 (Y-down is positive)
vy += (vyGoal - vy) * gravAccel * dt
```

- You jump: `vy = -600` (upward)
- Goal is +800, so vy lerps: -600 → 0 → +400 → +800
- Natural arc: up, slow, apex, fall, settle at terminal
- No `if (vy > MAX_FALL) vy = MAX_FALL` clamp needed — lerp can't overshoot the goal

## Why Not Force-Based (vy += gravity * dt)?

Force-based is fine for **dumb objects** (particles, coins in flight). But for entities with intent (player, enemies, barrels that should stop), goal-based gives:
- Tunable feel via one number (accel)
- Built-in terminal velocity (no clamps)
- Consistent ground/air behavior (same math, different grip)
- Knockback "just works" (set vx, goal pulls it back to 0)
- No edge cases (friction only when grounded, etc.)

## What This Replaces

| Today | Tomorrow |
|-------|----------|
| `vx *= GROUND_FRICTION` (×0.85) | Lerp toward vxGoal=0 at accel rate |
| `vx = targetVx` (ground snap) | `vxGoal = targetVx`, lerp does it (high ground accel ≈ instant) |
| `vx += sign * step` (air ramp) | Same lerp, lower air accel |
| `vx = moveDir * |vx|` (air reversal) | `vxGoal = -runSpeed`, lerp flips direction |
| `vx += kb` (knockback impulse) | `vx = kb` (set directly), goal decays it |
| `vy += GRAVITY * dt` + MAX_FALL clamp | `vyGoal = +terminal`, lerp handles it |
| 10 places that set vx | 1 lerp in update() + systems that set goals/impulses |

## What Does NOT Change

- Collision resolution (resolve(), overlap push-out) — same
- Hitstop (skip update frames) — same
- Direct position writes (teleport, snap-to-surface) — same
- Object physics for pure projectiles (coins, particles) — can stay force-based if simpler
- Animation/state machine — reads vx/vy same as today

## Reference Implementation

This pattern already exists in the **enjfine** engine (Python, Thumby-based):

- Repo: `https://github.com/gogluejf/enjfine`
- Core math: `src/enjfine/enjfine.py` → `class Point` (velocityGoal, velocity, vAcceleration)
- Update loop: `src/enjfine/animator.py` → `Animator.updatePoint()` + `Animator.__approach()`

The `__approach(goal, current, step)` function IS the lerp: move `current` toward `goal` by at most `step` per frame. Step = `accel × dt`. Bounce = flip both goal and current. That's the whole system.

Petal-panic JS should port this same pattern. The math is proven, it just was never ported.

## Status

**Design only. Not implemented.** Current code still uses the old impulse+friction model.
This doc captures the target architecture for when we do the refactor.
