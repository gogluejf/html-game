# Entity Size Refactor — Handoff (targetH + baseW)

**Date:** 2026-07-14
**Status:** Core refactor done. Constructor migration partially complete.

## What was done

`Entity` now uses a single source of truth for size:

- **`targetH`** (Y-units) — always present. Drives `h` getter and `setAnim()` scale.
- **`baseW`** (px, optional) — if present, width is fixed. If absent, width comes from the sheet's collision box × scale.
- **`w` / `h`** are getters with setters. Never stored independently.
- **`this.box`** is gone. `worldBox()` reads the live getters.
- **`setAnim()`** only computes `_spriteScale`. Never writes w/h.
- **`sprite.targetH`** removed. The entity's `_targetH` is the only target.
- **`boxFromSheet`** flag removed. Presence/absence of `baseW` implies the owner.

### Files changed
- `js/core/entity.js` — new constructor, getters, setAnim, worldBox
- `js/objects/object.js` — barrel + checkpoint use `targetH` (+ `baseW` for barrel)
- `js/world/tileSprite.js` — terrain tiles use `targetH` + `baseW`
- `js/world/terrainTiles.js` — floor uses `targetH` + `baseW`
- `js/world/level.js` — `ZONE_FLAG_H` derived from `CHECKPOINT_TARGET_H`
- Tests updated to read values from sheets/defs instead of hardcoding

### New constant
```js
// js/objects/object.js
export const CHECKPOINT_TARGET_H = 1.5; // single source of truth
```

## What remains (constructor migration)

These still pass legacy `w`/`h` to `super()`. They work (the constructor translates), but should be migrated to `targetH` + `baseW` explicitly:

| File | Line | Current | Should be |
|------|------|---------|-----------|
| `js/hero/hero.js` | 89-90 | `w: heroDef.w, h: heroDef.h` | `targetH: heroDef.h/48, baseW: heroDef.w` (or sheet-owned if hero gets a sheet) |
| `js/enemies/enemy.js` | 36-37 | `w: def.w, h: def.h` | `targetH: def.h/48, baseW: def.w` (or sheet-owned) |
| `js/objects/coin.js` | ~73 | `w: def.size, h: def.size` | `targetH: def.size/48, baseW: def.size` |
| `js/objects/powerup.js` | ~132 | `w: 28, h: 28` | `targetH: 28/48, baseW: 28` |
| `js/objects/projectile.js` | ~54, ~206 | `w: 12, h: 12` | `targetH: 12/48, baseW: 12` |
| `js/objects/hazardZone.js` | ~22 | `w: opts.w, h: opts.h` | `targetH: opts.h/48, baseW: opts.w` |
| `js/core/solidBox.js` | 13 | `w: box.w, h: box.h` | `targetH: box.h/48, baseW: box.w` |

### Decision needed per entity
For each: does it have a sheet that will drive its width?
- **Yes** → `targetH` only (no baseW). Width from sheet aspect ratio.
- **No** → `targetH` + `baseW`. Fixed logical size.

Current state:
- Hero/Enemy: no sheet yet → `baseW` for now, switch when sheets land
- Coin/Powerup/Projectile/HazardZone/SolidBox: no sheet → `baseW`
- Barrel/Checkpoint: have sheets → `targetH` only (done ✓)
- Terrain tiles/Floor: macro-grid owned → `targetH` + `baseW` (done ✓)

## Barrel width note

The barrel's sheet collision box (305×365) produces a 40px width at targetH=1.
The old code used 32px. The barrel is currently `targetH` only (sheet-owned),
so it IS 40px wide. If gameplay needs 32px, tighten the sheet's collision box
in the sprite editor so `w/h * 48 ≈ 32` (i.e. collisionBox.w ≈ 243).

## Testing

All 654 tests pass (7 pre-existing failures unrelated to this change).
The `barrel.stack.test.js` now reads barrel width dynamically from the entity.
