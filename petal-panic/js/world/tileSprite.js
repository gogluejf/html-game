// Petal Panic — Terrain tile sprite (sprite-engine M8 / terrain-tiling.md §Scaling).
//
// One solid/platform AABB becomes a small pool of TileSprite entities. Each
// tile is a REAL Entity running the standard sprite pipeline:
//   setAnim() → uniformScale(collisionBox.h) → drawSprite() bottom-centered.
// No raw drawImage stretching anywhere — the authored collision box drives
// the scale exactly like barrels, checkpoints and the floor (sprites.md §4).
//
// Tiling layout (decompose, 75/25 frame picks, per-solid seeded RNG) stays in
// terrainTiles.js; this module only turns those decisions into drawable
// entities. Pool is rebuilt when the solid rect changes (zone transitions).

import { UNIT_PX_Y } from './macros.js';
import { getLevelAsset } from './levelAssets.js';
import { Entity } from '../core/entity.js';

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
      e.sprite = { anchor: 'bottom-center', anims: asset.data.anims };
      Object.defineProperty(e.sprite, 'frames', { get: () => asset.frames });
      e.setAnim(animName);
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
  return drew;
}

/** Drop pools for a level (call on zone transition to free stale rects). */
export function clearTilePools(level) {
  for (const k of [...pools.keys()]) if (k.startsWith(`${level}:`)) pools.delete(k);
}

/** Test helper. */
export function _clearAllTilePools() { pools.clear(); }
