# EPIC: Petal Panic Level Engine v1 (Level 1)
Why: The prototype level system is a single flat corridor with random scatter, one hardcoded level, and ad-hoc start/restart logic. The design contract in petal-panic/docs/levels/ defines sealed zones, authored terrain macros, per-game deterministic generation, vertical areas, boss zone flow, and a global continue pool. This epic replaces the prototype with that engine and ships Level 1 (The Circus) playable.
Outcomes: N-level engine driven by config; Level 1 playable end-to-end (4 areas + boss); deterministic per-game world; area-entry/death/continue lifecycle; boss intro + reward screens; all tests green

## MILESTONE: 1 - Game Rules Core
Pattern: Lifecycle Operations + Global Settings
Objective: Establish the four distinct start operations (game start, area start, life start, continue) and global settings (lives, continue pool, coin->continue rate) per docs/levels/game-rules.md and lifecycle.md.
Success: Continues are a growable global pool starting at 3; death restarts the same area via the shared entry screen; continue restarts area -1 of the current level with restored lives; no coin cost anywhere.
Diagram: stateDiagram-v2
    SELECT --> PLAY : game start
    PLAY --> ENTRY_SCREEN : death with lives left
    ENTRY_SCREEN --> PLAY : life start same area
    PLAY --> OVER : zero lives
    OVER --> PLAY : continue to area -1
    OVER --> HOME : quit

### TASK: 1.1 - Global game settings module
Type: feature
What: Add js/gameRules.js exporting global settings (starting lives, starting continues, coin-per-continue threshold) and continue-pool helpers (remaining, spend, credit).
Why: Docs require configurable global defaults instead of numbers scattered across level behavior; the pool must be a growable balance, not a fixed max.
Files: + petal-panic/js/gameRules.js
Files: + petal-panic/js/test/gameRules.test.js
Snippet: export const GAME_RULES = {\n  startingLives: 3,\n  startingContinues: 3,\n  coinsPerContinue: 1000, // global tuning value\n};\n\n// Pool is a remaining balance, not a fixed maximum.\nexport function createContinuePool(starting = GAME_RULES.startingContinues) {\n  return { remaining: starting };\n}\nexport function canSpend(pool) { return pool.remaining > 0; }\nexport function spend(pool) { /* decrement once */ }\nexport function credit(pool, n) { /* grow the pool */ }
Acceptance: Pool starts at 3, can grow beyond initial via credit(), spend() never goes negative, all values come from GAME_RULES not literals in other modules
Verification: node --test petal-panic/js/test/gameRules.test.js

### TASK: 1.2 - Lifecycle operations (startRun/startLife/continueRun)
Type: refactor
What: Replace the scattered field assignments in update.js (onTransition hook, retryFromGameOver, continueFromGameOver, finishHeroDeath) with explicit lifecycle ops: startGame(heroDef), startArea(level, areaIdx), startLife(area), continueRun() returning to area -1 of the current level.
Why: Three ad-hoc code paths each know a different subset of 'what does starting mean' and can drift; docs/lifecycle.md defines four distinct operations that must reset different things.
Files: ~ petal-panic/js/systems/update.js
Files: + petal-panic/js/lifecycle.js
Files: ~ petal-panic/js/screens.js
Snippet: // lifecycle.js — one owner for what each start event resets.\nexport function startGame(state, heroDef) {\n  // new lives + continues pool, fresh generation choices, enter level 1 area -1\n}\nexport function startArea(state, level, areaIdx) {\n  // first arrival: fix arrangement from game seed, show entry screen\n}\nexport function startLife(state, area) {\n  // restore same arrangement, i-frames, lives untouched\n}\nexport function continueRun(state) {\n  // spend pool, restore starting lives, go to area -1 of CURRENT level\n}
Acceptance: No module outside lifecycle.js assigns lives/continuesUsed/position for a restart; continue from 2-3 lands in 2-1; death in an area restarts that same area; continue never rerolls generation choices
Verification: node --test petal-panic/js/test/

### TASK: 1.3 - Shared area-entry screen + death flow
Type: feature
What: Add the shared full-screen area-entry screen (level name, area id, remaining lives, NO score) used for new game, area advance, post-death restart, continue, and boss-zone entry; wire ordinary death to fade-black then this screen.
Why: Docs/checkpoints.md defines one shared entry screen replacing the old separate death-score idea; it must follow the pause-menu ergonomics contract (list layout, focus pill, keycap nav bar).
Files: ~ petal-panic/js/screens.js
Files: + petal-panic/js/test/screens.test.js
Snippet: // screens.js — AreaEntry screen\n// info: levelName, areaId (e.g. '1-2'), livesRemaining\n// NO score field. Same list/keycap pattern as Pause.\nexport function showAreaEntry({ levelName, areaId, lives }) { /* ... */ }\n\n// Death flow: presentation -> short delay -> fade black -> consume 1 life\n// -> if lives remain: showAreaEntry(same area) else Game Over (existing).
Acceptance: Entry screen shows exactly level name, area id, lives; no score rendered; same keycap nav bar as pause menu; death in 1-3 re-enters 1-3 beside its flag; zero lives goes to existing Game Over screen untouched
Verification: node --test petal-panic/js/test/

## MILESTONE: 2 - Zone & Transition System
Pattern: Sealed Zones + State Machine
Objective: Replace the single continuous corridor with sealed zones: 4 areas + boss zone per level, exit flags, clear banner, fade transitions, and camera rules that cannot reveal adjacent zones.
Success: Reaching an exit flag flashes, shows a '1-1 CLEAR' banner, fades out, generates the next zone, fades in; no scrolling past any boundary; each area is its own world.
Diagram: graph TD
    A[Play area] --> B{Reach exit flag}
    B --> C[Flag flash effect]
    C --> D[CLEAR banner]
    D --> E[Fade out]
    E --> F[Generate next zone from game seed]
    F --> G[Area-entry screen]
    G --> H[Fade into new zone]

### TASK: 2.1 - Zone model replacing single corridor
Type: refactor
What: Rework level.js so a level is 5 sealed zones (areas -1..-4 + boss zone), each with its own world bounds, entry flag (except -1), and exit flag; the -4 exit is the boss checkpoint. Remove the single 8000px flat world.
Why: Docs/structure.md: areas are not physically connected pieces of one scrolling map; reaching an exit ends the current zone and a new zone replaces it.
Files: ~ petal-panic/js/level.js
Files: + petal-panic/js/test/zone.test.js
Snippet: // One level = 5 sealed zones. Each zone owns its bounds + flags.\nexport function buildLevelZones(levelDef, gameSeed) {\n  return [\n    { idx: 1, orientation: 'horizontal', bounds: ..., entryFlag: null, exitFlag: ... },\n    { idx: 2, orientation: ..., bounds: ..., entryFlag: ..., exitFlag: ... },\n    // ... -3, -4 (exitFlag is the boss checkpoint)\n    { idx: 'boss', orientation: 'boss', bounds: ..., entryFlag: bossCheckpoint },\n  ];\n}
Acceptance: Level def yields 5 zones; -1 has no entry flag; -2..-4 have entry flags at their start; -4 exit uses boss-checkpoint appearance; zones share no geometry
Verification: node --test petal-panic/js/test/zone.test.js

### TASK: 2.2 - Exit flag, clear banner, fade transition
Type: feature
What: Implement the area-clear sequence: exit flag activation -> celebratory flash effect -> 'X-Y CLEAR' banner -> fade out -> generate next zone -> entry screen -> fade in. Reuse existing effects (screenFlash/fadeOut) for the celebration.
Why: Docs/checkpoints.md §2 defines this exact 6-step flow; completion must feel rewarding and there is no scrolling past the exit.
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/screens.js
Snippet: // Clearing an ordinary area:\n// 1. activate exit flag  2. flag flash effect  3. banner '1-1 CLEAR'\n// 4. fade out  5. showAreaEntry(next)  6. fade into new zone at its start\nexport function onExitFlagReached(zone) { /* ... */ }
Acceptance: Touching the exit flag triggers flash + banner exactly once; camera never reveals the next zone before the fade; after fade-in the hero stands at the new zone's start beside its entry flag; entry flag does not immediately re-trigger a clear
Verification: node --test petal-panic/js/test/

### TASK: 2.3 - Per-zone camera boundaries
Type: feature
What: Make the camera clamp to the active zone's bounds so it cannot reveal previous or next zones; horizontal zones scroll right only, boss zone is a fixed view.
Why: Docs/structure.md: the camera stops at area boundaries and cannot reveal adjacent zones; the boss arena locks both sides.
Files: ~ petal-panic/js/camera.js
Files: ~ petal-panic/js/systems/update.js
Snippet: // Camera takes its clamp range from the ACTIVE zone.\nexport function setCameraBounds(zone) {\n  // min/max from zone.bounds; boss zone: min === max (locked)\n}
Acceptance: Camera never draws outside the active zone in any state; entering the boss zone freezes the camera; returning to a new zone re-clamps correctly
Verification: node --test petal-panic/js/test/

## MILESTONE: 3 - Terrain Generation
Pattern: Seeded Macro Composition
Objective: Replace random scatter with authored terrain macros composed per area from a per-game seed: block/platform grammar, macro library, -1 to -4 progression, and roughly double the prototype length.
Success: Each area is built from compatible macros meeting its length budget; generation is deterministic per game (same choices on death/continue); difficulty rises -1 to -4; both heroes can complete every route.
Diagram: graph TD
    A[Game seed] --> B[Per-area RNG stream]
    B --> C[Select macros for orientation + progression stage]
    C --> D[Compose macros to meet length budget]
    D --> E[Validate joins and reachability]
    E --> F[Fixed arrangement stored for the game]

### TASK: 3.1 - Terrain grammar + seeded RNG
Type: feature
What: Add the terrain unit model (blocks: 1w x 1/2/3h solid from ground; platforms: 1/2/3w one-way at tier 1/2/3, double-jump reachable) and a seeded per-game RNG so generation choices are fixed for the whole game.
Why: Docs/generation.md §1 + lifecycle.md §6: randomness is rolled once per game and replayed identically after death/continue; 'regenerate' means rebuilding the same world, not rerolling.
Files: + petal-panic/js/terrain.js
Files: + petal-panic/js/test/terrain.test.js
Snippet: // Deterministic per-game RNG (seeded). Same seed -> same stream.\nexport function createRng(seed) { /* mulberry32 or similar */ }\n\n// Terrain units\nexport const BLOCK = { widths: [1], heights: [1, 2, 3], solid: true };\nexport const PLATFORM = { widths: [1, 2, 3], tiers: [1, 2, 3], oneWay: true };\n// Tier spacing must be double-jump reachable with margin for BOTH heroes.
Acceptance: Same seed produces identical block/platform sequences across calls; blocks are solid AABBs rising from ground; platforms are one-way at tier heights reachable by double jump of both heroes
Verification: node --test petal-panic/js/test/terrain.test.js

### TASK: 3.2 - Macro library + area composer
Type: feature
What: Implement the macro vocabulary (pyramid, low repeated obstacles, stretched pyramid, mixed crossing, climbing pattern, gap/drop) and the composer that selects compatible macros for an area's orientation and progression stage, arranges them to the length budget, and validates joins.
Why: Docs/generation.md §2-4: authored patterns with readable challenges replace arbitrary obstacle scatter; each macro declares entry/exit, placement opportunities, variations, and follow conditions.
Files: + petal-panic/js/macros.js
Files: ~ petal-panic/js/level.js
Files: + petal-panic/js/test/macros.test.js
Snippet: // A macro is an authored terrain sequence.\nexport const MACROS = {\n  pyramid:        { heights: [1,2,3,2,1], difficulty: 1, follows: [...] },\n  lowRepeated:    { ... },\n  stretchedPyramid: { ... },\n  mixedCrossing:  { ... },\n  climbing:       { orientation: 'vertical', ... },\n};\n\n// Compose one area: safe entry -> macros meeting budget -> validated exit flag zone.\nexport function composeArea(rng, orientation, stage, budget) { /* ... */ }
Acceptance: composeArea returns a playable block/platform layout meeting the budget; no impossible gaps or trapped starts at macro joins; required landings not buried; start/exit never require a random powerup to reach; output deterministic for a given rng stream
Verification: node --test petal-panic/js/test/macros.test.js

### TASK: 3.3 - Progression -1 to -4 + length doubling
Type: feature
What: Weight macro selection by progression stage (-1 sparse/simple, -2 more combinations, -3 denser set pieces, -4 strongest combos) and set area length budgets at roughly double the measured prototype baseline.
Why: Docs/generation.md §5 + structure.md §6: difficulty rises deliberately across areas and target length is ~2x the current short prototype areas (baseline measured now: 8000px total / ~2000px per checkpoint segment).
Files: ~ petal-panic/js/macros.js
Files: ~ petal-panic/js/level.js
Snippet: // Progression weighting per stage.\nexport const STAGE_WEIGHTS = {\n  1: { simple: 0.7, medium: 0.3, hard: 0 },\n  2: { ... }, 3: { ... }, 4: { ... },\n};\n// Length budget: measured prototype baseline x 2 (recorded in level config).
Acceptance: -1 areas are visibly sparser than -4; each horizontal area is ~2x the prototype segment length; exactly one of -2/-3/-4 is vertical for Level 1 (chosen by config, fixed for the game); all four stages produce completable routes
Verification: node --test petal-panic/js/test/

## MILESTONE: 4 - Population
Pattern: Budget + Placement Opportunities
Objective: Populate composed terrain from macro placement opportunities using per-level budgets: enemies, barrel structures (single/medium/super), and powerups — resolved together so no layer invalidates another.
Success: Enemies/barrels/powerups sit at macro-designated positions within budgets; barrel structures form organized arrangements; after death everything returns in the same arrangement; nothing is buried or trapped.
Diagram: graph TD
    A[Composed area with placement slots] --> B[Enemy budget resolution]
    A --> C[Barrel structure resolution]
    A --> D[Powerup matrix resolution]
    B --> E[Combined validation]
    C --> E
    D --> E
    E --> F[Fixed population stored for the game]

### TASK: 4.1 - Macro placement opportunities + population resolver
Type: refactor
What: Extend macros to declare placement slots (enemy spots, barrel pockets, powerup perches) and replace randomPositions() scatter with a resolver that fills level budgets from those slots using the seeded RNG.
Why: Docs/populate.md: enemies/barrels/powerups are not scattered independently at arbitrary intervals; quantity budget and placement/type chance must stay distinct, and fixed budgets must not produce empty or overcrowded areas.
Files: ~ petal-panic/js/macros.js
Files: ~ petal-panic/js/level.js
Files: + petal-panic/js/test/populate.test.js
Snippet: // Each macro exposes slots: { enemies: [pos], barrels: [pos], powerups: [pos] }\nexport function populateArea(rng, composedArea, levelConfig) {\n  // resolve enemy counts from slots (respect movement surface + reaction space)\n  // resolve barrel structures (single / medium 4-9 / super set piece)\n  // resolve powerups from matrix weights + hero eligibility\n  // combined validation: no buried powerups/flags, no trapped enemies,\n  // required landings remain usable\n}
Acceptance: All spawn items sit on valid macro slots, never in solids; fixed budgets are met without overcrowding; explosive barrels can form chain positions; result deterministic per game seed; after life loss the same population is restored
Verification: node --test petal-panic/js/test/populate.test.js

### TASK: 4.2 - Level 1 config (The Circus)
Type: feature
What: Define the Level 1 configuration: enemy roster from the story doc, boss, powerup mix, per-stage budgets, vertical slot choice, and length budgets — as pure data consumed by the generator.
Why: The engine is N-level; Level 1 content is a config entry, not code. The story doc (docs/story/levels.md) defines The Circus roster and boss.
Files: + petal-panic/js/levelConfigs.js
Snippet: // Pure data. Engine reads this; nothing here knows about rendering.\nexport const LEVEL_CONFIGS = [\n  {\n    name: 'The Circus', index: 1, boss: 'tusko',\n    verticalArea: 2, // exactly one of -2/-3/-4\n    enemies: { jester: ..., vine_hound: ..., ... },\n    powerups: { ammo: ..., shield: ..., ... },\n    stageBudgets: { 1: {...}, 2: {...}, 3: {...}, 4: {...} },\n    lengths: { horizontal: <baseline*2>, vertical: <tuned> },\n  },\n];
Acceptance: Config matches docs/story/levels.md Level 1 roster and boss; exactly one vertical area declared; budgets make scope explicit (per-level vs per-area); adding a Level 2 requires only a new array entry
Verification: node --test petal-panic/js/test/

## MILESTONE: 5 - Vertical Areas
Pattern: Orientation-Specific Zone
Objective: Support the vertical area: upward climb with up-only camera, fall-off-bottom death, flags on platforms, and climbing macros — exactly one of -2/-3/-4 for Level 1.
Success: The vertical zone scrolls up only, never back down; falling into the bottom emptiness kills; death restarts at the bottom platform; the exit flag sits on a top platform.
Diagram: stateDiagram-v2
    [*] --> BottomPlatform : entry flag on platform
    BottomPlatform --> Climbing : hero ascends
    Climbing --> Climbing : camera follows up only
    Climbing --> TopFlag : reach exit flag on platform
    Climbing --> Dead : fall off bottom
    Dead --> BottomPlatform : restart ascent

### TASK: 5.1 - Vertical zone orientation
Type: feature
What: Add vertical orientation support to the zone system: fixed horizontal camera width, upward-only camera follow (never back down), lethal bottom emptiness, entry flag on a bottom platform, exit flag on a top platform.
Why: Docs/structure.md §4: Contra-style ascent; the hero may fall within the visible view but falling into the bottom emptiness kills; descending cannot recover earlier climb.
Files: ~ petal-panic/js/camera.js
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/terrain.js
Snippet: // Vertical zone rules:\n// - no horizontal camera scroll; hero moves sideways within fixed width\n// - camera.y follows upward progress only (ratchet)\n// - y > bottomLimit => death\n// - entry flag on bottom platform; exit flag on top platform\nexport function makeVerticalZone(config, rng) { /* ... */ }
Acceptance: Camera never scrolls down once raised; falling below the bottom kills exactly like any other death; restart places hero on the bottom platform with reset camera; route remains usable under up-only camera; initial platform does not kill a standing hero
Verification: node --test petal-panic/js/test/

### TASK: 5.2 - Climbing macros for vertical composition
Type: feature
What: Add climbing-pattern macros (reachable upward landings within the fixed screen width) and wire the composer to build vertical areas from them, with progression via climbing complexity rather than horizontal length.
Why: Docs/generation.md §5: the vertical area follows the same progression principle through climbing complexity; three tiers must not become a three-platform cap on the whole ascent.
Files: ~ petal-panic/js/macros.js
Files: + petal-panic/js/test/vertical.test.js
Snippet: // Climbing macros: sequences of reachable landings going up.\n// Each landing double-jump reachable from the previous; sideways variety\n// within the fixed width so the climb is not a single-file staircase.\nexport const CLIMB_MACROS = { /* ... */ };
Acceptance: Vertical areas compose from climbing macros only; every landing reachable by both heroes' double jump; ascent has lateral variety; difficulty rises with stage via pattern complexity; deterministic per seed
Verification: node --test petal-panic/js/test/vertical.test.js

## MILESTONE: 6 - Boss Zone
Pattern: Fixed-Arena Sequence
Objective: Implement the boss zone: short approach from the boss checkpoint, arena lock, full-screen introduction (placeholder art), energy bar fill, boss entrance from the right, and the level reward screen that credits continues.
Success: Entering the boss zone locks both sides; the intro sequence plays in order; the boss becomes attackable only after the agreed combat start; defeating it shows the reward screen (kills, score, coins, continues earned) which credits the pool at 1 per 1000 coins.
Diagram: sequenceDiagram
    participant P as Player
    participant Z as BossZone
    participant S as Screens
    P->>Z: reach arena boundary
    Z->>Z: lock both sides
    Z->>S: intro graphic left-to-right + name right-to-left
    S->>S: graphic disappears
    Z->>Z: energy bar fills at top
    Z->>Z: boss enters from right
    Z->>P: combat enabled
    P->>Z: defeat boss
    Z->>S: reward screen kills score coins continues

### TASK: 6.1 - Boss approach + arena lock + intro sequence
Type: feature
What: Implement the boss zone entry: start beside the boss checkpoint, short (~1 screen) approach to a warning region, then arena lock (both sides, fixed camera), invisible boss, full-screen intro graphic sweeping left-to-right with the name/title moving right-to-left (placeholder art), graphic exit, energy bar fill at top, boss entering from the right, combat enable.
Why: Docs/boss-arena.md §1-2 defines this exact tension-building sequence; the presentation must not imply the boss is attackable before combat starts. Timings are design-plan values proposed here.
Files: ~ petal-panic/js/systems/update.js
Files: + petal-panic/js/bossZone.js
Files: ~ petal-panic/js/screens.js
Snippet: // Intro sequence state machine (placeholder visuals):\n// APPROACH -> LOCKED -> INTRO_SWEEP (graphic L->R, title R->L)\n// -> BAR_FILL -> BOSS_ENTER (from right) -> COMBAT\n// Player input during intro: movement allowed, shooting disabled.\nexport function enterBossZone(zone) { /* ... */ }
Acceptance: Approach is ~1 screen and leaves the flag behind; both sides locked on arena entry; intro plays in documented order with opposing motion; boss invisible until entrance; hero cannot damage boss before COMBAT state; death during intro/combat restarts at the boss checkpoint repeating the approach
Verification: node --test petal-panic/js/test/

### TASK: 6.2 - Level reward screen + continue crediting
Type: feature
What: Replace the current placeholder post-boss screen with the level reward screen: enemies killed, score, coins collected, continues earned — counting each full 1000-coin chunk and visibly crediting the global continue pool once.
Why: Docs/boss-arena.md §4 + game-rules.md §2: conversion is automatic at 1 continue per 1000 coins (global tuning value), credited exactly once regardless of redraws, following the shared screen ergonomics contract.
Files: ~ petal-panic/js/screens.js
Files: ~ petal-panic/js/systems/update.js
Files: + petal-panic/js/test/reward.test.js
Snippet: // Reward screen data: { kills, score, coins, continuesEarned }\n// continuesEarned = floor(coins / GAME_RULES.coinsPerContinue)\n// credit(pool, continuesEarned) called exactly once on first show.\nexport function showLevelReward(stats) { /* ... */ }
Acceptance: Screen shows kills, score, coins, continues earned; pool credited exactly once even if the screen redraws or animates; 2500 coins credits 2 continues; after the screen, next level starts at area -1 with its entry screen; final boss does not advance into a nonexistent level
Verification: node --test petal-panic/js/test/reward.test.js

## MILESTONE: 7 - Level 1 Integration + Gameplay Polish
Pattern: Vertical Slice Integration
Objective: Wire everything into a playable Level 1 end-to-end and polish the gameplay feel: pacing, tuning values for all design-plan decisions (timings, lengths, budgets), edge cases, and a green test suite. No art/sprite work — geometry stays drawn rectangles.
Success: A full Level 1 run is completable: entry screen -> 4 areas (one vertical) with clear banners -> boss intro/fight/reward -> next level or ending; death/continue flows work throughout; all tests pass; timing/budget values are concrete and documented.
Diagram: graph TD
    A[Select hero] --> B[Game start: lives + continues + seed]
    B --> C[Area-entry screen 1-1]
    C --> D[Play area -1 horizontal]
    D --> E[CLEAR banner + fade]
    E --> F[Area -2 vertical climb]
    F --> G[Areas -3 -4 horizontal]
    G --> H[Boss checkpoint + approach]
    H --> I[Intro sequence + fight]
    I --> J[Reward screen + continue credit]
    J --> K[Next level area -1]

### TASK: 7.1 - Wire engine into main loop (replace prototype world)
Type: refactor
What: Replace the module-level prototype world in update.js (SOLIDS, generated, boss at fixed x) with the new engine: level config -> zones -> composed terrain -> populated world per active zone, driven by lifecycle ops.
Why: The prototype's single flat world and hardcoded boss position must be replaced by the zone system; this is the integration seam that makes Level 1 actually run on the new engine.
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/main.js
Snippet: // update.js no longer owns a static world.\n// Active zone provides: solids, enemies, barrels, powerups, flags, bounds.\nexport function loadActiveZone(zone) { /* swap world refs */ }\n// Boss is created per boss-zone entry, not at module load.
Acceptance: Game boots from SELECT into Level 1 area -1 via the new engine; no reference to the old flat 8000px world remains; switching zones swaps all world contents; existing hero/enemy/projectile systems work unchanged against the new world refs
Verification: node --test petal-panic/js/test/

### TASK: 7.2 - Concrete design-plan values + tuning pass
Type: chore
What: Propose and document concrete values for every design-plan decision the docs defer: transition timings, banner duration, boss intro delays/bar-fill threshold, area lengths in px, population budgets per stage, coin carryover policy, inventory persistence across death/continue.
Why: The docs deliberately leave these to the plan; the game needs real numbers to feel thrilling and consistent. Values go in levelConfigs.js / GAME_RULES with a comment linking back to the doc section they settle.
Files: ~ petal-panic/js/levelConfigs.js
Files: ~ petal-panic/js/gameRules.js
Snippet: // Each value cites the doc it settles, e.g.:\n// structure.md §6 — horizontal area length budget (px)\n// boss-arena.md §2 — intro sweep duration, bar-fill % before entrance\n// game-rules.md §2 — coin remainder does NOT carry between levels\n// game-rules.md §5 — temporary powerups do NOT persist across death
Acceptance: Every 'design-plan decision' marker in docs/levels/*.md has a corresponding concrete value in code or config; choices are listed in one place (a TUNING block or doc appendix); no magic numbers left uncited
Verification: node --test petal-panic/js/test/

### TASK: 7.3 - Full-flow integration tests + suite green
Type: test
What: Add end-to-end tests for the full Level 1 flow (start -> areas -> vertical -> boss -> reward -> next level, plus death/continue paths) and fix all remaining test failures including the pre-existing canvas mock gaps (c2d.ellipse).
Why: The epic is only done when the whole contract is verifiable by tests; two pre-existing failures (ellipse mock, tabs focusable row) must also be resolved so the suite is genuinely green.
Files: + petal-panic/js/test/levelFlow.test.js
Files: ~ petal-panic/js/test/effectTheater.test.js
Files: ~ petal-panic/js/test/input.test.js
Snippet: // Simulate a full run headlessly:\n// startGame -> clear 1-1..1-4 (incl. vertical) -> boss intro -> defeat\n// -> reward credits continues -> next level entry screen.\n// Plus: death mid-area restarts same area; continue from 1-3 lands in 1-1.
Acceptance: node --test petal-panic/js/test/ passes with 0 failures; full-run simulation completes; determinism verified (same seed twice = identical worlds); vertical fall-death and bottom-restart covered
Verification: node --test petal-panic/js/test/

### TASK: 7.4 - 8 level config entries
Type: feature
What: Add all 8 level entries to levelConfigs.js: Level 1 (The Circus) with its real roster/boss from the story doc, Levels 2-4 from the story doc themes, Levels 5-8 as named placeholder themes — each with vertical slot, stage budgets, and tension curve (rising enemy quantities, falling powerup availability, harder macro weights).
Why: generation.md §5b: the game contains eight levels driven by config; writing them now proves the N-level engine and reduces the future tuning epic to numbers + art only. Rosters beyond Level 1 may reuse existing enemy types as placeholders.
Files: ~ petal-panic/js/levelConfigs.js
Snippet: // 8 entries. Tension per level index:\n// enemies up, powerups down, macro difficulty weight up.\n{ name: 'The Circus',        index: 1, boss: 'tusko',       verticalArea: 2, ... },\n{ name: 'Carnival After Dark', index: 2, boss: <placeholder>, verticalArea: 3, ... },\n{ name: 'The Pirate Ship',   index: 3, ... },\n{ name: "Carrot's Republic", index: 4, ... },\n{ name: '<TBD>', index: 5..8, ... } // placeholder themes, tune later
Acceptance: 8 config entries exist; each has unique name/index/boss/verticalArea (one of -2/-3/-4); budgets show monotonic tension rise across indices; engine can boot any level by index; adding a 9th level = one array entry
Verification: node --test petal-panic/js/test/

### TASK: 7.5 - Minimal end-of-game screen
Type: feature
What: After the final level's boss reward screen, show a minimal full-screen end-of-game presentation: congratulations text + final score + single 'Return Home' option, following the shared screen ergonomics contract. The last boss must not advance into a nonexistent next level.
Why: lifecycle.md now settles the game-end decision: placeholder congrats screen now, full story ending in the future story epic. Closes the last dangling flow in the epic so 'beat the whole game' is testable headlessly.
Files: ~ petal-panic/js/screens.js
Files: ~ petal-panic/js/systems/update.js
Snippet: // After reward screen of the FINAL level config entry:\n// showEndOfGame({ finalScore }) -> one option: Return Home (S.HOME)\n// Non-final levels still advance to next level area -1 as before.
Acceptance: Beating the last configured level shows the congrats screen with final score; its only option returns to HOME; non-final bosses still advance normally; screen uses the pause-menu list/keycap pattern; no reference to a level beyond the last exists
Verification: node --test petal-panic/js/test/
