// Petal Panic — Terrain tile sprite (sprite-engine M8 / terrain-tiling.md §Scaling).
//
// One solid/platform AABB becomes a small pool of TileSprite entities. Each
// tile is a REAL Entity running the standard sprite pipeline:
//   setAnim() → uniformScale(collisionBox.h) → drawSprite() bottom-centered.
// No raw drawImage stretching anywhere — the authored collision box drives
// the scale exactly like barrels, checkpoints and the floor (sprites.md §4).
//
// Tiling layout (decomposeVariant, 75/25 frame picks, per-solid seeded RNG) stays in
// terrainTiles.js; this module only turns those decisions into drawable
// entities. Pool is rebuilt when the solid rect changes (zone transitions).

import { UNIT_PX_Y, PLATFORM_DRAW_H } from './macros.js';
import { getLevelAsset } from './levelAssets.js';
import { Entity } from '../core/entity.js';
import { isHighGraphic } from '../core/renderMode.js';

/** kind → variant anim names (merged block/platform SpriteData). */
const VARIANT_ANIMS = {
  block: ['block_single', 'block_double', 'block_triple'],
  platform: ['platform_single', 'platform_double', 'platform_triple'],
};

/** @type {Map<string, Array>} key → live TileSprite entities */
const pools = new Map();

function poolKey(s, level) {
  return `${level}:${s.oneWay ? 'p' : 'b'}:${Math.round(s.x)}:${Math.round(s.y)}:${s.w}x${s.h}`;
}

/**
 * Get (and lazily build) the TileSprite pool for one solid.
 *
 * @param {{x:number,y:number,w:number,h:number,oneWay?:boolean}} s world-px box
 * @param {number} level 1-based level index
 * @param {Array<{x:number,y:number,w:number,h:number,frame:number,kind:string,variant:number,imgKey:string}>} tiles from tileSolid()
 * @returns {Entity[]} one entity per tile (may be empty until sheets parse)
 */
export function getTileSprites(s, level, tiles) {
  const key = poolKey(s, level);
  let pool = pools.get(key);
  if (!pool || pool._tiles !== tiles) {
    pool = [];
    pool._tiles = tiles;
    pools.set(key, pool);
  }
  const asset = getLevelAsset(level, s.oneWay ? 'platform' : 'block');
  if (!asset?.data) return pool; // sheets not parsed yet — render skips

  const animNames = VARIANT_ANIMS[s.oneWay ? 'platform' : 'block'];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const animName = animNames[t.variant - 1];
    const data = asset.data.anims[animName];
    if (!data) continue; // sheet missing this variant — skip tile
    let e = pool[i];
    if (!e) {
      e = new Entity({ x: t.x, y: t.y, w: t.w, h: t.h, debugColor: '#a86' });
      // The tile rect IS the placement unit (from the macro grid). Scale the
      // sheet's collision box onto that rect height (uniform §4) and let the
      // standard bottom-center anchor do the rest. Per-frame tuning in the
      // sheet JSON (offset/scale) then places each frame exactly as authored
      // in the editor — blocks fill their row, platforms pin a thin slab to
      // the landing face (build.js R5.1 thins the solid to PLATFORM_DRAW_H
      // at that same face).
      e.sprite = { anchor: 'bottom-center', anims: asset.data.anims, boxFromSheet: false }; // macro grid owns tile solids
      Object.defineProperty(e.sprite, 'frames', { get: () => asset.frames });
      e.setAnim(animName);
      // Platform sheet collision heights were reduced to 1/8 without
      // changing the art. Cancel the resulting 8x scale increase so existing
      // image size and top-left deltas remain unchanged.
      if (s.oneWay) e._spriteScale *= PLATFORM_DRAW_H / UNIT_PX_Y / 8;
      pool[i] = e;
    }
    // Frame pick can change on rebuild (new seed/rect): retarget without rescale.
    e._tileFrame = t.frame % data.frames.length;
  }
  return pool;
}

/**
 * Draw the pool. Returns true if at least one tile drew real art.
 * Tiles whose frames haven't decoded yet fall back to their legacy rect so
 * terrain never disappears while images load.
 */
export function drawTileSprites(ctx, pool) {
  let drew = false;
  for (const e of pool) {
    if (!e) continue;
    if (e.drawSprite(ctx)) { drew = true; continue; }
    // Fallback: flat rect at the tile footprint (legacy look, no stretch).
    ctx.fillStyle = e.debugColor ?? '#a86';
    ctx.fillRect(e.x, e.y, e.w, e.h);
  }
  // Sheet-box overlay (debug): blue 75% alpha rect where the SHEET's collision
  // box lands under the delta rule — compare against orange (physical solid)
  // and the art. All three agreeing = contract holding.
  if (typeof CanvasRenderingContext2D !== 'undefined' && isHighGraphic()) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#2f6fff';
    for (const e of pool) {
      if (!e) continue;
      drawSheetBox(ctx, e);
    }
    ctx.restore();
  }
  return drew;
}

/**
 * Universal sheet-collision-box overlay (debug): draws the SHEET's collision
 * box in blue at exactly where drawSprite() places it — for ANY entity that
 * has sprite data (terrain tiles, floor, barrels, enemies, bosses…). Use it
 * next to the orange physical box to compare sheet vs physics placement.
 */
export function drawSheetBox(ctx, e) {
  const data = e.spriteAnimData;
  if (!data?.collisionBox || !e._spriteScale) return;
  const s = e._spriteScale;
  const cb = data.collisionBox;
  // THE collision box: entity x/y IS the box top-left; size prorated by §4 scale.
  // Identical to the orange physics rect — this overlay exists only so you can
  // see the sheet box next to the art.
  ctx.fillRect(e.x, e.y, cb.w * s, cb.h * s);
}

/** Drop pools for a level (call on zone transition to free stale rects). */
export function clearTilePools(level) {
  for (const k of [...pools.keys()]) if (k.startsWith(`${level}:`)) pools.delete(k);
}

/** Test helper. */
export function _clearAllTilePools() { pools.clear(); }
