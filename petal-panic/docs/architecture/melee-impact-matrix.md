# Melee Impact Matrix

Single source of truth for what a melee-family impact does per move × outcome.
Velocities are px/s as stamped on the hitbox (pre victim-resist division).
"Ghost" = intangible flight (phases through terrain). "Fuse" = 0.6s cook →
break/explosion at fuse end.

Source code: `js/hero/heroDefs.js` (vectors), `js/combat/hitbox.js`
(tier selection, fuse branch, kill-upgrade, shake tiers),
`js/objects/barrelPhysics.js` (`armBarrelMeleeFuse`, star barrel constants),
`js/systems/update.js` (star barrel touch path),
`js/combat/collisionHandlers.js` (`starPowerKill`),
`js/objects/barrelSync.js` + `js/combat/attack/primitives/explosion.js`
(detonation shake).

## Attack structure (hits per swing)

| Move | Contact frames | Hits on one target | Finisher |
|---|---|---|---|
| Melee (jab) | all active frames | 1 (first frame to hit) | none |
| Super melee (sweep) | all active frames | 1 (first frame to hit) | none |
| Supermove (dash) | keyframes only (`durUnits >= 3`) | up to 3 (one per keyframe) | yes — last keyframe |

- **Melee / super melee:** the box is re-resolved every frame from the sheet,
  but owner-level swing dedupe means one target is struck once per swing.
  Set cleared when the swing ends.
- **Supermove:** only held money poses (keyframes) carry contact; short frames
  between them deal nothing. Each keyframe has its own hitbox instance, so the
  same target can connect on every burst. The final keyframe is the finisher
  (big vector + 8f hitstop, pre-hit).

## Barrels

| Move | Chip | Lethal | Shake (chip) | Shake (lethal) | Hitstop | Ghost (lethal) |
|---|---|---|---|---|---|---|
| Melee (jab) | 450, −120 | 750, −260 + fuse | 2px | 2px | 0 | Y (0.6s) |
| Super melee (sweep) | 550, −180 | 750, −330 + fuse | 2px | 2px | 0 | Y (0.6s) |
| Supermove burst | 300, −120 | 850, −260 + fuse | 4px | 4px | 4f | Y (0.6s) |
| Supermove finisher | 850, −260 | 850, −260 + fuse | 4px | 4px | 8f | Y (0.6s) |
| Star touch | — | 900, −450 ±15% jitter + fuse | — | 6px | 2f | Y (0.6s) |

### Barrel detonation shake (by type, at fuse end)

| Barrel type | Detonation shake |
|---|---|
| Explosive / propane | 4px (explosion primitive default) |
| Supercoin | 14px |
| Toxic | 6px |
| Wood / coin | none |

## Enemies

| Move | Chip | Lethal | Shake (chip) | Shake (lethal) | Hitstop | Ghost (lethal) |
|---|---|---|---|---|---|---|
| Melee (jab) | 450, −120 | 750, −260 | 2px | 6px | 0 | Y (until despawn) |
| Super melee (sweep) | 550, −180 | 750, −330 | 2px | 6px | 0 | Y (until despawn) |
| Supermove burst | 300, −120 | 850, −260 | 4px | 6px | 4f | Y (until despawn) |
| Supermove finisher | 850, −260 | 850, −260 | 4px | 6px | 8f | Y (until despawn) |
| Star touch | — (always kills) | 900, −450 ±15% jitter | — | 6px | 5f | Y (until despawn) |

## Projectiles (thorn, pea, specials…)

| Move | Chip | Lethal | Shake (chip) | Shake (lethal) | Hitstop | Ghost (lethal) |
|---|---|---|---|---|---|---|
| Any projectile | damage + sparkles + per-enemy shake | same + death pipeline | none | none | 0 | N |

## Rules

1. **Chip is byte-identical per attack** regardless of victim class (barrel or
   enemy) — same vector, same code path. Felt shove can differ slightly via
   victim resist/weight in `applyKnockback`.
2. **Barrel lethal = big-tier launch + delayed boom.** The `wouldKill` probe
   branches pre-hit: 0 damage, the attack's BIG-tier vector applied (same
   numbers as a lethal enemy hit), fuse armed with full-cook intangible
   flight. Chip hits keep the moderate vector.
3. **Enemy lethal = always upgraded to the big tier** + ghost corpse +
   KILL_SHAKE. Fires on any frame — not just the finisher.
4. **Finisher exists only on supermove**: the last contact keyframe of the dash
   sheet carries the big vector PRE-HIT, whether or not it kills. Melee and
   super melee stamp `finisher: false` on every frame; their big launches come
   exclusively from the kill-upgrade.
5. **Shake tiers** (max-kick merge): jab 2, super melee 2, supermove 4, kill 6.
   Fires when the hit connects on a non-hero pipeline target; zone ticks
   (fire/poison) excluded. The barrel fuse branch deals 0 damage but still
   shakes at its own connect tier — a landed hit is a landed hit.
6. **Star power** is its own path: enemies die inline (real lethal damage,
   5f hitstop); barrels take the fuse treatment (2f hitstop). Both launch
   along the NORMALIZED hero→victim center line at a constant magnitude with
   ±15% jitter (same direction rule as melee's fromAttacker). Vectors differ
   (enemy 900/−450 vs barrel 840/−320) — known divergence.
7. **Hitstop** is stamped per frame on the hitbox and fired by `applyHit` only
   on connect (max-merge: overlapping freezes never stack past the larger).
   Melee and super melee stamp none (0); supermove stamps 4f on burst frames
   and 8f on the finisher; star paths carry their own constants.
