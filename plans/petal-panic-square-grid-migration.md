# Petal Panic — Square-grid migration plan

Status: CUT OVER. Data + runtime are on square-grid-v1 (48×48). Docs updated
2026-10-30 (terrain-tiling.md, sprites.md; sprite-engine editor game-unit grid
now 48×48 display-only). Remaining work is the unverified gates below:
vertical-layout conflict review (§3), macro-editor lattice constraints (§4),
traversal/visual verification (§6), and gameplay retuning review.
Date: 2026-10-29 (cutover verified 2026-10-30)
Format: plain Markdown; no plan-generator workflow.

## Goal

Use one 48×48px logical grid everywhere, with explicit object footprints. Align runtime, macro editing, sprite tooling, docs, and plan references. Preserve existing authored block counts during migration rather than truncating them.

## Agreed rules

| Object / variant | Width in cells | Height in cells | Pixel footprint |
| --- | ---: | ---: | --- |
| Block single | 2 | 1 | 96×48 |
| Block double | 2 | 2 | 96×96 |
| Block triple | 2 | 3 | 96×144 |
| Platform single | 1 | 1 | 48×48 |
| Platform double | 2 | 1 | 96×48 |
| Platform triple | 3 | 1 | 144×48 |

- Base unit: X = 48px, Y = 48px.
- Block variants describe HEIGHT, never width. Wide walls repeat 2-cell columns; tall columns decompose into height variants.
- Block horizontal placement/movement snaps to 2-cell steps; widths are positive multiples of 2. Vertical placement and height resizing use 1-cell steps.
- Platform positions and widths use whole cells; platform height remains 1 cell under the existing collision convention.
- Shared sprite scaling uses the authored per-animation collision-box height, with one uniform scalar for source geometry. Props and artwork bounds do not determine scale.
- Art is being revised separately by the user. Do not overwrite sheets or collision boxes to force a fit. Report mismatches against target footprint ratios.
- No migration of exports/XCFs in Downloads is included.

## Migration policy

### Authored macro geometry

Convert old horizontal positions, lengths, widths, and applicable local offsets by ×2. Leave vertical coordinates and dimensions unchanged.

Examples:
- Old 5-column block → 10 new cells → 5 block columns, 480px wide.
- Old 5-unit platform → 10 new cells → platform tiles totaling 10 (e.g. 3+3+3+1), 480px wide.

This deliberately increases migrated horizontal pixel dimensions by 4/3 compared with the old 72px grid. It preserves relative horizontal layout and block counts, not original pixel width. New platform lengths may be odd; migrated integer lengths initially become even.

Classify fields before transformation: do NOT double vertical values, identifiers, counts, durations, RNG seeds, frame indexes, velocities, or already-pixel values. Do not blanket-replace numbers.

### Derived geometry

Recompute screen-fit dimensions from the new grid and existing pixel viewport, rather than applying ×2. For a 960px view, 48px cells give 20 columns, versus 13 whole columns at 72px.

Vertical areas require special handling: doubled authored content may not fit their recomputed screen width. Detect conflicts and prepare explicit layout corrections preserving traversal and block counts. No silent clipping, truncation, or automatic deletion. If corrections require new camera behavior or abandoning fixed-screen width, stop for approval.

### Physics and gameplay

Do not double stats automatically. Inventory unit-to-pixel conversions and distinguish layout units from gameplay measurements. Record before/after movement speeds and jump reach; preserve current pixel-space movement where feasible unless an explicit gameplay change is approved. Wider migrated gaps can require layout retuning even when movement is preserved.

## 1. Audit and baseline

- [ ] Confirm a clean starting point or identify unrelated changes to leave alone.
- [ ] Inventory all consumers of X/Y units, duplicated 72/48 constants, and hard-coded derived dimensions.
- [ ] Read current runtime and editor implementations; do not assume earlier session claims describe current code.
- [ ] Inventory saved macro formats, built-in definitions, generators, defaults, import/export paths, and all horizontal coordinate/offset fields.
- [ ] Establish whether block snap coordinates are local to a macro, area, or global world; ensure composition origins respect the agreed 2-cell lattice.
- [ ] Record baseline relevant test results and representative horizontal/vertical/boss screenshots and geometry.
- [ ] Produce a field conversion table: authored X ×2 / unchanged Y / derived recompute / gameplay review / pixel-space unchanged.

Known entry points to inspect:
- `petal-panic/js/consts.js`
- `petal-panic/js/world/macros.js`
- `petal-panic/js/world/terrainTiles.js`
- `petal-panic/js/world/` and `petal-panic/macros/`
- `petal-panic/macro-editor/js/`
- `.squid-os/skills/sprite-engine/scripts/editor/js/`

### Slice 1 progress (2026-10-29) — central target contract landed

Done (foundation only; migration NOT started):
- New module `petal-panic/js/world/squareGrid.js` — pure, zero runtime imports. Exports the 48×48 base grid, block footprint (width 2, height variants 1/2/3, x-snap 2), platform footprint (height 1, width variants 1/2/3, x-snap 1), cell↔px conversion, placement/dimension validation, snapping (`snapCell`/`snapPx`), variant decomposition (`decomposeVariant`, `blockColumns`), and pure migrator helpers (`migrateLegacyXUnits` ×2, `screenFitColumns` recompute). Module header explicitly marks it as the **target contract awaiting versioned migration** and forbids importing it from runtime/editor until §3 lands.
- New tests `petal-panic/js/test/squareGrid.test.js` — 18 tests, all passing (`node --test`). Regression check: `terrainTiles.test.js` still 9/9 pass; no runtime files touched.

Audit notes gathered for this slice (consumers inspected just enough to inform scope; SUPERSEDED values corrected 2026-10-30 — read current code, not these historical claims):
- `consts.js` is the single unit-conversion point: **currently `UNIT_PX_X = UNIT_PX_Y = 48` (square grid, cutover done)**; historically it was `UNIT_PX_X = 72`, `UNIT_PX_Y = 48`. `macros.js` re-exports both plus deprecated `UNIT_PX` alias. ~15 non-test files import `UNIT_PX_X`. NOTE: `72*old ≠ 48*2*old` — the old X-unit (72px) does NOT equal two new cells (96px); migrated horizontal pixel dimensions grow by 4/3, they are not preserved.
- `terrainTiles.js` already decomposes widths longest-first `[3,2,1]` and stacks block heights bottom-up with per-row natural 48px height — its tiling logic is shape-compatible with the target contract; only the unit constants (72→48 X) and variant semantics (block width fixed 2, height varies) need rewiring in §5.
- Saved macros (`petal-panic/macros/levels/*.json`) store integer unit fields (`x`, `width`, `y`, `height`). **The current version marker is REQUIRED at runtime:** root-level `schemaVersion` must be `"square-grid-v1"` (macroSchema.js + macro.schema.json both reject missing/wrong markers). Legacy v0 = marker absent; any other value is rejected. Migration is OFFLINE ONLY via `tools/migrate_square_grid.mjs --apply` — the runtime loads no migrator and never silently reinterprets legacy units.
- No existing snap-to-lattice helper exists in `js/world/` (only surface-snapping in build.js); `squareGrid.snapCell/snapPx` fills that gap for §4 editors/validators.

### Slice 3 progress (2026-10-29) — offline authored-macro migration tool (TASK 1)

Done:
- New tool `petal-panic/tools/migrate_square_grid.mjs` — pure/offline, dry-run by default, explicit `--apply`. Field map (documented in the tool header and tested): `units[].x` ×2, `units[].width` ×2 (blocks AND platforms), `placements[].x` ×2; `units[].y`, `units[].height`, `placements[].y` unchanged; ids/names/orientation/difficulty/follows/followedBy/variations/clearance untouched. No blanket number replacement; non-integer horizontal values throw.
- Version marker chosen from the actual format: macros currently carry NO version field (verified across all 19 files + `macro.schema.json`). Marker = root-level `schemaVersion`; absent → legacy v0 (migratable), `"square-grid-v1"` → current (skipped, idempotent), any other value → rejected with an error.
- Reports: block lattice (post-migration block x even / width positive multiple of 2 — enforced as validation errors), bounds overflow vs screen-fit columns (default 20 = 960px @ 48px; warnings, not blockers), unknown unit kinds and unsupported shapes rejected rather than guessed. Nested offsets: none exist in the real schema (flat x/y/width/height only); transform is written generically over `{kind,x,width}` / `{slot,type,x,y}` objects so nested occurrences would be handled, but no invented semantics.
- Focused tests `petal-panic/js/test/migrateSquareGrid.test.js` — 8/8 pass (`node --test`): real-schema fixture round-trip, Y/non-geometry invariance, idempotence, unknown-version rejection, lattice/integer errors, overflow warning, unsupported-shape rejection.
- Dry run against all 19 real files: 0 failures, many expected overflow warnings (authored content wider than one 960px screen — plan §"Derived geometry" says this requires explicit layout correction, NOT silent clipping). **No repository data was modified** (dry-run only; `git status` on `macros/` clean). Runtime grid NOT switched; no runtime legacy fallback added.

Test command: `node --test petal-panic/js/test/migrateSquareGrid.test.js` → 8 pass / 0 fail.
Dry-run command: `node petal-panic/tools/migrate_square_grid.mjs` → 19 files scanned, 0 failures.

Next-task handoff (plan §3 remainder):
1. Decide how to handle the widespread post-migration overflow (areas are scrollable? recompute per-area fit instead of a single 20-column constant?) — needs approval before `--apply`.
2. Once approved: run `--apply`, then add `schemaVersion` to `macro.schema.json` (optional property, enum) and to `macroSchema.js` validator so runtime rejects un-migrated legacy files (import handling, never silent reinterpretation).
3. Then proceed to plan §4 (editor lattice constraints) and §5 (terrain rewiring of UNIT_PX_X 72→48) — deliberately out of scope for TASK 1.

### Slice 2 progress (2026-10-29) — shared footprint contract wired into the live terrain pipeline

Done (production decomposition logic only; base grid still legacy 72/48, migration NOT started):
- `squareGrid.js` is now the **single shared footprint/decomposition contract** consumed by the live terrain pipeline. It exports `BLOCK_FOOTPRINT` / `PLATFORM_FOOTPRINT`, `getFootprint`, `decomposeVariant(kind, cells)` (blocks → height variants [3,2,1]; platforms → width variants [3,2,1], longest-first), and `blockColumns`. Header documents the agreed variant semantics and explicitly marks the 48×48 authored-macro conversion (§3) as STILL PENDING.
- `terrainTiles.tileSolid()` now routes block heights and platform widths through `decomposeVariant` instead of its own copy. The duplicate `decompose()` helper and the local `WIDTH_VARIANTS = [3,2,1]` constant were deleted. Behavior is identical for the current coordinate representation (both axes used the same longest-first split); no units, art, collision boxes, physics, or layouts changed.
- Removed speculative unused target helpers from `squareGrid.js`: `migrateLegacyXUnits`, `screenFitColumns` (the §3 migrator is not landed yet — reintroduce when it is), plus dead cell↔px conversion (`cellsToPx`/`pxToCells`/`footprintPx`) and editor-only validation/snap helpers (`validateBlockCells`/`validatePlatformCells`/`validatePlacement`/`snapCell`/`snapPx`) that no runtime code consumes. No backward-compat branches or fallbacks remain.
- Tests adapted: `squareGrid.test.js` now covers the consolidated contract (footprints, kind-correct `decomposeVariant`, `blockColumns`); `terrainTiles.test.js` decomposition cases route through `squareGrid.decomposeVariant`. Full suite: 101/108 pass — the 7 failures (bombGameplay, bossRushScreen, menuRunFlow, pickerRide, spriteData, spriteSetAnim, takeoffPicker) are pre-existing on the clean tree, unrelated to this slice.

NOT done / still pending: converting the live base grid to 48×48 and migrating authored macro data (plan §3) — deliberately deferred so old block counts are never prematurely interpreted as new cell counts. Square-grid migration is therefore NOT complete.


## 2. Centralize grid and footprint rules

- [x] Make 48×48 the authoritative base grid; eliminate divergent editor fallbacks/constants. *(consts.js UNIT_PX_X = UNIT_PX_Y = 48; macro-editor state.js in lockstep)*
- [ ] Represent block width/snap step (2), platform width/snap step (1), and variant dimensions as shared configuration, not scattered conditionals.
- [ ] Separate base grid spacing from object footprint constraints and sprite source-pixel coordinates.
- [ ] Recompute area widths, composition lengths, boss approaches, screen-fit counts, bounds, and exit offsets according to the audit table.
- [ ] Review physics/stat conversions and reachability calculations; fix ambiguity instead of mechanically replacing 72 with 48.

Acceptance: runtime and both editors agree on units; derived screen widths are consistent; no object-specific scaling hacks.

## 3. Versioned macro migration

- [x] Choose and document a schema/unit version marker after inspecting existing schema conventions. *(root `schemaVersion`; absent = legacy v0, `"square-grid-v1"` = current — see Slice 3)*
- [x] Implement a dry-run conversion report before allowing file writes. *(tools/migrate_square_grid.mjs, dry-run default, explicit --apply; all 19 real files scanned clean)*
- [x] Convert all applicable authored horizontal fields ×2, including nested/local offsets and placement anchors; leave vertical data unchanged. *(APPLIED — all 19 macros/levels files carry schemaVersion "square-grid-v1"; migrator dry-run reports 19/19 SKIP idempotent)*
- [x] Migrate built-in definitions and saved macros consistently; prevent generated data from being doubled a second time. *(idempotent marker gate verified: re-run skips all 19 files)*
- [x] Make conversion idempotent: current-version files are skipped; unknown versions are rejected with a useful error. *(tested)*
- [x] Define import handling for legacy files; never silently interpret old units as new ones. *(runtime REQUIRES schemaVersion "square-grid-v1" at load — macroSchema.js + macro.schema.json both reject missing/wrong markers; NO inline migrator is loaded at runtime, migration is offline-only via tools/migrate_square_grid.mjs --apply)*
- [x] Report odd/fractional block positions, invalid widths, boundary conflicts, and vertical-area overflow. *(lattice/width errors + screen-fit overflow warnings in the dry-run report; fractional x throws)*
- [ ] Review and resolve vertical-layout conflicts explicitly before considering migration complete.

Acceptance: five old block columns remain five new block columns; migrated platform span preserves its relationship to migrated blocks; a second migration makes no changes.

## 4. Macro editing and runtime validation

- [ ] Blocks: creating/painting, dragging, numeric X edits, duplication, paste, and horizontal keyboard movement honor the 2-cell lattice.
- [ ] Blocks: resize handles and numeric widths allow only 2,4,6… cells; anchor behavior remains predictable when resizing from either side.
- [ ] Blocks: vertical position/size remain integer cells, minimum height 1.
- [ ] Platforms: horizontal position and length remain 1-cell granular, minimum width 1.
- [ ] Apply equivalent validation to imported macros, generators, and runtime construction—not just mouse interaction.
- [ ] Update grid labels, previews, collision overlays, validation messages, and reachability feedback.
- [ ] Verify undo/redo and serialization preserve valid geometry.

Acceptance: no path bypasses block width/snap rules; platform editing still supports odd widths.

## 5. Terrain and sprite integration

- [ ] Blocks: decompose HEIGHT into single/double/triple; repeat 2-cell columns horizontally.
- [ ] Platforms: decompose WIDTH into 1/2/3-cell variants.
- [ ] Route rendering through the shared sprite transform contract. Remove any remaining independent X/Y stretching or frame-bounds scaling for terrain.
- [ ] Keep stable per-tile seeded frame selection; avoid rebuilding drawable pools each render solely due to array identity changes.
- [ ] Verify authored frame offsets, collision-box placement, and anchor mapping—not just scalar height calculations.
- [ ] Validate source collision-box ratios against configured footprints and report incompatible art without changing it.
- [ ] Keep floor/fg repeat behavior independent of block variant selection; regression-test floor, barrels, and checkpoints.
- [ ] Sprite editor: align game-unit displays with 48×48 while retaining its source-pixel authoring grid and existing authored geometry.

Acceptance: block double/triple are taller, not wider; platform double/triple are wider, not taller; art and collision transforms remain aligned.

## 6. Level composition and traversal verification

- [ ] Audit horizontal area length, zone stitching, boss approaches, exits, and entrances.
- [ ] Audit vertical-area width, side boundaries, reachable platforms, and available columns.
- [ ] Update camera bounds, spawn/checkpoint placement, enemy/object offsets, and transition trigger geometry where affected.
- [ ] Check gaps, jump arcs, headroom, reachable landings, and collision seams for both heroes.
- [ ] Check deterministic generation and death/Continue/restart behavior.
- [ ] Surface required gameplay retuning separately; do not hide it in a constant migration.

## 7. Documentation and plan references

- [x] Update `petal-panic/docs/architecture/terrain-tiling.md` with separate block-height/platform-width rules and correct examples. *(2026-10-30: rewritten for the square 48×48 grid — blocks fixed 2-cell width, height variants 1/2/3 stacked bottom-up; platforms fixed 1-cell height, width variants 1/2/3 tiled left-to-right; both via shared `squareGrid.decomposeVariant`; uniform collision-height scalar noted)*
- [x] Update `petal-panic/docs/architecture/sprites.md` and affected unit, macro, world, editor, and level documentation. *(2026-10-30: sprites.md §1/§4 now state the square 48×48 cell, 2-cell block / 1-cell platform snap lattice, and the uniform collision-height scalar. Other docs not yet swept — see next box)*
- [ ] Search project docs and `.squid-os/plans/` for obsolete 72×48 assumptions and incorrect block width-variant statements. *(partially done 2026-10-30: sprite-engine editor `state.js` game-unit display constants corrected 72→48 (display-only, source-pixel authoring untouched); full sweep of remaining docs/plans still open)*
- [ ] Update active plan requirements/references; annotate historical completed plans with supersession/migration notes instead of rewriting history.
- [ ] Document authored migration versus derived-dimension recomputation, new version marker, and art-readiness caveats.

## 8. Tests and completion gate

- [ ] Unit tests: square grid, footprint dimensions, snapping, variant selection, and derived widths.
- [ ] Migration fixtures: nested offsets, platforms, blocks, unchanged vertical values, version/idempotence, and overflow reporting. *(landed in `js/test/migrateSquareGrid.test.js` — 8/8 pass; "nested offsets" covered generically since the real schema has none)*
- [ ] Editor tests: paint/place/drag/resize/numeric edits/paste/undo/import/export.
- [ ] Integration tests: world composition, vertical layouts, transitions, camera bounds, and reachability.
- [ ] Visual review with collision overlays: representative horizontal, vertical, and boss areas plus all terrain variants.
- [ ] Compare against baseline failures; distinguish pre-existing failures from regressions.
- [ ] Review diff and provide remaining art/layout issues. Do not claim full visual completion while known incompatible art remains.

## Suggested commit boundaries

1. Shared unit/footprint configuration and rule documentation.
2. Versioned migrator and migration fixtures.
3. Migrated definitions/data and approved layout corrections.
4. Editor constraints and runtime validators.
5. Terrain rendering integration and regressions.
6. Remaining documentation/plan-reference updates and verification.

Commit only when explicitly requested. This plan does not authorize implementation or commits by itself.
