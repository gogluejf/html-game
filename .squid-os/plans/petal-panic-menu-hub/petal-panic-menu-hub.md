# EPIC: Petal Panic Menu Hub
Why: The current flow jumps from Home to Select and lacks real menu options, persistent progress, level selection, boss rush, media unlocks, and pause save/settings.
Outcomes: Add a main menu with New Game, Continue, Level Select, Boss Rush, Media, Controls, Options, Credits; add shared pause options and Save & Quit; persist progress/settings; reuse existing screen ergonomics for buttons, focus, and navigation.

## MILESTONE: 1 - Progress and Settings Persistence
Pattern: Repository + State Machine
Objective: Create one persistent local storage layer for game progress, settings, media unlocks, and save metadata.
Success: The game can load/save a single JSON blob in localStorage with safe defaults and explicit APIs for progress and settings.
Diagram: graph TD
  A[localStorage] --> B[progressStore]
  B --> C[progress]
  B --> D[settings]
  B --> E[mediaUnlocks]
  B --> F[saveMeta]
  C --> G[Level Select]
  C --> H[Boss Rush]
  D --> I[Options]
  E --> J[Media Menu]

### TASK: 1.1 - Persistent progress and settings store
Type: feature
What: Add a localStorage-backed store for Petal Panic progress, settings, media unlocks, and save metadata.
Why: Menus need persistent Continue, Level Select, Boss Rush, Media, and Options state without scattering localStorage calls through screens.
Files: + petal-panic/js/systems/progressStore.js
Snippet: export const DEFAULT_PROGRESS = {\n  version: 1,\n  completedAreas: {},\n  defeatedBosses: [],\n  mediaUnlocked: [],\n};\n\nexport const DEFAULT_SETTINGS = {\n  music: false,\n  sfx: true,\n  screenShake: true,\n  vibration: true,\n};\n\nexport function loadStore() {}\nexport function saveStore(store) {}\nexport function updateProgress(mutator) {}\nexport function updateSettings(mutator) {}\nexport function hasSave() {}\nexport function clearRunSave() {}
Acceptance: loadStore returns defaults when localStorage is empty or invalid
Acceptance: saveStore persists one JSON document under a stable key
Acceptance: updateProgress and updateSettings mutate and persist atomically
Acceptance: hasSave reflects whether a resumable run exists
Verification: node --input-type=module -e "import('./petal-panic/js/systems/progressStore.js').then(m => console.log(typeof m.loadStore))"

## MILESTONE: 2 - Main Menu Hub
Pattern: Screen State + Shared UI Ergonomics
Objective: Replace the current Home-to-Select jump with a real main menu hub that routes into gameplay, selection, options, and meta screens.
Success: The player can choose New Game, Continue, Level Select, Boss Rush, Media, Controls, Options, and Credits using the same focus pill and keycap nav style as Pause.
Diagram: graph TD
  A[HOME] --> B[Main Menu]
  B --> C[New Game]
  B --> D[Continue]
  B --> E[Level Select]
  B --> F[Boss Rush]
  B --> G[Media]
  B --> H[Controls]
  B --> I[Options]
  B --> J[Credits]
  C --> K[SELECT]
  D --> L[PLAY]
  E --> M[Level Select Screen]
  F --> N[Boss Rush Screen]
  G --> O[Media Screen]
  H --> P[REMAP]
  I --> Q[Options Screen]

### TASK: 2.1 - Main menu state and routing
Type: feature
What: Add MENU states for the main hub, options, level select, boss rush, and media screens, plus transition rules from HOME, PAUSE, and submenus.
Why: The existing state machine only supports HOME, SELECT, PLAY, PAUSE, OVER, WIN, REMAP, AREA_ENTRY, REWARD, and END_OF_GAME, so new menu destinations need explicit states.
Files: ~ petal-panic/js/core/state.js
Snippet: export const S = {\n  HOME: 0,\n  MENU: 10,\n  OPTIONS: 11,\n  LEVEL_SELECT: 12,\n  BOSS_RUSH: 13,\n  MEDIA: 14,\n};\n\nconst TRANSITIONS = {\n  [S.HOME]: [S.MENU, S.SELECT, S.PLAY, S.REMAP],\n  [S.MENU]: [S.SELECT, S.PLAY, S.LEVEL_SELECT, S.BOSS_RUSH, S.MEDIA, S.REMAP, S.OPTIONS],\n  [S.PAUSE]: [S.PLAY, S.HOME, S.MENU, S.REMAP, S.OPTIONS, S.AREA_ENTRY],\n  [S.OPTIONS]: [S.MENU, S.PAUSE],\n  [S.LEVEL_SELECT]: [S.MENU, S.PLAY, S.AREA_ENTRY],\n  [S.BOSS_RUSH]: [S.MENU, S.PLAY, S.AREA_ENTRY],\n  [S.MEDIA]: [S.MENU],\n};
Acceptance: HOME can transition to MENU
Acceptance: MENU can transition to every top-level destination
Acceptance: PAUSE can open OPTIONS and return to MENU or PLAY
Acceptance: LEVEL_SELECT and BOSS_RUSH can start play through AREA_ENTRY
Verification: node --input-type=module -e "import('./petal-panic/js/core/state.js').then(m => console.log(Object.keys(m.S).length))"

### TASK: 2.2 - Main menu screen
Type: feature
What: Add a canvas-drawn MENU screen with the same centered option list, focus pill, and nav bar style as Pause.
Why: The user wants a real entry point that feels like the existing menus instead of an extra HTML overlay.
Files: ~ petal-panic/js/ui/screens.js
Snippet: export const Menu = {\n  focus: 0,\n  options() {\n    return [\n      { label: 'New Game', enabled: true },\n      { label: hasSave() ? 'Continue' : 'No Save', enabled: hasSave() },\n      { label: 'Level Select', enabled: true },\n      { label: 'Boss Rush', enabled: true },\n      { label: 'Media', enabled: true },\n      { label: 'Controls', enabled: true },\n      { label: 'Options', enabled: true },\n      { label: 'Credits', enabled: true },\n    ];\n  },\n  draw(ctx) {},\n  onAction(action) {},\n  reset() {},\n};
Acceptance: Menu draws all top-level options using the pause-style focus pill
Acceptance: Continue is disabled when no save exists
Acceptance: up/down moves focus and confirm routes to the selected destination
Acceptance: back from MENU returns HOME
Verification: node --input-type=module -e "import('./petal-panic/js/ui/screens.js').then(m => console.log(typeof m.Menu?.draw))"

### TASK: 2.3 - New Game and Continue flow
Type: feature
What: Wire MENU New Game and Continue to the existing hero select/play lifecycle and persist a resumable save.
Why: The menu is only useful if it can start a fresh run or resume the last saved level/area safely.
Files: ~ petal-panic/js/ui/screens.js
Files: ~ petal-panic/js/systems/lifecycle.js
Snippet: // New Game:\n// clearRunSave()\n// tryTransition(S.SELECT)\n\n// Continue:\n// loadStore().saveMeta\n// set hero.currentLevel / currentArea from saveMeta\n// tryTransition(S.AREA_ENTRY)\n\n// Save & Quit:\n// updateProgress(() => {\n//   store.saveMeta = { level, area, score, timestamp };\n// });\n// tryTransition(S.MENU)
Acceptance: New Game clears the active run save but preserves meta unlocks
Acceptance: Continue starts the saved level/area through AREA_ENTRY
Acceptance: Save & Quit writes saveMeta before returning to MENU
Acceptance: disabled Continue cannot be selected or confirmed
Verification: node --input-type=module -e "import('./petal-panic/js/systems/lifecycle.js').then(m => console.log(typeof m.startGame))"

## MILESTONE: 3 - Level Select and Boss Rush
Pattern: Data-Driven Grid + Locked Card UI
Objective: Add Level Select and Boss Rush screens that show locked/unlocked content with hover-style tooltips on the right side.
Success: Level Select shows 8 zones × 5 stages, Boss Rush shows boss cards, and locked items explain what must be passed before unlocking.
Diagram: graph TD
  A[LEVEL_SELECT] --> B[Zone Grid]
  B --> C[Stage Cards]
  C --> D[Locked Card]
  C --> E[Unlocked Card]
  C --> F[Completed Card]
  G[BOSS_RUSH] --> H[Boss Cards]
  H --> I[Locked Boss]
  H --> J[Unlocked Boss]
  D --> K[Right Side Tooltip]
  I --> K
  J --> L[Boss Name Tooltip]

### TASK: 3.1 - Level select model
Type: feature
What: Add a pure model that turns LEVEL_CONFIGS and progress into 8 selectable levels plus 5 sub-area choices per selected level.
Why: Level Select needs stable data for the world map markers, sub-area chips under the selected level, locking, completion, and starting the correct level/zone.
Files: + petal-panic/js/ui/levelSelectModel.js
Snippet: export function buildLevelMap(progress) {\n  // returns 8 level markers:\n  // [\n  //   {\n  //     level: 1,\n  //     name: 'Big Top',\n  //     status: 'locked' | 'available' | 'completed',\n  //     selected: false,\n  //   }\n  // ]\n}\n\nexport function buildSubAreasForLevel(level, progress) {\n  // returns 5 sub-area choices for the selected level:\n  // [\n  //   {\n  //     level: 1,\n  //     zone: '1',\n  //     label: '1-1',\n  //     boss: false,\n  //     status: 'locked' | 'unlocked' | 'completed',\n  //     tooltip: 'Pass 1-4 to unlock',\n  //     start: { level: 1, area: 1 },\n  //   }\n  // ]\n}
Acceptance: buildLevelMap returns exactly 8 level markers and never includes zone nodes in the map data
Acceptance: buildSubAreasForLevel returns exactly 5 sub-areas: X-1, X-2, X-3, X-4, X-B for the selected level
Acceptance: a sub-area is locked when its previous sub-area is not completed
Acceptance: the first sub-area of level 1 is unlocked by default
Verification: node --input-type=module -e "import('./petal-panic/js/ui/levelSelectModel.js').then(m => console.log(m.buildLevelSelectCards({ completedAreas: {} }).length))"

### TASK: 3.2 - Level select screen
Type: feature
What: Add the LEVEL_SELECT canvas screen using the existing menu card/focus style and a right-side tooltip panel.
Why: The user specifically wants 8 columns, 5 rows, lock icons, and hover-style text explaining what unlocks each card.
Files: ~ petal-panic/js/ui/screens.js
Snippet: export const LevelSelect = {\n  focus: { level: 1, zone: '1' },\n  draw(ctx) {\n    // left: world map with 8 level markers only\n    // marker status: circle available, gold/star completed, lock locked\n    // selected level: pin above marker\n    // below map: 5 sub-area chips for selected level: X-1..X-4, X-B\n    // right: detail card for focused sub-area with lock hint / play hint\n  },\n  onAction(action) {\n    // up/down: change level\n    // left/right: change zone within selected level\n    // confirm: start focused unlocked zone through AREA_ENTRY\n  },\n  reset() {},\n};
Acceptance: draws 8 columns and 5 rows without overflow at 960x540
Acceptance: locked cards show a lock icon and dimmed content
Acceptance: focused locked card shows 'Pass <previous stage> to unlock' on the right
Acceptance: confirm starts an unlocked stage through AREA_ENTRY
Verification: node --input-type=module -e "import('./petal-panic/js/ui/screens.js').then(m => console.log(typeof m.LevelSelect?.draw))"

### TASK: 3.3 - Boss rush model and screen
Type: feature
What: Add Boss Rush data and a canvas screen showing boss cards with locked silhouettes and right-side unlock/name tooltips.
Why: Boss Rush should hide locked bosses completely while revealing the boss card image and name only after the required level is passed.
Files: + petal-panic/js/ui/bossRushModel.js
Files: ~ petal-panic/js/ui/screens.js
Snippet: export function buildBossRushCards(progress) {\n  // returns:\n  // [\n  //   {\n  //     index: 1,\n  //     bossId: 'tusko_wobble',\n  //     name: 'Tusko Wobble',\n  //     status: 'locked' | 'unlocked',\n  //     tooltip: 'Pass Level 1 to unlock this boss',\n  //     start: { level: 1, area: 5 },\n  //   }\n  // ]\n}\n\nexport const BossRush = {\n  focus: 0,\n  draw(ctx) {},\n  onAction(action) {},\n  reset() {},\n};
Acceptance: returns one card per LEVEL_CONFIGS entry
Acceptance: locked boss cards show no boss image, only a lock icon
Acceptance: focused locked boss shows 'Pass Level X to unlock this boss' on the right
Acceptance: focused unlocked boss shows the boss name and boss card image
Acceptance: confirm starts an unlocked boss through AREA_ENTRY
Verification: node --input-type=module -e "import('./petal-panic/js/ui/bossRushModel.js').then(m => console.log(m.buildBossRushCards({ defeatedBosses: [] }).length))"

## MILESTONE: 4 - Options, Controls, and Pause Integration
Pattern: Shared Overlay + Persistent Settings
Objective: Make Controls and Options reusable from both Main Menu and Pause, and add Save & Quit to Pause.
Success: Pause has Resume, Retry Level, Save & Quit, Controls, and Options; Options persists music/SFX/screen shake; Controls still opens the existing remap screen.
Diagram: graph TD
  A[PAUSE] --> B[Resume]
  A --> C[Retry Level]
  A --> D[Save and Quit]
  A --> E[Controls]
  A --> F[Options]
  G[MENU] --> E
  G --> F
  E --> H[REMAP]
  F --> I[OPTIONS]
  I --> J[progressStore.settings]

### TASK: 4.1 - Options screen and settings wiring
Type: feature
What: Add an OPTIONS screen with Music, SFX, and Screen Shake toggles that persist through progressStore.
Why: The user wants Options in both menu and pause, and the game currently has no persistent options system.
Files: ~ petal-panic/js/ui/screens.js
Snippet: export const Options = {\n  focus: 0,\n  rows() {\n    const s = loadStore().settings;\n    return [\n      { label: 'Music', value: s.music },\n      { label: 'SFX', value: s.sfx },\n      { label: 'Screen Shake', value: s.screenShake },\n      { label: 'Vibration', value: s.vibration },\n    ];\n  },\n  draw(ctx) {},\n  onAction(action, origin) {},\n  reset() {},\n};
Acceptance: OPTIONS draws three toggle rows using the same focus style as Pause
Acceptance: left/right toggles the focused option
Acceptance: changes persist immediately to localStorage
Acceptance: back returns to MENU or PAUSE based on origin
Verification: node --input-type=module -e "import('./petal-panic/js/ui/screens.js').then(m => console.log(typeof m.Options?.draw))"

### TASK: 4.2 - Pause menu Save and Quit integration
Type: feature
What: Update Pause to include Save & Quit, Options, and Controls while preserving Resume and Retry behavior.
Why: The user explicitly wants pause to have save and quit plus options accessible during gameplay.
Files: ~ petal-panic/js/ui/screens.js
Snippet: const options = [\n  'Resume',\n  'Retry Level',\n  'Save & Quit',\n  'Controls',\n  'Options',\n];\n\n// execute:\n// case 2: saveCurrentRun(); tryTransition(S.MENU);\n// case 3: tryTransition(S.REMAP);\n// case 4: tryTransition(S.OPTIONS);
Acceptance: Pause shows five options in the existing centered list style
Acceptance: Save & Quit writes progress/saveMeta and returns to MENU
Acceptance: Controls opens REMAP with parent PAUSE
Acceptance: Options opens OPTIONS with origin PAUSE
Verification: node --input-type=module -e "import('./petal-panic/js/ui/screens.js').then(m => console.log(typeof m.Pause?.draw))"

## MILESTONE: 5 - Media Menu and Unlock Rewards
Pattern: Collection Screen + Progress Gating
Objective: Add a Media screen for intro, level clips, and ending content with locked/unlocked presentation.
Success: Media shows locked cards until the related intro/level/ending milestone is completed, then allows playback of sprite-loop or video placeholders.
Diagram: graph TD
  A[MENU] --> B[MEDIA]
  B --> C[Intro Card]
  B --> D[Level Clip Cards]
  B --> E[Ending Card]
  F[progress.mediaUnlocked] --> C
  F --> D
  F --> E
  C --> G[Locked or Playable]
  D --> G
  E --> G
  G --> H[Playback Overlay]

### TASK: 5.1 - Media unlock model
Type: feature
What: Add a media catalog and unlock rules for intro, per-level clips, and ending.
Why: The Media screen needs one source of truth for what exists, what is locked, and what unlocks it.
Files: + petal-panic/js/ui/mediaModel.js
Snippet: export function buildMediaCards(progress) {\n  // returns:\n  // [\n  //   {\n  //     id: 'intro',\n  //     title: 'Intro',\n  //     status: 'locked' | 'unlocked',\n  //     tooltip: 'Start a new game to unlock',\n  //     kind: 'sprite-loop' | 'video',\n  //     asset: null,\n  //   },\n  //   {\n  //     id: 'level-1',\n  //     title: 'Big Top Clip',\n  //     status: 'locked' | 'unlocked',\n  //     tooltip: 'Beat Boss 1 to unlock',\n  //   },\n  //   {\n  //     id: 'ending',\n  //     title: 'Ending',\n  //     status: 'locked' | 'unlocked',\n  //     tooltip: 'Beat the final boss to unlock',\n  //   }\n  // ]\n}\n\nexport function markMediaUnlocked(id) {}
Acceptance: returns intro, eight level clips, and ending
Acceptance: intro unlocks after any New Game start
Acceptance: level clip unlocks after the matching boss is defeated
Acceptance: ending unlocks after the final boss is defeated
Verification: node --input-type=module -e "import('./petal-panic/js/ui/mediaModel.js').then(m => console.log(m.buildMediaCards({ mediaUnlocked: [] }).length))"

### TASK: 5.2 - Media screen and playback overlay
Type: feature
What: Add the MEDIA canvas screen with locked cards, right-side tooltips, and a simple playback overlay for unlocked clips.
Why: The user wants media to be part of the menu and to remain locked until the intro/level/ending content is earned.
Files: ~ petal-panic/js/ui/screens.js
Snippet: export const Media = {\n  focus: 0,\n  playing: null,\n  draw(ctx) {\n    // grid of media cards\n    // locked card: dark + lock icon\n    // unlocked card: thumbnail or placeholder\n    // right side tooltip for focused card\n  },\n  onAction(action) {},\n  reset() {},\n};
Acceptance: MEDIA draws all media cards using the same card/focus style as Level Select
Acceptance: locked media shows no preview image and an unlock requirement on the right
Acceptance: unlocked media can open a playback overlay
Acceptance: back closes playback first, then returns to MENU
Verification: node --input-type=module -e "import('./petal-panic/js/ui/screens.js').then(m => console.log(typeof m.Media?.draw))"

### TASK: 5.3 - Progress unlock hooks
Type: feature
What: Hook gameplay milestones into progressStore so level completion, boss defeat, and ending completion unlock Level Select, Boss Rush, and Media.
Why: The menu screens need real unlock state instead of always showing everything as available.
Files: ~ petal-panic/js/systems/lifecycle.js
Files: ~ petal-panic/js/boss/bossFlow.js
Snippet: // On area completion:\n// updateProgress((store) => {\n//   store.completedAreas[areaId] = true;\n// });\n\n// On boss defeat:\n// updateProgress((store) => {\n//   if (!store.defeatedBosses.includes(bossId)) store.defeatedBosses.push(bossId);\n//   markMediaUnlocked(`level-${levelIndex}`);\n// });\n\n// On final boss defeat:\n// markMediaUnlocked('ending');
Acceptance: completing a normal stage records completedAreas
Acceptance: defeating a boss records defeatedBosses
Acceptance: defeating a boss unlocks the matching media clip
Acceptance: defeating the final boss unlocks the ending media card
Verification: node --input-type=module -e "import('./petal-panic/js/systems/lifecycle.js').then(m => console.log(typeof m.showLevelReward))"

---

## AS-BUILT ADDENDUM (2026-10-24, post-completion)

Deviations/additions from execution that override the original spec where they conflict:

1. **Boss Rush post-victory routing (§3.3):** after the normal victory summary (REWARD), the player returns to the BOSS_RUSH screen at the SAME focus position — NO auto-advance, defeated boss starred. Implemented via `_bossRushReturn` flag in lifecycle.js, consumed in rewardOnAction with priority over the final-level END_OF_GAME route. (User decision 2026-10-24.)
2. **Autosave:** saveMeta is written automatically on AREA EXIT (next area as resume point) and on BOSS DEFEAT (next level's area 1), in addition to manual Save & Quit. Continue/hasSave() consume it unchanged.
3. **Content gate:** levels without world content (LEVELS currently defines only Level 1) are visible-but-locked in Level Select / Boss Rush ("No content yet — coming soon") instead of starting Level 1 geometry.
4. **Story mode caveat:** with single-level content, the Level 1 story boss currently routes to END_OF_GAME (final-level check keys off playable LEVELS). Media unlock correctly keys off LEVEL_CONFIGS (8). Corrects itself when levels 2–8 land.

Living source of truth for the shipped flow: `petal-panic/docs/architecture/game-flow.md`.
