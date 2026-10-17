# Handoff — Next: Bomb Composition Macros

## State of the attack engine (as of this handoff)

### Implemented macros (10)
- reticleShot, spreadShot, burstShot, radialShot, homingMissile, predictiveShot
- spawnSplit, bodyExplosion, explosiveBomb, explosiveProjectile

### Implemented primitives (11)
projectile, bomb, explosion, meleeHitbox, charge (movement), bodyContact,
beam, fireArea, spike, orbit, boomerang

### NOT implemented (the bomb family is next)
- **bombSpread** (§8) ← easiest win
- **molotov** (§10)
- **clusterBomb** (§9)
- (remaining non-bomb: missileRain, targetedBeam, sweepingBeam,
  stomp, stompWave, dustCloud, dashLaneSequence)

## The bomb building blocks (all done, tested)

- **bomb primitive** — dumb ballistic carrier: arc/bounce/fuse/contact damage.
  Terminal `detonate { x, y, contact }` ALWAYS emitted at the death point.
  No VFX beyond landing debris puff. Tags entity `_attackHandle` for the
  gameplay host (systems/update.js steps it).
- **explosiveBomb macro** — bomb carrier → Explosion at death point.
  VFX: burst + shake, **screenFlash: false**. Params: speed/direction/arc/
  bounce/ttl/damage/radius/origin/blastTeam. Deferred blast passes explicit
  `targets` (world.targets + aimed target) — good-context pattern.
- **spawnSplit macro** — fan-out materializer; `spawnType: 'bomb'` children
  ARE explosiveBomb handles in `h.handles`.

## Critical engine knowledge (read before coding)

1. **The self-cancel bug is FIXED** (commit c7db953): `invoke()` no longer
   cancels a handle that returns itself. Deferred compositions (carrier →
   terminal event → payload) work. Do not "fix" setInner back.
2. **Macros declare `effects: []`** and inherit VFX rows from invoked attacks
   via `resolveEffects()` (meta.invokes). Never re-declare inherited effects.
3. **`team` is THE side vocabulary** (ally/foe/neutral) everywhere — projectile,
   explosion, hitboxes. `friendly`/`alignment` are gone from the attack engine.
4. **One owner per effect.** Carriers fire no blast VFX; the composing macro's
   explosion invoke owns them. Explosive macros suppress screenFlash.
5. **Theater stepping:** carrier-based handles route by the CARRIER ENTITY's
   `_attackId`, not the handle id (macro handle id = macro). See the
   `h.id === 'bomb' || 'explosiveBomb' || 'explosiveProjectile'` branch in
   attack-theater.js.
6. **spawnSplit children are stepped by the theater's spawnSplit branch** —
   if a new macro's children need stepping there, extend that branch (last
   session's lesson: unstepped children never detonate).

## Suggested order

1. **bombSpread** — copy spreadShot's fan math (count/angle/direction/
   sequenceInterval), invoke `explosiveBomb` per child instead of projectile.
   Children go in `h.handles`; completion when all children complete (same
   pattern as spawnSplit). ~30 min.
2. **molotov** — bomb carrier → fireArea at death point. Same deferred pattern
   as explosiveBomb; fireArea is synchronous-ish (steps ticks). VFX: fireArea
   glow, NO explosion burst. Decide: shake true/false (suggest: shake, no flash).
3. **clusterBomb** — explosiveBomb parent; on its terminal `detonate`, invoke
   spawnSplit with `spawnType: 'bomb'` at the death point. This is
   macro→macro composition (allowed; meta.invokes = ['explosiveBomb',
   'spawnSplit']). Watch: the split's children must be stepped by the theater
   (point 6 above).

## Per-macro checklist (house rules)

- [ ] new file in `js/combat/attack/macros/` + one line in `macros/index.js`
- [ ] `meta.invokes` honest; `effects: []` unless the macro fires native VFX
- [ ] params documented in `docs/architecture/attack-macros.md` §N with REAL
      param names (verified against code — last session fixed 7 fake lists)
- [ ] theater preset + TWEAKABLE entry in attack-theater.js
- [ ] integration.test.js: registration + resolveEffects rows
- [ ] tests green: `for t in js/test/attack/*.test.js; do node $t; done`
- [ ] commit only on explicit user instruction

## Open questions for the next session
- molotov: does the fire area persist after the macro completes? (fireArea has
  its own duration — probably yes, let it live on)
- clusterBomb: child count/force defaults? (suggest count 4, force 300,
  matching spawnSplit's demo preset)
- bombSpread: sequential launch (sequenceInterval) or simultaneous default?
  (spreadShot defaults simultaneous — match it)
