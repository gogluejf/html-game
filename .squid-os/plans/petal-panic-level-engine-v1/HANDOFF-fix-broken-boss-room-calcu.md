# Handoff — fix broken boss-room calculation (REVISED)

**Plan:** `petal-panic-level-engine-v1`
**Working directory:** `~/src/html-game` (project `petal-panic/`)
**Baseline commit:** `b065a48` — *petal-panic: allow shooting during boss zone APPROACH*
**Status of baseline:** green. `node --test js/test/{bossZone,levelConfigs,levelFlow}.test.js` → **68/68 pass**.
**Supersedes:** the first version of this doc (the "rightmost 960px slice" approach).

---

## 0. Ground truth about coordinates (verified in code)

`buildLevelZones()` (js/level.js) already builds **every zone at `bounds.x = 0`**.
Each zone is its own local space; only one zone is ever loaded into the collision
world at a time (`loadActiveZone` clears + refills). There is NO chained absolute
coordinate system — no 6400, no cumulative offsets. The remaining `bounds.x + …`
expressions are all just `0 + offset`.

So the bug is NOT a coordinate-model problem. It is three concrete dumb things:

1. **The boss checkpoint flag sits at the LEFT of 1-B** (`zoneEntryFlag` places it
   at `bounds.x + ZONE_ENTRY_X` = 120). The hero spawns at 120 too, so the flag
   fires almost immediately (`[collision] HERO×CP! id=1-boss pos=(120,452)`),
   before any walk happens.
2. **The flow machine invents a fake "approach" inside the zone**: `begin()`
   starts in APPROACH, the hero must walk from x=120 to `arenaEntryX`=1080, and
   only THEN does the presentation start. That 960px walk-after-trigger is not
   what the player experiences — they already crossed the flag.
3. **On lock, the camera teleports to a computed center**
   (`cx = bounds.w/2 − VIEW_W/2` = 320) via `lockTo()`, while the follow-cam was
   sitting around ~480–560. That delta is the visible jump. Two extra sources of
   arena geometry make it worse: `bossZone.arenaX/arenaW` (center-computed) and
   `boss.js`'s own `BOSS_ARENA_WIDTH=400` copy.

## 1. What the user wants (verbatim intent)

> "In the boss arena we just re-render the battle room over the run 1-B like it
> is part of it — an internal mechanic that overrides the dimensions of the area
> and removes the check flag. Then the boss arrives. Simple."

Concrete sequence for 1-B (one area, five dots on the progress line, no second
zone):

1. **Run phase.** Hero enters 1-B at the left (x=120, same as any level start).
   Normal camera follow. The **boss checkpoint flag stands at the far right** of
   the zone (x = w − ZONE_EXIT_PAD = 1480). The hero walks the whole way — a real
   walk, exactly like any other area.
2. **Cross the flag** → the intro card/sweep/bar animation plays.
3. **Battle room.** After the card, the room is re-drawn OVER the run:
   - the **flag is removed** (not drawn, no longer triggerable);
   - the world becomes a fixed **960px room at x ∈ [0, 960]** — the camera is
     frozen at `minX = maxX = 0`, so screen x = world x. Left pixel = 0, right
     pixel = VIEW_W. No scroll possible; the hero cannot leave the screen.
   - the **hero is placed at the room's left entry** (x = 120, same as any level
     start), zero velocity;
   - the **boss slides in from the right** (off-screen at x > 960) and settles at
     ~75% across the screen (x ≈ 720).
4. **Combat.** Death restarts the WHOLE 1-B: flag comes back, hero at left
   entry, run again, cross the flag, card, room. (This matches how death works
   in every other area — restore the area snapshot.)

No second zone. No new `currentArea`. No sub-zone stepping in debug W.

## 2. Design: two phases inside ONE zone

### Phase A — Run (normal horizontal behavior)
- Zone bounds stay `{x:0, y:0, w:1600, h:VIEW_H}`.
- Entry flag (the boss checkpoint) moves to the **far right**:
  `x = bounds.w − ZONE_EXIT_PAD` (= 1480). This is the ONLY layout change.
- Hero spawns at `ZONE_ENTRY_X` (120). Camera: normal follow + clamp (the
  existing `setZoneBounds` boss branch already allows scrolling across the full
  width — keep it).
- The boss entity is NOT in the collision world yet (zone-scoped, as today).
- The flow machine is **dormant** (`state === null`) — shooting allowed, no
  presentation.

### Phase B — Battle room (fixed 960px world at origin)
Triggered by the existing HERO×CHECKPOINT handler when the triggered flag is the
boss checkpoint (`checkpointId === '<level>-boss'`). On trigger:

1. **Remove the flag** from the collision world and from the rendered checkpoint
   list (it must not be drawn or re-triggered).
2. **Shrink the world to the room.** The room is the LEFTMOST `VIEW_W` of the
   zone: `roomX = 0`, `roomW = VIEW_W` (960). Freeze the camera there:
   ```js
   camera.minX = camera.maxX = 0;   // minX === maxX → update() no-ops (frozen)
   camera.x = 0;
   ```
   Because the room is exactly `VIEW_W` wide and starts at 0, **screen x =
   world x**. No translation, no computed center, no `lockTo` teleport.
3. **Place the hero at the room's left entry:** `hero.x = ZONE_ENTRY_X` (120),
   `hero.y = ZONE_GROUND_Y − hero.h`, `vx = vy = 0`.
4. **Add the boss to the collision world**, off-screen right:
   `boss.x = VIEW_W + BOSS_ENTER_TRAVEL − boss.w` (travel ≈ `VIEW_W × 0.5`).
5. **Start the presentation** (existing machine minus APPROACH):
   `LOCKED → INTRO_SWEEP → BAR_FILL → BOSS_ENTER → COMBAT`. During BOSS_ENTER
   the boss eases from off-screen-right to its rest at
   `VIEW_W × 0.75 − boss.w/2` (~75% across the screen). Shooting gated off until
   COMBAT (existing gate).
6. **Clamps.** While the room is active, clamp hero and boss to `[0, VIEW_W]`
   (hero) / `[0, VIEW_W − w]` (boss). The zone-bounds clamp already keeps the
   hero inside `[0, 1600]`; the room clamp is tighter and replaces the old
   arena-rect clamp.

### Why this kills the bug
- One coordinate space (the room, at origin). The hero is placed INSIDE it
  BEFORE the camera freezes → nothing teleports.
- The camera freeze is `minX === maxX = 0` — a stable value derived from the
  room definition, not a center-computed target that differs from where the
  follow-cam was.
- The flag is gone, so there is nothing left to overlap or log.
- No second zone ⇒ no double clear-sequence, no debug-wrap mis-step, no
  `getActiveZone()` ambiguity.

### Room teardown (death / restart / debug W)
When 1-B is re-entered fresh (death-restart path, debug W wrap, or new game):
- re-instantiate the zone content (this restores the flag — `instantiateZone`
  rebuilds checkpoints from `zone.entryFlag`);
- `camera.setZoneBounds(bossZoneDef)` (restores the full-width scroll range);
- `camera.unlock()` if locked;
- place the hero at `ZONE_ENTRY_X`;
- `bossZone.reset()` (machine back to dormant/null);
- remove the boss from the collision world (it is re-added on the next trigger).

## 3. Exact changes (file by file)

> All paths relative to `petal-panic/`. Baseline is `b065a48`.

### 3.1 `js/level.js` — boss checkpoint at the far right
- In `zoneEntryFlag()`: for the boss zone, place the flag at the FAR RIGHT:
  `x = zone.bounds.w − ZONE_EXIT_PAD` (mirror of the exit-flag placement). Keep
  `appearance: 'boss-checkpoint'`, id `${level}-boss`.
- Everything else in level.js stays (zones are already at bounds.x = 0).

### 3.2 `js/bossZone.js` — trim the machine to the room phase
- **Remove** `BZ_APPROACH`, `approachStartX`, `arenaEntryX`, the APPROACH case in
  `update()`, and the `BOSS_APPROACH_DIST` / `BOSS_APPROACH_START_PAD` exports.
  `BOSS_ZONE_STATES` becomes `[LOCKED, INTRO_SWEEP, BAR_FILL, BOSS_ENTER, COMBAT]`.
- **Replace** `arenaX/arenaY/arenaW/arenaH` with room geometry at the origin:
  ```js
  this.roomX = 0;
  this.roomW = VIEW_W;
  this.bossRestX = Math.round(this.roomW * 0.75 − boss.w / 2);
  this.bossRestY = Math.round(zone.bounds.y + zone.bounds.h − boss.h);
  this.bossEnterFromX = this.roomW + BOSS_ENTER_TRAVEL − boss.w;
  ```
- `begin()` now starts in **LOCKED** (not APPROACH) and places the boss
  off-screen right.
- `inIntro` = LOCKED..BOSS_ENTER (no APPROACH). `heroCanShoot()`,
  `bossCanTakeDamage()`, `bossVisible()`, `progress()`, `reset()` unchanged in
  behavior. `arenaLocked()` renamed conceptually to "room active": true from
  LOCKED through COMBAT (i.e. `state !== null`); keep the method name
  `arenaLocked()` to minimize call-site churn OR rename to `roomLocked()` and
  update the 2 call sites in update.js — prefer the rename for clarity.
- Drop the `onLock` option (camera freeze moves to the trigger site, §3.3).
- Keep `BOSS_ENTER_TRAVEL` (used for the entrance distance).

### 3.3 `js/boss.js` — delete the duplicate arena source of truth
- Remove `BOSS_ARENA_WIDTH` and the constructor's `this.arenaX / this.arenaW`.
- Update the header comment that lists them. The room bounds are owned by
  `bossZone.roomX/roomW`; the update system clamps using those (§3.4).

### 3.4 `js/systems/update.js` — move the camera freeze to the trigger
- **HERO×CHECKPOINT handler**: after `cp.trigger(heroEnt)` succeeds, check
  `cp.checkpointId === '${level}-boss'` (or `cp.appearance === 'boss-checkpoint'`
  AND the active zone kind is 'boss'). If so, run the room setup INSTEAD of the
  area-clear sequence (the current code early-returns for non-'area' zones — the
  boss zone IS the active zone here, so add the branch before that return):
  1. remove the flag: `collisionWorld.remove(cp)` + splice it out of the
     `checkpoints` array (so render stops drawing it and it can't re-trigger);
  2. freeze the camera: `camera.minX = camera.maxX = 0; camera.x = 0;`
     (also `camera.minY = camera.maxY = 0; camera.y = 0;` to pin vertical);
  3. place the hero: `hero.x = ZONE_ENTRY_X; hero.y = ZONE_GROUND_Y − hero.h;
     hero.vx = hero.vy = 0;`
  4. add the boss to the collision world (`collisionWorld.add(boss)` — move the
     existing add out of `loadActiveZone` if it lives there);
  5. `beginBossZoneFlow()` (which now starts in LOCKED).
  Guard: the checkpoint's `triggered` latch already makes this fire once.
- **Delete** the `onLock` camera-freeze hook from the `makeBossZone(...)` call
  (keep `onCombat`).
- **AREA_ENTRY→PLAY hook** (currently calls `beginBossZoneFlow()` when the active
  zone is the boss zone): REMOVE that call. Entering 1-B now behaves like any
  other area — run phase, machine dormant. The flow starts ONLY from the
  checkpoint trigger above.
- **Safety net** near line 2160 (`if (!bossZone.active && getActiveZone(hero)?.kind === 'boss') beginBossZoneFlow()`): DELETE — it would start the
  presentation without the room setup (no flag removal, no camera freeze).
- **Hero clamp** block using `bossZone.arenaX/arenaW`: replace with the room
  clamp `bossZone.roomX .. roomX + roomW` (guard: only while `roomLocked()`).
- **Boss AI clamp** (`b.arenaX / b.arenaW`): replace with
  `bossZone.roomX .. bossZone.roomX + bossZone.roomW − b.w`.
- **Death restart** (`finishHeroDeath` boss branch): instead of setting the
  checkpoint to `approachStartX`, do a FULL 1-B reset:
  - `hero.currentArea = AREA_BOSS`;
  - re-instantiate the boss zone content (restores the flag) — reuse whatever
    the generic death path already does for areas (restoreArea / loadActiveZone
    with the stored population snapshot);
  - `camera.setZoneBounds(bossZoneDef)` + `camera.unlock()`;
  - `hero.checkpoint = { x: ZONE_ENTRY_X, y: ZONE_GROUND_Y − hero.h }`;
  - `bossZone.reset()` (dormant) and remove the boss from the collision world.
  Net effect: death in the room restarts the RUN (flag back, hero at left), per
  the user's spec.
- **Debug W wrap** (`debugWrapToNextArea`): boss branch wraps to 1-1 — keep.
  Ensure it runs the same full-reset as death (flag restored, camera unbound,
  machine dormant) so wrapping INTO the boss zone later starts clean.
- **Shooting gate** (uses explicit state list LOCKED..BOSS_ENTER): unchanged —
  during the run phase the machine is dormant (`state === null`) so shooting is
  allowed; during the presentation it is blocked; on in COMBAT.

### 3.5 `js/camera.js` — simplify the boss branch
- `setZoneBounds`: the boss orientation branch currently sets the full-width
  scroll range "for the approach" — that is still correct (run phase scrolls
  across the full 1600). Keep it, but fix the comment (there is no separate
  APPROACH state anymore; it's the run phase).
- `lockTo()`: no longer called by the boss flow. Keep the method (generic
  utility) or delete if unused elsewhere — verify with grep first.

### 3.6 `js/hud.js` — no change
Progress line renders one dot per zone; 5 dots (1,2,3,4,B) stays correct.

### 3.7 Tests
- `js/test/bossZone.test.js`: rewrite for the trimmed machine —
  states `LOCKED → INTRO_SWEEP → BAR_FILL → BOSS_ENTER → COMBAT` (no APPROACH);
  `begin()` starts in LOCKED; room geometry asserts (`roomX === 0`,
  `roomW === VIEW_W`, boss rest ≈ 75%, boss enters from off-screen right).
- `js/test/levelFlow.test.js`: boss-flow tests reference `m.arenaEntryX` /
  `BZ_APPROACH` — update to the room model (drive the machine with a static
  hero; all states are timer-driven now).
- `js/test/levelConfigs.test.js`: assert the boss zone's entry flag is at the
  FAR RIGHT (`w − ZONE_EXIT_PAD`), not at `ZONE_ENTRY_X`.
- Add a focused test: triggering the boss checkpoint removes the flag, freezes
  the camera at 0, places the hero at `ZONE_ENTRY_X`, adds the boss to the
  collision world, and starts the machine in LOCKED (no jump).

### 3.8 Docs
- `docs/levels/boss-arena.md`: §1 — the approach is a normal walk from the left
  entry to the boss checkpoint at the far right. §2/§3 — after the card, the
  fight is a fixed 960px room at the origin (camera frozen at 0, world maps 1:1
  to screen); the flag is removed for the duration of the room; death restarts
  the whole area (flag returns). Keep it non-technical per the user's earlier
  instruction. (There is already an uncommitted direction correction in this
  file — fold it in.)

## 4. Definition of done

1. `node --test js/test/*.test.js` fully green.
2. In-game: enter 1-B → walk right the FULL length (normal cam) → touch the
   boss checkpoint at the far right → **no camera jump** → flag disappears →
   card/sweep/bar play → boss slides in from the right to ~75% → combat. Hero at
   left entry (screen x=120), boss at right, both on screen, no scroll.
3. Shooting works during the run walk, is correctly gated off during the
   presentation, on in combat.
4. Death in the room restarts the RUN: flag back at the far right, hero at the
   left entry, normal camera, walk again.
5. Debug W from the boss area wraps to 1-1; wrapping back into 1-B starts clean
   (flag present, machine dormant).
6. No "1-4 exit" flag or progress-dot anomaly while fighting the boss.
7. User still sees exactly 5 areas (1-1…1-4, 1-B).
8. No `bounds.x`-derived mystery offsets remain in the boss path: the room is
   literally x ∈ [0, 960].

## 5. Out of scope / do NOT do
- Do **not** create a second zone for the room.
- Do **not** introduce a new `currentArea` value or a new area id.
- Do **not** touch the macro/terrain composer, vertical zones, or reward screen.
- Do **not** remove the HUD progress line.
- Do **not** attempt to change the global coordinate model — zones are already
  local at x=0; nothing else needs it.

## 6. Suggested commit shape (modular, confirm with user before committing)
1. `petal-panic: boss checkpoint flag moves to the far right of 1-B`
   — level.js + levelConfigs test
2. `petal-panic: model boss fight as a fixed 960px room at the origin (no 2nd zone)`
   — bossZone.js + boss.js
3. `petal-panic: trigger the boss room on the checkpoint (freeze cam at 0, remove flag, kill the jump)`
   — update.js trigger + clamps + death/debug resets + camera.js comment
4. `petal-panic: update boss-zone tests + docs to the room model`
