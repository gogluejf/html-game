# Petal Panic — Attack Macros

Conceptual reference for standardized, reusable compositions of Attack Primitives
that produce recognizable gameplay patterns. A macro is a named attack pattern with
a canonical sequence, sensible defaults, and a controlled set of exposed parameters.

The intended flow:

```
Hero / Enemy / Boss AI  →  Attack Macro  →  Attack Primitives  →  Collision/Hitbox + Effect Engine
```

Both regular enemies and bosses use Attack Macros. The difference is in their AI:

- A simple enemy may repeat one or two predictable macros.
- A stronger enemy may use a short fixed sequence.
- A boss may select from many macros, phases, and patterns.

The AI decides **when and in what order** attacks happen. The Attack Macro decides
**what the attack actually does**.

---

## Why macros exist

Macros prevent every boss or enemy from rebuilding a familiar mechanic slightly
differently. For example, Missile Rain should remain recognizably **Missile Rain**
everywhere: launch upward → leave screen → telegraph landing positions → fall. A
boss may change count, speed, spacing, ordering, or effects, but it should not
independently reimplement the mechanic.

## Defaults and overrides

Every Attack Macro has:

- A canonical sequence.
- Sensible default parameters based on the most common version.
- Default effects/styles.
- A controlled set of exposed parameters.
- Optional effect/style overrides.

**Defaults create consistency; overrides create variation.** A caller should often
be able to request only `missile_rain` and receive a complete usable attack. Bosses
and enemies configure Attack Macros. They should not normally assemble arbitrary
primitives directly.

## Who calls macros

| Caller | Usage |
|--------|-------|
| Hero weapons (thorn, saw, bomb, spread) | Each weapon is a macro consumption with hero-specific params. |
| Simple enemies | Repeat 1–2 macros on a timer or trigger. |
| Stronger enemies | Short fixed sequences with repositioning between. |
| Bosses | Select from many macros across phases; override params per phase. |
| Attack Theater (debug/showcase) | Play any macro or primitive in isolation for tuning/demo. |

No caller assembles primitives directly. Even a single-shot attack goes through
the `Projectile_Shot` macro — the macro can be trivially simple, but the call site
is always a macro invocation.

---

## 1. Projectile Shot

A standard shot fired from the attacker toward a direction or target.

### Sequence

Projectile → travel → collision/expiration.

### Main parameters

- **direction / target** — firing direction.
- **speed** — projectile speed.
- **ttl** — optional lifetime.
- **damage** — damage.
- **origin / marker** — launch position.
- **projectileStyle** — optional visual override.

---

## 2. Predictive Shot

Fires toward where the hero is expected to be if current movement continues.
Useful for enemies that punish mindless running.

### Sequence

Predictive Targeting → Projectile.

### Main parameters

- **speed** — projectile speed (the aim is solved from this: where bullet and
  target meet if the target keeps its current velocity).
- **ttl** — optional lifetime.
- **damage** — damage.
- **origin / marker** — launch position.

The intercept point is calculated at firing time unless explicitly configured
otherwise.

---

## 3. Reticle Shot

A telegraphed lock-on shot: a reticle TRACKS the target, LOCKS its position at
`lockTime`, and when the warning window ends ONE projectile fires from the
attacker's center at the LOCKED point — not where the target happens to be at
that moment. The canonical "telegraph then fire" composition.

### Sequence

Reticle/Telegraph (track → lock) → Projectile at locked point.

### Main parameters

- **target** — entity to track (default ctx.target).
- **duration** — total warning window in seconds (track → lock → fire).
- **lockTime** — seconds after start when the aim freezes.
- **style** — telegraph visual (`reticle` | `circle` | `marker`).
- **color / radius** — VFX color and size.
- **tracking** — follow the target until lockTime.
- **speed** — projectile speed px/s.
- **ttl** — projectile lifetime (s).
- **damage** — projectile damage.

### Rules

- Exactly ONE shot, fired at the end of the warning window.
- The shot aims at the LOCKED point; a target that keeps moving after the lock
  can dodge it.
- The telegraph effect outlives the warning window on purpose: it stays up
  while the bullet is in flight and dismisses with the shot's terminal event
  (hit or expire). Hosts need no distance math or manual dismissal.

---

## 4. Burst Shot

Fires the same projectile repeatedly with controlled spacing.

### Sequence

Projectile → interval → Projectile → repeat.

### Main parameters

- **count** — shots in the burst.
- **interval** — time between shots.
- **speed** — projectile speed.
- **direction / target** — firing direction.
- **ttl** — optional projectile lifetime.
- **damage** — damage.

---

## 5. Spread Shot

Fires multiple projectiles simultaneously across an angle centered on a direction.

### Sequence

Spread → multiple Projectiles.

### Main parameters

- **count** — simultaneous projectiles.
- **direction** — center direction.
- **angle** — total spread angle.
- **speed** — projectile speed.
- **ttl** — optional lifetime.
- **damage** — damage.

---

## 6. 360° Spread

A radial form of Spread Shot that distributes projectiles around the attacker.

### Main parameters

- **count** — number of projectiles around the circle.
- **startAngle** — optional rotation of the pattern.
- **speed** — projectile speed.
- **ttl** — optional lifetime.
- **damage** — damage.

The canonical spread angle is 360 degrees.

---

## 7. Homing Missile

Launches a projectile that continuously steers toward the hero.

### Sequence

Projectile + Homing/Steering.

### Main parameters

- **speed** — forward travel speed.
- **steerVelocity / turnRate** — agility.
- **initialDirection** — starting direction.
- **ttl** — lifetime.
- **damage** — damage.
- **missileStyle** — optional effect/style override.

Low steering produces a missile the player can outmaneuver; high steering produces
a much more agile threat.

---

## 8. Boomerang

Launches one or more projectiles outward before they return.

### Sequence

Boomerang outward → turnaround → return.

### Main parameters

- **force / speed** — outward speed.
- **direction** — launch direction.
- **count / burst** — number launched.
- **burstInterval** — spacing between repeated launches when applicable.
- **outboundDuration / distance** — turnaround point.
- **returnForce / speed** — return speed.
- **ttl** — optional total lifetime.
- **damage** — contact damage.

---

## 9. Orbiting Projectiles

Creates projectiles or damaging objects that rotate around the attacker. They
behave visually as electrons around an owner.

### Sequence

Spawn orbiting entities → Orbit → expire/remove.

### Main parameters

- **count** — orbiting objects.
- **minRadius** — inner bound of the radius pulse (px).
- **maxRadius** — outer bound of the radius pulse (px).
- **pulseSpeed** — pulse frequency in Hz (0 = static at max).
- **speed** — rotation speed (rad/s).
- **ttl** — duration.
- **damage** — contact damage.

---

## 10. Orbit → Eject

Starts as Orbiting Projectiles, then releases all orbiting objects. On release,
each object keeps its current tangential direction/velocity and becomes a linear
projectile. The result resembles a naturally distributed multi-direction spread
without recalculating an artificial spread pattern.

### Main parameters

Includes Orbiting Projectiles parameters plus:

- **ejectTime / trigger** — when release happens.
- **ejectSpeedMultiplier** — optional change to release speed.
- **projectileTTL** — lifetime after release.

---

## 11. Missile Rain

Launches multiple projectiles vertically upward from the attacker, sends them
outside the visible play area, announces their future landing positions with ground
reticles, then drops them back onto the play area. During ascent, projectiles may
have a small oscillation so the launch feels alive rather than perfectly mechanical.

This is a canonical macro: callers configure it but should not rebuild its sequence.

### Sequence

1. Launch projectiles upward.
2. Projectiles ascend with subtle oscillation.
3. Projectiles leave the visible play area.
4. Determine landing positions.
5. Show ground reticles.
6. Wait the configured warning/time-to-target period.
7. Projectiles fall at their calculated positions.
8. Resolve impact/collision.

### Main parameters

- **count** — number of projectiles in the rain.
- **launchInterval** — spacing between projectiles during the upward launch burst.
- **ascentSpeed** — upward travel speed.
- **ascentOscillation** — subtle side-to-side motion while rising.
- **fallDelay** — delay after ascent before the falling phase begins.
- **descentSpeed** — falling speed.
- **timeToTarget** — delay between drawing a landing reticle and the corresponding
  projectile dropping/arriving.
- **pattern** — `simultaneous` or `sequential`.
- **interval** — when sequential, time between falling projectiles.
- **distanceType** — `fixed` or `relative`.
- **distance** — spacing around the central drop point for fixed placement. `0` is
  valid for sequential attacks, allowing repeated drops at the same position.
- **xCoordinate** — central X coordinate used to calculate the drop pattern.
- **coordination** — for sequential patterns: `random`, `from_left`, or `from_right`.
- **projectileDamage** — impact/contact damage.
- **reticleStyle** — optional Effect Engine override.
- **projectileStyle** — optional projectile visual override.

### Distance behavior

**Fixed:** requested distance controls separation around the center point. If the
requested fixed spacing would place the pattern outside the playable screen,
positions are redistributed evenly so the complete pattern fits.

**Relative:** positions are evenly distributed across the usable horizontal play
area rather than using a fixed pixel/unit separation.

### Sequential coordination

- **from_left** — calculated landing positions trigger from left to right.
- **from_right** — calculated landing positions trigger from right to left.
- **random** — the same calculated legal landing positions are used, but their
  activation order is randomized. Random does not mean unrelated arbitrary
  coordinates.

---

## 12. Bomb Throw

Throws one ballistic bomb.

### Sequence

Bomb launch → ballistic arc → optional bounce/contact → payload/detonation.

### Main parameters

- **speed / force** — throw force.
- **direction** — throw direction.
- **arc / verticalForce** — trajectory height.
- **bounce** — whether it bounces on valid surfaces.
- **explodeOnContact** — optional contact trigger.
- **ttl** — optional timed detonation.
- **payload** — normally Explosion, Fire, or another standardized payload.

---

## 13. Bomb Spread

Throws multiple bombs around a central throw angle. Like Spread Shot, the requested
total angle is divided across the bombs. A useful variation is a very high vertical
force with low horizontal force, allowing several bombs to be thrown high into the
air simultaneously.

### Main parameters

- **count** — bombs in the spread.
- **angle** — total spread angle.
- **direction** — central throw direction.
- **speed / force** — throw force.
- **arc / verticalForce** — trajectory height.
- **bounce** — optional bounce.
- **explodeOnContact** — optional contact trigger.
- **ttl** — optional timed detonation.
- **payload** — bomb payload.

---

## 14. Cluster Bomb

Throws a bomb that spawns multiple smaller bombs when its payload triggers. The
child bombs are real Bomb primitives: they pop outward in curved trajectories and
then follow normal bomb rules.

### Sequence

Parent Bomb → trigger → Spawn/Split → child Bombs → child payloads.

### Main parameters

- **parent bomb parameters** — throw behavior of the initial bomb.
- **childCount** — number of smaller bombs.
- **childForce** — force of the outward pop.
- **childAngle / spread** — distribution of child bombs.
- **childArc** — vertical component of child trajectories.
- **childTTL** — optional child detonation timing.
- **childPayload** — payload used by child bombs.

---

## 15. Molotov

Throws a bomb-like object that creates persistent horizontal fire when triggered.

### Sequence

Bomb → impact/timer → Fire/Persistent Area.

### Main parameters

- **bomb parameters** — throw direction, force, arc, contact behavior.
- **fireLength** — horizontal size of the fire.
- **fireDuration** — how long it remains active.
- **fireDamage** — damage behavior.
- **tickRate** — if repeated damage uses ticks.
- **fireStyle** — Effect Engine override.

---

## 16. Explosive Bomb

Throws a bomb whose payload is the game's standard radial explosion.

### Sequence

Bomb → trigger → Explosion.

### Main parameters

- **bomb parameters** — trajectory/contact/timer.
- **explosionRadius** — blast radius.
- **explosionDamage** — blast damage.
- **knockback** — blast knockback.
- **explosionStyle** — Effect Engine override.

---

## 17. Horizontal Beam

Telegraphs and then fires a beam horizontally across the play area.

### Sequence

Telegraph → delay/lock → horizontal Beam → end.

### Main parameters

- **telegraphTime** — warning duration.
- **beamHeight / width** — dangerous thickness.
- **duration** — active beam duration.
- **direction** — left or right when relevant.
- **damage** — beam damage.
- **beamStyle** — visual override.
- **telegraphStyle** — warning effect override.

Full-screen horizontal reach is the normal default.

---

## 18. Targeted Beam

Uses a reticle to establish a target/direction, locks that target, then fires a
beam from the attacker/beam marker through the locked position.

### Sequence

Reticle tracks/positions → lock → optional final telegraph → Beam → end.

### Main parameters

- **reticleControl** — how the target reticle moves/tracks.
- **trackingTime** — how long it can follow before locking.
- **lockDelay / telegraphTime** — warning after lock if required.
- **duration** — beam duration.
- **beamWidth** — dangerous thickness.
- **damage** — beam damage.
- **beamStyle / reticleStyle** — effect overrides.

The beam direction is determined by the locked reticle placement.

---

## 19. Sweeping Beam

Locks or establishes a starting beam direction, then rotates the beam through an
angle.

### Sequence

Reticle/telegraph → Beam starts → angular sweep → end.

### Main parameters

- **reticleControl / startingDirection** — initial beam direction.
- **telegraphTime** — warning duration.
- **duration** — total sweep duration.
- **angle** — total angle swept.
- **sweepDirection** — clockwise or counter-clockwise.
- **beamWidth** — dangerous thickness.
- **damage** — beam damage.
- **beamStyle / reticleStyle** — effect overrides.

---

## 20. Melee

A standardized close-range attack synchronized with animation. Melee does not
require a separate hitbox when the normal enemy body already represents the
dangerous area. A temporary Melee Hitbox is used when the animation extends the
attack beyond the body. Melee can also include movement.

### Sequence

Windup/telegraph → optional movement → active contact/hitbox frames → recovery.

### Main parameters

- **windup** — delay before active frames.
- **activeTiming / frames** — damaging period.
- **recovery** — end lag.
- **useBodyContact** — use normal body collision for damage.
- **hitbox** — optional extended Melee Hitbox.
- **damage** — damage.
- **knockback** — hit knockback.
- **movement** — optional movement during the move.

This supports punches, sweeps, horn attacks, lunges, cartwheels, and similar
animation-driven attacks without inventing separate collision systems.

---

## 21. Charge / Dash

Moves the attacker aggressively in a direction as an attack. For enemies, the
normal damaging body is usually sufficient. An extra melee hitbox is only added if
the animation extends beyond the body.

### Sequence

Optional telegraph → Movement/Charge → body contact and/or extended hitbox →
stop/recovery.

### Main parameters

- **direction / targetDirection** — charge direction.
- **speed** — charge speed.
- **duration / distance** — travel limit.
- **acceleration / easing** — movement profile.
- **stopOnObstacle** — terrain behavior.
- **bodyDamageOverride** — optional charge-specific contact damage.
- **extendedHitbox** — optional temporary attack hitbox.
- **chargeEffect** — optional dust/trail effect.

---

## 22. Stomp

A surface-aware stomp attack with one telegraph for the full sequence, followed by
a short signal before each individual stomp.

### Canonical sequence

Telegraph once → signal → stomp → interval → signal → stomp → repeat until
`count` is reached.

### Parameters

- **surface** — `current` / `all`.
- **telegraphDuration** — full-sequence warning.
- **telegraphStyle** — visual for the full telegraph.
- **count** — number of stomps, default `1`.
- **interval** — pause between stomps.
- **attackSignalEffect** — short cue before each individual stomp.
- **signalDelay** — time after the signal before stomp damage lands.
- **damage** — stomp damage.
- **knockback** — stomp knockback.

### Rules

- The full telegraph plays only once at the beginning.
- Every individual stomp gets its own short attack signal.
- Do not replay the full telegraph between repeated stomps.
- `count: 1` behaves as a normal single stomp.

### Composition

**Reticle/Telegraph once → repeat [attack signal → delay → Stomp → interval]**

---

## 23. Stomp Wave

A stomp creates a damaging wave traveling along the supporting surface. On a block
or platform, the wave ends when that surface ends. On the ground, it travels until
its configured end or until blocked by solid geometry. The wave can hit barrels it
passes through.

### Sequence

Telegraph → stomp impact → surface wave → wave terminates.

### Main parameters

- **waveDirection** — `to_left`, `to_right`, or `both`.
- **waveSpeed** — travel speed.
- **damage** — wave damage.
- **waveWidth / size** — dangerous wave area.
- **maxDistance / ttl** — optional travel limit.
- **waveStyle** — effect override.

---

## 24. Dust Cloud / Radius Attack

Creates a damaging dust/effect cloud around the attacker for a duration. The
mushroom enemy is the conceptual reference.

### Sequence

Dust effect appears → radial area active → duration ends.

### Main parameters

- **radius** — blast/cloud radius.
- **duration** — how long it remains active.
- **damage** — damage/contact behavior.
- **tickRate** — optional repeated-damage timing.
- **dustStyle** — effect override.

---

## 25. Spikes

Creates one or more static spike hazards that alternate between active/visible and
hidden states.

### Sequence

Optional warning → spikes appear and become dangerous → visible TTL → hide →
optional hidden TTL → optional repeat.

### Main parameters

- **positions / pattern** — spike placement.
- **visibleTTL** — active duration.
- **hiddenTTL** — hidden duration.
- **repeat / repeatCount** — cycling.
- **warningTime** — advance warning.
- **warningEffect** — quick flash/ease/telegraph.
- **damage** — spike damage.
- **spikeStyle** — effect override.

---

## 26. Body Explosion / Kamikaze

An enemy deliberately detonates itself and dies. The Jack-o'-lantern enemy is a
direct example.

### Sequence

Telegraph → approach/trigger as defined by AI → Explosion → Self-Destruct.

### Main parameters

- **telegraphTime** — warning before detonation.
- **explosionRadius** — blast radius.
- **explosionDamage** — blast damage.
- **knockback** — explosion knockback.
- **explosionStyle** — Effect Engine override.
- **deathTiming** — normally immediately with/after the explosion.

The AI controls how the enemy gets into position. The macro controls the
standardized detonation behavior.

---

## 27. Dash Lane Sequence

A telegraphed sequence where the attacker enters from offscreen and dashes
completely across the screen through each configured Y lane exactly once.

### Canonical sequence per lane

Entry flash/warning → dash across screen → exit → next lane warning → next dash.

### Parameters

- **lanes** — configured Y positions.
- **laneOrder** — `bottom_to_top` / `top_to_bottom` / `random`.
- **sideMode** — `fixed_left` / `fixed_right` / `alternate` / `random`.
- **alternateStartSide** — `left` or `right`.
- **telegraphDuration** — warning per lane.
- **telegraphStyle** — visual.
- **dashSpeed** — horizontal speed.
- **damage** — contact damage during dash.
- **knockback** — dash knockback.
- **interval** — pause between lanes.

### Rules

- One complete sequence uses every configured Y lane exactly once.
- Fixed side means every dash enters from that same side, including with random
  lane order.
- Alternate side alternates left/right per lane; starting side is configurable.
- Random side independently chooses left/right for each lane.
- Lane order and side selection are independent.
- Every dash is telegraphed at its actual entry side and Y position before it
  begins.
- The attacker crosses the full screen and exits before the next telegraph begins.

### Composition

**Reticle/Telegraph → offscreen positioning → Movement/Charge + Body Contact
Damage → repeat for next lane**

Examples:
- `fixed_left + random lanes` → L/Y3 → L/Y1 → L/Y2
- `alternate(left) + bottom_to_top` → L/Y1 → R/Y2 → L/Y3
- `random side + random lanes` → R/Y2 → L/Y1 → L/Y3

---

## AI usage examples

Attack Macros do not contain enemy decision-making.

**Simple enemy**

`Projectile Shot → wait → Projectile Shot → wait`

**More advanced enemy**

`Burst Shot → reposition → Bomb Throw → repeat`

**Boss**

`Missile Rain → Charge → Targeted Beam → Cluster Bomb → phase logic`

This keeps normal enemies predictable and readable while allowing bosses to build
richer patterns from the exact same standardized attack library.

---

## Design contract

When adding an attack:

1. First ask whether it is already an existing Attack Macro with different
   parameters.
2. If not, ask whether existing primitives can form a new reusable macro.
3. Add a new primitive only when the engine truly lacks a reusable mechanical
   capability.
4. Keep visual variation in Effect Engine styles/overrides whenever possible.
5. Keep AI sequencing outside the Attack Macro.
6. Preserve the recognizable behavior of a macro even when its exposed parameters
   are overridden.

The goal is a small mechanical vocabulary that can produce many attacks without
creating dozens of almost-identical custom implementations.
