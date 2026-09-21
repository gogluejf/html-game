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

**Carrier contract.** For each continuous declaration, the engine asks the carrier whether its condition currently holds by calling `carrier.isConditionMet(condition)` with the declared condition string (`'moving'` or `'fastMoving'`) and using the boolean return value. Carriers that declare continuous effects must implement this method; one instance is kept alive per declaration (not per condition), so two declarations sharing a condition each get their own instance. When a live instance reports `done`, the engine drops it and re-spawns a fresh one on the next update as long as the condition still holds.

### Lifecycle

Every effect instance runs the same lifecycle regardless of type:

1. **fire(trigger, carrier)** — instantiate with resolved `params` (values may be read from the carrier, e.g. beam orientation from its hitbox).
2. **update(dt)** — advance internal timers while active.
3. **render(ctx, renderCtx?)** — draw; screen-space effects render after the camera transform is restored. `renderCtx` is an optional draw-time context handed by `drawEffects()` (e.g. `{ view: { w, h } }`) that screen-space overlays read their viewport from.
4. **complete** — removed from the active set when its duration elapses.

**Two-pass rendering.** Effects live in one of two coordinate spaces, declared by an optional `body.space` field (`'world'` | `'screen'`; default `'world'`). The renderer draws them in two passes: world-space effects (e.g. spriteFlash, impactStar) are drawn inside the camera translate via `drawEffects(ctx, undefined, { space: 'world' })`, and screen-space effects (e.g. vignette, screenFlash, screenOverlay — `space: 'screen'`) are drawn after the camera restore via `drawEffects(ctx, { view }, { space: 'screen' })`. `drawEffects()` applies one generic filter on `body.space ?? 'world'`; omitting the pass filter draws every instance (legacy single-pass behavior).

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
- Spread
- Gravity
- Rotation
- Lifetime
- Size

Implementation notes (type `debris`, js/effects/debris.js):

This catalog entry is a **one-shot particle effect** that spawns all fragments into the shared pool (js/particles.js) at fire time via `spawnOne()` with per-fragment overrides; the instance reports `done` immediately and the pool owns the fragments' stepping, culling, and rendering for their lifetime (same pattern as explosion.js / particleBurst.js).

Parameter semantics:
- `fragmentCount` — number of fragments to project (default 8); 0 or negative spawns nothing.
- `velocity` — base initial speed in px/s (default 140). Each fragment gets a uniform random multiplier in **[0.5, 1] · velocity**, so every fragment's speed stays bounded by the declared velocity while the burst has natural spread.
- `direction` — launch axis in radians (default −π/2, i.e. up). Every fragment is scattered around this axis within `spread`.
- `spread` — half-angle of the scatter cone in radians (default π/2 → a full 360° burst).
- `gravity` — downward acceleration applied to the fragments in px/s² (default 400); negative values float upward. Overrides the pool's legacy 200 px/s² sparkle arc.
- `rotation` — spin rate in rad/s applied to each fragment's draw rotation (default 6); sign sets spin direction. Fragments start unrotated (rot = 0) at fire time.
- `lifetime` — seconds each fragment lives before fading out (default 0.6); overrides the pool's SPARKLE_LIFETIME.
- `size` — fragment side length in px (default 4); the drawn square scales down linearly toward the end of life.
- `x` / `y` — impact point in world space (standalone/fallback position). **Carrier origin wins:** when the carrier exposes `origin()`, its FIRE-time position is used instead of params.x/y (params are the fallback for manual/theater fires with a null carrier).

Pool extension (strictly additive, documented contract): Sparkle supports three optional per-item fields consumed only when set — `debrisGravity` (per-fragment gravity, else the legacy 200), `debrisRotation` (spin rate, else no spin), and `rot` (current rotation; presence also selects the rotating-draw path). Plain sparkles never set them, so their update/draw behavior is byte-identical to the legacy code path; recycled slots clear these fields on respawn so a slot can never carry stale debris state into a plain-sparkle life.

Pool culling epsilon: the pool culls items at `life <= 1e-9` rather than `<= 0`. Fixed-step FP residue (e.g. 0.2 − 12·(1/60) ≈ 4.9e-17) would otherwise extend an exact-lifetime item by one frame; the epsilon makes the done-frame deterministic at exact boundaries for ALL pool items (plain sparkles included). This applies to any consumer of the pool, not just debris.

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
- Blend intensity — additional alpha multiplier applied to the tint while ON (default 1.0, i.e. no change; effective alpha = opacity × blend intensity). Dials down how strongly the tint blends over the sprite without altering the base opacity contract.
- Box *(fallback)* — factory-time geometry `{ x, y, w, h }` in **world coordinates**, used only when the carrier exposes neither `worldBox()` nor `origin()+size()` (tests, theater demos with a null carrier). No default: absent or non-positive dimensions make render() a no-op.

Phase alignment: the flash starts ON at t=0; each half-cycle (one ON stretch or one OFF stretch) lasts `duration / (2 * flashes)` seconds, and state flips at every half-cycle boundary. With a fixed 1/60s frame step, a frame landing exactly on a boundary counts as the new phase (ON phases are even-indexed).

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

Implementation notes (standalone type `sprite-shake-standalone`, js/effects/spriteShakeStandalone.js):

This catalog entry is implemented as a **standalone STATE effect** that owns its own timer — distinct from the migrated `sprite-shake` type (js/effects/spriteShake.js), which rides on the carrier's existing `hitFlash` window and stays as-is for monolith parity. The standalone type is a STATE effect: `render()` is a no-op; the renderer reads `getOffset() → {x,y}` off the instance each frame and adds it to that one sprite's draw position only (localized jitter; the camera never moves).

Parameter semantics:
- `hIntensity` / `vIntensity` — max offset per axis in px (default 3 each, the legacy SHAKE_AMT).
- `duration` — TOTAL lifetime in seconds (default 0.1, the legacy hitFlash shake window). The effect is done exactly when `duration` elapses; `getOffset()` returns `{x:0, y:0}` after that.
- `frequency` — re-roll rate in Hz (default 0 = "perFrame": a fresh random offset every `update()` call, the legacy behavior). A positive value f re-rolls every 1/f seconds and HOLDS the previous offset between rolls; the first roll happens on the first update after fire.
- `decay` — decay exponent: amplitude(t) = intensity · (remaining/duration)^decay, applied independently per axis (default 1 = linear ease-out).

While active, each axis is a fresh uniform random in [−intensity·amp, +intensity·amp] where amp follows the decay curve.

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

Implementation notes (standalone type `impact-star`, js/effects/impactStar.js):

This catalog entry is a **DRAW effect** that owns its own timer and pops at the exact impact point. `render()` draws a scaling star/burst centered on the impact origin; the pop starts at full size and pops OUT — it scales down along the scale curve while fading to zero opacity, then completes exactly when the declared `duration` elapses.

Parameter semantics:
- `size` — star radius in px at t=0 (default 12). Zero or negative → no draw.
- `duration` — TOTAL lifetime in seconds (default 0.1, "very short"). The effect is done exactly when `duration` elapses; total lifetime equals `duration`.
- `rotation` — base rotation in radians (default 0).
- `opacity` — peak opacity, clamped to [0,1] (default 1). Zero → no draw.
- `style` — `'star'` (default) or `'burst'`; unknown values fall back to `'star'`.
- `scaleCurve` — named curve applied to both scale and alpha over the lifetime: `'linear'` (default), `'easeOut'`, `'easeIn'`; unknown names fall back to `'linear'`.
- `x` / `y` — impact point in world space (default {0,0}); standalone/fallback position.

Position: prefers the live carrier's `origin()` at DRAW time (tracks a moving carrier); `params.x/y` are the standalone/fallback position used when there is no carrier exposing `origin()`. With neither a carrier nor params the pop renders at the origin (center).

Style rendering:
- `'star'` — filled white (`#ffffff`) 4-point star path.
- `'burst'` — 8 yellow (`#ffd93b`) radial spokes, stroked (not filled).

Scale/alpha curves (progress p in [0,1] → remaining strength in [0,1]):
- `linear`: `1 - p`
- `easeOut`: `(1 - p)^2`
- `easeIn`: `1 - p^2`

Fade/alpha: `globalAlpha = opacity · curve(progress)` where progress = elapsed/duration, so alpha tracks the same curve as scale and reaches 0 exactly at the end of the lifetime.

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

Implementation notes (type `dust-cloud`, js/effects/dustCloud.js):

This catalog entry is a **one-shot particle effect** that spawns all puffs into the shared pool (js/particles.js) at fire time via `spawnOne()` with per-puff overrides; the instance reports `done` immediately and the pool owns the puffs' stepping, culling, and rendering for their lifetime (same pattern as explosion.js / debris.js).

Parameter semantics:
- `particleCount` — number of dust puffs to spawn (default 6); 0 or negative spawns nothing.
- `spread` — horizontal half-width of the cluster in px (default 10). Each puff's launch x is offset uniformly from the contact point within ±spread, so the cloud reads as a patch on the ground rather than a single point.
- `size` — puff side length in px (default 5).
- `velocity` — base initial speed in px/s (default 30 — soft, low-velocity). Each puff gets a uniform random multiplier in **[0.5, 1] · velocity**, so every puff stays bounded by the declared velocity while the cloud keeps natural spread.
- `lifetime` — seconds each puff lives before fading out (default 0.4); overrides the pool's SPARKLE_LIFETIME.
- `opacity` — peak alpha, clamped to [0,1] (default 0.8). The drawn alpha is `opacity · (remaining/lifetime)`, so every puff fades to exactly 0 at its end of life.
- `gravity` — downward acceleration applied to the puffs in px/s² (default 0 → gentle drift, no settling); positive values make the cloud settle back down, negative floats it upward. Overrides the pool's legacy 200 px/s² sparkle arc.
- `x` / `y` — contact point in world space (standalone/fallback position). **Carrier origin wins:** when the carrier exposes `origin()`, its FIRE-time position is used instead of params.x/y (params are the fallback for manual/theater fires with a null carrier).

Launch direction: not a param — puffs billow up and outward around the contact point by construction: each launches at −π/2 + uniform(−π/2, +π/2), i.e. a wide cone centered straight up. This matches the catalog's "around a contact point" usage (landings, run starts, slides, stomps, impacts) without exposing a redundant axis param.

Pool extension (strictly additive, documented contract): Sparkle supports one more optional per-item field consumed only when set — `dustAlpha` (peak draw alpha; drawn alpha = `dustAlpha · (life/maxLife)`). Plain sparkles never set it, so their update/draw behavior remains byte-identical to the legacy full-alpha fade path; recycled slots clear the field on respawn so a slot can never carry stale dust state into a plain-sparkle life. (The existing `debrisGravity` / `debrisRotation` / `rot` fields from §3 are reused unchanged — dust uses `debrisGravity` for its gravity param.)


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

When fadeIn + fadeOut exceed duration, both ramps are scaled proportionally to fit; total lifetime always equals duration (hold = 0).

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
