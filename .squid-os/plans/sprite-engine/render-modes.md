# Render Mode System — High-Graphic vs Primitive-Graphic

## Context

The engine currently has two rendering concerns tangled together:
1. **Entity/terrain visuals** — sheet sprites (when loaded) or `debugColor` fillRects (fallback)
2. **Debug overlay** — semitransparent collision boxes layered on top

There is no way to explicitly select "I want to see the game with basic shapes" vs
"I want to see the game with full art." The primitive path only appears as an
accident of missing sprite data. Attack drawers, hazard zones, special weapons,
parallax backgrounds, and terrain all need a clean gate.

## Goal

Two graphic modes + optional collision overlay, selectable via F3:

| F3 index | Name | Graphic layer | Collision overlay |
|----------|------|---------------|-------------------|
| 0 | **high-graphic + collision** | Full sprites (entities, terrain, bg, attacks) | ✅ semitransparent |
| 1 | **high-graphic only** | Full sprites | ❌ |
| 2 | **primitive-graphic only** | Basic shapes (fillRects, attack primitives, flat terrain) | ❌ |
| 3 | **collision only** | Opaque layer-colored boxes | ✅ opaque |
| 4 | **primitive-graphic + collision** | Basic shapes | ✅ semitransparent |

F3 cycles 0→1→2→3→4→0.

## What "high-graphic" includes

Everything that uses sheet art or per-level image assets:

- Entity sprites (hero, enemies, barrels, checkpoints, powerups, coins)
- Terrain sprites (floor fg, block/platform tiles via tileSprite.js)
- Parallax level background (`drawParallaxBg`)
- Attack/weapon sprites (when sheet-backed; falls back to primitive drawers if not)
- Boss sprites

## What "primitive-graphic" includes

All hand-drawn canvas geometry that exists today as the non-sprite path:

- Entity bodies: `debugColor` fillRect (per-entity color: green hero, red enemy, orange barrel, etc.)
- Attack drawers (ALL of them):
  - `combat/attack/drawers/ballistic/` — bomb, molotov, rock, mine, circusBall
  - `combat/attack/drawers/projectile/` — boomerang, spread
  - `combat/attack/drawers/zone/` — fire, spike, dust
- Hazard zones: filled/stroked rects
- Special weapons: their geometric shapes
- Terrain: flat colored rects (orange for solids, light-orange for platforms)
- Parallax bg: solid dark fill (no image)
- Projectiles: small colored circles/rects
- Explosion effects: expanding circle

## Architecture

### New: `js/core/renderMode.js`

```js
export const GRAPHIC_MODE = {
  HIGH: 'high',       // sheet sprites + parallax images
  PRIMITIVE: 'primitive' // basic shapes only
};

let current = GRAPHIC_MODE.HIGH;

export function setGraphicMode(mode) { current = mode; }
export function getGraphicMode() { return current; }
export function isHighGraphic() { return current === GRAPHIC_MODE.HIGH; }
```

Single source of truth. No module reads `Debug.viewMode` directly for graphic decisions.

### Modified: `Debug` (debug.js)

`viewMode` becomes a 5-value cycle (0–4). F3 handler updates both:
- `Debug.viewMode` (for the collision overlay logic, which already exists)
- `setGraphicMode(...)` (for the graphic layer)

Mapping:
```
viewMode 0 → HIGH + collision overlay
viewMode 1 → HIGH, no overlay
viewMode 2 → PRIMITIVE, no overlay
viewMode 3 → PRIMITIVE (but draw opaque collision boxes instead), no overlay
viewMode 4 → PRIMITIVE + collision overlay
```

### Modified: `Entity.draw()` (entity.js)

```js
draw(ctx) {
  if (this.visible === false) return;
  if (isHighGraphic()) {
    if (this.drawSprite(ctx)) return;
  }
  // Primitive path (always available):
  ctx.save();
  ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
  // ... mirror, rotate, scale ...
  ctx.fillStyle = this.debugColor;
  ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
  ctx.restore();
}
```

In high-graphic mode: try sprite first, fall through to primitive if no sprite data.
In primitive mode: skip sprite entirely, go straight to fillRect.

### Modified: `render.js` terrain section

```js
if (isHighGraphic()) {
  // Current sprite path: drawFloor, drawTileSprites, drawParallaxBg
} else {
  // Primitive: flat fillRect per solid (orange/light-orange), solid dark bg
}
```

### Modified: `render.js` parallax bg

```js
if (isHighGraphic()) {
  drawParallaxBg(ctx, cam, zone.level, zone.orientation);
} else {
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}
```

### Modified: Attack drawers (`combat/attack/drawers/index.js`)

Each drawer already draws primitives. In high-graphic mode, if a sheet-backed
sprite exists for that attack type, use it; otherwise fall through to the
primitive drawer. For now (no attack sheets exist), both modes use the same
primitive drawers — the gate is in place for when sheets arrive.

```js
// In the attack render loop:
if (isHighGraphic() && entity.hasAttackSprite) {
  entity.drawAttackSprite(ctx);
} else {
  primitiveDrawer(ctx, attack); // existing code, unchanged
}
```

### Unchanged: Collision overlay (`drawDebugOverlay`)

Stays exactly as-is. It's orthogonal to graphic mode — it just checks
`Debug.viewMode` to decide visibility/opacity. Modes 0 and 4 show it
semitransparent; mode 3 shows it opaque (replacing the graphic layer);
modes 1 and 2 hide it.

## Files touched

| File | Change |
|------|--------|
| `+ js/core/renderMode.js` | New: mode state + getters |
| `~ js/debug/debug.js` | viewMode 0–4 cycle, F3 handler calls setGraphicMode |
| `~ js/core/entity.js` | draw() gates sprite vs primitive on isHighGraphic() |
| `~ js/systems/render.js` | Terrain + parallax sections gated on isHighGraphic() |
| `~ js/combat/attack/drawers/index.js` | Gate for future attack sprites |
| `~ js/world/tileSprite.js` | Fallback fillRect already exists; ensure it's the primitive path |
| `~ js/world/terrainTiles.js` | Floor: primitive = flat rect, high = fg entity |

## Acceptance

- [ ] F3 cycles through all 5 modes without errors
- [ ] Mode 0 (default): identical to current gameplay look
- [ ] Mode 1: sprites visible, no debug boxes
- [ ] Mode 2: all entities are colored fillRects, terrain is flat orange rects, bg is solid dark, attacks draw their primitive shapes — NO sheet art anywhere
- [ ] Mode 3: opaque layer-colored boxes only (current collision-only behavior)
- [ ] Mode 4: colored fillRects + semitransparent collision overlay
- [ ] Switching modes mid-frame does not crash or leave stale state
- [ ] All existing tests pass (no regression in sprite or collision paths)
- [ ] `isHighGraphic()` is the ONLY gate — no module reads viewMode for graphic decisions

## Out of scope

- Per-entity override (some entities always primitive, some always sprite)
- Attack sheet art (doesn't exist yet; the gate is forward-looking)
- Macro editor preview (it can adopt the same mode later)
