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

Creates a projectile from an origin, normally the attacker or one of its markers.

### Main parameters

- **speed** — travel speed.
- **direction** — initial travel direction (angle or 8-way index).
- **count / burst** — number launched as part of the action.
- **burstInterval** — delay between repeated launches.
- **ttl** — optional lifetime before disappearing.
- **damage** — damage caused on valid contact.
- **origin / marker** — where the projectile starts (a named marker on the
  attacker's animation, or an explicit position).
- **solidBehavior** — how the projectile interacts with terrain: `pass`,
  `absorb`, or `bounce`.
- **gravity** — optional vertical acceleration (ballistic arc).

### Effects / hooks

May use projectile visuals, trails, launch effects, impact particles, and
destruction effects from the Effect Engine. Impact behavior can depend on what
was hit — for example, a barrel may own its own reaction to being struck rather
than the projectile defining the barrel's response.

---

## 2. Predictive Targeting

Calculates an aim point based on where the hero is expected to be if the hero
continues moving at the current velocity. This is targeting logic used by another
primitive, usually Projectile.

### Main parameters

- **target** — normally the hero.
- **predictionTime / predictionStrength** — how far ahead to predict.
- **maxPrediction** — optional limit on prediction distance.

The result is an aim direction or target point. It does not create a projectile
by itself.

---

## 3. Homing / Steering

Continuously adjusts the movement direction of a projectile toward a target.

### Main parameters

- **speed** — forward travel speed.
- **steerVelocity / turnRate** — how quickly it can correct toward the target.
  Low values create wide, difficult turns; high values create agile missiles.
- **target** — entity being followed.
- **initialDirection** — starting direction.
- **ttl** — optional lifetime.

Homing should not imply perfect tracking. Steering strength determines how
recoverable the trajectory is after missing or overshooting.

---

## 4. Spread

Calculates multiple simultaneous directions around a central direction.

### Main parameters

- **count** — number of simultaneous outputs.
- **direction** — center direction of the spread.
- **angle** — total spread angle (radians). Outputs are distributed evenly
  across this angle. A 360° angle creates a radial attack.
- **ttl** — optional projectile lifetime when used with projectiles.

Spread is direction-generation logic and can be combined with projectiles, bombs,
or other compatible primitives.

---

## 5. Bomb / Ballistic Arc

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

## 6. Beam

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

## 7. Melee Hitbox

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

## 8. Movement / Charge

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

## 9. Explosion

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

## 10. Fire / Persistent Area

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

## 11. Spike / Static Hazard

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

## 12. Orbit

Keeps one or more attack entities orbiting an owner on an ELLIPSE, like
electrons around a nucleus seen at an angle: each satellite passes IN FRONT of
the nucleus axis, then BEHIND it, as it rotates. Depth is derived from the orbit
angle (`depth = sin(angle)`: +1 fully in front, −1 fully behind) and the host
renders satellites with scale/alpha/layering from that value — no separate
"hide behind" flag exists; depth IS the data. Satellites are always evenly
distributed around the ellipse (count 3 → 120° apart).

### Main parameters

- **count** — number of orbiting entities (evenly distributed).
- **radius** — horizontal semi-axis of the ellipse (distance from owner).
- **depth** — vertical squash factor 0..1 (0 = flat line, 1 = full circle).
- **angularSpeed** — orbit speed (rad/s).
- **direction** — clockwise or counter-clockwise.
- **startAngle** — phase offset of the whole formation.
- **ttl** — optional orbit lifetime.
- **damage** — contact damage if orbiting entities are dangerous.
- **ejectable** — whether the orbit can be released (see eject behavior).
- **ejectTtl** — lifetime of projectiles created by an eject.

### Eject behavior

Orbit supports release/ejection, gated by `ejectable`. When ejected, each entity
leaves the orbit along its current tangential direction (the ellipse tangent at
its angle, oriented with the rotation direction) and continues as a normal
linear projectile carrying `ejectTtl`. This naturally creates a spread-like
release in multiple directions based on where each object was in its orbit.

---

## 13. Boomerang

Creates a projectile that travels outward and then returns.

### Main parameters

- **force / speed** — outward travel speed.
- **direction** — initial travel direction.
- **count / burst** — number launched.
- **burstInterval** — spacing between repeated launches.
- **outboundDuration / distance** — when the return begins.
- **returnForce / speed** — return speed.
- **ttl** — optional total lifetime.
- **damage** — contact damage.

The return path should be deterministic and recognizable rather than behaving as
generic homing unless a macro explicitly combines the two.

---

## 14. Spawn / Split

Creates additional attack entities from an existing attack event.

### Main parameters

- **spawnType** — what the children become: `projectile` (straight shots),
  `bomb` (ballistic arc, bounce, detonate on impact), or `enemy` (a live enemy
  entity that continues acting toward the attacker). The host feeds each child
  descriptor into the matching primitive or enemy factory.
- **count** — number created.
- **direction / centerDirection** — central launch direction.
- **angle / spread** — distribution angle.
- **force / speed** — launch force.
- **inheritVelocity** — optional inheritance from parent.
- **delay** — optional delay before spawning.

Spawn/Split can occur on detonation, hit, expiration, or another explicit trigger.
For bombs, spawned child bombs use normal Bomb rules after being launched,
including their own curved trajectories and payloads.

---

## 15. Reticle / Telegraph

Provides advance information that an attack is about to happen. It normally
belongs to the Effect Engine visually, while the attack primitive/macro controls
timing and placement.

### Main parameters

- **position / target** — telegraph location.
- **duration / warningTime** — time before the attack becomes active.
- **style** — reticle, flash, ground marker, beam warning, etc.
- **tracking** — whether it follows a target before locking.
- **lockTime** — optional moment at which position is fixed.

Telegraphs should be reusable and consistent so dangerous attacks remain readable.

---

## 16. Body Contact Damage

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

## 17. Self-Destruct / Kill Self

Removes or kills the attacker as part of an attack sequence.

### Main parameters

- **timing** — when death/removal occurs.
- **deathBehavior** — normal death, immediate removal, or attack-specific death state.
- **triggerPayloadFirst** — whether an explosion/spawn/etc. is triggered before death.

This is primarily useful for kamikaze-style attacks. The actual damage normally
comes from another primitive such as Explosion; Self-Destruct controls the
attacker lifecycle.

---

## Composition principle

Primitives are intentionally small and composable. Examples:

- **Charge** = Movement + Body Contact Damage.
- **Extended horn charge** = Movement + Body Contact Damage + Melee Hitbox.
- **Molotov** = Bomb → Fire.
- **Cluster Bomb** = Bomb → Spawn/Split → child Bombs.
- **Kamikaze** = Telegraph → Explosion → Self-Destruct.
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
