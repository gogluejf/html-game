# Petal Panic — Visual Effects Catalog

The Effects Engine provides a reusable, parameterized library of visual effects. Each effect is described by a type and a set of parameters; an effect carries no behavior in its configuration — it is registered once by type, and instantiated with parameters when a trigger fires.

Effects should remain primarily visual. Damage, collision, attack timing, and gameplay consequences belong to the appropriate gameplay systems. Attack Patterns can combine effects with collision volumes, sprites, audio, timers, and other systems.

Effects may be procedural Canvas effects, sprite-based animations, or compositions of multiple smaller effects.

---

## Effect Model

Every effect is described by a **type** and a set of **parameters**. An effect has no behavior of its own while it is being configured — it is pure description. A given type is registered once with the engine, and each time a matching trigger fires, a fresh instance of that effect is created using the declared parameters. The same type can therefore be reused across many different situations simply by supplying different parameters.

## Carriers

An effect is attached to a **carrier** — anything that owns the state the effect needs at fire time. A carrier might be a projectile, a hit area, a collision event, a marker, or an area-of-effect region. A carrier declares which effects it carries and on which trigger each one fires. When the carrier's trigger occurs, the engine instantiates the declared effects, reading any values they need from the carrier at that moment.

## Triggers

A fixed vocabulary of trigger events. Each catalog entry below lists the trigger(s) that fire it (see the Trigger Table). The current vocabulary:

- **spawn** — the carrier appears / is created
- **death** — the carrier (or its owner entity) dies
- **collision** — a collision involving the carrier resolves
- **explosion** — an explosion area detonates
- **pickup** — a collectible is picked up
- **damage taken** — the hero takes damage
- **hit landed** — an enemy is struck
- **attack active** — the carrier's attack window opens (matching its attached hit area)
- **state change** — the carrier enters a notable state (charge, stun, phase)
- **manual** — fired explicitly by game code (debug theater, scripted sequences)

## Continuous Activation

Some effects are active only while a condition holds rather than at a single moment — for example, a trail while moving, or afterimages while moving fast. For these, a single instance stays alive for as long as the condition holds: it starts when the condition begins and ends when the condition stops. A continuous activation can accompany discrete triggers, so the same effect may fire on either.

## Lifecycle

Every effect instance runs through the same stages regardless of type:

1. **Fired** — the effect is instantiated with its parameters, possibly reading values from its carrier at that moment.
2. **Updated** — the effect advances over time while it is active.
3. **Rendered** — the effect draws itself each frame.
4. **Completed** — the effect is removed once its duration elapses.

**Two-pass rendering.** Effects live in one of two spaces. Some are in **world space** — they move with the world and the camera (for example, an impact star at a point in the scene). Others are in **screen space** — fixed to the viewport, like overlays and flashes. The renderer draws them in two passes: world-space effects are drawn within the world view, and screen-space effects are drawn after the camera transform is applied, so overlays stay put relative to the screen rather than drifting with the world.

## Trigger Table

| # | effect | trigger(s) |
|---|--------|-----------|
| 1 | Particle Burst / Sparks | spawn, death, collision, explosion, pickup, hit landed |
| 2 | Explosion | explosion, death |
| 3 | Debris | death, explosion, collision |
| 4 | Ground Wave | attack active (paired with a moving collision volume) |
| 5 | Shockwave | explosion, attack active |
| 6 | Trail | spawn, attack active; continuous (moving) |
| 7 | Afterimage / Ghost Frames | state change (dash/supermove); continuous (fast moving) |
| 8 | Telegraph Circle | state change (attack windup begins) |
| 9 | Ground Target Marker | spawn (projectile/missile created) |
| 10 | Target Reticle | spawn (lock-on acquired), state change |
| 11 | Damage Vignette | damage taken |
| 12 | Sprite Flash | hit landed, state change, damage taken |
| 13 | Camera Shake | explosion, hit landed, attack active |
| 14 | Screen Flash | explosion, state change |
| 15 | Sprite Shake | hit landed, state change |
| 16 | Impact Star / Hit Pop | hit landed, collision |
| 17 | Fade Out | death, state change |
| 18 | Scale / Pulse | state change, spawn |
| 19 | Squash & Stretch | state change (jump/landing), hit landed |
| 20 | Dust Cloud | state change (landing/run start), collision |
| 21 | Attack Arc / Slash | attack active |
| 22 | Aura / Glow | state change, spawn |
| 23 | Screen Overlay | state change (boss phase / danger state) |
| 24 | Composite Explosion Burst | death, explosion |
| 25 | Heat Distortion *(experimental — out of scope for v1)* | explosion |
| 26 | Beam | attack active (oriented to its attached hit area) |

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

# Experimental Effect

## 25. Heat Distortion *

Creates the appearance of heated air or visual distortion around explosions, fire, machinery, or other heat sources.

A simple Canvas implementation may simulate the effect using animated translucent distortion-like sprites. True dynamic distortion of the rendered scene would likely require WebGL/shader-based rendering.

This effect is **experimental and optional**. It should not be considered a required capability of the initial Effects Engine.

Potential parameters:
- Area
- Intensity
- Distortion amount
- Animation speed
- Opacity
- Duration

---

## 26. Beam

A directional rectangular beam — a lightsaber-style strike that extends from an origin along an axis, with a bright core and a soft alpha-gradient halo around it.

Useful for melee slash attacks, energy strikes, sword-like hits, and fast directional attacks.

The beam is fired when its attached attack becomes active. It visually mirrors the shape and orientation of the attack's collision area, so the visible beam always matches the hit area that actually deals damage. It ignites quickly, holds, then fades out; its total lifetime is the sum of its ignition, hold, and fade times.

Parameters may include:
- Length
- Width
- Halo / gradient radius
- Color
- Ignition time (flash-in)
- Fade-out time
- Hold time
- Origin
- Orientation

---

# Effect Composition

Effects are intentionally small and reusable. More sophisticated visuals should normally be created by combining effects rather than implementing a new monolithic effect.

For example, a boss death could compose:

`Sprite Shake + Composite Explosion Burst + Particle Burst + Debris + Camera Shake + Screen Flash + Fade Out`

A ground stomp could compose:

`Telegraph Circle + Sprite Animation + Dust Cloud + Ground Wave + Shockwave + Camera Shake`

A hero supermove could compose:

`Aura + Afterimage + Trail + Sprite Flash + Particle Burst + Screen Flash`

Compositions are themselves data: a list of effect entries sharing a trigger. The Attack Engine determines **when and why** these effects occur. The Effects Engine determines **how they are visually rendered**.

# Core Rule

**Effects describe presentation, not gameplay truth.**

An explosion effect does not deal damage.

A Ground Wave does not hit the player.

A Target Marker does not launch a missile.

A Telegraph Circle does not execute an attack.

Those gameplay behaviors are composed by the Attack Engine using Collision, Effects, Sprite/Animation, Audio, and other systems.

---

# Scope & Handoff

This section records exactly what shipped with the Effects Engine epic so the next epic can pick up cleanly. It is a concept-level note — no implementation detail.

## What Shipped

- **The generic registry-driven Effect Engine.** Every effect is a plain data object — a type plus its parameters — attached declaratively to any carrier and fired on a trigger. The engine knows nothing about specific effects; it only knows how to look a type up and drive its lifecycle.
- **Twenty-five catalog effects implemented** (§1–§24 above, plus §26 Beam). Heat Distortion (§25) remains experimental and is not implemented.
- **Legacy effects migrated behavior-preservingly.** Existing one-off visual code was folded into the engine without changing how it looks or feels in-game.
- **A debug-mode Effect Theater.** In debug mode, a step-through viewer walks every catalog effect in turn, showing each one's name and id alongside a live demo of that effect. It is driven by keyboard and gamepad input.
- **The carrier interface.** A carrier exposes origin, facing, and size as needed, plus a list of the effects it carries and their triggers. The engine drives any such carrier unchanged — plain-object carriers shaped like a projectile, hit area, collision event, marker, or area-of-effect region all fire effects through the same path today. No per-entity-class code is required; the interface is generic by design.

## Deferred / Out of Scope for v1 (handoff to the next epic)

- **Heat Distortion (§25).** Experimental; not implemented.
- **Per-entity renderer consumption of sprite-state multipliers.** Fade Out's opacity, Scale/Pulse's scale, and Squash & Stretch's per-axis scale expose their state, but the production renderer does not yet read those values onto individual sprites. Likewise, behind-sprite rendering order for Aura/Glow is not wired into the production render pass. These effects work standalone; the follow-up is teaching the renderer to apply them to sprites.
- **Wiring effects onto future multi-box / multi-radius / multi-marker data** (the animation-studio revision). No such data exists yet. When it lands, the carrier interface already accepts it unchanged.

## Extensibility Contract

Adding a new effect is three things: one file under the effects folder, one registration line, and one row in the theater catalog. No engine change is required.

## Carrier Readiness

The carrier interface accepts any duck-typed object — anything that exposes origin, facing, and size as an effect needs them, plus an effects configuration. Future marker, box, and radius entities can therefore attach effects with zero engine change; the interface is ready before the data arrives.
