# Immunity States — Concept

## The idea

An entity can enter special **states** that change how the world treats it.
A state is a property of the ENTITY, not of any one system: damage, collision,
and contact rules all read the same flag, so they can never disagree.

There are exactly three states. They answer three different questions:

| Question | State |
|---|---|
| Can I be hurt? | `invincible` |
| Does touching me hurt *them*? | `starPower` |
| Am I part of the collision world at all? | `intangible` |

That's the whole vocabulary. Anything else (blink, flicker, color cycle) is a
**visual effect** — a costume the state wears, decided by the render layer.
States never know how they look; looks never decide behavior.

## The three states

### 1. Invincible — "can't be hurt"

- Damage dealt TO this entity is ignored.
- The entity is still a normal body: it collides with walls and enemies,
  enemies bump into it, and its own attacks still work.
- Always has a defined end (a time window or an event).

Think of it as a shield around the body. The body is still there.

### 2. Star Power — "I'm the danger now"

- Everything invincible gives (can't be hurt), PLUS:
- Touching an enemy kills it on contact — no attack, no hitbox needed.
  The body itself is the weapon.
- Still a normal body in the collision world.

This is the mario-star. It IMPLIES invincible — you never set one without
the other, and they end together.

### 3. Intangible — "I'm not here"

- The entity leaves the collision system entirely: nothing blocks it,
  it blocks nothing, nothing can touch it.
- It keeps its motion (gravity, velocity) but the world is ghosted to it.
- Because nothing can touch it, it also can't be hurt — but that's a
  side effect of being untouchable, not a damage rule.

Think of it as phasing out of reality. Unlike the other two, this changes
PHYSICS, not just damage.

## How they combine

The states are independent switches, but in practice:

- `starPower` always rides on top of `invincible` (one lifetime, one end).
- `intangible` is used alone — a ghost doesn't need a shield.
- No entity ever needs all three.

## Triggers, states, effects, impact

| Trigger | State | Visual effect | Impact (behavior) |
|---|---|---|---|
| Take a hit | invincible (short window) | transparent blink | takes no damage; still solid — enemies bump you, your attacks work |
| Respawn / level entry | invincible (grace window) | transparent blink | same as above |
| Star powerup pickup | starPower + invincible (star window) | color-cycle flicker | takes no damage; touching an enemy kills it (launch + hitstop + shake); still solid |
| Supermove trigger | invincible (for as long as the supermove plays) | none — speed sells it | takes no damage; dash hitbox live; still a normal body in the world |
| Barrel cooking | intangible (until detonation) | none | passes through everything, hits nothing, is hit by nothing |

Two ways a state gets its length, both legitimate:

- **Duration-based** — "lasts N seconds" (hit i-frames, respawn grace, star).
  The state owns a countdown and ends itself.
- **Event-based** — "lasts until X happens" (supermove: from trigger to end,
  including early jump-cancel). The state borrows the lifetime of the thing
  that started it.

Both funnel through the same start/stop rules, so behavior is identical
regardless of which shape the trigger has.

## Rules

1. **One owner per state.** A state is started and stopped in exactly one
   place each. Triggers call the state; they never fiddle with the flag,
   the timer, or the visual directly.
2. **Scoped endings.** When a state ends, only THAT state's grant is removed.
   A supermove ending never eats a star picked up mid-dash; a star expiring
   never touches hit i-frames.
3. **Visuals follow states automatically.** The render layer asks "what state
   are you in?" every frame and picks the matching look. No trigger site
   knows what anything looks like.
4. **States are entity-level.** Any entity can hold any state — hero, barrel,
   boss, projectile. The rules don't change per entity type.

## Examples

- **Hero gets swatted by a boss.** → invincible for a short window. The hero
  blinks, slides under the knockback, and can't be re-hit while blinking —
  but a wall still stops him and his next punch still works.
- **Hero grabs the star.** → starPower + invincible for the star window.
  The hero ripples through colors, walks straight through a row of enemies
  and every one of them pops with a launch. Walls still stop him.
- **Hero fires the supermove.** → invincible for the whole move, from trigger
  to end. If he jump-cancels it early, the immunity ends early too — exactly
  when the move does, no leftovers. No visual: the speed IS the effect.
- **Barrel starts cooking.** → intangible until it detonates. It rolls clean
  over spikes, through platforms, past enemies — the world simply isn't
  there for it. At detonation it snaps back into the collision world.
