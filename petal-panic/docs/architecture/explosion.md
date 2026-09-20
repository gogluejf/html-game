# Petal Panic — Explosion / Blast

An explosion is **a radial area-of-effect event**: something detonates at a point, and
every entity within a radius reacts — taking damage, being shoved outward, and (for
heroes) briefly becoming invulnerable. Two explosions can have identical blast radius
while producing very different results, because an explosion's *character* — how hard it
hits, which side it hurts, and how violently it throws things — is its own data.

The guiding idea: **an explosion is one generic structure, not a per-source special case.**
Whether the blast comes from a destructible barrel, an enemy that rolls in and detonates,
or a friendly bomb the hero throws, the engine resolves it with the same rules against the
same blast definition. No source type gets special-cased at the moment of detonation.

This document is the conceptual spec. It describes behavior and invariants, not a
mandatory internal implementation. Where it and `knockback.md` overlap, `knockback.md`
owns the shove/stun math; this document owns what an explosion *is*, who it affects, and
how those pieces fit together.

---

## 1. What an explosion describes

A blast expresses five things:

- **Where** it happens (its center).
- **How far** it reaches (its radius).
- **How much** it hurts (its damage).
- **Which side** it hurts (its alignment: foe, ally, or neutral).
- **How hard** it shoves (its knockback character, described by `knockback.md`).

These are independent knobs. A blast can be wide but weak, small but lethal, hurt only
enemies or only the hero, shove with no damage, or deal damage with barely any shove.

---

## 2. Alignment: which side does it hurt

Every explosion declares an alignment. This decides who is a valid target.

- **Foe** — the blast belongs to the enemy side. It hurts the hero (and hero-owned
  objects). It does **not** hurt other enemies. An enemy that explodes does not take down
  its own kind.
- **Ally** — the blast belongs to the hero side. It hurts enemies. It does **not** hurt
  the hero. A friendly bomb the player throws cannot blow up the thrower.
- **Neutral** — the blast belongs to no side. It hurts everything in range except itself.
  A destructible object like a barrel is neutral: standing next to it when it blows hurts
  you whether you're the hero or an enemy.

Alignment is part of the blast's character, so each explosion declares how it should treat
the entities around it. The engine filters targets by alignment before applying anything —
a foe blast simply never considers another enemy a target.

Self-damage is excluded by construction: the thing that detonated is never a target for
its own blast.

---

## 3. Damage

Every valid target within the radius takes the blast's damage through the central damage
system, so defense mitigation, resource pools (energy vs HP), telemetry, and death
handling all apply uniformly.

Damage and knockback are independent properties. Two blasts may deal equal damage while
producing very different shove, or deal different damage while shoving identically.

Targets already protected by i-frames absorb the blast — no damage, no shove.

---

## 4. Knockback

A blast shoves every damaged target radially outward from the blast center. This is the
`radial` direction mode from `knockback.md`: the push direction points from the center to
the victim, and stronger blasts throw victims further.

The blast carries a knockback setting exactly like any other hit source (`knockback.md`
§7): base strength, motion contribution, stun duration, optional protection window, and
direction mode fixed to `radial`. Because the shove routes through the single shared
`applyKnockback`, a blast and a melee hit and a projectile all obey the same physical
rules — mass resists, stun interrupts action while physics run, and heavier victims move
less.

Vertical pop applies as usual: a strong blast lofts light victims upward so they arc away
and fall back under gravity.

The blast's knockback may be derived from its damage/strength or declared explicitly;
either way it lives on the blast definition, never inline at the detonation site.

---

## 5. One mechanism, every source

Because an explosion is a single structure resolved by one path, adding a new kind of
blast is a matter of describing its character — not writing a new detonation routine.

| Source | Alignment | Notes |
|--------|-----------|-------|
| Destructible barrel | Neutral | Hurts whoever stands in range; the common "don't stand there" hazard. |
| Rolling enemy that detonates (e.g. Jack-O-Lantern) | Foe | Hurts the hero, spares its own kind. |
| Hero-thrown bomb | Ally | Hurts enemies, spares the thrower. |

Each of these is the *same* blast resolved with a different alignment and a different
knockback character. There is no separate "barrel explosion code" versus "enemy explosion
code" — there is one explosion, and these are three instances of it.

---

## 6. Readability

A blast must read clearly at the moment of detonation:

- a visible flash/expanding ring scaled to the blast radius;
- screen shake proportional to the blast's violence;
- affected victims visibly reacting (shove + stun + loft) rather than silently losing HP.

The visual scale should track the blast's actual radius and strength so a small pop and a
big detonation look appropriately different.

---

## 7. Design intent

Explosions should feel like **consequences of position**: standing where something blows
has a cost, and the cost scales with how violent the blast is and which side it serves.

A neutral hazard punishes everyone equally. A foe's self-destruction threatens the player
without thinning the enemy ranks. An ally's bomb clears a pocket of enemies without
endangering the thrower. The contrast between these three is the whole design point —
and it falls out of a single alignment field plus a single knockback setting, with no
per-source branching at the point of impact.
