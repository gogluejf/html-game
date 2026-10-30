# Square-Grid Cutover Audit — Migrator Field Coverage & Dependency Map

Date: 2026-07-10 (autonomous session)
Scope: verify `petal-panic/tools/migrate_square_grid.mjs` field coverage against the
real saved-macro schema, and map every file/function that must change in a
coordinated 48px cutover. **No apply, no runtime switch, no commit** — this task
is audit + verification only.

## 1. Verdict: migrator is CORRECT as-is — no fix required

Verification evidence (all run this session):

| Check | Result |
|---|---|
| `node --test petal-panic/js/test/migrateSquareGrid.test.js` | 9/9 pass |
| `node tools/migrate_square_grid.mjs` (dry-run, default dir) | 19/19 files OK, 0 failures |
| Files already carrying `schemaVersion` | 0 (all legacy v0 → migratable) |
| Top-level key set across all 19 macros | exactly `{id,name,orientation,difficulty,units,placements,variations,follows,followedBy[,clearance]}` — matches `macro.schema.json` (`additionalProperties: false`) |
| Nested offset/anchor fields in any macro | none exist (flat x/y/width/height only) |
| Default fixed-width constraint in migrator | **none** — overflow warnings only when caller passes explicit `--fit-columns N` ✔ |

### Field-by-field coverage vs `macros/macro.schema.json`

Schema geometry fields and the migrator's treatment of each:

| Schema field | Constraint in schema | Migrator behavior | Status |
|---|---|---|---|
| `units[].x` (block & platform) | integer ≥ 0 | ×2, strict integer check (`doubleX`) | ✔ |
| `units[].width` (block & platform) | integer ≥ 1 | ×2, strict integer check | ✔ |
| `units[].y` | block: int ≥ 0; platform: int ≥ 1 | unchanged, validated integer ≥ 0 | ✔ |
| `units[].height` (block only) | integer ≥ 1 | unchanged (copied verbatim) | ✔ |
| `placements[].x` | integer ≥ 0 | ×2, strict integer check | ✔ |
| `placements[].y` | integer ≥ 0 | unchanged, validated | ✔ |
| `placements[].slot`, `.type` | string / enum | untouched (generic copy) | ✔ |
| `kind` | const `block` \| `platform` | unknown kind → ERROR (rejected, never guessed) | ✔ |
| `id`,`name`,`orientation`,`difficulty`,`variations`,`follows`,`followedBy`,`clearance` | non-geometry | copied verbatim, order-preserving | ✔ |
| `schemaVersion` | not in current schema (marker added by migration) | absent → migrate; `"square-grid-v1"` → skip (idempotent); anything else → throw | ✔ |

Notes on correctness details:

- **Platform `height`**: schema allows platforms to have *no* `height`. The
  migrator emits `height: undefined` for platforms, which serializes away in
  JSON — output stays schema-valid. Tests assert this explicitly.
- **Block lattice rule** (agreed rules, `js/world/squareGrid.js`): post-migration
  block `x` must be even and `width` a positive multiple of 2. Since every input
  is an integer and is doubled, post-migration values are *always* even — the
  lattice checks therefore only fire on pathological inputs (non-integers are
  rejected earlier by `doubleX`). This is correct: legacy odd block coordinates
  were legal under the old 72px grid but become lattice errors after ×2… and in
  practice ×2 makes them even again, so **no real macro fails the lattice check**.
  Confirmed by the clean 19/19 dry-run.
- **Unsupported shapes**: unknown unit kinds, non-object units/placements,
  non-integer x/width → hard error or thrown `MigrationError`. Nothing is
  invented. ✔
- **Bounds**: no default 20-column assumption anywhere; horizontal areas scroll.
  `fitColumns` is purely opt-in. ✔

## 2. Cutover dependency map — coordinated 48px change

Target state: one square cell = 48×48 px everywhere. Macro data migrated via
`migrate_square_grid.mjs --apply` (×2 on horizontal fields). After cutover,
legacy units × UNIT_PX_X(72) == new cells × 48, so pixel geometry is preserved.

### A. Runtime generators (pixel math)

| File | Function / site | What changes at cutover |
|---|---|---|
| `petal-panic/js/consts.js` | `UNIT_PX_X = 72` (line 37), `UNIT_PX_Y = 48` (line 38) | `UNIT_PX_X` → **48**. Single source of truth; everything below inherits it. |
| `petal-panic/js/world/macros.js` | re-export of `UNIT_PX_X/Y` (lines 110–116); `VERTICAL_ZONE_WIDTH_UNITS = floor(VIEW_W/UNIT_PX_X)` (line 130); `HORIZONTAL_ZONE_HEIGHT_UNITS` (line 146); hero speed/jump conversions (lines 164–165) | Inherits 48 automatically. Zone width in units grows from ~11 to ~16 columns — verify camera/view assumptions downstream. `UNIT_PX` alias (= Y) unaffected. |
| `petal-panic/js/world/build.js` | `unitAabbToPx` / placement→px converters (lines 35–76): `b.x + u.aabb.x * UNIT_PX_X`, `slotX()`, half-cell centering `(UNIT_PX_X - itemW)/2` | Inherits 48. No code edit needed if consts change — but these are the exact functions whose *inputs* become migrated cell counts. |
| `petal-panic/js/world/macros.js` | layout validation using `u.x + u.width` spans (lines ~640, ~974, ~1421) and barrel-spacing heuristics (~812–830) | Unit-space math — invariant under cutover (counts double, px/unit halves). Re-run `validateLayout` suite. |
| `petal-panic/js/world/terrainTiles.js` | live tiling pipeline consuming `squareGrid.js` footprints | Consumes the TARGET contract already; after data migration its decomposition inputs finally match. No edit expected — verify with tile tests. |
| `petal-panic/js/world/squareGrid.js` | pure footprint/variant math (`BLOCK_FOOTPRINT`, `PLATFORM_FOOTPRINT`) | **No change.** Already encodes the target contract; header comment ("STILL PENDING") should be updated when cutover lands. |
| `petal-panic/js/world/macroLoader.js` | `loadMacrosFromDisk` / fetch path (lines 28–95) | **Must route imports through the offline migrator** (or require pre-migrated files). There is NO runtime legacy fallback by design — loader currently parses JSON straight into the runtime shape. Decision point for cutover PR: inline `migrateMacro()` call on load vs. committed migrated files. |
| `petal-panic/js/world/macroSchema.js` | `macroSchemaErrors()` (line 21) | Add optional `schemaVersion` to the JSON schema (`macro.schema.json`: allow `"square-grid-v1"`) so migrated files validate; tighten lattice constraints (block x even, width % 2 == 0) if we want schema-enforced footprints. |

### B. Editor

| File | Site | What changes at cutover |
|---|---|---|
| `petal-panic/macro-editor/js/state.js` | hardcoded `UNIT_PX_X = 72` (line 8), `UNIT_PX_Y = 48` (line 9) — "source of truth: world/macros.js" but duplicated | `UNIT_PX_X` → **48**. This duplicate is the classic cutover trap; keep in lockstep with `consts.js`. |
| `petal-panic/macro-editor/js/loader.js` | `unitPxX: CONSTS.UNIT_PX_X` fallback chain (lines 15–25) | Inherits once both sources move; test editor render at 48. |
| `petal-panic/macro-editor/js/draw.js`, `pointer.js`, `ghost.js`, `save.js` | drawing/snapping/ghost clearance use the loaded `unitPxX` | Inherit; ghost-clearance signatures will change for existing content (expected — clearance is recomputed on content change per schema). |

### C. Schema / tooling

| File | Change |
|---|---|
| `petal-panic/macros/macro.schema.json` | add `schemaVersion` property (`const: "square-grid-v1"`, optional); optionally encode lattice constraints in `$defs/block`. |
| `petal-panic/tools/migrate_square_grid.mjs` | **No change needed.** Field map verified complete; idempotent; rejects unknown versions/shapes; no default width constraint. Run `--apply` as the cutover step itself. |
| `petal-panic/js/test/migrateSquareGrid.test.js` | green as-is; add a fixture with `clearance` present (only real-file variant not covered by fixtures) if desired. |
| `petal-panic/js/test/macros.test.js`, `levelConfigs.test.js`, `populate.test.js` | re-run after cutover; they exercise the unit→px pipeline with legacy fixtures — fixtures may need migrating copies. |

### D. Migration execution order (for the future cutover PR — NOT done here)

1. `node tools/migrate_square_grid.mjs --apply` over `macros/levels/` (19 files; dry-run verified clean).
2. Flip `UNIT_PX_X` in `js/consts.js` **and** `macro-editor/js/state.js` together (single commit).
3. Extend `macro.schema.json` with the `schemaVersion` marker + lattice constraints.
4. Decide loader strategy (inline migrate-on-load vs. committed migrated files) and implement in `macroLoader.js`.
5. Update `squareGrid.js` status header; re-run full test suite incl. editor tests.

## 3. Explicit non-goals honored

- No `--apply` run; all 19 macro files remain legacy v0 on disk.
- No runtime switch, no `UNIT_PX_X` change, no loader change.
- No git commit/push/stash/reset.
