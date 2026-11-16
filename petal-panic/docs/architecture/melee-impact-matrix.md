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

| Move | Chip | Lethal | Shake (chip) | Shake (lethal) | Hitstop |
|---|---|---|---|---|---|
| Melee (jab) | 450, −120 | 450, −120 + ghost 0.6s + fuse | 2px | none | 0 |
| Super melee (sweep) | 550, −180 | 550, −180 + ghost 0.6s + fuse | 2px | none | 0 |
| Supermove burst | 300, −120 | 300, −120 + ghost 0.6s + fuse | 4px | none | 4f |
| Supermove finisher | 850, −260 | 850, −260 + ghost 0.6s + fuse | 4px | none | 8f |
| Star touch | — | 840, −320 ±15% jitter + ghost 0.6s + fuse | — | 6px | 2f |

### Barrel detonation shake (by type, at fuse end)

| Barrel type | Detonation shake |
|---|---|
| Explosive / propane | 4px (explosion primitive default) |
| Supercoin | 14px |
| Toxic | 6px |
| Wood / coin | none |

## Enemies

| Move | Chip | Lethal | Shake (chip) | Shake (lethal) | Hitstop |
|---|---|---|---|---|---|
| Melee (jab) | 450, −120 | 750, −260 + ghost until despawn | 2px | 6px | 0 |
| Super melee (sweep) | 550, −180 | 750, −330 + ghost until despawn | 2px | 6px | 0 |
| Supermove burst | 300, −120 | 850, −260 + ghost until despawn | 4px | 6px | 4f |
| Supermove finisher | 850, −260 | 850, −260 + ghost until despawn | 4px | 6px | 8f |
| Star touch | — (always kills) | 900, −450 ±15% jitter + ghost until despawn | — | 6px | 5f |

## Projectiles (thorn, pea, specials…)

| Move | Chip | Lethal | Shake (chip) | Shake (lethal) | Hitstop |
|---|---|---|---|---|---|
| Any projectile | damage + sparkles + per-enemy shake | same + death pipeline | none | none | 0 |

## Rules

1. **Chip is byte-identical per attack** regardless of victim class (barrel or
   enemy) — same vector, same code path. Felt shove can differ slightly via
   victim resist/weight in `applyKnockback`.
2. **Barrel lethal = chip velocity + delayed boom.** The `wouldKill` probe
   branches pre-hit: 0 damage, swing's own vector applied, fuse armed with
   full-cook intangible flight. Barrels NEVER get the kill-upgrade.
3. **Enemy lethal = always upgraded to the big tier** + ghost corpse +
   KILL_SHAKE. Fires on any frame — not just the finisher.
4. **Finisher exists only on supermove**: the last contact keyframe of the dash
   sheet carries the big vector PRE-HIT, whether or not it kills. Melee and
   super melee stamp `finisher: false` on every frame; their big launches come
   exclusively from the kill-upgrade.
5. **Shake tiers** (max-kick merge): jab 2, super melee 2, supermove 4, kill 6.
   Only fires when actual damage > 0 on a non-hero pipeline target; zone ticks
   (fire/poison) excluded. The barrel fuse branch deals 0 damage → no connect
   shake on a lethal barrel hit (the explosion path shakes instead).
6. **Star power** is its own path: enemies die inline (real lethal damage,
   5f hitstop); barrels take the fuse treatment with a fixed impulse
   (2f hitstop). Vectors differ (enemy 900/−450 vs barrel 840/−320) — known
   divergence.
7. **Hitstop** is stamped per frame on the hitbox and fired by `applyHit` only
   on connect (max-merge: overlapping freezes never stack past the larger).
   Melee and super melee stamp none (0); supermove stamps 4f on burst frames
   and 8f on the finisher; star paths carry their own constants.
