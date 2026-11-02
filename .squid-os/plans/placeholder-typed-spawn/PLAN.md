# Placeholder Typed Spawn — kill quotas, spawn what the placeholder says

## Context

Today `populateArea` (macros.js) fills barrel/enemy/powerup slots from a **per-type quota**
(`stageBudgets[stage].{barrels,enemies,powerups}` in levelConfigs.js). RNG picks which slot
gets which type within those caps. The user wants the opposite: **the macro placeholder is
the source of truth**. Each placement carries either `"random"` or a specific type id drawn
from that object family's meta list. The composer spawns exactly what the placeholder says.
Quotas are deleted. Future work (out of scope here): per-level random-pool scoping for
progression.

Placement data today: `{slot, x, y, type}` where `type ∈ {enemy, barrel, powerup}` — the
family only, no concrete type. New shape: add `value` = `"random"` | `<typeId>`.

## Meta lists (single source of truth per family)

| Family    | List constant        | Source file                     | Notes                                   |
|-----------|----------------------|---------------------------------|-----------------------------------------|
| barrel    | `BARREL_TYPES`       | objects/object.js               | NEW registry: wood, explosive, coin     |
| enemy     | `ENEMY_TYPES`        | enemies/enemyRegistry.js        | NEW file; moves ENEMY_KEYS out of stats.js (stats keeps importing it); entries carry `{id, name, label}` |
| powerup   | `POWERUP_ROLL_TYPES` | objects/powerup.js              | existing; NO flatten with specials      |

No flatten of powerups + special weapons. A powerup slot rolls one powerup type; a special
weapon drop is a separate concern (user will split both later).

## Tasks

### M1 — Object meta registries
1. `objects/object.js`: add `BARREL_TYPES` ordered array (`[{id:'wood',label:'Wood'},...]`)
   + `barrelById` map. Keep existing defs; ids must match current spawn fns.
2. `enemies/enemyRegistry.js` (NEW): `ENEMY_TYPES` ordered array with `{id, name, label}`
   for the 6 types; move `ENEMY_KEYS` derivation here; `stats.js` imports from there.
3. Verify `POWERUP_ROLL_TYPES` exists and is importable (it does — powerup.js:92).

### M2 — Schema: placement gains `value`
4. `world/macroSchema.js`: `validatePlacement` accepts optional `value` (string, non-empty);
   if present and not `"random"`, validate against the family's meta list (import the three
   lists). No fallback/default in code — validation error on unknown value.
5. `macros/macro.schema.json`: document the new optional property.

### M3 — Composer: spawn what the placeholder says
6. `world/macros.js`:
   - delete `chooseSlots` usage + `assignBarrelTypes` / `assignEnemyTypes` /
     `assignPowerupTypes` quota logic.
   - new path: every placement in `layout.placements` spawns directly.
     `value === 'random'` → `rng.pick(familyList)`; else use `value`.
   - keep the solid-block guard, structure classification, and `budgets` report shape
     (now: requested = placed = slot count; under-placement impossible by construction).
7. `world/build.js`: pass through — placements already flow into population; verify no
   budget references remain.

### M4 — Level configs: delete quota machinery
8. `world/levelConfigs.js`: remove `stageBudgets` generation (tension/stageMult/barrelMults
   blocks), the hand-tuned per-stage `barrels/enemies/powerups` maps, and all call sites.
   Levels keep everything else (terrain, stages, hero, etc.).
9. Grep repo for `stageBudget` / `getStageBudget` / `barrelScale` / `barrelMults` — remove
   all remaining references (accessors.js, level.js, tests).

### M5 — Macro migration (bulk, clean data)
10. Script: walk `petal-panic/macros/**/*.json`; for every placement with
    `type ∈ {barrel, enemy, powerup}` set `value: "random"`. Write back formatted JSON.
    Scope: all 18 level files (100 placements: 40 barrel, 44 enemy, 16 powerup).
11. Run schema validation over all migrated macros to prove they still parse.

### M6 — Macro editor UX
12. Placement click cycles `value`: `random → first in list → … → last → random`.
    Cycle order comes from the family meta list (dynamic, not hardcoded).
13. Hover tooltip on the placement dot shows `barrel — random` / `barrel — coin` etc.
    (label from meta list).
14. Editor loads the three meta lists from the game JS (same import paths as runtime) so
    adding a new barrel/enemy/powerup type automatically appears in the cycle.

### M7 — Tests + audit
15. Unit tests: schema accepts `value` (valid id / random / rejects unknown), composer
    spawns exact type for specific values, random draws stay within the family list,
    migrated macros validate.
16. Full test suite green; manual: open macro editor, click a barrel dot through the full
    cycle, save, load, verify persisted `value`.

## Out of scope (future)
- Per-level random-pool scoping ("level 1 only rolls wood+coin") — next iteration.
- Powerup vs special-weapon split — user will do separately.

## Commit strategy
One commit per milestone after its tests pass (M1..M7). No push.
