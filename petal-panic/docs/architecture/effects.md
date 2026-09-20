# Petal Panic — Visual Effects Catalog

This document is the **conceptual source of truth** for the Effects Engine. It wins over code: if an implementation diverges from this spec, the implementation changes to match it (the same contract `knockback.md` holds for knockback).

Effects should remain primarily visual. Damage, collision, attack timing, and gameplay consequences belong to the appropriate gameplay systems. Attack Patterns can combine effects with collision volumes, sprites, audio, timers, and other systems.

---

## Effect Model

Every effect is a **data object**: `{ type, params }`. An effect has no behavior of its own in configuration — it is registered once by `type`, then instantiated with `params` when a trigger fires.

```js
// An effect instance is pure data until the engine instantiates it:
{ type: 'beam', params: { length: 120, width: 8, ... } }
```

### Carriers

An effect is **attached to a carrier** via declarative config. A carrier is anything that owns state the effect needs at fire time: a projectile, a hitbox, a collision event, a marker, or a radius (AoE area).

```js
// Carriers declare their effects in config; the engine reads them:
carrier.effects = [
  { on: 'collision',   type: 'particle-burst', params: { count: 12 } },
  { on: 'attackActive', type: 'beam',          params: { length: 120 } },
];
```

The engine's single fire path is: *carrier emits trigger event → engine looks up attached effects whose `on` matches → instantiates `{ type, params }` from the registry → runs the lifecycle*. Adding a new effect requires one file + one registration + one demo (a theater entry exercising it) — no engine change.

### Triggers

A fixed vocabulary of trigger events. Each catalog entry below lists the trigger(s) that fire it (see the Trigger Table). The current vocabulary:

- `spawn` — the carrier appears / is created
- `death` — the carrier (or its owner entity) dies
- `collision` — a collision involving the carrier resolves
- `explosion` — an explosion AoE detonates
- `pickup` — a collectible is picked up
- `damageTaken` — the hero takes damage
- `hitLanded` — an enemy is struck
- `attackActive` — the carrier's attack window opens (matches the attached hitbox)
- `stateChange` — the carrier enters a notable state (charge, stun, phase)
- `manual` — fired explicitly by game code (debug theater, scripted sequences)

### Continuous Activation

Some effects are active only while a condition holds rather than at a discrete moment. An effect may declare continuous activation alongside or instead of discrete triggers:

```js
{ on: 'collision', type: 'trail',
  continuous: { condition: 'moving' },   // spawn when condition becomes true, complete when it stops
}
```

Config shape: `{ continuous: { condition: 'moving' | 'fastMoving' } }`. The engine keeps **one instance** alive while the carrier satisfies the condition — spawning it when the condition starts and completing it when the condition ends. A continuous declaration can accompany discrete triggers (the effect fires on either).

### Lifecycle

Every effect instance runs the same lifecycle regardless of type:

1. **fire(trigger, carrier)** — instantiate with resolved `params` (values may be read from the carrier, e.g. beam orientation from its hitbox).
2. **update(dt)** — advance internal timers while active.
3. **render(ctx)** — draw; screen-space effects render after the camera transform is restored.
4. **complete** — removed from the active set when its duration elapses.

Effects may be procedural Canvas effects, sprite-based animations, or compositions of multiple smaller effects (see Effect Composition).

---

## Trigger Table

| # | effect | trigger(s) |
|---|--------|-----------|
| 1 | Particle Burst / Sparks | `collision`, `death`, `explosion`, `pickup`, `hitLanded` |
| 2 | Explosion | `explosion`, `death` |
| 3 | Debris | `death`, `explosion`, `collision` |
| 4 | Ground Wave | `attackActive` (paired with a moving collision volume) |
| 5 | Shockwave | `explosion`, `attackActive` |
| 6 | Trail | `spawn`, `attackActive`; continuous (`moving`) |
| 7 | Afterimage / Ghost Frames | `stateChange` (dash/supermove); continuous (`fastMoving`) |
| 8 | Telegraph Circle | `stateChange` (attack windup begins) |
| 9 | Ground Target Marker | `spawn` (projectile/missile created) |
| 10 | Target Reticle | `spawn` (lock-on acquired), `stateChange` |
| 11 | Damage Vignette | `damageTaken` |
| 12 | Sprite Flash | `hitLanded`, `stateChange`, `damageTaken` |
| 13 | Camera Shake | `explosion`, `hitLanded`, `attackActive` |
| 14 | Screen Flash | `explosion`, `stateChange` |
| 15 | Sprite Shake | `hitLanded`, `stateChange` |
| 16 | Impact Star / Hit Pop | `hitLanded`, `collision` |
| 17 | Fade Out | `death`, `stateChange` |
| 18 | Scale / Pulse | `stateChange`, `spawn` |
| 19 | Squash & Stretch | `stateChange` (jump/landing), `hitLanded` |
| 20 | Dust Cloud | `stateChange` (landing/run start), `collision` |
| 21 | Attack Arc / Slash | `attackActive` |
| 22 | Aura / Glow | `stateChange`, `spawn` |
| 23 | Screen Overlay | `stateChange` (boss phase / danger state) |
| 24 | Composite Explosion Burst | `death`, `explosion` |
| 25 | Heat Distortion *(experimental — out of scope for v1)* | `explosion` |
| 26 | Beam | `attackActive` (oriented to its attached hitbox) |

---

## 1. Particle Burst / Sparks

Spawns multiple small particles from a point or area.

Used for bullet impacts, melee hits, explosions, object destruction, landings, and death effects.

Parameters may include:
- Particle count
- Size
- Speed
- Direction / spread
- Lifetime
- Gravity
- Color
- Spawn radius

---

## 2. Explosion

Creates a localized explosion effect.

The explosion may be procedural or use an animated sprite sequence. Its visual size does not define its damage area; collision and damage remain separate.

Parameters may include:
- Size
- Duration
- Intensity
- Sprite / visual style
- Growth rate
- Position

---

## 3. Debris

Projects small visual fragments away from an impact or destroyed object.

Useful when destroying barrels, scenery, enemies, armor, platforms, or boss components.

Parameters may include:
- Fragment count
- Initial velocity
- Direction
- Gravity
- Rotation
- Lifetime
- Size

---

## 4. Ground Wave

Creates a visual wave that travels horizontally along the ground.

Commonly paired with a moving collision volume by an Attack Pattern for stomps, earthquakes, or ground-based attacks.

Parameters may include:
- Direction
- Speed
- Distance
- Height
- Width
- Duration
- Visual style

---

## 5. Shockwave

Creates a circular ring originating from a point and rapidly expanding outward.

Useful for explosions, boss impacts, stomps, power releases, and large attacks.

Parameters may include:
- Starting radius
- Maximum radius
- Expansion speed
- Thickness
- Opacity
- Duration

---

## 6. Trail

Creates a visual trail behind a moving entity.

Useful for projectiles, missiles, fast attacks, dashes, particles, and other high-speed movement.

Parameters may include:
- Length
- Width
- Lifetime
- Opacity
- Density
- Offset

---

## 7. Afterimage / Ghost Frames

Creates temporary translucent copies of a moving sprite behind its current position.

Useful for fast hero movement, dashes, supermoves, rapid boss movement, or attacks that need an exaggerated sense of speed.

Parameters may include:
- Number of afterimages
- Spawn interval
- Lifetime
- Opacity
- Fade rate
- Offset

---

## 8. Telegraph Circle

Displays a warning circle before an attack occurs.

The circle may shrink toward its center as the attack approaches. When the countdown completes, the Attack Pattern can trigger the actual attack.

Useful for boss attacks, stomps, explosions, area attacks, and delayed hazards.

Parameters may include:
- Radius
- Duration
- Shrink rate
- Opacity
- Thickness
- Position
- Follow target / fixed position

---

## 9. Ground Target Marker

Displays a target marker at a world position on the ground.

Useful for missiles, falling objects, bombs, artillery, or attacks arriving from above. The marker can remain fixed, allowing the player to escape the danger area before impact.

Parameters may include:
- Position
- Radius
- Duration
- Animation
- Rotation
- Pulse rate
- Opacity

---

## 10. Target Reticle

Displays a targeting reticle at an arbitrary XY position or attached to an entity.

Unlike the fixed ground marker, this effect can follow a moving hero, enemy, projectile, or other entity.

Useful for homing missiles, lock-on attacks, sniper-style targeting, and tracking attacks.

Parameters may include:
- Target entity / position
- Duration
- Size
- Rotation speed
- Pulse rate
- Offset
- Follow mode

---

## 11. Damage Vignette

Applies a temporary visual overlay around the edges of the screen when the hero takes damage.

Similar to damage feedback used in action games where the center remains visible while the edges become tinted or darkened.

Parameters may include:
- Color
- Opacity
- Duration
- Fade-in
- Fade-out
- Intensity

---

## 12. Sprite Flash

Temporarily flashes or tints a sprite.

Useful for damage feedback, invincibility, power-ups, attack charging, or state changes.

Parameters may include:
- Color
- Duration
- Flash frequency
- Number of flashes
- Opacity
- Blend intensity

---

## 13. Camera Shake

Temporarily shakes the game camera.

All world-space objects move together while HUD/UI elements normally remain stable.

Useful for explosions, boss landings, heavy melee attacks, earthquakes, and major impacts.

Parameters may include:
- Intensity
- Duration
- Frequency
- Horizontal strength
- Vertical strength
- Decay

---

## 14. Screen Flash

Briefly overlays the entire gameplay viewport with a color.

Useful for explosions, lightning, supermoves, boss transitions, and very strong impacts.

Parameters may include:
- Color
- Maximum opacity
- Duration
- Fade-in
- Fade-out

---

## 15. Sprite Shake

Applies localized jitter to a single sprite without moving the camera.

Useful for charging attacks, stunned enemies, anticipation, rage, machinery, or impact reactions.

It can be combined with Camera Shake when a stronger effect is required.

Parameters may include:
- Horizontal intensity
- Vertical intensity
- Frequency
- Duration
- Decay

---

## 16. Impact Star / Hit Pop

Creates a very short visual pop at the exact point of impact.

Typically represented by a small star, burst, flash, or stylized hit shape.

Useful for punches, kicks, bullets, melee contacts, and lighter impacts.

Parameters may include:
- Size
- Duration
- Rotation
- Opacity
- Style
- Scale curve

---

## 17. Fade Out

Gradually reduces a sprite or visual object's opacity until it disappears.

Useful after enemy death animations, destroyed objects, temporary entities, summoned objects, or disappearing effects.

Parameters may include:
- Starting opacity
- Ending opacity
- Duration
- Delay
- Fade curve

---

## 18. Scale / Pulse

Temporarily grows and/or shrinks a visual element.

Useful for charging attacks, pickups, warnings, power-ups, target indicators, impacts, and environmental objects.

Parameters may include:
- Starting scale
- Maximum scale
- Minimum scale
- Duration
- Pulse frequency
- Loop count

---

## 19. Squash & Stretch

Temporarily distorts the scale of a sprite along its X and Y axes.

Useful for landings, jumps, boss stomps, impacts, bouncing objects, and exaggerated cartoon movement.

Parameters may include:
- X scale
- Y scale
- Duration
- Recovery duration
- Intensity

---

## 20. Dust Cloud

Creates dust, smoke, or small ground particles around a contact point.

Useful for landings, running starts, slides, boss stomps, impacts, and ground movement.

Parameters may include:
- Particle count
- Spread
- Size
- Velocity
- Lifetime
- Opacity
- Gravity

---

## 21. Attack Arc / Slash

Creates a fast visual arc representing the path of a melee attack.

Useful for claws, blades, ribbons, cymbals, sweeping attacks, and other fast melee actions.

Parameters may include:
- Arc angle
- Radius
- Thickness
- Duration
- Orientation
- Opacity
- Follow entity

---

## 22. Aura / Glow

Creates a glow or aura around or behind a sprite.

Useful for invincibility, power-ups, boss states, charged attacks, special abilities, or supernatural effects.

Parameters may include:
- Radius
- Opacity
- Pulse rate
- Intensity
- Color
- Duration
- Offset

---

## 23. Screen Overlay

Applies a temporary visual layer over the entire gameplay viewport.

Unlike Screen Flash, this effect can remain active for a longer period and change gradually.

Useful for danger states, boss phases, environmental mood, poison-like states, special sequences, or dramatic transitions.

Parameters may include:
- Color
- Opacity
- Duration
- Fade-in
- Fade-out
- Blend mode

---

## 24. Composite Explosion Burst

Creates multiple explosion effects at randomized positions and times inside a defined area.

This is intended for large boss deaths, machinery destruction, large objects, or Contra-style chained explosions.

The effect acts as a compositor: it repeatedly spawns smaller Explosion, Particle Burst, Debris, Flash, or other effects within its area.

Parameters may include:
- Radius / area
- Explosion count
- Spawn interval
- Random timing variance
- Random position variance
- Child effect
- Child size range
- Duration
- Density

Example:

A boss enters its death state. Over two seconds, explosions appear at random locations across its body while sparks and debris are generated. The boss sprite can simultaneously shake and fade out.

---

## 25. Heat Distortion *(experimental — out of scope for v1)*

Creates the appearance of heated air or visual distortion around explosions, fire, machinery, or other heat sources.

A simple Canvas implementation may simulate the effect using animated translucent distortion-like sprites. True dynamic distortion of the rendered scene would likely require WebGL/shader-based rendering.

This effect is **experimental and out of scope for v1**. It must not be considered a required capability of the initial Effects Engine; it is documented here only so the catalog stays complete. It may be implemented later as any other `{ type, params }` effect without engine changes.

Potential parameters:
- Area
- Intensity
- Distortion amount
- Animation speed
- Opacity
- Duration

---

## 26. Beam

A directional rectangular beam — a lightsaber-style strike that extends from an origin along an axis, with a bright core and an alpha-gradient halo around it.

Fired on `attackActive` from its **attached hitbox**: the beam's origin is captured once at fire time, while its orientation continuously tracks the attached hitbox for the beam's lifetime. So the beam always visually matches the collision volume that actually deals damage, even if the carrier re-orients between frames.

Lifecycle: **flash-in then fade-out**. On fire the beam ramps from zero to full intensity over the flash-in time (a quick "ignition"), holds at full strength for the middle of its life, then fades to zero over the fade-out time ("extinguish"). Total lifetime = flashIn + hold + fadeOut (hold may be zero for a pure pulse).

Rendering: a filled rectangle (length × width) rotated to the hitbox orientation, plus a halo drawn as layered strokes/fills with decreasing alpha out to the gradient radius — brightest at the core, transparent at the halo edge. No blur passes; the gradient is achieved with stacked alpha layers so it stays cheap on Canvas 2D.

Parameters:
- `length` — beam length in px (may default to the hitbox dimension along its axis)
- `width` — beam core width in px
- `gradientRadius` — halo extent beyond the core, in px
- `color` — core/halo color
- `flashInTime` — ignition ramp duration (s)
- `fadeOutTime` — extinguish ramp duration (s)
- `holdTime` — full-intensity hold between flash-in and fade-out (s, optional, default 0)
- `origin` — beam start point in world coordinates; defaults to the corner of the attached hitbox nearest the carrier's facing point (or the hitbox center if the hitbox has no facing)
- `orientation` — beam axis; defaults to the attached hitbox's long axis, resolved from the carrier's facing when the hitbox is square

Example config:

```js
// A lightsaber slash: the beam mirrors the slash hitbox exactly.
slashHitbox.effects = [
  { on: 'attackActive', type: 'beam',
    params: { length: 120, width: 8, gradientRadius: 14,
              color: '#8ef', flashInTime: 0.05, fadeOutTime: 0.15 } },
];
```

---

# Effect Composition

Effects are intentionally small and reusable. More sophisticated visuals should normally be created by combining effects rather than implementing a new monolithic effect.

For example, a boss death could compose:

`Sprite Shake + Composite Explosion Burst + Particle Burst + Debris + Camera Shake + Screen Flash + Fade Out`

A ground stomp could compose:

`Telegraph Circle + Sprite Animation + Dust Cloud + Ground Wave + Shockwave + Camera Shake`

A hero supermove could compose:

`Aura + Afterimage + Trail + Sprite Flash + Particle Burst + Screen Flash`

Compositions are themselves data: a list of `{ type, params }` entries sharing a trigger. The Attack Engine determines **when and why** these effects occur. The Effects Engine determines **how they are visually rendered**.

# Core Rule

**Effects describe presentation, not gameplay truth.**

An explosion effect does not deal damage.

A Ground Wave does not hit the player.

A Target Marker does not launch a missile.

A Telegraph Circle does not execute an attack.

Those gameplay behaviors are composed by the Attack Engine using Collision, Effects, Sprite/Animation, Audio, and other systems.
