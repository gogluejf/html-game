# Petal Panic — Attack Primitives

Conceptual reference for the reusable mechanical capabilities that make up every
attack in the game. A primitive is a low-level gameplay action — not a finished
named attack, not a visual effect, not an AI decision. It is one verb the engine
can perform on demand with configurable parameters.

The intended flow:

```
Hero / Enemy / Boss AI  →  Attack Macro  →  Attack Primitives  →  Collision/Hitbox + Effect Engine
```

AI decides **when**. A macro defines **what pattern**. Primitives provide **how**
each mechanical step works. This document owns the primitives; `attack-macros.md`
owns the compositions.

---

## Core rules

- Every primitive has sensible default parameters matching its most common use.
- Parameters can be overridden when a macro needs variation.
- Visual/effect styles have defaults and can be overridden via the Effect Engine.
- Defaults create consistency; overrides create controlled variation.
- Primitives remain generic. Boss-specific behavior is not added to a primitive
  unless it is genuinely reusable across multiple attacks.
- Damage is associated with the attack or damaging entity using the primitive.
- Enemy bodies can already damage the hero through normal body collision.
- A temporary attack hitbox is only required when an attack extends the dangerous
  area beyond the normal body, or needs different damage/contact behavior.
- A primitive may trigger another primitive on an event (hit, expiration,
  explosion, manual release).

---

## 1. Projectile

**Effects:** Hit Sparkle (blood on enemy impact — hit juice), Debris (dusty grain
puff when a `stop` shot dies on terrain)

Creates a projectile from an origin, normally the attacker or one of its markers.

### Main parameters

- **speed** — travel speed.
- **direction** — initial travel direction (angle or 8-way index).
- **ttl** — optional lifetime before disappearing.
- **damage** — damage caused on valid contact.
- **origin / marker** — where the projectile starts (a named marker on the
  attacker's animation, or an explicit position).
- **solidBehavior** — how the projectile interacts with terrain:
  - `phase` — passes through terrain (default; thorns/spread).
  - `stop` — dies on impact (saws); fires the debris puff at the death point.
  - `reflect` — bounces off the surface and keeps flying (bombs).
- **gravity** — optional vertical acceleration (ballistic arc).

### Effects / hooks

May use projectile visuals, trails, launch effects, impact particles, and
destruction effects from the Effect Engine. Impact behavior can depend on what
was hit — for example, a barrel may own its own reaction to being struck rather
than the projectile defining the barrel's response.

---

## 2. Bomb / Ballistic Arc

**Effects:** Explosion + Screen Flash + Camera Shake (detonation)

Creates a thrown object that follows a curved ballistic trajectory. The existing
Balthazar bomb behavior is the conceptual reference.

### Main parameters

- **speed / force** — launch force.
- **direction** — initial throw direction.
- **arc / verticalForce** — controls the height of the throw (gravity value).
- **bounce** — whether it can bounce on ground, blocks, or platform surfaces.
- **explodeOnContact** — whether contact with an enemy or obstacle triggers its
  payload.
- **ttl** — optional time before triggering its payload, including while airborne.
- **damage** — optional direct-contact damage.

### Completion / payload

A bomb can trigger another primitive or macro payload when it detonates:

- Explosion.
- Fire / Persistent Area.
- Spawn / Split into smaller bombs.

---

## 3. Beam

**Effects:** Beam (the beam body itself — Effect Engine renders it)

Creates a continuous damaging line or ray. Beam placement and motion are
controlled by the Attack Macro using it.

### Main parameters

- **origin / marker** — where the beam begins.
- **direction** — beam direction.
- **length** — beam reach; may be full-screen.
- **width** — damaging beam thickness.
- **duration** — how long it remains active.
- **damage** — damage/contact behavior.
- **style** — Effect Engine beam style override.

Beam does not inherently decide whether it is horizontal, targeted, or sweeping.
Those are macro-level patterns.

---

## 4. Melee Hitbox

**Effects:** Hit Sparkle (blood on connect — hit juice)

Creates a temporary damaging hitbox, usually synchronized with active animation
frames.

### Main parameters

- **activeFrames / timing** — when the hitbox exists.
- **shape / size** — hitbox dimensions.
- **offset / marker** — placement relative to the attacker.
- **damage** — damage.
- **knockback** — force/direction applied on hit.
- **hitLimit** — optional number of times a target can be hit during the action.

Melee hitboxes are optional when the attack can use the attacker's normal
damaging body collision. Use them for attacks such as a punch, horn extension,
sweep, tongue, weapon, or any body extension that reaches beyond the normal
collision body.

---

## 5. Movement / Charge

**Effects:** —

Applies intentional attack movement to the attacker.

### Main parameters

- **direction** — movement direction.
- **speed / force** — movement speed.
- **duration / distance** — how long or how far movement continues.
- **acceleration / easing** — optional movement profile.
- **stopOnObstacle** — whether terrain stops the motion.
- **bodyDamageOverride** — optional contact-damage change while moving.

A charge often needs no separate attack hitbox: the enemy's existing damaging
body can be the attack. A Melee Hitbox can be combined when the animation
extends beyond the normal body.

---

## 6. Explosion

**Effects:** Explosion (blast burst) + Camera Shake

Creates a short-lived radial damage event. Resolved by the single explosion
system described in `explosion.md`.

### Main parameters

- **radius** — damaging radius.
- **damage** — damage.
- **knockback** — radial knockback strength.
- **alignment** — foe / ally / neutral (who it hurts).
- **duration** — short active duration if needed.
- **style** — explosion Effect Engine style override.

Explosion can be triggered by bombs, projectiles, enemies, environmental objects,
or other attacks.

---

## 7. Fire / Persistent Area

**Effects:** — (area render is host/debug; damage ticks via hitbox path)

Creates a damaging area that remains active for a duration. For Petal Panic, the
common fire form is a horizontal ground area, such as the result of a Molotov.

### Main parameters

- **length / width** — horizontal coverage.
- **height** — damaging height if required.
- **duration / ttl** — how long the area remains active.
- **tickRate** — how frequently continuous damage may be applied.
- **damage** — damage per valid contact/tick.
- **style** — persistent effect style.

The primitive should support other persistent-area visuals later without changing
the core lifetime/collision concept.

---

## 8. Spike / Static Hazard

**Effects:** Hit Sparkle (while damaging — melee hit juice)

Creates a stationary damaging hazard that can appear and disappear.

### Main parameters

- **position / marker** — location.
- **size** — collision dimensions.
- **visibleTTL** — how long the spike is active/visible.
- **hiddenTTL** — optional time hidden before repeating.
- **repeatCount / repeat** — optional cycle behavior.
- **damage** — contact damage.
- **warningTime** — optional pre-appearance warning.
- **warningEffect** — optional flash/ease/telegraph before appearing.

The visible/hidden cycle makes the same primitive usable for static spikes and
timed spike traps.

---

## 9. Orbit

**Effects:** —

Keeps one or more attack entities on a 2D PULSING RING around the owner. The
ring breathes between `minRadius` and `maxRadius` in a smooth cosine cycle
(same pulse model as the pulse-bubble effect §27): at t=0 the ring is at
MAXIMUM radius, contracts toward minRadius at half-period, then expands back.

Pulse model:
    r(t) = midR + ampR · cos(2π · pulseSpeed · t)
where midR = (maxRadius + minRadius) / 2 and ampR = (maxRadius - minRadius) / 2.

Satellites are always evenly distributed around the circle (count 3 → 120°
apart) and rotate together at `speed`. Pure 2D — no ellipse squash, no
depth/layering.

### Main parameters

- **count** — number of orbiting entities (evenly distributed).
- **minRadius** — inner bound of the pulse (px).
- **maxRadius** — outer bound of the pulse (px).
- **pulseSpeed** — pulse frequency in Hz (cycles per second; 0 = static at max).
- **speed** — rotation speed (rad/s).
- **ttl** — optional orbit lifetime.
- **damage** — contact damage if orbiting entities are dangerous.
- **ejectable** — whether the orbit can be released (see eject behavior).
- **ejectTtl** — lifetime of projectiles created by an eject.

### Re-arm

`h.rearm()` spawns ANOTHER independent ring while this action is live
(additive attack); the handle completes when ALL rings are done.

### Eject behavior

Orbit supports release/ejection, gated by `ejectable`. When ejected, each entity
leaves the ring along its current tangential direction (the circle tangent at
its angle, oriented with the rotation direction) and continues as a normal
linear projectile carrying `ejectTtl`. This naturally creates a spread-like
release in multiple directions based on where each object was in its orbit.

---

## 10. Boomerang

**Effects:** —

Creates a projectile that travels outward and then returns.

### Main parameters

- **force / speed** — outward travel speed.
- **direction** — initial travel direction.
- **count** — max simultaneously alive boomerangs (cap); `h.throw()` launches
  one more up to the cap. This is a concurrency model, NOT burst-shot
  semantics (repeated-fire patterns belong to macros/attack plans).
- **outboundDuration / distance** — when the return begins.
- **returnForce / speed** — return speed.
- **ttl** — optional total lifetime.
- **damage** — contact damage.

The return path should be deterministic and recognizable rather than behaving as
generic homing unless a macro explicitly combines the two.

---

## 11. Telegraphs are Effects

**Effects:** (this section documents the telegraph EFFECTS themselves)

There is NO telegraph primitive. A telegraph (warning) is simply an Effect
Engine effect fired early by whichever attack needs it — the visual lives in
the effect, and the attack owns the timing + placement directly:

- **target-reticle** — tracking brackets for lock-on shots (Reticle Shot macro:
  fire once, move the instance's origin with the target, freeze at lockTime —
  see attack-macros.md §3).
- **telegraph-circle** — static closing ring for area warnings (spikes, beams).
- **ground-target-marker** — painted marker at a fixed spot (boss slams).

The shared helper is `targetCenter(entity)` in `combat/attack/context.js`
("where is the target"). Attacks that track a moving target move the LIVE
effect instance's origin each frame instead of re-firing (no stacking), and
freeze it when the aim locks.

Telegraphs stay reusable and consistent because they ARE the shared effect
catalog — not a per-attack copy.

---

## 12. Body Contact Damage

**Effects:** — (contact rule; hit juice comes from the attack that triggers it)

Uses an entity's existing body/collision area as a damaging area. This is
especially important for enemies, whose bodies may already hurt the hero by
default.

### Main parameters

- **damage** — body contact damage.
- **knockback** — contact knockback.
- **enabled** — whether body damage is currently active.
- **temporaryOverride** — optional attack-specific damage/knockback.

This avoids creating redundant melee hitboxes for attacks such as a simple charge.

---

## Composition principle

Primitives are intentionally small and composable. Examples:

- **Charge** = Movement + Body Contact Damage.
- **Extended horn charge** = Movement + Body Contact Damage + Melee Hitbox.
- **Molotov** = Bomb → Fire.
- **Cluster Bomb** = Bomb → Spawn/Split → child Bombs.
- **Kamikaze** = Body Explosion macro (payload blast → death).
- **Orbit Eject** = Orbit → eject into Projectile movement.

Finished, recognizable patterns belong in **Attack Macros** (`attack-macros.md`),
not as new one-off primitives. A new primitive is added only when the engine truly
lacks a reusable mechanical capability.

---

## Relationship to other systems

| System | Role |
|--------|------|
| Sprite editor markers | Provide named spatial anchors (`origin/marker`) and radii that primitives read at runtime. Schema (already implemented in sprite-crop editor): `st.markers = [{ label, x, y, radiusOn, radius }]` per animation. Primitives resolve via `attacker.markers.find(m => m.label === origin)`. |
| Collision/Hitbox engine | Resolves whether a primitive's damaging area actually contacts a target. |
| Effect engine | Renders the visual representation of a primitive (trails, flashes, beams, telegraphs). Owns style; does not own damage or lifetime. |
| Damage system | Central HP/energy drain, defense mitigation, telemetry. All primitives funnel through it. |
| Knockback system | Shove/stun/pop math. Primitives declare a knockback setting; the system applies it. |
| Explosion system | Single radial AoE resolver. The Explosion primitive is a thin wrapper over it. |
| Attack Theater (F4) | Debug/showcase overlay following the same pattern as the Effect Theater (F2). Lists all macros + primitives, allows live param tuning, plays them in a sandbox arena. |

---

## Design intent

The goal is a small mechanical vocabulary that can produce many attacks without
creating dozens of almost-identical custom implementations. Every enemy, boss,
and hero weapon in the game should be expressible as a composition of these
primitives with different parameters — never as bespoke code.
