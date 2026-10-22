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

## Macro contract: `meta.invokes` + `meta.effects`

Every macro registration declares its composition in metadata:

```js
registerMacro('homingMissile', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Homing Missile',
    desc: '...',
    invokes: ['projectile'],   // ← what this attack composes (registry ids)
    effects: [                 // ← VFX it fires (Effect Engine type names)
      { type: 'hit-sparkle', desc: 'blood sparkles if the missile connects' },
    ],
    params: [ ... ],
  },
  impl(params, ctx) { ... },
});
```

- **`meta.invokes`** is the list of registry ids the macro's `impl()` invokes
  (primitives or other macros). It is the machine-readable form of each doc
  section's **Invokes:** line. Macros only.
- **`meta.effects`** is the list of Effect Engine types the attack fires —
  declared by BOTH primitives and macros (a primitive like `bomb` owns only its
  landing puff; a macro like `explosiveBomb` declares none — its blast rows are
  inherited from the Explosion primitive it invokes). Each entry
  is `{ type, desc }` where `type` matches an Effect Engine catalog type.
  An attack declares only its OWN native effects here — a macro does NOT copy
  its invoked attacks' effects into this field.
- **Inheritance is resolved, not copied.** `resolveEffects(id)` in
  `combat/attack/effectsMeta.js` returns an attack's effective effect rows:
  its own `meta.effects` plus, for macros, the effects of every id in
  `meta.invokes` (deduped by type; inherited rows labeled with their source).
  Change a primitive's VFX and every macro that invokes it updates for free —
  no duplication, no drift.
- The Attack Theater renders **INVOKES** and **EFFECTS** panel sections from
  this metadata (EFFECTS via `resolveEffects()`) — hosts never hardcode "what
  a macro is made of" or "what it looks like."
- A primitive must NOT declare `invokes` and must not call `invoke()` — that
  is the enforceable primitive/macro boundary (see Design contract below).

---

## 1. Predictive Shot

**Invokes:** Projectile

**Effects:** Hit Sparkle (hit juice)

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

## 2. Reticle Shot

**Invokes:** Projectile (plain) OR Explosive Projectile / Shockwave Projectile / Napalm (payload, chosen by `blastType`)

**Effects:** Target Reticle (telegraph — `target-reticle` effect, fired and moved by this macro)

A telegraphed lock-on shot: a target-reticle EFFECT tracks the target, LOCKS
its position at `lockTime`, and when the warning window ends ONE projectile
fires from the attacker's center at the LOCKED point — not where the target
happens to be at that moment. The canonical "telegraph then fire" attack.

The macro owns the effect lifecycle directly: fire the `target-reticle` effect
once, move its origin with the target while tracking, freeze it at lock.

### Sequence

target-reticle effect (track → lock) → Projectile at locked point.

### Main parameters

- **target** — entity to track (default ctx.target).
- **duration** — total warning window in seconds (track → lock → fire).
- **lockTime** — seconds after start when the aim freezes.
- **color / radius** — reticle VFX color and size.
- **tracking** — follow the target until lockTime.
- **speed** — projectile speed px/s.
- **ttl** — projectile lifetime (s).
- **damage** — projectile damage.
- **blastType** — `plain` | `explosion` | `shockwave` | `napalm`. Chooses the
  payload on impact. `plain` fires the bare Projectile primitive; the others
  invoke the matching carrier macro (Explosive Projectile / Shockwave
  Projectile / Napalm) so the shot detonates into that payload at its death
  point. Default `plain`.
- **blast.explosionRadius** — explosion blast circle (px), used when
  `blastType=explosion`.
- **blast.shockRadius** — shockwave ring max radius (px), used when
  `blastType=shockwave`.
- **blast.fireWidth** — napalm burn zone width (px), used when
  `blastType=napalm`.

Each payload reads ONLY its own size key from `blast`; the others are ignored.
The carrier always uses `solidBehavior: 'stop'` so the shot detonates on
surface contact, not through it.

### Rules

- Exactly ONE shot, fired at the end of the warning window.
- The shot aims at the LOCKED point; a target that keeps moving after the lock
  can dodge it.
- The telegraph effect outlives the warning window on purpose: it stays up
  while the bullet is in flight and dismisses with the shot's terminal event
  (hit or expire). Hosts need no distance math or manual dismissal.
- Cancel tears down the effect instance (no ghost reticle).
- The fired payload macro is promoted into the root handle's `handles` list so
  hosts step AND draw its deferred zone children (napalm fire) uniformly.

---

## 3. Burst Shot

**Invokes:** Projectile

**Effects:** Hit Sparkle (hit juice)

Fires the same shot repeatedly with a fixed interval between shots — the
M16-style fire group. The interval is the cool-down INSIDE the attack; the
handle completes when the last shot of the burst dies.

**Targeting rule:** the caller computes the direction (AI/input owns targeting);
all shots in the group share it. A burst that must track a moving target is AI
sequencing — re-invoke with a fresh direction — not a macro feature.

### Sequence

Projectile → interval → Projectile → repeat × count.

### Main parameters

- **count** — shots in the burst.
- **interval** — seconds between shots (the intra-burst cool-down).
- **direction** — radians, caller-computed aim; all shots share it.
- **speed** — projectile speed.
- **ttl** — optional projectile lifetime.
- **damage** — damage.

Pacing BETWEEN separate attacks (wait, then next attack) is AI/attack-plan
sequencing, not part of the burst.

---

## 4. Spread Shot

**Invokes:** Projectile

**Effects:** Hit Sparkle (hit juice)

Fires multiple projectiles across an angle centered on a direction.
Simultaneous by default; `sequenceInterval > 0` launches them one at a time,
each that many seconds after the previous (boss ring sweeps).

### Sequence

Spread → multiple Projectiles (simultaneous or sequenced).

### Main parameters

- **count** — projectiles in the fan.
- **direction** — center direction.
- **angle** — total spread angle.
- **speed** — projectile speed.
- **ttl** — optional lifetime.
- **damage** — damage.
- **sequenceInterval** — seconds between launches (null/0 = simultaneous).

---

## 5. 360° Spread (Radial Shot)

**Invokes:** Spread Shot (with computed ring geometry)

**Effects:** Hit Sparkle (hit juice)

A radial form of Spread Shot that distributes projectiles evenly in a full
ring around the attacker. The macro computes the spread width from `count`
so neighbor gaps are exactly 360°/count — callers pass only `count`, never
`angle`. `sequenceInterval` (inherited from Spread Shot) sweeps the ring one
bolt at a time instead of firing it all at once — the classic boss ring.

### Main parameters

- **count** — number of projectiles around the circle.
- **startAngle** — optional rotation of the pattern.
- **speed** — projectile speed.
- **ttl** — optional lifetime.
- **damage** — damage.
- **sequenceInterval** — seconds between launches (null = simultaneous).

The canonical spread angle is 360 degrees.

---

## 6. Homing Missile

**Invokes:** Projectile

**Effects:** Hit Sparkle (hit juice)

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

## 7. Missile Rain

**Invokes:** Sky Missile (per missile) + launch visual

**Effects:** Surface Target Marker (landing warnings, via Sky Missile)

Launches multiple projectiles vertically upward from the attacker, sends them
outside the visible play area, announces their future landing positions with
ground markers, then drops them back onto the play area. During ascent,
projectiles may have a small sine oscillation so the launch feels alive rather
than perfectly mechanical.

The rain is N **Sky Missiles** (§22) with staggered positions/timing plus the
launch-up visual — the macro owns the pattern; each missile owns its own
marker → delay → drop sequence.

This is a canonical macro: callers configure it but should not rebuild its sequence.

### Sequence

1. Launch projectiles upward.
2. Projectiles ascend with a subtle sine oscillation (visual only — never
   affects landing positions).
3. Projectiles leave the visible play area.
4. Determine landing positions.
5. Show Surface Target Markers at each landing point.
6. Wait the configured warning/time-to-target period.
7. Projectiles fall vertically at their marked positions (Sky Missile, §22).
8. Resolve impact/collision.

### Main parameters

- **count** — number of projectiles in the rain.
- **xCoordinate** — central X coordinate used to calculate the drop pattern
  (null → view center).
- **distanceType** — `fixed` or `relative`.
- **distance** — spacing around the central drop point for fixed placement.
  Ignored in relative mode. `0` is valid for sequential attacks, allowing
  repeated drops at the same position.
- **pattern** — `simultaneous` or `sequential`.
- **interval** — when sequential, time between falling projectiles.
- **coordination** — for sequential patterns: `random`, `from_left`, or
  `from_right`.
- **launchInterval** — spacing between rockets during the upward launch burst.
- **ascentSpeed** — upward travel speed of the launch visual.
- **ascentOscillation** — amplitude of the sine drift while rising (px; visual
  only, does not affect landing positions).
- **fallDelay** — tension beat: silence between the last rocket leaving the
  view and the first marker appearing (default 0.5s).
- **timeToTarget** — per-missile delay between its marker appearing and impact
  (the player's survival window).
- **descentSpeed** — per-missile falling speed.
- **dropHeight** — per-missile spawn height above the impact point (px).
- **damage** — per-missile contact + blast damage.
- **team / blastTeam** — who the falling carriers / blasts hurt.
- **size** — carrier box size (px).
- **margin** — keep landing positions this far inside the view (px).
- **seed** — optional RNG seed for `random` coordination (determinism).
- **markerStyle** — optional Surface Target Marker effect override.
- **projectileStyle** — optional ascent-visual (trail) effect override.
- **blastType** — `explosion` | `shockwave` | `napalm`. Payload on impact,
  applied to EVERY missile in the rain (default `explosion`). Passed through
  to each Sky Missile (§22).
- **blast.explosionRadius** — explosion blast circle (px), used when
  `blastType=explosion`.
- **blast.shockRadius** — shockwave ring max radius (px), used when
  `blastType=shockwave`.
- **blast.fireWidth** — napalm burn zone width (px), used when
  `blastType=napalm`.

Each payload reads ONLY its own size key from `blast`; the others are ignored.

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

## 8. Bomb Spread

**Invokes:** Explosive Bomb (per bomb)

**Effects:** Debris + Explosion + Camera Shake (per bomb, via the explosiveBomb macro — screen flash suppressed)

Throws multiple bombs around a central throw angle. Like Spread Shot, the requested
total angle is divided across the bombs. A useful variation is a very high vertical
force with low horizontal force, allowing several bombs to be thrown high into the
air simultaneously. Each child is an explosiveBomb macro — the classic exploding
bomb composition.

### Main parameters

- **count** — bombs in the spread.
- **angle** — total spread angle.
- **direction** — central throw direction.
- **speed / force** — throw force.
- **arc / verticalForce** — trajectory height.
- **bounce** — optional bounce.
- **explodeOnContact** — optional contact trigger.
- **ttl** — optional timed detonation.

---

## 9. Cluster Bomb

**Invokes:** Bomb (carrier) → Spawn/Split (payload, fired on the carrier's terminal `detonate`)

**Effects:** Debris + Explosion + Camera Shake (via the child explosiveBombs — screen flash suppressed)

Throws a bomb that spawns multiple smaller bombs when it detonates. The parent is
an explosiveBomb; on its terminal event this macro fans out child explosiveBombs
via Spawn/Split. The children are real compositions: they pop outward in curved
trajectories and then follow normal bomb rules.

### Sequence

Parent explosiveBomb → terminal detonate → Spawn/Split → child explosiveBombs.

### Main parameters

- **parent bomb parameters** — throw behavior of the initial bomb.
- **childCount** — number of smaller bombs.
- **childForce** — force of the outward pop.
- **childAngle / spread** — distribution of child bombs.
- **childArc** — vertical component of child trajectories.
- **childTTL** — optional child detonation timing.

---

## 10. Molotov

**Invokes:** Bomb (carrier) → Fire Area (aftermath, fired on the carrier's terminal `detonate` event)

**Effects:** Debris (landing puff, via Bomb) + Fire Area glow (persistent area render)

Throws a bomb-like object that creates persistent horizontal fire when triggered.
Same composition pattern as Explosive Bomb: the dumb carrier owns flight; this
macro owns the aftermath at the death point.

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

## 11. Explosive Bomb

**Invokes:** Bomb (carrier) → Explosion (aftermath, fired on the carrier's terminal `detonate` event)

**Effects:** Debris (landing puff, via Bomb) + Explosion + Camera Shake (inherited from the Explosion primitive; screen flash suppressed per call — the macro declares no native effects)

Throws a bomb that detonates into the game's standard radial explosion at its
death point. The Bomb primitive is a dumb flight carrier (arc, bounce, fuse,
contact damage); THIS macro owns the aftermath — it subscribes to the carrier's
terminal `detonate { x, y }` event and invokes the Explosion primitive there.
One owner per effect: the carrier fires no blast VFX, so the blast's burst,
flash, and shake come from exactly one place — the Explosion primitive itself
(default switches, all on). The macro declares NO native effects; resolveEffects()
inherits the rows via meta.invokes (same pattern as bodyExplosion).

The hitbox works for real: the carrier is consumed on contact with a target
(`_attackHit` set by the collision handler / sandbox check), which ends the
flight and fires the blast AT THE IMPACT POINT. No phase-through exclusion —
a bomb that touches something goes off there.

### Sequence

Bomb (flight) → terminal detonate{x,y} → Explosion at that point.

### Main parameters

- **speed** — launch force (px/s).
- **direction** — throw direction (radians).
- **arc** — gravity px/s² (throw height).
- **bounce** — reflect off surfaces.
- **ttl** — fuse seconds.
- **damage** — carrier contact damage AND blast damage (one value).
- **radius** — blast radius (px).
- **origin** — marker label | {x,y} | null → attacker center.
- **blastTeam** — foe | ally | neutral: who the blast hurts.

---

## 12. Explosive Projectile

**Invokes:** Projectile (carrier) → Explosion (aftermath, fired on the carrier's terminal hit/expire events)

**Effects:** Hit-Sparkle / Debris (via Projectile) + Explosion + Camera Shake (inherited from the Explosion primitive; screen flash suppressed per call — the macro declares no native effects)

The straight-line twin of Explosive Bomb: a shot that detonates into a radial
explosion at its death point — impact or fuse expiry. Same composition pattern:
the Projectile primitive owns flight only; this macro owns the blast.

### Sequence

Projectile (flight) → hit or expire → Explosion at the death point.

### Main parameters

- **speed** — px/s travel speed.
- **direction** — radians (0 = right).
- **ttl** — seconds before auto-cull.
- **damage** — carrier contact damage AND blast damage (one value).
- **radius** — blast radius (px).
- **origin** — marker label | {x,y} | null → attacker center.
- **solidBehavior** — phase | stop | reflect.
- **gravity** — px/s² (>0 routes to the ballistic pool).
- **team** — ally | foe: who the carrier shot hurts.
- **blastTeam** — foe | ally | neutral: who the blast hurts.
- **size** — box size (px).
- **blastTeam** — foe | ally | neutral: who the blast hurts.

---

## 13. Dash Combo (macro id: `dashCombo`)

**Invokes:** Movement + Melee Hitbox (per segment) + Body Contact

**Effects:** Afterimage (per segment, during its movement phase), Sprite Shake
(on the victim, per connected hit), Hit Sparkle (hit juice)

A frame-scripted multi-hit dash: the attacker commits to a short timeline of
segments. Each segment holds ONE sprite frame for its whole movement, then
FREEZES on that frame — and the hit lands during the freeze. N segments = N
hits. The readable "get in close and commit" melee verb: fast, aggressive, and
beatable by design.

### Segment model

Each segment is two phases back-to-back:

```
[ MOVE ] → [ FREEZE ]   ← one segment (one sprite frame held throughout)
   ↑            ↑
 travels at    attacker STOPS; hitbox is LIVE here — this is the hit
 speed for
 duration,
 afterimage trails
```

- **MOVE phase** — the sprite shows the segment's frame (held static for the
  whole travel; a running cycle can replace it later). The attacker travels at
  `speed` for `duration` (or until `distance`). An afterimage instance trails
  the motion. NO hitbox during travel.
- **FREEZE phase** — the attacker stops on the SAME frame for `freezeFrames`.
  The segment's Melee Hitbox is active during this window. This is where the
  segment connects.

Segments run back-to-back with NO gap between them — one continuous committed
motion. The last segment's freeze carries the knockback launch.

```
seg1 move → seg1 FREEZE(hit) → seg2 move → seg2 FREEZE(hit) → segN move → segN FREEZE(hit + launch) → RECOVERY
```

### Canonical sequence

Optional telegraph → per segment: [move (afterimage) → freeze (hitbox live)] →
recovery (attacker committed, punishable).

### Main parameters

- **segments** — the timeline: an array of segment objects (see below).
- **direction / targetDirection** — dash direction (radians); all segments
  share it. Caller-computed (AI/input owns targeting). Horizontal only
  (left/right) — a ground dash has no vertical variant.
- **defyGravity** — the dash holds its altitude for the whole timeline
  (startup + all move/freeze phases): no arcing down mid-combo. When the last
  freeze ends, the attacker keeps its momentum and falls under normal gravity.
  A broken/cancelled dash releases the same way immediately.
- **startup** — seconds before the first segment starts moving (the
  commitment tell; tunable per enemy for risk level).
- **recovery** — ONE window at the very END (not between segments): seconds
  after the last freeze where the attacker is committed and punishable.
- **afterimage** — effect override for the per-segment trail (count,
  fadeRate, lifetime, color...).
- **shakeStyle** — sprite-shake override applied to the VICTIM on connected
  hits (amount scales with segment index — early hits shake less than the
  finisher).

#### Per-segment fields

- **frame** — the sprite frame/label held for this segment's move AND freeze
  (the visual identity of the beat; markers on the frame can offset the
  hitbox).
- **speed** — movement-phase speed (px/s) (Movement primitive `speed`).
- **duration** — movement-phase length (s) (Movement `duration`).
- **distance** — optional travel cap instead of/in addition to duration
  (Movement `distance`).
- **shove** — move-phase push on an overlapping victim as a fraction of the
  segment speed (default 0.6; 0 = no shove). Physics only, never damage.
- **freezeFrames** — how long the stop lasts (s or frames); the hitbox is live
  for this window.
- **hitbox** — `{ w, h, offset, activeFrames }` for this segment's Melee
  Hitbox, active during the freeze (`null` = pure-reposition segment that
  deals no hit — available, but the canonical combo hits on every segment).
- **damage** — this segment's hit damage (escalating: early < finisher).
- **knockback** — KnockbackSetting or `null`. Every segment EXCEPT the last
  MUST be `null` (or zero-strength) so the victim keeps control; ONLY the last
  segment carries a real setting `{ base?, scaleBySpeed, hitstun, pop?, dirMode }`.
  If `base` is omitted it is derived from the segment's own speed (`speed × 0.25`)
  so faster dashes launch harder automatically. `scaleBySpeed` adds a bonus
  proportional to the attacker's velocity at impact; `pop` adds a fixed upward
  launch; `hitstun` is the stun seconds.

### Rules

- **Hits land on the freeze, not during travel.** The move phase is
  repositioning (afterimage only); the freeze is the attack frame. This makes
  each beat readable: motion = coming, stop = hit.
- **The move phase SHOVS, it does not damage.** While the move-phase body
  overlaps the victim, the victim is pushed along at a fraction of the segment
  speed (default ~60%; per-segment `shove` override) — a shoulder-check, no
  hitstun, no launch, victim keeps full control. This is what keeps a standing
  victim IN the combo path: without it, the attacker would pass through and
  every later freeze would land behind a stationary victim (one-hit "combos"
  by geometry). Stand still = eat the full combo; run away = outrun the shove
  and later freezes miss; counter = still possible after any freeze. It is NOT
  knockback (no hitstun/launch data) — a per-frame AABB overlap → add to the
  victim's vx, same overlap test the hitboxes use. Body-overlap during the move
  deals NO damage; only the freeze hitboxes hurt.
- **Afterimages fade naturally at each freeze.** The per-segment afterimage
  instance is fed the attacker position while moving; when the freeze stops
  the motion, no new ghosts record and the existing ones fade out over their
  `lifetime` (built-in B2 recency rule — no manual clear). The next segment's
  move starts a fresh trail. The fade-between-beats sells the distinct hits
  for free.
- **Knockback lives on the hitbox data, not in takeDamage.** A segment with
  `knockback: null` deals damage with zero physical reaction — presence of the
  data is the only gate. Early freezes hurt without pushing: the victim stays
  in range and keeps control (the counter window must be real). Only the final
  freeze launches (short `hitstun` ends the exchange).
- **Combo lock limit:** at most N−1 segments connect on one victim before the
  finisher. All segments landing is the attacker's full-commit reward; a
  victim who reacts to an early hit still gets the counter.
- **Breaker = MELEE contact while the timeline is still running** (any move or
  freeze phase): the rest of the sequence DROPS immediately, the attacker takes
  the hit normally (no extra stun/stagger — just a normal hit on a committed
  body), and all pending state is cleaned (no ghost hitboxes; trails fade via
  their own rule). Hitting a planted freeze is the easiest frame to land it.
  A broken dash releases the gravity hold immediately so the body doesn't hang in the air.
- **Projectiles do NOT break the combo** — ranged contact is damage only, the
  timeline continues. The counter-verb is the melee-verb: breaking requires
  being point-blank, which is the commitment the design wants.
- **Recovery = punish, not breaker.** By then the timeline is finished; any
  hit (melee or projectile) is a free punish on a committed attacker.
- **Camera shake is NOT used** — this is a melee exchange, not an event.
  Camera shake stays reserved for explosions/stomps so it keeps its meaning.
- Cancel/damage rules above leave no orphan state: aborted timelines emit
  complete, pending hitboxes are dropped, afterimage instances terminate on
  their own clock.

### Composition

**Telegraph (optional) → per segment: [hold frame + Movement (+ Afterimage
while moving) → freeze: Melee Hitbox live] → on connect: Sprite Shake(victim)
+ Hit Sparkle → last freeze adds Knockback → Recovery**

Examples:
- 2-segment poke-dash → light enemy pressure, low startup
- 3-segment full commitment → boss/strong enemy; big finisher launch
- `startup: 0.4, recovery: 0.5` → flashy but heavily punishable (risky tool)

---

## 14. Targeted Beam

**Invokes:** Beam

**Effects:** Beam (the beam body itself)

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
- **announceMarker** — bool (default true). A Surface Target Marker fires at
  the beam's ENTRY point (the starting direction, same screen-edge rules as
  the beam primitive) before the beam pops in. Only the entry is announced —
  the sweep motion itself plays out un-telegraphed; that motion is its own read.
- **announceDelay** — seconds the entry marker stays visible (default 1.0).

The beam direction is determined by the locked reticle placement.

---

## 15. Sweeping Beam

**Invokes:** Beam

**Effects:** Beam (the beam body itself)

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

## 16. Stomp

**Invokes:** none (self-contained — owns its own radius blast via the damage pipeline; telegraph + dust + shake are effects, the hop is a visual sprite offset, no primitives invoked)

**Effects:** Telegraph effect (warning marker), Dust Cloud (ground impact),
Camera Shake (impact)

A surface-aware stomp attack with one telegraph for the full sequence, followed by
a short signal before each individual stomp. On impact the attacker performs a
very small hop — just enough to read that it moved — then lands and the blast
lands: a damaging **radius** around the impact point, dust puff on the ground,
and a camera shake. Every enemy inside the radius takes damage and knockback.

### Canonical sequence

Telegraph once → [signal → tiny hop → land: radius blast + dust + screen shake]
→ interval → repeat until `count` is reached.

### Parameters

- **surface** — `current` / `all`.
- **buildTime** — telegraph grow phase (s).
- **gapTime** — telegraph silence phase (s).
- **blinkTime** — telegraph final-warning phase (s).
- **impactDelay** — beat after the warning ends, before the hop/slam (s).
  Macro timing only — the telegraph effect finishes at blink end.
- **count** — number of stomps, default `1`.
- **interval** — pause between stomps.
- **hopHeight** — tiny vertical offset of the pre-impact hop (visual only).
- **radius** — blast radius around the impact point.
- **damage** — stomp damage (applied to everyone in the radius).
- **knockback** — radial stomp knockback.
- **dustStyle** — ground dust effect override.
- **shakeStrength** — camera shake intensity on impact.

### Rules

- The full telegraph plays only once at the beginning.
- Every individual stomp gets its own short attack signal.
- Do not replay the full telegraph between repeated stomps.
- Damage is a circular radius around the impact point — not a box, not
  screen-wide. Enemies outside the radius are untouched.
- Dust and camera shake fire on every impact, even if nothing is hit.
- `count: 1` behaves as a normal single stomp.

### Composition

**Reticle/Telegraph once → repeat [attack signal → delay → tiny hop →
land: Explosion(radius) + Dust Cloud + Camera Shake → interval]**

---

## 17. Stomp Wave

**Invokes:** Surface Wave (one invoke per side; the macro decides how many sides). Telegraph is an effect and the hop a visual sprite offset — neither is a primitive invoke.

**Effects:** Telegraph effect (warning marker), Dust Cloud (impact point),
Camera Shake (impact)

A stomp that sends a damaging wave traveling along the supporting surface. The
attacker does a tiny hop, lands, and on impact: dust puff at the impact spot,
camera shake, then one Surface Wave per side rolls out from there. On a block
or platform, the wave ends when that surface ends. On the ground, it travels
until its ttl or until blocked by solid geometry. The wave can hit barrels it
passes through.

### Sequence

Telegraph → tiny hop → land: dust + screen shake → surface wave(s) roll out →
wave(s) terminate.

### Main parameters

- **buildTime / gapTime / blinkTime** — telegraph phase times (s); the effect
  derives its total from them.
- **impactDelay** — beat after the warning ends, before the hop/waves (s).
  Macro timing only.
- **hopHeight** — tiny vertical offset of the pre-impact hop (visual only).
- **sides** — which waves fire: `left`, `right`, or both.
- **waveSpeed** — travel speed (maps to the primitive's `speed`).
- **damage** — wave damage.
- **waveHeight** — dangerous area height above the surface (primitive `height`).
- **ttl / maxDistance** — optional travel limit; the wave dies when it expires.
- **dustStyle** — ground dust effect override.
- **shakeStrength** — camera shake intensity on impact.
- **waveStyle** — wave effect override.

The macro owns the pattern, not the geometry: it invokes the Surface Wave
primitive once per side it wants. The direction parameter lives on the
primitive only.

Dust and camera shake fire on the impact itself, even if no wave hits anything.

Termination is owned by the Surface Wave primitive: ttl, end of supporting
surface (platform edge), or solid geometry in its path — whichever comes first.

---

## 18. Dust Zone (primitive — see attack-primitives.md §13)

A persistent rectangular toxic cloud that ticks damage on enemies inside it.
Documented in the primitives reference; listed here for completeness since it
appears in the Attack Theater alongside macros.

---

## 19. Body Explosion / Kamikaze

**Invokes:** Explosion (payload)

**Effects:** Explosion + Screen Flash + Camera Shake (inherited from the Explosion payload)

An enemy deliberately detonates itself and dies. The Jack-o'-lantern enemy is a
direct example.

### Sequence

Telegraph → approach/trigger as defined by AI → Explosion → Self-Destruct.

### Main parameters

- **deathBehavior** — `kill` (death pipeline) | `remove` (instant).
- **triggerPayloadFirst** — fire the payload before dying.
- **payload** — `{ id, params }` attack to fire first (default: explosion on the target).
- **payloadDelay** — max seconds to wait for an async payload.

The AI controls how the enemy gets into position. The macro controls the
standardized detonation behavior.

---

## 20. Dash Lane Sequence

**Invokes:** Movement + Telegraph effect

**Effects:** Telegraph effect (lane warning)

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

- Lanes are anchored to the ACTIVE ROOM'S FLOOR (`getActiveFloorY`): lane 0's
  BOTTOM sits at `laneOffset` above the floor (the macro subtracts the attack
  half-height so beam/charge centers land correctly), each next lane UP by
  `laneSpacing`. No more sub-floor lanes. Falls back to ZONE_GROUND_Y (480)
  when no zone context exists (theater).
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

## 21. Spawn / Split

**Invokes:** Projectile / Explosive Bomb / enemy factory

**Effects:** Hit Sparkle + Debris (projectile children, via Projectile) / Debris + Explosion + Camera Shake (bomb children, via Explosive Bomb → Explosion; screen flash suppressed)

Fans out N child entities from a single point and materializes each into a live
attack or enemy. The caller invokes one id and gets live results back — it never
loops children or handles launch physics. This is the shared mechanism behind
Cluster Bomb and any "burst outward" attack.

### Canonical sequence

Generate fan vectors → materialize each child (projectile / bomb / enemy) →
children run their own normal rules.

### Main parameters

- **spawnType** — what the children become: `projectile` (straight shots),
  `bomb` (ballistic arc, bounce, detonate on impact — materialized as an
  explosiveBomb macro), or `enemy` (a live enemy entity that continues acting
  toward the attacker).
- **count** — number created.
- **centerDirection** — central launch direction.
- **angle** — distribution width (2π = radial).
- **force** — launch speed.
- **inheritVelocity** — optional fraction of parent velocity added to each child.
- **enemyType** — enemy id when `spawnType` is `enemy`.
- **bomb** — bomb params override when `spawnType` is `bomb`.

### Rules

- One invoke returns live handles (projectiles/bombs) and/or enemy entities; the
  caller registers enemies with its world and steps their AI (per-frame enemy AI
  is the game loop's job, never the engine's).
- Enemy children are launched with the fan velocity + a knockback-style hit-stun
  so gravity integrates the full arc before their AI resumes.
- Child bombs/projectiles follow their own normal primitive rules once launched.
- Can be triggered on detonation, hit, expiration, or an explicit call.

### Composition

**Fan vector generation → Projectile / Bomb / enemy factory per child**

Examples:
- `spawnType: bomb, count: 4` → Cluster Bomb payload pop
- `spawnType: projectile, angle: 2π` → radial burst
- `spawnType: enemy, count: 3` → spawn a small pack that fans out and chases

---

## 22. Sky Missile

**Invokes:** Explosive Projectile / Shockwave Projectile / Napalm (vertical fall, chosen by `blastType`)

**Effects:** Surface Target Marker (landing warning at the impact point)

A single missile arriving from above at a FIXED ground position: the landing
marker appears, the player gets a clear escape window, then the missile drops
straight down and detonates. The vertical, telegraphed twin of Explosive
Projectile — same blast, but the approach vector is always straight down and
the impact point is announced in advance.

This is the building block for Missile Rain (§7): the rain is N sky missiles
with staggered positions/timing plus the launch-up visual. One missile, one id.

### Sequence

Surface Target Marker at (x, groundY) → wait `timeToTarget` → payload macro
(explosion/shockwave/napalm) spawns above the marker and falls vertically →
detonate at the marked point.

### Main parameters

- **x** — impact x (world coords); the marker AND the drop share it.
- **groundY** — ground line y for the marker placement (or resolved from the
  surface under `x`).
- **timeToTarget** — seconds between marker appearance and impact. This is the
  player's survival window; the core game-feel knob.
- **dropHeight** — how far above the marker the missile becomes visible before
  falling (visual entry).
- **fallSpeed** — descent speed (px/s).
- **damage** — carrier contact + blast damage (passed to the payload macro).
- **team / blastTeam** — who the carrier/blast hurts.
- **markerStyle** — optional Surface Target Marker effect override.
- **blastType** — `explosion` | `shockwave` | `napalm`. Chooses the payload on
  impact. Default `explosion`. (No `plain`: a sky missile that is just a
  falling bullet is not a distinct attack.)
- **blast.explosionRadius** — explosion blast circle (px), used when
  `blastType=explosion`.
- **blast.shockRadius** — shockwave ring max radius (px), used when
  `blastType=shockwave`.
- **blast.fireWidth** — napalm burn zone width (px), used when
  `blastType=napalm`.

Each payload reads ONLY its own size key from `blast`; the others are ignored.
The carrier uses `solidBehavior: 'stop'` so it detonates on surface contact.

### Rules

- The marker is FIXED at the impact point for the whole warning window — the
  player reads "leave this spot", not "track a moving target" (that would be
  Target Reticle, §10 effects; wrong tool here).
- `groundY` is the TOP of the highest surface in the drop column (floor,
  platform, or block) — the missile detonates on whatever is actually there,
  not on an invisible floor below it.
- The fall is strictly vertical: no homing, no drift. Fairness comes from the
  warning, not from prediction.
- Cancel during the warning removes the marker AND prevents the drop.
- The fired payload macro is promoted into the root handle's `handles` list so
  hosts step AND draw its deferred zone children (napalm fire) uniformly.
- Demo/theater: stage a small platform under part of the drop zone so the
  column-resolution behavior is visible (same staging as the other platform
  demos).

### Composition

**Surface Target Marker (effect) → delay → payload macro (vertical)**

Examples:
- single use → boss "you're next" punishment shot
- N × with stagger + ascent visual → Missile Rain (§7)
- `blastType=napalm` → telegraphed burning-zone drop (area denial)

---

## 23. Shockwave (primitive — see attack-primitives.md §14)

Expanding ring-pass damage primitive. Documented in the primitives reference;
listed here for completeness since it appears in the Attack Theater alongside
macros, and two macros below are built on it.

---

## 24. Shockwave Bomb (macro)

Ballistic bomb that detonates into an expanding shockwave ring at its landing
point. Telegraph blink warns before the ring launches.

### Sequence

1. Bomb arcs in (gravity, bounce).
2. Lands → telegraph circle blink (0.15s shrink + 0.1s flash = 0.25s total).
3. Shockwave primitive fires at impact point (ring expands, ring-pass damage).

### Main parameters

| Param | Default | Description |
|-------|---------|-------------|
| direction | -0.5 | Throw direction (radians) |
| speed | 500 | Launch force (px/s) |
| arc | 800 | Gravity px/s² (throw height) |
| bounce | true | Reflect off surfaces |
| ttl | 2 | Fuse seconds |
| radius | 150 | Shockwave max radius (px) |
| damage | 70 | Ring-pass damage |
| duration | 1.2 | Ring expansion time (s) |
| easing | easeIn | Growth curve |
| knockbackIntensity | 8 | Radial push strength |
| blastTeam | neutral | foe \| ally \| neutral |

**Invokes:** bomb (carrier) → shockwave (payload)

---

## 25. Shockwave Projectile (macro)

Straight-line shot that detonates into an expanding shockwave ring at its
impact point. Telegraph blink warns before the ring launches.

### Sequence

1. Projectile flies straight (or ballistic if gravity > 0).
2. Hits wall/ground/target → telegraph circle blink at impact (0.25s).
3. Shockwave primitive fires at impact point.

### Main parameters

| Param | Default | Description |
|-------|---------|-------------|
| direction | 0 | Radians (0 = right) |
| speed | 700 | px/s travel speed |
| ttl | 2 | Seconds before auto-cull |
| radius | 150 | Shockwave max radius (px) |
| damage | 70 | Ring-pass damage |
| duration | 1.2 | Ring expansion time (s) |
| easing | easeIn | Growth curve |
| solidBehavior | stop | phase \| stop \| reflect |
| gravity | 0 | px/s² (>0 = ballistic arc) |
| blastTeam | neutral | foe \| ally \| neutral |

**Invokes:** projectile (carrier) → shockwave (payload)

---

## 26. Napalm

**Invokes:** Projectile (carrier) → Fire Area (payload, fired on the carrier's terminal hit/expire events)

**Effects:** Debris (via Projectile carrier) + persistent Fire Area zone at the death point

The straight-line, instant-detonation twin of Explosive Projectile (§12): a
shot that leaves a persistent BURNING GROUND ZONE at its death point — impact
or fuse expiry. Same composition shape as Explosive Projectile (no telegraph,
no beat clock) — the payload is a `fireArea` primitive instead of a radial
blast.

The difference from Molotov (§10): Molotov LOBS (bomb carrier, arced throw);
Napalm SHOTS (projectile carrier, straight line). Both leave the same
`fireArea` payload.

### Sequence

Projectile (flight) → hit or expire → Fire Area anchored to the highest
surface in the impact column (floor OR platform).

### Main parameters

- **speed** — px/s travel speed.
- **direction** — radians (0 = right).
- **ttl** — seconds before auto-cull.
- **damage** — carrier contact damage.
- **fireWidth** — burn area width (px); height fixed at 48.
- **fireDuration** — how long the area burns (s).
- **fireTickRate** — damage ticks per second in the area.
- **fireDamage** — damage per tick in the area.
- **origin** — marker label | {x,y} | null → attacker center.
- **solidBehavior** — phase | stop | reflect (default stop: ignite on contact).
- **gravity** — px/s² (>0 routes to the ballistic pool).
- **team** — ally | foe: who the carrier shot hurts.
- **size** — box size (px).
- **blastTeam** — foe | ally | neutral: who the fire hurts.

### Rules

- Instant ignition — no telegraph, no blink, no beat clock (unlike Shockwave
  Projectile, §25).
- The fire zone anchors to the TOP of the highest surface in the impact column
  (floor OR platform) via the shared `resolveImpactPoint` rule, so it never
  renders through a platform or below the floor.
- The fire zone is a deferred child exposed in `handles`; hosts step and draw
  it like any other deferred payload.

---

## AI usage examples

Attack Macros do not contain enemy decision-making.

**Simple enemy**

`Projectile (primitive, aimed at hero) → wait → repeat`

**More advanced enemy**

`Burst Shot → reposition → Bomb (primitive) → repeat`

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
7. A macro's `impl()` MAY call `invoke()`; a primitive's MUST NOT. Every macro
   declares what it composes via `meta.invokes` (rendered by the Theater's
   INVOKES panel and documented as each section's **Invokes:** line).
8. **A macro must compose.** It either invokes ≥2 primitives/macros, or owns
   timing/looping no single primitive provides (telegraph sequencing, computed
   fan/ring geometry). If an attack is a 1:1 mirror of one primitive, there is
   NO macro — callers invoke the primitive directly. Repeated-fire patterns
   (fire-groups beyond a burst) are expressed by sequencing macro invocations
   in an attack plan, not by adding burst params to primitives.
9. **Macros never target.** Targeting is the caller's job: AI and hero input
   code compute the direction (they know where the target is) and pass it.
   Macros own PATTERNS — timing, fans, rings, telegraphs — and take a
   `direction`, never a `target`. This keeps intent readable in AI code and
   keeps the attack library free of who-is-aimed-at logic.

The goal is a small mechanical vocabulary that can produce many attacks without
creating dozens of almost-identical custom implementations.

---

## 27. Lane Sequence (implemented — `laneSequence.js`)

**Invokes:** Charge (mode: dash) OR Beam (mode: beam), per lane

**Effects:** Surface Target Marker (boundary telegraph per lane, via primitive announceMarker) + Beam (beam mode)

A telegraphed sequence where the attacker enters from offscreen and attacks
completely across the screen through each configured Y lane exactly once.
One macro, two modes via enum.

### Modes

- **`dash`** — charge primitive (`distanceType: 'infinit'`, `announceMarker: true`).
  The attacker dashes across the screen at `dashSpeed`. Position-based dodge.
- **`beam`** — beam primitive (`length: 9999`, `announceMarker: true`).
  A static full-screen beam stays hot for `beamDuration`. Timing-based dodge.

### Canonical sequence per lane

Boundary marker (entry side) → gap → attack fires → attack ends → interval → next lane.

The interval starts ONLY after the current lane's attack fully completes
(beam fade done / dash exited), so the next marker never overlaps the previous attack.

### Parameters

- **mode** — `'charge'` | `'beam'`.
- **laneCount** — number of rows (default 3).
- **laneSpacing** — px between rows, measured UP from the floor (default 120).
- **laneOffset** — px above the active room's floor where lane 0's BOTTOM sits (default 0 = bottom on the ground).
- **lanes** — array of absolute Y positions; overrides laneCount/laneSpacing/laneOffset.
- **laneOrder** — `bottom_to_top` | `top_to_bottom` | `random`.
- **sideMode** — `fixed_left` | `fixed_right` | `alternate` | `random`.
- **alternateStartSide** — `left` or `right`.
- **announceDelay** — s the boundary marker stays visible per lane (default 0.5).
  Hardcoded ON — a lane sequence is by definition telegraphed.
- **dashSpeed** — px/s (dash mode, default 1200).
- **damage** — contact damage (dash) / per tick (beam).
- **knockback** — `{x,y}` or null (dash only).
- **beamDuration** — s the beam stays hot (beam mode, default 0.8).
- **beamWidth** — damaging thickness px (beam mode, default 24).
- **tickRate** — damage ticks per second (beam mode, default 8).
- **interval** — pause between lanes in seconds (default 0.15).
- **team** — ally | foe.
- **style** — beam effect style override (beam only).

### Rules

- One complete sequence uses every configured Y lane exactly once.
- Fixed side means every attack enters from that same side.
- Alternate side alternates left/right per lane; starting side configurable.
- Random side independently chooses left/right for each lane.
- Lane order and side selection are independent.
- The announcement is always on (not a param).
- The interval starts after the attack fully ends (no overlap with next marker).


## Mine and Throw Mine

`invoke('mine', { x, groundY, ttl: 2, blinkDuration: 2,
  mineType: 'explosion', team: 'neutral', damage: 40, radius: 70 }, ctx)`

The persistent 24×8 rectangular base is drawn through the ordinary `zone.draw`
host hook (layered casing, highlight and indicator), separately from its warning.
Host-owned `step(dt, targets)` advances idle → warning → payload → complete.
TTL starts while settled; `null` disables automatic triggering, not contact.
Valid AABB contact immediately latches warning; repeated contacts never restart it.
Zero blink duration detonates immediately. Cancellation explicitly clears the held overlay.

Contact eligibility reuses `combat/explosion.js:isValidTarget`: ally hits enemies,
foe hits `ctx.world.hero`, neutral hits either; owner, dead and intangible targets
are excluded. Supply the real hero identity in context, not merely a team string.
Explosion is the default primitive; shockwave invokes the primitive directly after
warning, with **no** additional telegraph/build/gap/blink/impact-delay phases.

`throwMine` adds `origin` (center point or marker), `speed:500`, `direction:-0.5`,
`arc:800`, `bounce:true`. It composes the actual `bomb` (Ballistic Arc)
primitive: a pooled Special integrated only by the host's pool update, then
shared bomb terrain resolution and CollisionWorld wall/block-side reflection.
The bomb opts into `retainOnContact` and `retainOnSettle`, with `ttl:null`
disabling its flight fuse. Defaults for other bomb users remain unchanged.
Non-consuming `contact` events arm eligible targets without contact damage.
On settling, throwMine snapshots the rectangular base into the persistent mine
and cancels/releases the flight carrier (including its collision registration).
The mine owns only the resting TTL, warning, payload and zone rendering—not physics.
Nested skyMissile/missileRain/spawnSplit/clusterBomb parents step children once;
hosts integrate pooled carriers once and never promote children to another step list.
Cancellation cascades to the carrier and warning; pool exhaustion completes cleanly. TTL does not run during flight or bounces. Contact
in flight latches arming, but the mine continues falling/bouncing and only starts
its blink once settled on a floor/platform. No contact damage is dealt.

Payload propagation:
- `skyMissile` / `missileRain`: `blastType:'mine'`, `mineType`, `mineTtl:4`
  (nullable), `blinkDuration:2`; radius uses `blast.explosionRadius` or
  `blast.shockRadius`. The falling mine stops on the resolved marked surface;
  `blastTeam` becomes the mine team.
- `spawnSplit`: `spawnType:'mine'`, `mineType`, `mine:{ttl,blinkDuration,team,
  damage,radius,arc,bounce}`. Launch vectors include inherited velocity.
- `clusterBomb`: `spawnType:'mine'` selects children (parent remains a bomb),
  `mineType`, `mineTtl:4` (nullable), `blinkDuration:2`; child damage/radius/arc
  and blastTeam propagate to bouncing thrown mines.

Theater controls expose these selectors, nullable TTL and blink duration. The
base mine demo centers its base and walks an appropriate target into contact.
