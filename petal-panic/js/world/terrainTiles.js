// Petal Panic — Terrain sprite tiling (docs/architecture/terrain-tiling.md).
//
// Turns a solid/platform AABB (world px) into a list of draw commands using
// the per-level block/platform sheet art. ALL geometry is in whole cells
// (48px each); every tile rect lands exactly on the cell lattice:
//
//   BLOCKS — fixed 2-cell columns; each column's HEIGHT decomposes longest-
//     first [3,2,1] and stacks BOTTOM → TOP (triple at the bottom, remainder
//     stacked above it: H=5 → triple + double, H=7 → triple + triple + single).
//     Wide walls repeat 2-cell columns RIGHT → LEFT so left-column art overlays
//     right-column art (proper overdraw order).
//   PLATFORMS — always 1 cell tall; WIDTH decomposes longest-first [3,2,1]
//     RIGHT → LEFT (W=7 → triple + triple + single, placed from the right edge).
//     A platform's collision box is the full W×1u rect but the SPRITE is pinned
//     to the top face: targetH = PLATFORM_DRAW_H (6px ≈ 0.16u), so the drawn
//     slab sits exactly where the platform level is (y=1 → sprite top at y=1).
//
// Frame selection (per-kind pools): platform f1–f3 decorated 25% / f4..end
//   plain 75%; block f1 plain 75% / f2..end decorated 25% — rolled from a
//   per-solid seeded stream so choices are stable across death/Continue
//   (lifecycle.md §6).
//
// Deterministic: same (solid, level, seed) → same tiles, every time.
// Asset loading (sheet JSON + frame PNGs) lives in levelAssets.js — this
// module only decides WHICH tile goes WHERE and reads loaded frames back.

import { UNIT_PX_X, UNIT_PX_Y, PLATFORM_DRAW_H } from './macros.js';
import { createRng } from './terrain.js';
import { loadLevelAsset, getLevelAsset } from './levelAssets.js';
import { ZONE_FLOOR_UNITS } from './level.js';
import { Entity } from '../core/entity.js';
import { decomposeVariant, blockColumns, BLOCK_FOOTPRINT } from './squareGrid.js';

// --- Frame selection (terrain-tiling.md §Frame selection) ----------------------
const PLAIN_FRAME_WEIGHT = 0.75;
/**
 * Pools are positional, not fixed indices (terrain-tiling.md): the plain pool
 * is the LAST TWO frames of the sheet through the end (today: platform f4,
 * block f2 — one frame each); the decorated pool is everything before it
 * (platform f1–f3, block f1). New plain variants appended at the sheet end
 * join the plain pool automatically.
 */

/** Kick off (or join) the asset load for a terrain kind. Fire-and-forget. */
export function loadTerrainFrames(level, kind) {
  return loadLevelAsset(level, kind);
}

// --- Tiling ---------------------------------------------------------------------
// Variant decomposition (longest-first [3,2,1]) lives in squareGrid.js — the
// single shared footprint contract. Blocks decompose HEIGHT into variants;
// platforms decompose WIDTH into variants.

/**
 * Pick a frame index for one tile (deterministic per rng stream + kind).
 *
 * Pools are PER-KIND (terrain-tiling.md §Frame selection):
 *   PLATFORM (6 frames): f1–f3 decorated (25%) / f4..f6 empty (75%).
 *   BLOCK (2 frames):    f1 decorated (75%) / f2 empty (25%).
 */
function pickFrame(rng, frameCount, kind) {
  let plainPool, decoPool;
  if (kind === 'block') {
    // f1 (index 0) is the plain frame; everything after is decorated.
    plainPool = [0];
    decoPool = [];
    for (let i = 1; i < frameCount; i++) decoPool.push(i);
  } else {
    // Platform: f4..end (last three slots of a 6-frame sheet) are the empty
    // pool; everything before (f1–f3) is decorated.
    const plainStart = Math.max(0, frameCount - 3);
    plainPool = [];
    for (let i = plainStart; i < frameCount; i++) plainPool.push(i);
    decoPool = [];
    for (let i = 0; i < plainStart; i++) decoPool.push(i);
  }
  if (rng.next() < PLAIN_FRAME_WEIGHT && plainPool.length > 0) {
    return plainPool[Math.floor(rng.next() * plainPool.length)];
  }
  return decoPool.length > 0 ? decoPool[Math.floor(rng.next() * decoPool.length)] : plainPool[0];
}

/**
 * Tile one solid/platform AABB into draw commands (WORLD coordinates).
 *
 * Placement order (user rule):
 *   - blocks: columns right→left; within a column, rows bottom→top
 *   - platforms: tiles right→left along the width
 * Every tile rect is an exact multiple of the 48px cell — no offsets.
 *
 * @param {{x:number,y:number,w:number,h:number,oneWay?:boolean}} s world-px box
 * @param {number} level 1-based level index
 * @param {number|string} seed per-game seed
 * @returns {Array<{x,y,w,h,frame,imgKey,kind,variant}>} draw commands
 */
export function tileSolid(s, level, seed) {
  const kind = s.oneWay ? 'platform' : 'block';
  const wUnits = Math.max(1, Math.round(s.w / UNIT_PX_X));
  const hUnits = Math.max(1, Math.round(s.h / UNIT_PX_Y));

  // Per-solid RNG stream derived from the game seed + position: identical
  // world rebuilds produce identical frame picks (lifecycle.md §6).
  const rng = createRng(`${seed}:tile:${kind}:${Math.round(s.x)}:${Math.round(s.y)}`);

  // Square-grid footprint rules (squareGrid.js):
  //   - BLOCKS are fixed 2-cell columns; a wide wall repeats those columns and
  //     each column decomposes its HEIGHT into single/double/triple variants.
  //     (Blocks describe height, never width.)
  //   - PLATFORMS keep 1-cell height; their WIDTH decomposes into
  //     single/double/triple variants.
  let widths;
  if (kind === 'block') {
    // Authored blocks are lattice-validated upstream (squareGrid.unitGridError:
    // even x, width a positive multiple of BLOCK_FOOTPRINT.widthCells). If a
    // malformed solid reaches the tiler we must NOT silently round or truncate
    // its geometry — throw with the offending box so the producer is fixed.
    widths = blockColumns(wUnits);
  } else {
    widths = decomposeVariant('platform', wUnits);
  }
  const rows = kind === 'block' ? decomposeVariant('block', hUnits) : [1];
  const asset = getLevelAsset(level, kind);
  const anim = asset?.data?.anims[asset.animName];
  const frameCount = anim?.frames.length ?? (kind === 'platform' ? 4 : 2);

  const tiles = [];
  // Columns RIGHT → LEFT (proper overlay: earlier-drawn right tiles sit under
  // later-drawn left tiles).
  let cursorRight = s.x + s.w; // right edge; advances across tiles
  for (let c = widths.length - 1; c >= 0; c--) {
    const colW = widths[c]; // block: always 2 (fixed column); platform: variant width
    // Right-anchored walk: the first (right-most) tile starts at s.x + w and
    // each next tile begins where the previous one ended.
    if (kind === 'platform') {
      // One row, 1 cell tall. The tile rect IS the platform's collision rect
      // (full width × 1u) — the sprite pinning happens in tileSprite.js via
      // targetH = PLATFORM_DRAW_H so the drawn slab tops out at the platform
      // level exactly.
      const frame = pickFrame(rng, frameCount, kind);
      const imgKey = anim ? anim.frames[frame % anim.frames.length].file
        : `platform_${colW === 1 ? 'single' : colW === 2 ? 'double' : 'triple'}_f${frame + 1}.png`;
      const colX = cursorRight - colW * UNIT_PX_X;
      cursorRight = colX;
      tiles.push({
        x: colX,
        y: s.y,
        w: colW * UNIT_PX_X,
        h: UNIT_PX_Y,
        frame,
        kind,
        variant: colW,
        imgKey,
      });
    } else {
      // Block column: fixed 2-cell width, right-anchored walk position.
      const colX = cursorRight - colW * UNIT_PX_X;
      cursorRight = colX;
      // Rows BOTTOM → TOP: rows[0] is the tallest (bottom-most) variant.
      let rowY = s.y + s.h; // bottom edge (screen coords: y grows down)
      for (let r = 0; r < rows.length; r++) {
        const rowH = rows[r] * UNIT_PX_Y;
        rowY -= rowH;
        const frame = pickFrame(rng, frameCount, kind);
        const vname = rows[r] === 1 ? 'single' : rows[r] === 2 ? 'double' : 'triple';
        const imgKey = anim ? anim.frames[frame % anim.frames.length].file
          : `block_${vname}_f${frame + 1}.png`;
        tiles.push({
          x: colX,
          y: rowY,
          w: colW * UNIT_PX_X,
          h: rowH,
          frame,
          kind,
          variant: rows[r],
          imgKey,
        });
      }
    }
  }
  return tiles;
}

/**
 * Convenience: ensure sheets are parsed, compute tiles, kick off frame loading.
 * Tiles carry imgKey immediately (from parsed sheets); the image MAP fills in
 * once the asset load settles — the render loop skips tiles whose image
 * isn't loaded yet.
 *
 * @returns {Promise<Array>} tiles (same shape as tileSolid)
 */
export async function buildTerrainTiles(s, level, seed) {
  await loadTerrainFrames(level, s.oneWay ? 'platform' : 'block');
  return tileSolid(s, level, seed);
}

// --- Floor (fg) entity ---------------------------------------------------------
// The floor is a first-class sprite citizen (sprite-engine plan M7): ONE wide
// Entity per zone spanning the full floor width, anim 'fg' from the per-level
// fg_sheet.json, target height 1 Y-unit, tile=true so drawSprite() repeats the
// frame across the span. Floors NEVER get block tiles — kind='floor' routes
// them here instead of through tileSolid().

/** @type {Map<number, Entity>} level → floor entity (rebuilt when rect changes) */
const floorEntities = new Map();

/**
 * Get (and lazily build) the floor Entity for a level+floor rect. The entity's
 * collision box IS the floor solid; its sprite data comes from the fg sheet so
 * scaling follows the uniform collision-box rule (§4) like every other entity.
 * @param {{x:number,y:number,w:number,h:number}} s the floor solid (world px)
 * @param {number} level 1-based level index
 * @returns {Entity}
 */
export function getFloorEntity(s, level) {
  let e = floorEntities.get(level);
  if (!e || e.w !== s.w || e.x !== s.x || e.y !== s.y) {
    e = new Entity({ x: s.x, y: s.y, w: s.w, h: s.h, debugColor: '#8f6' });
    e.sprite = { anchor: 'bottom-center', targetH: ZONE_FLOOR_UNITS, tile: true, anims: {}, frames: new Map(), boxFromSheet: false }; // zone floor rect is macro-owned
    floorEntities.set(level, e);
  }
  // Wire sprite data once the shared fg asset has settled (fire-and-forget;
  // the loader retries on failure — see levelAssets.js).
  loadLevelAsset(level, 'fg').then(({ data, animName, frames }) => {
    if (!data || e !== floorEntities.get(level)) return; // stale or failed
    e.sprite.anims = data.anims;
    e.sprite.frames = frames;
    e.setAnim(animName); // scale = ZONE_FLOOR_H / fg collision box h (§4)
  });
  return e;
}

/** Synchronous render hook: draws the floor entity when its frames are ready. */
export function drawFloor(ctx, s, level) {
  const e = getFloorEntity(s, level);
  if (!e?.sprite?.frames?.size) return false;
  return e.drawSprite(ctx);
}

/**
 * Synchronous image lookup for the render loop (no awaits).
 * @param {number} level 1-based level index
 * @param {'block'|'platform'} kind
 * @param {string|null} file frame file name (tile.imgKey)
 * @returns {HTMLImageElement|null} complete image, or null until loaded
 */
export function getTerrainFrameImage(level, kind, file) {
  if (!file) return null;
  const img = getLevelAsset(level, kind)?.frames?.get(file);
  return img && img.complete ? img : null;
}
