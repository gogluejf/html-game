# EPIC: Placeholder Typed Spawn
Why: Barrel/enemy/powerup spawning is quota-based (stageBudgets per type) but the user wants the macro placeholder to be the source of truth: each placement declares 'random' or a specific type id from its family registry, and the composer spawns exactly that. Quotas are deleted.
Outcomes: Deterministic typed spawn from macro data / dynamic type lists from object registries (no hardcoded editor values) / macro editor click-cycles random->types / all existing macros migrated to random / quota machinery removed

## MILESTONE: 1 - Object Type Registries
Pattern: Registry / Single Source of Truth
Objective: Each object family (barrel, enemy, powerup) exposes an ordered [{id,label}] list + lookup helpers so editor and composer derive type options dynamically.
Success: BARREL_TYPES, ENEMY_TYPES({id,label}), POWERUP_ROLL_TYPES all importable without circular-import TDZ; labels available for UI.
Diagram: graph LR
  A[object.js BARREL_TYPES] --> C[composer]
  B[build.js ENEMY_TYPES] --> C
  D[powerup.js POWERUP_ROLL_TYPES] --> C
  A --> E[macro editor]
  B --> E
  D --> E

### TASK: 1.1 - Barrel registry
Type: refactor
What: Add BARREL_TYPES ordered [{id,label}] list plus barrelById/isBarrelType to objects/object.js. Ids match BARREL_FACTORIES keys in world/build.js (wood/explosive/coin).
Why: Barrels have no factory list today; the editor and schema need a dynamic source of barrel types.
Files: ~ petal-panic/js/objects/object.js
Snippet: // ids must match BARREL_FACTORIES keys in world/build.js\nexport const BARREL_TYPES = [\n  { id: 'wood', label: 'Wood' },\n  { id: 'explosive', label: 'Explosive' },\n  { id: 'coin', label: 'Coin' },\n];\nexport const barrelById = ...;\nexport function isBarrelType(id) {...}
Acceptance: importing object.js standalone succeeds (no TDZ)
Acceptance: BARREL_TYPES has exactly wood/explosive/coin with labels
Verification: node --input-type=module -e "import('./petal-panic/js/objects/object.js').then(m=>console.log(m.BARREL_TYPES.length))"

### TASK: 1.2 - Enemy registry with labels
Type: refactor
What: Rework ENEMY_FACTORIES in world/build.js so each entry carries a display label; export ENEMY_TYPES as ordered [{id,label}] plus enemyById/isEnemyType and ENEMY_TYPE_IDS for enum pickers. stats.js keeps its local ENEMY_KEYS (no import from build.js — circular).
Why: Enemies already have a factory map but no labels; the editor tooltip/cycle needs them, and stats must not create an import cycle.
Files: ~ petal-panic/js/world/build.js
Files: ~ petal-panic/js/stats.js
Files: ~ petal-panic/js/debug/attack-theater.js
Snippet: // ENEMY_FACTORIES entries become { label, make(x,y) }\nexport const ENEMY_TYPES = Object.entries(ENEMY_FACTORIES).map(([id,m]) => ({ id, label: m.label }));\nexport const ENEMY_TYPE_IDS = ENEMY_TYPES.map(t => t.id);
Acceptance: importing build.js standalone succeeds
Acceptance: makeEnemy still works via f.make(x,y)
Acceptance: stats.js loads without importing build.js
Verification: node --input-type=module -e "import('./petal-panic/js/world/build.js').then(m=>console.log(m.ENEMY_TYPES.length))"

### TASK: 1.3 - Placement value validation
Type: feature
What: Add optional 'value' to validatePlacement in world/macroSchema.js: non-empty string; if not 'random' it must be a valid id for the placement's family (barrel/enemy/powerup registries). Document it in macros/macro.schema.json.
Why: The composer will spawn exactly what the placeholder declares, so invalid data must fail at load time, never default silently.
Files: ~ petal-panic/js/world/macroSchema.js
Files: ~ petal-panic/macros/macro.schema.json
Snippet: // allowed keys gain 'value' (optional - legacy placements have none)\n// value === 'random'  -> ok\n// else check family registry, error names bad value + family
Acceptance: placement without value still validates (backwards compatible)
Acceptance: value random valid for all three families
Acceptance: valid id per family passes; bogus id fails with named error
Acceptance: wrong-family id (e.g. barrel=jester) fails
Verification: node --test petal-panic/js/test/

## MILESTONE: 2 - Composer Typed Spawn
Pattern: Declarative Population
Objective: populateArea spawns one entity per placement using its declared value (random rolls from the family list); quota assignment logic is deleted.
Success: Every placement in a macro produces exactly one spawned entity of the declared or rolled type; no budget under/over-placement remains possible.
Diagram: graph LR
  A[placement slot] --> B{value}
  B -->|random| C[rng.pick family list]
  B -->|specific id| D[use as-is]
  C --> E[spawn via factory]
  D --> E

### TASK: 2.1 - Spawn from placeholder value
Type: feature
What: Rewrite populateArea in world/macros.js: every layout placement spawns directly; value 'random' rolls rng.pick over the family registry ids, specific values pass through. Delete chooseSlots/assignBarrelTypes/assignEnemyTypes/assignPowerupTypes quota logic. Keep solid-block guard and structure classification.
Why: The placeholder becomes the single source of truth for what spawns; quotas are gone by design.
Files: ~ petal-panic/js/world/macros.js
Snippet: // per placement:\n// const ids = FAMILY_IDS[slot.type];            // from registries\n// const type = slot.value === 'random' ? rng.pick(ids) : slot.value;\n// placements.push({ ...slot, type });
Acceptance: specific value spawns that exact type
Acceptance: random always yields an id from the correct family list
Acceptance: same seed + same macros produce identical populations (determinism preserved)
Acceptance: budgets report shape retained (requested == placed == slot count)
Verification: node --test petal-panic/js/test/

### TASK: 2.2 - Delete budget machinery
Type: refactor
What: Remove stageBudgets generation (tension/stageMult/barrelMults blocks), hand-tuned per-stage barrels/enemies/powerups maps, getStageBudget and all its call sites (world/build.js, world/accessors.js if any) from world/levelConfigs.js. Update or delete the test assertions that exercise budgets (tuning.test.js, levelFlow.test.js, levelConfigs.test.js).
Why: With typed placeholders the per-type quantity budget is obsolete; leaving it invites drift.
Files: ~ petal-panic/js/world/levelConfigs.js
Files: ~ petal-panic/js/world/build.js
Files: ~ petal-panic/js/test/tuning.test.js
Files: ~ petal-panic/js/test/levelFlow.test.js
Files: ~ petal-panic/js/test/levelConfigs.test.js
Acceptance: grep for stageBudget/getStageBudget/barrelScale/barrelMults returns nothing in petal-panic/js
Acceptance: full test suite shows zero new failures vs baseline
Verification: grep -rn 'stageBudget\|getStageBudget\|barrelScale\|barrelMults' petal-panic/js/
Verification: node --test petal-panic/js/test/

## MILESTONE: 3 - Macro Migration
Pattern: Bulk Data Migration
Objective: All existing macro files get value: random on every barrel/enemy/powerup placement — clean data, no fallbacks in code.
Success: Every placement in petal-panic/macros carries an explicit value; all macros still pass schema validation.
Diagram: graph LR
  A[18 macro files] --> B[script adds value=random to 100 placements]
  B --> C[schema validate all macros]
  C --> D[green]

### TASK: 3.1 - Migrate macros to random
Type: chore
What: Write and run a one-off script that walks petal-panic/macros/**/*.json and sets value: 'random' on every placement whose type is barrel/enemy/powerup (none have value today). Then validate every migrated macro against the schema.
Why: Existing levels must keep working under the new composer; defaulting them to random preserves current behavior with zero code fallbacks.
Files: + petal-panic/tools/migrate-macro-values.js
Files: ~ petal-panic/macros/levels/*.json
Snippet: // for each placement with type in [barrel,enemy,powerup]:\n//   if (!p.value) p.value = 'random';\n// write back formatted JSON; then assertMacroSchema on every file
Acceptance: all 100 placements across 18 level files carry value random
Acceptance: every macro file passes assertMacroSchema after migration
Verification: python3 -c "import json,glob; ps=[p for f in glob.glob('petal-panic/macros/levels/*.json') for p in json.load(open(f)).get('placements',[])]; print(len([p for p in ps if p.get('value')=='random']))"

## MILESTONE: 4 - Macro Editor UX
Pattern: Direct Manipulation
Objective: The editor lets the user pick a concrete type per placeholder by clicking, cycling random through the family list dynamically; hovering shows the current value.
Success: Clicking a placement dot cycles random to first type to last type back to random; tooltip reads e.g. 'barrel - coin'; lists come from the registries so new types appear automatically.
Diagram: stateDiagram-v2
  random --> wood : click
  wood --> explosive : click
  explosive --> coin : click
  coin --> random : click

### TASK: 4.1 - Editor value cycle and tooltip
Type: feature
What: In macro-editor (js/pointer.js + js/state.js + js/draw.js or wherever placement dots are handled): clicking a barrel/enemy/powerup placement cycles its value random to each id in the family registry order back to random; hovering the dot shows a tooltip like 'barrel - random' using the registry label. Import the three registries from the game JS so the cycle is dynamic.
Why: The user must be able to pin specific types without hardcoding anything in the editor; labels come from object meta.
Files: ~ petal-panic/macro-editor/js/pointer.js
Files: ~ petal-panic/macro-editor/js/state.js
Files: ~ petal-panic/macro-editor/js/draw.js
Snippet: // on placement click:\n// const list = FAMILY_LISTS[placement.type];      // [{id,label}]\n// const cur = placement.value ?? 'random';\n// const idx = list.findIndex(t => t.id === cur);\n// placement.value = idx === -1 ? list[0].id : (idx + 1 < list.length ? list[idx+1].id : 'random');\n// tooltip: 
Acceptance: clicking cycles random to all family ids back to random in registry order
Acceptance: hovering the dot shows 'family - label' (e.g. 'barrel - Coin')
Acceptance: saved macro persists the chosen value and reloads it
Verification: manual: open macro editor, click a barrel dot through full cycle, save, reload, verify persisted value

## MILESTONE: 5 - Verification
Pattern: Regression Gate
Objective: Prove the whole typed-spawn flow end to end and that nothing regressed.
Success: Unit tests cover schema + composer behavior; full suite at baseline or better; a manual playthrough spawns the declared types.
Diagram: graph LR
  A[unit tests] --> C[full suite]
  B[manual editor cycle] --> C
  C --> D[play level - spawned types match placeholders]

### TASK: 5.1 - Typed spawn test coverage
Type: test
What: Add unit tests: schema accepts/rejects value per family; composer spawns exact type for specific values; random draws stay within the family list; determinism (same seed same population); migrated macros validate. Run the full suite and compare against the pre-change baseline failure set.
Why: The quota removal touches level building broadly; the regression gate must be explicit, not vibes.
Files: + petal-panic/js/test/typedSpawn.test.js
Acceptance: specific value spawns that exact type (all three families)
Acceptance: random never yields an id outside the family list (statistical: N rolls all valid)
Acceptance: same seed + macros yields identical population twice
Acceptance: full node --test run shows zero new failures vs baseline
Verification: node --test petal-panic/js/test/
