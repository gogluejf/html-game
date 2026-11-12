# Zone Entry Unification Refactor

## Problem

"Entering a zone" (starting a level, advancing, retrying after death, continuing,
resuming from save) is implemented across 5+ code paths that each manually:
- build/swap the hero
- build/restore the world
- set the hero checkpoint (a dumb copy of `zone.spawn`)
- position the hero
- reset energy/weapon/wallet (different rules per path, hardcoded inline)
- show the area-entry screen

This causes:
- Bugs when one path forgets a step (heroId not saved → wrong hero on reload)
- Features that can't be added cleanly (drop-from-air breaks vertical zones)
- 200+ lines of lifecycle code that should be ~50

## Goal

One function. One state model. No duplication.

```js
enterZone(run, life, zone, transition)
```

## State Objects

### Run (persists across death, continue, save/load)

```js
{
  heroId: string,        // 'scarlet' | 'balthazar' | ...
  seed: number,          // world generation (fixed for whole run)
  level: number,         // 1-based
  area: number,          // 1..4 or 5 (boss)
  lives: number,
  continues: number,     // remaining in pool
  wallet: { coins, kills },
  snapshots: { [zoneId]: { coins, kills } },  // anti-farming rollback
  trace: TraceLog,       // append-only score telemetry
}
```

### Life (resets on death / failure zone entry)

```js
{
  energy: number,
  weapon: string | number,
  specials: (string|null)[],
  shield: number,
  x, y, vx, vy: number,
  iFrames: number,
}
```

### Transition (event, not state)

| Name | Run rule | Life rule |
|------|----------|-----------|
| `new-game` | fresh | fresh |
| `advance` | keep | keep |
| `death-retry` | rollback wallet to zone snapshot | reset |
| `continue` | rollback to 1-1 snapshot, refill lives | reset |
| `level-clear` | keep, credit continues | refill energy only |
| `save-load` | restore from saveMeta | reset |

## The Function

```js
function enterZone(run, life, zone, transition) {
  const rule = TRANSITIONS[transition];

  // Apply run rules
  if (rule.run === 'fresh')        Object.assign(run, freshRunValues());
  if (rule.run === 'rollback')     rollBackWallet(run, zone.id);
  if (rule.run === 'refill-lives') run.lives = STARTING_LIVES;

  // Apply life rules
  if (rule.life === 'fresh')       life = freshLife(run.heroId);
  if (rule.life === 'reset')       resetLife(life);
  if (rule.life === 'refill')      life.energy = maxEnergyFor(run.heroId);

  // THE FIVE STEPS (always identical, every path)
  installZoneContent(zone);
  resetTransientWorld();
  placeHeroAtEntry(life, zone);   // reads zone.spawn, applies drop offset
  showAreaEntryScreen(run, zone);
  startCameraFor(zone);
}
```

## What Dies

| Current | Replaced by |
|---------|-------------|
| `h.checkpoint` field on Hero | Read `zone.spawn` directly |
| `restartAttempt()` / `arriveAtZone()` / `startLife()` | `enterZone(run, life, zone, transition)` |
| 5 inline MENU→AREA_ENTRY code paths in update.js | One `enterZone(...)` call |
| Manual `h.energy = h.maxEnergy` in 4 places | Transition table |
| `makeHero()` + boot placeholder + debug swap + reload swap | `new HeroEntity(run.heroId)` |
| `buildWorld()` called in 3 places with different seeds | `buildWorld(run.seed)` |
| `saveCurrentRun` manually picking 8 fields | `serialize(run)` |
| `applySavedState` manually restoring 4 fields | `deserialize(saveMeta)` |
| `heroEntryPosition()` + `placeHeroAtEntry()` (two positioning systems) | One `placeHeroAtEntry(life, zone)` |

## Drop Feature (post-refactor)

One line in `placeHeroAtEntry`:

```js
function placeHeroAtEntry(life, zone) {
  life.x = zone.spawn.x;
  life.y = zone.spawn.y - heroH(run.heroId) - ZONE_ENTRY_DROP_PX;
  life.iFrames = 2;
}
```

Works for all orientations because `zone.spawn` is always "feet on the floor
of the active room." Vertical zones have their floor at the bottom platform —
the hero drops onto it. No special-casing.

## Save/Load

```js
// Save
saveMeta = { ...run, timestamp: Date.now() };

// Load
run = deserialize(saveMeta);
life = freshLife(run.heroId);
hero = new HeroEntity(run.heroId);
enterZone(run, life, getZone(run.level, run.area), 'save-load');
```

The heroId bug becomes structurally impossible — `run.heroId` IS the run.

## Implementation Order

Each step is a separate commit. Testable independently.

### Step 1: Delete `h.checkpoint`
- Replace every `h.checkpoint = {x, y}` with nothing (dead write)
- Replace every read (`h.checkpoint ?? fallback`) with direct `zone.spawn` access
- Files: lifecycle.js, zoneLifecycle.js, update.js, hero.js, bossFlow.js, object.js
- No behavior change. Pure deletion.

### Step 2: Extract `Run` and `Life` objects
- Create `js/systems/runState.js` with `createRun()`, `serializeRun()`, `deserializeRun()`
- Create `js/systems/lifeState.js` with `createLife()`, `resetLife()`, `refillLife()`
- Move fields off Hero into these objects
- Hero keeps only entity concerns (physics, anim, collision, rendering)
- All existing code reads `run.lives` instead of `hero.lives`, etc.
- Adapter getters on Hero during migration: `get lives() { return this._run.lives; }`

### Step 3: Transition table
- Define `TRANSITIONS` constant in lifecycle.js
- Replace inline energy/weapon/wallet decisions with table lookups
- `resetHeroTransient`, `resetHeroInventory`, `restoreAreaEntryStats` become
  implementations of table entries, not standalone concepts

### Step 4: Single `enterZone()`
- Write the function
- Replace all 5 call sites
- Delete `restartAttempt`, `arriveAtZone`, `startLife` (deprecated alias)
- Delete the 80-line MENU→AREA_ENTRY hook in update.js → one line
- Delete `heroEntryPosition` from zoneLifecycle.js

### Step 5: Save/Load simplification
- `saveCurrentRun` → `serialize(run)`
- `applySavedState` → `deserialize(saveMeta)`
- Delete the hero-swap block in update.js (no longer needed — run.heroId drives it)
- Delete `capturePlayerState` / `applySavedState`

### Step 6: Drop feature
- Add `ZONE_ENTRY_DROP_PX` constant
- One line in `placeHeroAtEntry`
- Done. Works everywhere. No special cases.

## Risks

- Step 2 is the biggest blast radius (every system reads hero fields). Mitigate
  with adapter getters so the migration is incremental.
- Boss zone has unique flow (approach → trigger → arena). It still uses
  `enterZone` for the initial entry, but the internal boss flow is unchanged.
- Debug harness reads/writes hero fields directly. Update it in Step 2.

## Out of Scope

- Boss zone internal flow (trigger, arena, reward) — stays as-is
- Camera logic — stays as-is (just called from enterZone)
- Area-entry screen presentation — stays in screens.js (just receives data)
- World generation algorithm — stays in build.js (just receives run.seed)
