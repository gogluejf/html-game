# Hitbox Engine — Concept

## What a hitbox is

A hitbox is a **damage zone** that exists in world space for some number of frames
during an animation. When a target's collision box overlaps the hitbox, damage is
dealt — once per target per animation instance.

A hitbox is NOT:
- An entity (no position of its own in the world, no layer, no pool lifetime)
- A projectile (doesn't travel, doesn't have velocity)
- Tied to a specific attack type (the engine doesn't know "melee" vs "dash" vs
  "whip" — it only reads team + box + damage)

## The frame sequence

Every attack is driven by an animation. Each frame of that animation either
**has a hitbox** or **does not**. The engine checks every tick:

```
frame has box? → yes → overlap check → damage (if target not already in hitSet)
frame has box? → no  → nothing happens
```

There is no hardcoded "active frame index." The box exists on whatever frames
the data says it exists. This means:

- A quick jab might have a box on 1 frame only.
- A wide arc might have a box on frames 2–4 with different shapes each frame.
- A dash might have a box on frames 1–8 following the hero.

The box can **change shape and position** between frames. The engine doesn't care.

## One hit per target per animation instance

This is the core rule. No matter how many frames the box is alive, no matter how
many ticks the box overlaps a target, **each target takes damage at most once
per animation play**.

### How it works

Each hitbox carries a `hitSet` (a Set of target references). On overlap:

1. Is this target already in the set? → skip.
2. No → deal damage, add target to set.

When does the set reset? **When a new animation instance begins.** Concretely:
when the box transitions from "not present" to "present" (null → non-null),
the engine calls `resetHitbox()` which clears the set.

### Examples

| Scenario | Result |
|----------|--------|
| Melee swing, box on frame 3 only, enemy in box | Enemy takes 1 hit. Frame ends. Done. |
| Supermove dash, box on frames 1–8, enemy in box on frame 3 | Enemy takes 1 hit on frame 3. Frames 4–8: skipped (in set). |
| Combo: swing 1 hits enemy, swing 2 (new instance) hits same enemy | Two separate instances → two separate hits. |
| Dash plows through 5 enemies | Each takes 1 hit. All added to the same set. |

## Team routing

The hitbox doesn't know "I'm friendly" or "I'm an enemy." It knows one field:
`team`. The engine uses that to decide which target layers to check against.

| Team | Hits these layers |
|------|-------------------|
| `ally` | ENEMY, BOSS, SOLID |
| `foe` | HERO |
| `neutral` | HERO, ENEMY, BOSS, SOLID (explosions, hazards) |

One code path handles all teams. No special casing.

## Damage routing

When overlap is confirmed and the target isn't in the hitSet:

1. Call `target.takeDamage(dmg, owner, method)` if it exists (enemies run death pipeline).
2. Else call `target.hit(dmg, owner, method)` if it exists (barrels/objects).
3. Else fall back to central `damage(source, target, amt, method)`.

Defense mitigation, minimum-1 floor, telemetry, and death flagging all happen
inside `damage()`. The hitbox system never does HP math itself.

## Adding a new attack

To give any entity (hero, enemy, boss) a new attack:

1. **Create the animation** with N frames.
2. **Define per-frame hitbox data** (from your sprite editor or manually):
   which frames have a box, what size/position.
3. **Expose a getter** on the entity that returns the world-space AABB for the
   current frame, or `null` if no box on this frame.
4. **Register a slot** in the update system pointing at that getter, with:
   - `team`: who it hits
   - `damage`: raw amount (or a function)
   - `method`: telemetry label

That's it. The slot lifecycle (activate, reset-on-first-frame, deactivate) is
handled generically. You don't touch the hitbox processing loop.

## Slot lifecycle

```
box appears (null → value)  → activate slot, reset hitSet (fresh instance)
box persists (value → value) → stay active, hitSet prevents re-hits
box disappears (value → null) → deactivate slot, flag ready for next instance
```

This is identical for melee swings, supermove dashes, enemy whips, boss attacks,
and anything else. One pattern, zero duplication.

## What the engine does NOT do

- Does not decide which frames have boxes (that's your data / editor)
- Does not animate the box (it just reads the getter each tick)
- Does not handle knockback or VFX (the `onHit` callback does)
- Does not manage cooldowns between attacks (that's the entity's job)
- Does not know about combos (a combo is just multiple animation instances
  chained by input/cooldown logic)
