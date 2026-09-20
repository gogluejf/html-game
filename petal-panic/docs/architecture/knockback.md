# Petal Panic — Knockback / Hit Reaction

Knockback is **how a victim reacts physically when hit**. It is separate from damage:
damage drains a health/energy pool; knockback is the physical reaction — being shoved,
being stunned, and (for heroes) briefly becoming invulnerable. Two attacks can deal
identical damage while producing very different knockback.

The guiding idea: **knockback belongs to the thing that is hitting, not to the moment of
the hit.** Whatever deals the blow — an attack hitbox, a projectile, an explosion, or
an enemy's own body — carries its own knockback character. The engine reads that character
and applies it to whichever entity was struck, using the same rules for heroes and for
enemies. No attack type gets special-cased at the point of impact.

---

## 1. What knockback describes

A knockback setting expresses four things about a hit:

- **How hard** the victim is pushed (its strength).
- **How long** the victim is stunned and unable to act (its duration).
- **Whether** the victim briefly absorbs further hits afterward (a protection window).
- **Which way** the push goes (away from the attacker, along the attacker's motion, or
  radially outward from a blast center).

These are independent knobs. A hit can be strong but brief, weak but long, shove with no
stun, or stun with barely any shove.

---

## 2. Strength: fixed weight plus motion

Knockback strength has two contributions:

**Inherent weight.** Every attack has a base "heft" — how hard it lands even when
nothing is moving. A supermove is inherently heavier than a light poke. This is what
makes a supermove feel like a big reward and a normal hit feel smaller, regardless of
speed.

**Motion contribution.** How fast the attacker is moving *into* the victim adds to the
impact. Only the head-on component matters: an attacker sliding past sideways adds
little, while one charging straight in adds a lot. This makes knockback physical rather
than flat — the same body, idle versus charging, produces very different knockback.

Together these mean an attack's punch is partly its nature and partly the momentum
behind it at the moment of contact.

---

## 3. Victim mass resists knockback

Not every victim moves the same amount under the same blow. Heavier entities resist
knockback more than light ones. A light enemy sent flying by a supermove should barely
stumble a heavy one under the identical hit. Mass therefore acts as a divisor on the
final shove: the same attack, different mass, different response — with no per-attack
special handling.

---

## 4. Direction

A hit pushes the victim in a meaningful direction, chosen by the kind of attack:

- **Away from the attacker** — the default for bodies and melee; you get shoved off the
  thing that hit you.
- **Along the attacker's motion** — for lunging/dashing attacks; the victim is thrown in
  the direction the attacker was traveling.
- **Radial from a center** — for explosions; everything is blown outward from the blast
  point, falling off with distance.

Direction is part of the knockback character, so each attack declares how it should throw
its victim.

---

## 5. Knockback is two-dimensional

A hard hit does not only slide the victim sideways — it imparts upward motion, so the
victim pops off the ground and falls back under gravity. This gives a readable "launched"
reaction without any separate bounce system: the pop comes from the impulse, the return
comes from existing gravity.

The read is tuned to stay grounded in feel: a supermove visibly lofts a light enemy a
body-height or two; a light poke lifts nothing. Stronger knockback naturally produces a
bigger pop because it imparts more upward velocity. There is no exaggeration beyond what
the impulse itself provides.

---

## 6. Stun and protection

**Stun.** While a victim is stunned it cannot act — an enemy mid-attack freezes, a hero
loses control — for the knockback's duration. Physics keep running during the stun so the
knockback plays out visibly; control returns cleanly when it expires. This is what makes
a connect feel like it *lands*: the target actually reacts instead of the attacker passing
through.

**Protection window.** After being hit, a victim may briefly absorb further hits. Heroes
use this so a single encounter doesn't melt them across several overlapping frames.
Enemies rely instead on the existing "one hit per swing" rule, so their protection window
stays off — keeping combat snappy.

---

## 7. Where knockback lives

Knockback is carried by the source of the hit:

| Source of the hit | Who carries the knockback |
|-------------------|------------------------|
| An attack hitbox (melee, sweep, cartwheel, super) | that attack |
| A projectile | the projectile |
| An explosion | the explosion (strength + distance falloff) |
| An enemy's body (contact) | the enemy itself |

Body contact is the one case where the "attacker" is the entity's own body rather than a
transient hitbox — but it follows the same rules and uses the same motion contribution,
so an idle body and a charging body behave differently for free.

Because knockback is data on the source, making a new attack shove harder (or not shove at
all) is a matter of describing that attack's character — not adding branching logic at
the point of impact. A friendly bullet that should never knock anything simply carries no
knockback.

---

## 8. Symmetry between heroes and enemies

Heroes and enemies react with the same underlying mechanic: a shove, a stun window, and
mass-based resistance. The difference is only in the details each side uses — heroes add
a protection window and a visual blink; enemies interrupt their current action during the
stun. One set of rules covers both directions, so an enemy hitting a hero and a hero
hitting an enemy are described the same way.

---

## 9. Body contact: idle vs charging

Because body-contact knockback includes the motion contribution, an enemy's body hit scales
with how fast it is moving. An idle enemy you walk into gives a small shove; the same
enemy charging at you launches you. A boss is heavier and often faster, so it reads as
harder through its actual mass and speed rather than through a separate "boss" category.
This replaces the old idea of distinct "regular contact" and "boss contact" strengths with
a single, physical rule.

---

## 10. Impact matrix — enemy attacks on heroes

Every way an enemy can hurt the hero, and how that hit should read in terms of knockback.
This is a design description, not tuning values.

| Enemy attack | How it lands | Knockback character on the hero |
|--------------|-------------|------------------------------|
| Body contact (idle) | Hero overlaps a stationary enemy body | Small shove away, short stun. You bonk your head; you keep most control. |
| Body contact (charging / dashing) | A fast-moving enemy body hits the hero head-on | Large launch, longer stun. Scales with the enemy's speed into the hit — a charging enemy far exceeds an idle one. |
| Boss body contact | Overlap or charge from a heavy boss | Heavier than a regular enemy through its mass and speed; reads as a big fling. |
| Projectile | A foe bullet strikes the hero | Moderate shove along the bullet's travel direction, short stun. Lighter than a body hit. |
| Heavy projectile | A large/slow foe shot (e.g. bomb) | Stronger shove + longer stun than an ordinary bullet. |
| Melee hitbox (whip, lunge, etc.) | An enemy's ranged melee swing connects | Short shove + brief stun, directional toward the swing. Currently missing — should behave like a light body hit. |
| Explosion / blast | Hero inside a blast radius | Strong radial shove outward from the blast center, falling off with distance; moderate-long stun. The heaviest "area" reaction. |

Reading: the heavier and faster the source, the bigger the launch and the longer the
stun. Idle bodies are mild; charging bodies, heavy shots, and explosions are severe.

---

## 11. Impact matrix — hero attacks on enemies

Every way the hero can hurt an enemy, and how that hit should read in terms of knockback on
the enemy. v1 scope applies knockback to the three committed attacks only; the rest deal
damage without shoving (for now).

| Hero attack | Commitment | Knockback character on the enemy |
|-------------|-----------|-------------------------------|
| Normal melee | Low (quick poke) | v1: damage only, no knockback. (Future: small flinch.) |
| Sweep (Balthazar) | High — committed forward lunge | Medium-strong shove forward along the lunge + short stun. Clears the path ahead. |
| Cartwheel (Scarlet) | High — committed retreat | Strong shove away from the hero + short stun. Creates escape space behind. |
| Supermove dash | Highest — full-body commit | Strongest launch, longest stun, visible loft. The big reward; scales with dash speed. |
| Thorn projectile | None (ranged) | No knockback — pure damage. Keeps basic fire safe and non-committal. |
| Special projectile (saw/bomb) | Low (ranged) | v1: damage only. (Future: bomb could carry a radial shove.) |
| Friendly explosion | Area | Blows enemies radially outward, falling off with distance. |

Reading: the more the hero commits their body, the harder the enemy is thrown. A bullet
never shoves; a supermove launches. This contrast is the core of the design intent.

---

## 12. Design intent

The goal is that committed, high-commitment attacks feel decisive. A supermove should
read as a big, rewarding launch; a sweep should clear the path forward; a cartwheel should
create escape space behind. Light, safe attacks (like a basic bullet) should deal damage
without shoving, so there is a clear contrast between "I threw my whole body at this" and
"I fired a shot." Knockback is the tool that makes that contrast legible.

---

## 13. v1 Scope & Handoff

v1 ships knockback on the three committed hero attacks — Balthazar's sweep, Scarlet's
cartwheel, and the shared supermove dash — each carrying its own `knockback` setting on
its attack hitbox and routing through the single `applyKnockback()` engine. Enemies react
with hitstun (their `ai()` freezes while physics keep integrating, so the shove plays out
visibly). Body contact is unified under the same rule for heroes and enemies: one
velocity-scaled `bodyKnockback` carried on the entity, idle versus charging falling out of
the motion term with no separate branch. And every shove carries a vertical pop, so a hard
hit visibly lofts the victim off the ground before gravity brings it back.

**Out of scope for v1 — deferred to future work:**

- **Enemy→hero per-attack knockback.** Enemy melee hitboxes (Jester's whip, Vine Hound's
  lunge, Violetta's swing) currently route through `KNOCKBACK_PROFILES` source keys rather
  than `applyKnockback`, so they use flat profile strengths instead of a per-attack setting
  with a motion contribution. The impact matrix in §10 describes the intended character; the
  wiring to carry it on the enemy's own hitbox is not done.
- **Friendly projectile knockback.** Thorn, saw, and bomb carry no knockback — pure damage.
  This is intentional for v1 (basic fire stays non-committal); a radial shove on the bomb is
  a candidate for later.
- **Boss mass-based resistance.** Bosses read harder today via a higher base value chosen by
  an `isBoss` check (`base: 340` vs `260`), not a true mass divisor. A real mass term that
  resists all knockback uniformly is still to come.
- **Hit-stop.** Documented separately in `.squid-os/plans/knockback-system/hitstop-proposal.md`;
  not implemented.
- **Radial explosion knockback on enemies.** The engine supports a `radial` dirMode, but no
  explosion currently carries a knockback setting, so blasts shove nothing yet.

The next epic picks up enemy→hero per-attack knockback and friendly projectile shove.
