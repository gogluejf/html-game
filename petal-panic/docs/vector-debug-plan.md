# Vector Debug & Sprite Orientation Plan

Goal: make debug mode show **what the sprite looks like** and **what the entity is doing** as separate, readable signals — without duplicating logic per enemy/hero/projectile.

## Core principle

All transform + motion state already lives on `Entity`:

```js
x, y          // position (top-left of collision box)
vx, vy        // velocity vector (px/s)
facing        // logical horizontal aim: -1 | 1 (internal AI/input value, NOT displayed)
mirrorX       // render flip horizontal
mirrorY       // render flip vertical
rotation      // render rotation (radians)
scale         // render scale
worldBox()    // collision AABB
```

Debug rendering must **read** these fields generically. No per-entity arrow code.

## Concepts

| Concept | Field(s) | Debug display |
|---|---|---|
| Sprite orientation | `rotation` + `mirrorX` | **Green solid arrow** (combined true angle) |
| Velocity | `vx, vy` | **Brown dotted line + dot** (direction + speed via length) |
| Mirror X | `mirrorX` | `[X]` icon over label (dim when off) |
| Mirror Y | `mirrorY` | `[Y]` icon over label (dim when off) |
| Facing | `facing` | **Not displayed** (redundant — the green arrow already shows true direction) |

Key distinction:

- **Sprite orientation** = how the *image* points after mirrorX + rotation. One combined angle.
- **Velocity direction** = how the *entity* moves (`atan2(vy, vx)`).

These are intentionally different:

- Projectile at 45° → green arrow 45°, brown dotted line also 45°.
- Enemy jumping while facing right → green arrow stays right (or left if mirrored), brown dotted line points up.

## Entity additions (generic, no duplication)

Add to `Entity` (single source of truth):

```js
// Optional base angle if the raw art doesn't point right by default.
this.baseSpriteAngle = opts.baseSpriteAngle ?? 0; // radians

/**
 * Visual direction the sprite is pointing, in world radians.
 * Combines mirrorX + rotation into one true angle.
 * Assumes the untransformed art points RIGHT (0 rad).
 * mirrorY does NOT affect horizontal orientation (it's a vertical flip).
 */
spriteOrientation() {
  let a = this.rotation;
  if (this.mirrorX) a = Math.PI - a;   // mirrorX flips direction
  return this.baseSpriteAngle + a;
}

/**
 * Direction of movement in world radians, or null when (nearly) stationary.
 */
velocityAngle(threshold = 1) {
  const speed = Math.hypot(this.vx, this.vy);
  if (speed < threshold) return null;
  return Math.atan2(this.vy, this.vx);
}

/** Speed magnitude (px/s). */
velocitySpeed() {
  return Math.hypot(this.vx, this.vy);
}
```

Notes:

- Most current sprites face right by default → `baseSpriteAngle = 0`.
- If a sprite sheet is authored pointing up/down, set `baseSpriteAngle` once on that entity type.
- `mirrorY` is excluded from `spriteOrientation()` — it flips top/bottom but doesn't change which horizontal direction the sprite points.
- These are pure reads; they don't mutate state.

## Debug rendering (one generic function)

Replace the current single "facing arrow" (`drawAggroViz`) with a generic transform overlay drawn for **every live Entity**:

```js
drawEntityTransformDebug(ctx, ent) {
  const b = ent.worldBox();
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;

  // 1) Sprite orientation arrow (green, solid, bold)
  const oa = ent.spriteOrientation();
  drawArrow(ctx, cx, cy, Math.cos(oa), Math.sin(oa), '#2ecc71', 22);

  // 2) Velocity indicator (brown, dotted, subtle — like radius circles)
  const va = ent.velocityAngle();
  if (va !== null) {
    const len = clamp(ent.velocitySpeed() * 0.15, 8, 36);
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#8B4513'; // saddle brown, muted
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(va) * len, cy + Math.sin(va) * len);
    ctx.stroke();
    // small dot at the tip
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(va) * len, cy + Math.sin(va) * len, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#8B4513';
    ctx.fill();
    ctx.restore();
  }
}
```

### Visual contrast (intentional)

```text
green solid arrow     = "which way the sprite faces" (primary, bold, clear)
brown dotted line+dot = "which way it's moving" (secondary, quiet, background)
```

The brown dotted style matches the existing dashed radius circles, so the whole debug overlay feels cohesive and non-intrusive. The green arrow pops because it's solid and bright.

### Color semantics (fixed)

```text
cyan   #00e5ff  collision box / selected entity
green  #2ecc71  sprite visual orientation (solid arrow)
brown  #8B4513  velocity vector (dotted line + dot, muted)
white  #ffffff  labels / icons
yellow #f1c40f  active special hitbox (melee)
```

### Arrow helper

```js
function drawArrow(ctx, x, y, dx, dy, color, len) {
  const ex = x + dx * len;
  const ey = y + dy * len;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  const ang = Math.atan2(dy, dx);
  const hs = 6;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - hs * Math.cos(ang - 0.4), ey - hs * Math.sin(ang - 0.4));
  ctx.lineTo(ex - hs * Math.cos(ang + 0.4), ey - hs * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
```

## Readability: layered detail (avoid clutter)

One debug mode (`Debug.enabled`), three detail levels cycled by a key. Do NOT show everything at once.

### Level 0 — vectors only (default when debug on)

For every entity:

```text
collision box (dim)
green solid arrow (sprite orientation)
brown dotted line + dot (velocity)
```

No text. Good for watching movement/animation feel.

### Level 1 — vectors + compact labels + mirror icons

Adds per entity:

```text
name:state  [X] [Y]
```

- `[X]` lit when `mirrorX` is true, dim when false.
- `[Y]` lit when `mirrorY` is true, dim when false.
- No facing icon (redundant — the green arrow already shows true direction).
- No rotation number here (it's baked into the arrow visually; raw number available at level 2).

### Level 2 — inspect selected entity

Only the selected entity gets a numeric panel:

```text
vx 180  vy -240
spd 300  rot 15°  orient -165°
mx 1  my 0  scale 1
anim f3/7
hp/ttl if present
```

`orient` = the computed `spriteOrientation()` in degrees (the true combined angle). All other entities stay at the current level but dimmer.

### Suggested keys

```text
F1 / F3   toggle debug master (already unified)
C         cycle detail level (0 → 1 → 2 → 0)
RMB       select entity
LMB       force AI state
arrows    scrub selected anim
X         deselect
```

(Existing `C = viewMode` must be remapped or merged; one key, one job.)

## What changes where

### `entity.js`
- Add `baseSpriteAngle`, `spriteOrientation()`, `velocityAngle()`, `velocitySpeed()`.

### `systems/render.js`
- Remove `drawAggroViz` (single facing arrow).
- Add `drawEntityTransformDebug` + `drawArrow` helper.
- Call `drawEntityTransformDebug` for every live entity from the existing debug block.
- Drive label/mirror-icon/numeric-panel visibility off `Debug.detailLevel`.
- Keep existing collision-box overlay (`drawDebugOverlay`) as-is; new indicators layer on top.

### `debug.js`
- Add `detailLevel: 0` + `cycleDetailLevel()`.
- Resolve `C` key conflict: either `C` cycles detail level AND view mode together, or split into two keys. Pick one.

### Transform duplication cleanup (separate, recommended)
Currently `Entity.draw()`, `Enemy.draw()`, and `Hero.draw()` each re-apply:

```js
translate → mirrorX → mirrorY → rotate → scale
```

Consolidate so `Entity.draw()` is the single transform pipeline; subclasses call `super.draw()` then add overlays only. This guarantees the debug green arrow always matches what's actually rendered.

## Acceptance checklist

- [ ] `Entity.spriteOrientation()` returns correct angle for: upright, mirrored-X, rotated, rotated+mirrored.
- [ ] `Entity.velocityAngle()` returns `null` when stationary, correct angle when moving.
- [ ] Green arrow matches the visible sprite direction for a rotated projectile.
- [ ] Brown dotted line points up for a jumping enemy whose sprite stays upright.
- [ ] Brown dotted line length scales with speed (clamped 8–36px).
- [ ] Detail level 0 shows only boxes + green arrow + brown dotted line (no text).
- [ ] Detail level 1 adds `name:state` + `[X] [Y]` icons (no facing icon).
- [ ] Detail level 2 shows numeric panel for the selected entity only.
- [ ] No per-enemy/hero/projectile arrow code — one generic function.
- [ ] Normal play (debug off) pays zero cost (single boolean check).

## Out of scope (for now)

- Acceleration / knockback force indicator (add later as a distinct style if needed).
- Editing transforms at runtime from the debug UI.
- A formal `Vector2` class (current scalar `vx/vy` + `Math.atan2` is sufficient).
- Displaying `facing` in any form (redundant with the green arrow).
