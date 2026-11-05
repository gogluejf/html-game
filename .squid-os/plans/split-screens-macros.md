# Plan: Split screens.js + world/macros.js

Pure file-split refactor. Zero behavior change. Every step is cut/paste + re-export shim; existing imports keep working via the shims. One commit per step (only on explicit user instruction).

## Rules
- No logic edits during a move — if a fix seems needed, stop and flag it.
- After each step: `node --test` on affected test files must match the pre-move pass/fail set exactly (5 known pre-existing failures in js/test/attack/ are unrelated noise).
- Update import paths only where the shim approach isn't used.
- Grep-verify after each move: no dangling references to moved symbols.

## Part A — `js/ui/screens.js` (2606) → `js/ui/screens/`

Shared helpers first (everything else depends on them):

1. `screens/shared.js` — drawHubBackground, fillFullSurface, drawHomeScenery, image cache + loadImages/imagesReady, drawFitted, drawPlaceholder, drawOptionList, setMenuHero/getMenuHero, canContinue, drawLockIcon, drawBossCardCover + bossCardImages, drawFittingText, oneWayPan
2. `screens/home.js` — Home
3. `screens/select.js` — Select
4. `screens/menu.js` — Menu
5. `screens/levelSelect.js` — LevelSelect
6. `screens/bossRush.js` — BossRush
7. `screens/media.js` — Media + mediaClipImages
8. `screens/options.js` — Options
9. `screens/pause.js` — Pause
10. `screens/index.js` — re-export all public symbols; `js/ui/screens.js` becomes a one-line `export * from './screens/index.js'` shim (or delete + update the ~few importer files directly — decide at step 10 by counting importers)

Verify: game boots, every screen reachable (home → menu → select → level select → boss rush → media → options → pause).

## Part B — `js/world/macros.js` (2533) → `js/world/`

Order matters: leaves first (nothing below imports from above).

1. `world/unitMath.js` — UNIT_PX_X/Y/PX, clearance constants (H/V_ENTRY/EXIT_CLEAR, ENTRY/EXIT_CLEAR), zone length/height/width units, BOSS_* units, TOP_CLEARANCE, HORIZONTAL_* units, minHeroGapClearPx, doubleJumpReachForStats, minHeroDoubleJumpHorizontalReachPx, superAssistReachForStats, minHeroSuperAssistReachPx, MAX_CLEARABLE_GAP, ZONE_WIDTH_UNITS, MAX_ELEVATION_STEP, macroElevationGain
2. `world/macroCatalog.js` — B(), P(), PLATFORM_UNIT_H, PLATFORM_DRAW_H, MACROS + setMacros, STAGE_WEIGHTS, STAGE_DIFFICULTY, selectMacros, macroWidth, macroAxisLength, macroDensity, layoutDensity (imports unitMath)
3. `world/barrels.js` — BARREL_STRUCTURE, BARREL_PX, BARREL_EXPLOSION_RADIUS_PX, BARREL_CHAIN_MAX_UNITS, classifyBarrelStructure, formsChain, barrelStructures, slotIsOnValidSurface (imports unitMath + barrel def)
4. `world/traversal.js` — bfsReachableSpans, traversalRoute, findPathBetween, validateLayout (imports unitMath + macroCatalog)
5. `world/compose.js` — populateArea, populationSnapshot, composeArea, composeAreaSeeded (imports everything above)
6. `js/world/macros.js` → thin re-export shim (`export * from` each of the five) so all existing importers keep working untouched

Verify: level generation still passes `js/test/macros.test.js` + lifecycle tests identically to pre-move; play levels 1–2 + a vertical zone.

## Risks / watch-outs
- Circular imports: screens share helpers one-way (shared ← screens) — safe. World side: compose → traversal/catalog/barrels → unitMath — strict DAG, safe. Confirm with a grep for cross-imports before each cut.
- `export let MACROS` is mutable state (setMacros) — the shim must re-export the live binding, not a copy. `export { MACROS } from './macroCatalog.js'` preserves this.
- Test files importing deep symbols (`js/test/macros.test.js`) — check their import specifiers at step B6 and point them at the new files or leave them on the shim.
- Do Parts A and B as separate commits; do NOT mix.
