# Attack Engine — Milestone 4 Handoff (hero weapon migration)

**Last updated:** 2026-10-31
**Supersedes:** `HANDOFF.md` §"What REMAINS #2 Hero weapon wiring" (this is the active workstream now).
**Plan ref:** `.squid-os/plans/attack-engine/attack-engine.md` → **Milestone 4** (Tasks 4.1–4.5).
**Source-of-truth specs:** `petal-panic/docs/architecture/attack-primitives.md`, `attack-macros.md`.

---

## Where we are

Milestones 1–3 (primitives, macros, Attack Theater) are DONE and stable. We are
now executing **Milestone 4: route hero weapons through the Attack Engine**.

### Done this session (all committed)
| Commit | What |
|--------|------|
| `86d43cf7` | Fixed `throwMine` stale `ent.box` crash (Entity size-refactor fallout). Unblocked all ballistic→mine macros + theater rendering. |
| `e96aa0f7` | **Thorn spawn → engine.** `fireThorn()` now calls `invoke('projectile', …)` instead of inline `projectilePool.spawn()`. Also: bg dim (`BG_BRIGHTNESS=0.35`), thorn box shrink (`PROJECTILE_TARGET_H` 0.32→0.22), and an additive fix so the projectile primitive keeps the entity's natural sheet box when no explicit size is passed. |

### Thorn status = PARTIALLY migrated
- ✅ **Spawn** (velocity/ttl/box/position) goes through the engine.
- ❌ **Damage / hit / impact routing is STILL legacy.** When a thorn hits an
  enemy/boss/barrel, `combat/collisionHandlers.js`'s `PROJ_ALLY` branch deals the
  damage (`takeDamage`/`damage()`), spawns sparkles/shake, applies the boss weak-point
  multiplier + boss-zone COMBAT gate, chips barrels, and consumes the shot.
- The `handle` returned by `invoke()` in `fireThorn` is **discarded** — gameplay never
  subscribes to `.on('hit'/'expire')` nor steps it. So even the engine's own
  "report a hit" path (`stepProjectile`) is dormant for thorns. `_attackId:'projectile'`
  is tagged but nothing in gameplay reads it (only `'ballistic'` gets special handling
  in `update.js`).

**Net:** thorn is half-engine (spawn) + half-legacy (impact). Behavior is provably
identical (tests green); this is a safe first slice, NOT yet "100% engine."

---

## Weapon inventory (SPECIAL_WEAPONS registry)

| Weapon | id | spawn today | engine? | sheet sprite wired? |
|--------|----|-------------|---------|---------------------|
| Thorn (default) | — | `invoke('projectile')` | ✅ spawn only | ✅ yes (`initProjectileSprites`) |
| Bomb | `bomb` | `ctx.bombAttacks.spawn('explosiveBomb')` | ✅ spawn (already was) | ❌ procedural (orange circle+fuse) |
| Saw | `saw` | inline `specialPool.spawn` | ❌ | ❌ procedural (spinning disc+teeth) |
| Spread | `spread` | inline `specialPool.spawn` fan loop | ❌ | ❌ procedural (pellet discs) |

Sheet assets **exist but are NOT loaded/wired** for saw/spread/bomb:
- `assets/projectiles/saw/shoot_sheet.json`
- `assets/projectiles/spread/shoot_sheet.json`
- `assets/projectiles/bomb/explode_sheet.json`

Only thorn has a loader. `Special.draw()` (in `objects/projectile.js`) renders specials
as type-branched procedural shapes — there is no `this.sprite` path for them yet.

---

## Thorn-port workarounds → MUST BE REMOVED (fix the primitive, not the caller)

The thorn port shipped two **workarounds for a weak primitive contract**. They are
NOT acceptable long-term and are NOT "gotchas to carry forward" — they are bugs in
`primitives/projectile.js` to be fixed. Do this FIRST, before Step B.

### The flaw
`spawnPoint()` treats `origin` as a CENTER point but centers the box using a hardcoded
`size/2` (default 12), while the real shot uses its sheet-derived box (~26×10). The
mismatch forces callers to compensate. Also, the primitive spawns with `dir=0` and never
records the aim index, forcing callers to patch `ent.dir` back.

### Fix (in `js/combat/attack/primitives/projectile.js`)
1. **Direction:** accept an explicit 8-way index cleanly (e.g. an `aimIndex` param, or
   unambiguous detection), compute the angle once, AND set `ent.dir = <index>` inside the
   primitive. Callers then pass the index and never touch `.dir`.
2. **Centering:** center the box on `origin` using the entity's REAL (sheet-derived) box
   size, not a hardcoded 12. Resolve the natural box first, then `topLeft = origin − box/2`.
   No `+6`, no `SPAWN_HALF`, no caller-side re-centering.

### Then simplify `fireThorn` (`shooting.js`)
Becomes a clean call: pass muzzle CENTER + `size:null`. Delete the `SPAWN_HALF`
compensation, the manual `shot.entity.dir = dir`, and the `bw/bh` sheet math from the caller
(it moves into the primitive). Re-run `spritePivot` + `contextualAim` (must stay green).

**RESOLVED (2026-11-01):** executed with one deliberate deviation — NO `aimIndex` param.
Rationale: every caller already passes radians (gameplay converts via `dirAngle`; all
macros/theater compute angles), so an index param would be dead weight. The primitive's
contract is now: **origin = box CENTER, centered using the FINAL box size (natural or
explicit); direction = radians**. `ent.dir` stays at the pool default (0) for engine
shots — verified nothing in gameplay reads it (collision uses velocity vectors; debug
uses theater state, not entity fields). Tests that asserted on `p.dir` of engine shots
now assert on the velocity vector instead.

⚠️ This touches shared code (theater + tests use the projectile primitive). Update any caller
that relied on the old top-left/`dir=0` behavior. Keep behavior pixel-identical.

---

## The agreed order (user-approved sequence)

Work the LOW-RISK visual/spawn slices FIRST, prove parity, then do the high-risk
damage-routing migration LAST, and only delete legacy code once everything is green.

### Step 0 — Fix the projectile primitive spawn contract (see above)
Remove both thorn workarounds by fixing `spawnProjectile`/`spawnPoint`. Simplify `fireThorn`.
**Exit:** no `+6`/`SPAWN_HALF`/manual `.dir` anywhere; spritePivot + contextualAim green.

### Step A — Wire special sprites (LOW risk, visual only)
Mirror the thorn pattern for saw/spread/bomb:
- Add a loader (e.g. `initSpecialSprites()` or per-type) that parses each sheet JSON +
  loads frames, same as `initProjectileSprites()`. Call it from `main.js` boot
  (alongside `initProjectileSprites()` at `main.js:213`).
- In `Special.initialize()`, set `this.sprite` + `setAnim(...)` per type when data is
  present; keep the procedural fallback for node/pre-boot.
- Verify boxes still come from the sheet collisionBox (pure target model, like thorn).
- **Exit:** all 3 specials render their real art in-game + theater; tests green.

### Step B — Port saw + spread SPAWN to engine (MEDIUM risk)
Mirror the CLEAN thorn port (post-Step 0 — no workarounds):
- `fireSpecial()`: replace `specialPool.spawn(...)` with `invoke('projectile', …)` for
  saw (single) and spread (fan — either N invokes or the `spreadShot` macro).
- Pass the aim **index** (the primitive now handles index→radians + sets `ent.dir`).
- Pass muzzle CENTER as `origin` (the primitive centers using the real box).
- Pass `size: null` to keep the natural sheet box.
- Bomb spawn is already engine-driven — leave it, just confirm parity.
- **Exit:** all 4 weapons spawn via engine; velocity/damage/ttl/box identical to before.

### Step C — Regression gate (no code change)
Full test suite green; compare behavior frame-by-frame if needed. Debug G-key works.
This is plan Task 4.4.

### Step D — THE MIGRATION: engine-owned damage/hit (HIGH risk) ← the real "100% engine"
This is where legacy combat code actually gets disconnected. Requires:
1. A **gameplay projectile host** (like `BombAttackHost`, but for projectiles) that each
   frame steps live thorn/saw/spread handles via `stepProjectile()` and reacts to
   `'hit'`/`'expire'`.
2. **Move the PROJ_ALLY impact rules into the engine layer / a shared combat resolver:**
   enemy `takeDamage`, boss weak-point mult, boss-zone COMBAT gate, barrel chip+explode,
   hit sparkles, enemy shake, consume-on-impact.
3. **Route collision through the engine** instead of the raw `collisionWorld.on('hit')`
   PROJ_ALLY branch.
4. Then **delete dead code** (plan Task 4.5): the legacy PROJ_ALLY branch +
   `explodeSpecial()`'s inline AoE loop become genuinely dead and go.

⚠️ D is shared by ALL friendly shots AND is the core collision path — highest-risk task
in the whole plan. Own focused session + heavy regression testing. Do NOT bolt on.

---

## Thorn-port workarounds (HISTORY — being removed in Step 0)
For reference only; Step 0 deletes these from `fireThorn`:
1. Engine `direction` was radians-only → thorn converted via `dirAngle(dir)` and patched
   `ent.dir`. (Fixed by primitive accepting an index + setting `ent.dir`.)
2. `spawnPoint()` baked a 12px half-box offset → thorn added `SPAWN_HALF=6`. (Fixed by
   centering on the real box.)
3. Pass `size: null` so the primitive keeps the natural sheet box (KEEP — this one is correct).
4. Destructure `bodyCenter()` as `{ x: cx, y: cy }` (a bare `cy` is undefined).

---

## Test baseline (compare before/after; never chase these)
Pre-existing failures NOT caused by our work (canvas mock + fake-pool stubs lacking
`orientSprite`): `bombHost`, `fireArea`, `homingMissile`, `integration`,
`predictiveShot`, `spawnSplit`, `spreadShot`.

Relevant-and-green after the thorn port: `spritePivot` (3/3), `contextualAim` (16/16),
`projectile`, `projectileSprite`, `specialRotation`.

Run:
```bash
cd ~/src/html-game/petal-panic
node js/test/spritePivot.test.js
node js/test/contextualAim.test.js
for t in js/test/attack/*.test.js; do node "$t"; done
```

---

## Rules
- **Consume, don't duplicate.** Primitives wrap existing systems.
- **NEVER git commit/push without explicit user instruction in the current message.**
  "finish"/"done" ≠ commit authorization.
- Anti-spin debugging: one debug run per hypothesis, max 3 iterations per bug, state the
  hypothesis first, never repeat a near-identical tool call.

## Session log (2026-11-01) — Steps 0 + A DONE, visual contracts agreed

### Committed
- `8ad2243c` — **Step 0 + A:** clean projectile spawn contract (origin = box CENTER,
  centered on final box size; size default null) + special weapon sheets wired
  (`initSpecialSprites`: saw/spread/bomb shoot + bomb explode; synthetic collisionBox
  from max frame bbox; baseW keeps authored square boxes) + `sprite-burst` effect.
- `5ec7becd` — frameLoader URL-keyed cache (mobile black-screen: bare-filename key
  collided across thorn/saw/spread shoot_fN.png → lost onload → boot hang, zero errors)
  + Special.draw renders outline + 4px outlines thorn/saw/spread + spread pellet re-aim.

### Uncommitted at context limit (verify + commit as one batch)
1. `ballistic.js` — no forced `rockDrawer` default; drawer only when explicitly passed
2. `explosiveBomb.js` — dropped explicit `bombDrawer` (entity draws itself now)
3. `explosion.js` — `sprite-burst` declared in meta.effects + fired at blast center
   (THE home of the explode sheet art — engine detonations only)
4. `projectile.js` — Special sheet drawing gated on `isHighGraphic()` (primitive mode
   keeps procedural shapes)
5. `shooting.js` — dead sprite-burst code removed from `explodeSpecial` (unreachable
   for engine bombs: `_attackId === 'ballistic'` returns early)

### Visual identity contract (AGREED — do not drift)
- **ONE look-owner per entity type.** `Special('spread')` owns BOTH modes:
  high = sheet + 4px outline, primitive = procedural disc. Thorn same pattern.
- **Macros/primitives are look-blind.** Pattern data only (count, fan, speed,
  `specialType`). No drawers in standard weapons.
- **`drawer` param = deliberate per-shot override ONLY** (theater experiments,
  future weird shots). Never a default. `spreadDrawer` in the spreadShot macro is
  legacy to delete once gameplay uses real Special entities.
- **Dual-mode interface already exists in `Entity`:** `drawSprite()` (high, sheet
  data) + `drawPrimitive()` (low, named method). Cleanup TODO: move Special's inline
  procedural block into `drawPrimitive()` so low-res art has a named, greppable home
  (protects it from future agents deleting "dead" code). Same for Projectile.
- **Explode sheet art belongs to the EXPLOSION, not the bomb entity:**
  `explosion` primitive fires `sprite-burst` (declared effect). `explodeSpecial`
  (legacy path) no longer carries VFX art.

### Step B design (agreed, NOT yet coded)
Goal: gameplay saw + spread spawn through the engine, real Special entities, both modes.
1. `projectile` primitive gains `specialType` param → routes to `specialPool.spawn(x,y,dir,type)`
   (data routing only; absent = today's Projectile/thorn path)
2. `fireSpecial`: saw = 1 invoke; spread = N invokes fanned (angles from meta.spread);
   bomb stays on explosiveBomb macro (already engine)
3. Delete `spreadDrawer` from spreadShot macro after switch (class draws its own
   primitive mode)
4. Theater + gameplay share the same macro/entities → no drift possible
~40 lines. Exit: all 4 weapons spawn via engine; velocity/damage/ttl/box identical.

### Remaining after B
- **Step C** — regression gate (full suite green vs baseline list below; theater check)
- **Step D** — HIGH RISK: damage/hit routing off legacy `collisionHandlers.js`
  PROJ_ALLY branch + `explodeSpecial` damage loop → engine hit/detonate events;
  delete legacy paths last. Consider fresh session for this one.

### Test baseline (pre-existing failures — do NOT chase)
`bombGameplay`, `bossRushScreen`, `menuRunFlow`, `pickerRide`, `takeoffPicker`,
`bombHost`, `fireArea`, `integration` (+ flaky `lifecycle` — passes on rerun).
Green-and-relevant: `projectile` (14), `contextualAim` (16), `spritePivot` (3),
`explosion`, `bomb`, `compositeExplosion`, `homingMissile`, `predictiveShot`,
`spawnSplit`, `spreadShot`.

## Session log (2026-11-01, second pass) — Step B COMPLETE, 4.3 done

### Committed
- `e43fd4f3` — **Task 4.3:** gameplay `fireSpecial()` switched to the engine.
  Saw + spread now spawn via `invoke('projectile', { specialType })` (real
  Special entities); raw `specialPool.spawn` fan/single paths deleted from
  shooting.js. Muzzle offset, fan math, soft-cap behavior preserved. Bomb
  branch unchanged (already engine).
- `c486c8e7` — sprite-burst dual-mode: `isHighGraphic()` gate (NOT asset-load
  state) + procedural `fallback` drawer (explosion primitive passes flash
  core + shock ring for primitive mode). Theater row §31 + meta + demo scene.
- `b70e41be` — docs: effects.md §30 sprite-outline + §31 sprite-burst.
- `a97c2034` — spawnType `'ballistic'` → `'bomb'` rename completed (macros,
  theater, staging, tests, docs). Primitive id stays `ballistic`.

### Status vs the agreed order
| Step | State |
|---|---|
| 0 — spawn contract | ✅ `8ad2243c` |
| A — special sprites | ✅ `8ad2243c` + `5ec7becd` |
| B — saw+spread spawn via engine | ✅ `ce9fe01d` (plumbing) + `e43fd4f3` (gameplay switch) |
| C — regression gate | ⏳ run full suite vs baseline below; update this doc |
| D — damage/hit routing off legacy PROJ_ALLY | ❌ NOT STARTED — own focused session |

### Task 4.4 regression gate (run 2026-11-01)
Attack suite (35 files): all green except pre-existing canvas-stub failures:
`bombHost` (ctx.createLinearGradient missing in mock), `fireArea` (no file at
js/test/attack/fireArea.test.js — check path), `radialShot` (1 geometry
assertion, stale since aca20dbb preset-tune — not caused by M4 work).
Gameplay baseline: `bombGameplay` still fails on blockColumns width (pre-existing).
`theaterParity` is GREEN (was on the old don't-chase list — baseline refreshed).

### Remaining after C
- **Task 4.5** — PARTIAL (2026-11-01): dead `SPECIAL_WEAPON_DEFS` import removed
  from shooting.js. `explodeSpecial()` KEPT — still the live death path for
  legacy-pooled specials (update.js TTL cull + collisionHandlers contact);
  deleting it is Step D's job, not 4.5's.
- **Step D** — HIGH RISK, own session: gameplay projectile host + move PROJ_ALLY
  impact rules into engine layer; delete legacy collisionHandlers branch last.
- Cleanup TODO (render-modes): move Special/Projectile inline procedural art
  into `drawPrimitive()`.

## Suggested next step (new session)
Task 4.5 cleanup (small), then **Step D** in a fresh focused session.
