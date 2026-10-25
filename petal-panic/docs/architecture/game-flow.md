# Game Flow — Menu Hub & Screen Routing

Source of truth for the player-facing flow: splash → menu hub → gameplay,
including save/continue, level select, boss rush, media, and the post-boss
routing rules. Implemented by the `petal-panic-menu-hub` plan (2026-10-24).

## The golden rule

**The splash is a stinger, never a gate. The MENU is where the game starts.**

- Splash (HOME) plays its bigtop intro sequence, then hands off to MENU.
  Any key skips ahead through the sequence. It must never feel like a screen
  you have to "get through" — no lingering PRESS ENTER wall.
- MENU is the home base. Every meta destination routes through it, and every
  exit path (pause Save & Quit, area-entry back, boss-rush return) lands back
  on it.

## Boot → gameplay

```
boot
 └─ HOME (splash stinger — skippable, auto-advances through its cards)
     └─ MENU (the hub)
         ├─ New Game     → SELECT (hero pick) → AREA_ENTRY → PLAY
         ├─ Continue     → AREA_ENTRY (saved level/area) → PLAY   ← 2 presses
         ├─ Level Select → stage pick → AREA_ENTRY → PLAY
         ├─ Boss Rush    → boss pick → AREA_ENTRY → boss fight → REWARD → BOSS_RUSH
         ├─ Media        → MEDIA (grid + playback overlay)
         ├─ Controls     → REMAP (returns to MENU)
         ├─ Options      → OPTIONS (returns to MENU or PAUSE by origin)
         └─ Credits      → in-screen overlay (any key closes)
```

Notes:
- **Continue skips hero select** — the hero was already chosen; resume goes
  straight to the saved area's entry card (`continueFromMenu`, task 2.3).
- **AREA_ENTRY is intentional**, not filler: it is the shared checkpoint card
  (level name, area id, lives) used by New Game, Continue, Level Select, and
  Boss Rush. One press. Do not remove it.
- **Intro clip (future):** slots between splash and menu — plays ONCE ever
  (flag in progressStore), skippable with any key, replayable from Media
  (`mediaUnlocked` id `intro`, written on first New Game by task 5.3).

## In-game loop

```
PLAY ⇄ PAUSE
PLAY → death → OVER (retry / quit-to-MENU)
PLAY → area exit flag → AUTOSAVE (saveMeta = next area) → next AREA_ENTRY (mid-level)
PLAY → boss defeated → REWARD (level-clear summary; AUTOSAVE saveMeta = next level's area 1)
```

### Pause menu (five options)

Resume · Retry Level · **Save & Quit** · Controls · Options

- Save & Quit writes `saveMeta {level, area, score, timestamp}` via
  `saveCurrentRun()` and returns to MENU. A failed write stays in PAUSE
  (nothing lost — no transition happened).
- Controls opens REMAP with parent PAUSE; Options opens OPTIONS with origin
  PAUSE (back returns to PAUSE, not MENU).

## Post-boss routing (the two modes differ)

| Mode | After boss defeat | Why |
|---|---|---|
| **Story** | REWARD → next level's AREA_ENTRY (levels 1–7); after the TRUE final level → ending clip → END_OF_GAME | The story continues; END_OF_GAME is only for the real end |
| **Boss Rush** | REWARD → **BOSS_RUSH, focus preserved**, defeated boss starred, NO auto-advance | Each fight is independent; the player picks the next boss |

Implementation: `_bossRushReturn` flag in lifecycle.js, armed when a boss is
started from the BOSS_RUSH screen, consumed in `rewardOnAction` — which takes
**priority over the final-level END_OF_GAME route** (in a rush there is no
"next level" concept).

> **Current-content caveat:** `world/level.js LEVELS` defines only Level 1
> today, so story mode's Level 1 boss currently hits the final-level route.
> That is an artifact of single-level content, not a design choice — when
> levels 2–8 land in LEVELS, story routing becomes correct automatically.
> The ending-media unlock correctly keys off `LEVEL_CONFIGS.length` (8), so
> the `ending` clip unlocks after boss 8 regardless.

## Persistence (progressStore, one localStorage document)

| Key | Written by | Read by |
|---|---|---|
| `saveMeta` (top-level) | **Autosave on area exit** (zoneLifecycle, points at the NEXT area) + **autosave on boss defeat** (`showLevelReward`, next level's area 1) + manual Save & Quit (`saveCurrentRun`) | Continue, hasSave() |
| `progress.completedAreas` | Exit flag reached (ordinary area); boss defeat (boss area) | Level Select gating |
| `progress.defeatedBosses` | `showLevelReward` (single writer) | Boss Rush presentation |
| `progress.mediaUnlocked` | `markMediaUnlocked`: `intro` on New Game, `level-N` on boss N defeat, `ending` on final boss | Media grid |
| `settings` | Options screen | screenShake gate (cameraShake `update()` funnel), vibration gate (`buzz()`); music/sfx persist for a future audio engine |

Rules:
- `saveMeta` lives at the document TOP LEVEL — never inside `updateProgress`
  (its mutator receives `store.progress`).
- All writes go through the store's atomic API (snapshot/rollback, single
  flush per outermost mutation).
- Media unlocks are decoupled from playability gates: media reads only
  `mediaUnlocked`; level select reads `completedAreas` + world-content
  (`hasLevelContent`).

## State machine (core/state.js)

States: HOME, SELECT, PLAY, PAUSE, OVER, WIN, REMAP, AREA_ENTRY, REWARD,
END_OF_GAME, MENU(10), OPTIONS(11), LEVEL_SELECT(12), BOSS_RUSH(13), MEDIA(14).

Key edges added by the menu hub:
- HOME→MENU (splash handoff)
- MENU→{SELECT, PLAY, AREA_ENTRY, LEVEL_SELECT, BOSS_RUSH, MEDIA, REMAP, OPTIONS, HOME}
- PAUSE→{PLAY, HOME, MENU, REMAP, OPTIONS, AREA_ENTRY}
- OPTIONS→{MENU, PAUSE} (origin-dependent)
- LEVEL_SELECT/BOSS_RUSH→{MENU, PLAY, AREA_ENTRY}
- MEDIA→MENU only (playback is an in-screen overlay, not a state)
- REWARD→BOSS_RUSH (boss-rush return)

## Deferred / known gaps

1. **Multi-level world content** — LEVELS has only Level 1; levels 2–8 are
   visible-but-locked in Level Select/Boss Rush (content gate) and their
   media clips show placeholder art until definitions land.
2. **Audio engine** — music/sfx settings persist but consume nothing yet.
3. **Ending clip production** — the `ending` media slot exists and unlocks;
   the actual video/sprite-loop asset is a production task.
4. **Input-dispatch quirk** — a mid-batch state transition can let a leftover
   edge (e.g. Escape's second 'pause'→'confirm') fire on the NEW state within
   the same physical press. Screens guard their own overlays via
   `consumedGeneration`; a general hardening belongs to an input task.
5. **Shared helpers** — the three select models (level/boss/media) duplicate
   small predicates; extract when multi-level content lands.

### Continue and manual-save rules

When a run save exists, Continue is the first/default menu option, followed by New Game. Without a save, New Game is first. Save & Quit records the current level/area without completing it or unlocking its successor; Continue resumes that saved area through area entry (not an exact mid-area position). Successful area clears autosave the next area; successful boss clears autosave the next level where applicable. Starting, retrying, or continuing an area never records completion. Previously incorrect completion records are not silently erased.
