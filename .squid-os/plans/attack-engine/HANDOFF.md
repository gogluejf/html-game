# Attack Engine — Handoff

**Last updated:** 2026-10-17 (benchmark of code vs docs; supersedes all prior handoffs)
**Plan:** `.squid-os/plans/attack-engine/attack-engine.md`
**⚠️ The plan file is INACCURATE** (stale task/wave numbering, wrong macro list).
The architecture docs are the source of truth:
- `petal-panic/docs/architecture/attack-primitives.md`
- `petal-panic/docs/architecture/attack-macros.md`

## Current state — benchmarked against the CODE (not the old state files)

### Primitives — ALL DONE ✅ (14 registered)
projectile, bomb, explosion, meleeHitbox, charge (movement.js), bodyContact,
beam, fireArea, spike, orbit, boomerang, surfaceWave, dustZone.

Plan-doc items that no longer exist as primitives (absorbed, intentional):
- `spread` → geometry lives in spreadShot/radialShot macros
- `reticle` → now a **target-reticle effect** owned by reticleShot (§2)
- `homing` / `predictive` → live inside their macros (modifier + aim math)
- `spawnSplit` / `selfDestruct` → moved to the MACRO layer
  (bodyExplosion covers self-destruct)

### Macros — 20 of 21 doc macros DONE ✅
All use `defineMacro()` (NOT `registerMacro()` — the plan's naming is stale);
each self-registers via the barrel `macros/index.js`. Registered ids:

predictiveShot, reticleShot, burstShot, spreadShot, radialShot, homingMissile,
missileRain, bombSpread, clusterBomb, molotov, explosiveBomb,
explosiveProjectile, dashCombo, targetedBeam, sweepingBeam, stomp, stompWave,
bodyExplosion, spawnSplit, skyMissile.

Notes:
- Missile Rain composes skyMissile per missile (doc §7 = N × Sky Missile §22).
- Dash Combo (§13) is the frame-scripted multi-hit close-range combo with
  freeze hitboxes — it is NOT Dash Lane Sequence.
- Dust Zone is a primitive (dustZone.js), not a macro (doc §18 says so).
- Horizontal_Beam / Melee / Charge_Dash from the plan were never in the macro
  doc — they don't exist and aren't needed.

### Tests — GREEN ✅
`js/test/attack/*.test.js`: 30 files, **180 pass / 0 fail**. Includes
theaterParity tests pinning sandbox↔gameplay seams (BombAttackHost, real Enemy
victims, CollisionWorld hit routing).

### Attack Theater (F4) — DONE, beyond original spec ✅
`js/debug/attack-theater.js`: lists primitives AND macros, live mini-sim with
real pools/collision/damage/effects, per-macro step choreography, shared
BombAttackHost with gameplay. All 20 macros have SANDBOX_PRESETS + TWEAKABLE
entries.

## What REMAINS

### 1. Dash Lane Sequence (macro doc §20) — THE ONLY MISSING MACRO
A telegraphed offscreen-entry sequence: attacker enters from offscreen and
dashes completely across the screen through each configured Y lane exactly once.

Canonical sequence per lane:
entry flash/warning → dash across screen → exit → next lane warning → next dash.

Parameters (from doc §20):
- lanes — configured Y positions
- laneOrder — bottom_to_top / top_to_bottom / random
- sideMode — fixed_left / fixed_right / alternate / random
- alternateStartSide — left | right
- telegraphDuration, telegraphStyle
- dashSpeed, damage, knockback (contact during dash)
- interval — pause between lanes

Rules to honor:
- One complete sequence uses every configured Y lane exactly once.
- Fixed side = every dash enters from that same side (even with random order).
- Alternate side alternates L/R per lane; starting side configurable.
- Lane order and side selection are independent.
- Every dash is telegraphed at its ACTUAL entry side + Y before it begins.
- Attacker crosses the full screen and exits before the next telegraph starts.

Composition (per doc): telegraph effect → offscreen positioning →
charge + bodyContact → repeat per lane.

Build notes:
- New file `js/combat/attack/macros/dashLaneSequence.js`, register via
  `defineMacro('dashLaneSequence', {...})`, add one import line to
  `macros/index.js`.
- Telegraph: no dedicated "lane warning" effect exists yet. Options, keep
  simple: reuse `telegraph-circle` or `surface-target-marker` at the entry
  point (x just offscreen, y = lane), OR draw the warning as macro-owned
  state rendered by the theater (like missileRain's ascent rockets). Pick the
  simpler one unless a real lane-strip effect is wanted later.
- Movement: invoke `charge` per lane (direction horizontal, speed = dashSpeed,
  distance = view width + margin) OR own x-position integration like
  missileRain owns rocket positions. bodyContact for damage during travel.
- Host contract: `h.step(dt, targets)` until true; `state.phase` per lane
  ('telegraph' | 'dash' | 'interval'); terminal 'complete' fires once.
- Test: `js/test/attack/dashLaneSequence.test.js` — verify lane coverage
  (every lane exactly once), side modes (fixed/alternate/random with seeded
  rng), telegraph-before-dash ordering, full-screen crossing, completion.
- Theater: add SANDBOX_PRESET + TWEAKABLE entries; extend `_stepOnce` if the
  handle needs stepping (see dashCombo branch as reference).

Exit criteria: 21/21 doc macros implemented; attack suite green; theater can
play it.

### 2. Hero weapon wiring (plan Milestone 4) — next wave after #1
`shooting.js` has ZERO imports from combat/attack; SPECIAL_WEAPONS has no
macro field. Thorn/specials still fire via inline pool spawns.
- Add macro/params to SPECIAL_WEAPONS entries
- Route fireThorn/fireSpecial through `invoke()`
- Regression gate: same damage/cooldown/spread/arc/AoE; debug G-key works
- Delete dead inline loops (explodeSpecial AoE loop, spread fan loop)

### 3. Enemy/boss migration (Milestone 5) — deferred by design
Nothing in js/enemies or js/boss consumes the engine yet. Incremental, one
enemy type at a time. Not part of this workstream unless asked.

## Key rules for the executor

1. **Consume, don't duplicate.** Primitives wrap existing systems; macros
   wrap primitives. Never reimplement collision/damage/pooling.
2. **Handles follow the uniform contract:** `.on('hit'|'expire'|'detonate'|
   'complete')` + `.cancel()`. Terminal events fire exactly once; late
   subscriptions never replay them. Synchronous attacks complete during
   `invoke()` — assert on data/state, not events, for those.
3. **stepX() pattern:** long-lived handles expose `step(...)` called by the
   host loop until true. The Attack Theater's `_stepOnce()` is the canonical
   host shape.
4. **Macros declare `effects: []`** and inherit VFX rows from invoked attacks
   via `resolveEffects()` (meta.invokes). Never re-declare inherited effects.
   Own effects (telegraphs fired directly) go in meta.effects with a
   `fireDeclared()` call.
5. **`team` is THE side vocabulary** (ally/foe/neutral) everywhere.
6. **One owner per effect.** Carriers fire no blast VFX; the composing macro's
   explosion invoke owns them. Explosive macros suppress screenFlash.
7. **No DOM in unit tests.** Pure logic; `node js/test/attack/<name>.test.js`.
8. **Anti-spin debugging rules** (user-enforced, in global memory): one debug
   run per hypothesis, max 3 iterations per bug, never repeat a tool call with
   identical args, state the hypothesis first.
9. **NEVER git commit/push without explicit user instruction in the current
   message.** "Finish"/"done" ≠ commit authorization.

## Known gotchas (carried forward, still true)

- **Self-cancel bug fix is permanent** (commit c7db953): `invoke()` no longer
  cancels a handle that returns itself. Do not "fix" setInner back.
- **Theater stepping routes carrier-based handles by the CARRIER ENTITY's
  `_attackId`**, not the macro handle id.
- **Unstepped children never detonate** — if a new macro materializes child
  handles, extend the theater's stepping branch for them.
- **`damage(source, ...)` with `source = null` throws** in Node v24. Pass an
  inert stand-in `{ traceStats: undefined }`.
- **Pool slots recycle via Object.assign** — set fields explicitly after spawn.
- **Frame quantization:** tick-rate accumulators (beam/fireArea/spike) can be
  ±1 tick off at 60Hz. Assert ranges near boundaries.
- **Screen-y-down convention:** target below attacker → vy > 0. Check signs
  against screen coords.

## Verify commands

```bash
cd ~/src/html-game/petal-panic

# Individual test
node js/test/attack/dashLaneSequence.test.js

# Full attack suite (expect: 180+ pass, 0 fail)
for t in js/test/attack/*.test.js; do node "$t"; done

# Full game suite (baseline: 402 pass / 2 known flakes)
node --test js/test/*.test.js
```

## Known baseline flakes (ignore these)

- `picker: wide low gap needing super` (takeoffPicker)
- `ride: full end-to-end ride classifies every platform` (pickerRide)

Compare failure sets before/after. Never chase baseline flakes.

## Where things live (quick reference)

| Thing | Path |
|-------|------|
| Plan (INACCURATE — history only) | `.squid-os/plans/attack-engine/attack-engine.md` |
| Primitives doc (source of truth) | `petal-panic/docs/architecture/attack-primitives.md` |
| Macros doc (source of truth) | `petal-panic/docs/architecture/attack-macros.md` |
| Attack engine core | `petal-panic/js/combat/attack/{engine,registry,context,defineMacro}.js` |
| Primitives (14) | `petal-panic/js/combat/attack/primitives/` |
| Macros (20) | `petal-panic/js/combat/attack/macros/` (+ index.js barrel) |
| Bomb host (shared w/ gameplay) | `petal-panic/js/combat/attack/bombAttackHost.js` |
| Attack Theater (F4) | `petal-panic/js/debug/attack-theater.js` |
| Special weapons registry | `petal-panic/js/objects/specialWeapons.js` |
| Projectile pool + classes | `petal-panic/js/objects/projectile.js` |
| Central damage | `petal-panic/js/combat/damage.js` |
| Effects facade + catalog | `petal-panic/js/effects/index.js` (CATALOG) |
| Effect types available | particle-burst, explosion, debris, ground-wave, shockwave, trail, afterimage, telegraph-circle, surface-target-marker, target-reticle, vignette, sprite-flash, camera-shake, screen-flash, sprite-shake, impact-star, fade-out, scale-pulse, squash-stretch, dust-cloud, slash, aura-glow, screen-overlay, composite-explosion, beam, pulse-bubble |

## Session prompt (copy-paste)

```
Read .squid-os/plans/attack-engine/HANDOFF.md (current) and
petal-panic/docs/architecture/attack-macros.md §20. The attack engine is
complete except ONE macro: Dash Lane Sequence. Build it:
new file js/combat/attack/macros/dashLaneSequence.js (defineMacro),
one-line import in macros/index.js, test in js/test/attack/, theater
SANDBOX_PRESET + TWEAKABLE entries. Compose charge + bodyContact + a
telegraph effect (reuse telegraph-circle or surface-target-marker at the
entry point — keep it simple). Honor all doc §20 rules (every lane exactly
once, side modes, telegraph before each dash, full-screen crossing).
Run the full attack suite (must stay green) before finishing. Do NOT
git commit or push — leave changes uncommitted.
```
