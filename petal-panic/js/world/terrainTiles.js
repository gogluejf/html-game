// Petal Panic — Terrain sprite tiling (docs/architecture/terrain-tiling.md).
//
// Turns a solid/platform AABB (world px) into a list of draw commands using
// the per-level block/platform sheet art:
//   - width tiling: longest-first (triple → double → single), trim remainder
//   - height stacking (blocks): same logic vertically, bottom-up
//   - frame selection: 75% "best" frame (platform f4 / block f2), 25% random
//     (platform f1–f3 / block f1) — rolled from a per-solid seeded stream so
//     choices are stable across death/Continue (lifecycle.md §6)
//
// Deterministic: same (solid, level, seed) → same tiles, every time.
// Asset loading (sheet JSON + frame PNGs) lives in levelAssets.js — this
// module only decides WHICH tile goes WHERE and reads loaded frames back.

import { UNIT_PX_X, UNIT_PX_Y } from './macros.js';
import { createRng } from './terrain.js';
import { loadLevelAsset, getLevelAsset } from './levelAssets.js';
import { ZONE_FLOOR_UNITS } from './level.js';
import { Entity } from '../core/entity.js';

// --- Frame selection (terrain-tiling.md §Frame selection) ----------------------
const BEST_FRAME_WEIGHT = 0.75;
/** "Best" frame index per kind (0-based): platform f4 → 3, block f2 → 1. */
const BEST_FRAME = { platform: 3, block: 1 };
/** Random-pool frame indices (0-based): platform f1–f3 → 0..2, block f1 → 0. */
const RANDOM_POOL = { platform: [0, 1, 2], block: [0] };

/** Width variants in descending order (longest first). */
const WIDTH_VARIANTS = [3, 2, 1]; // triple, double, single

/** Kick off (or join) the asset load for a terrain kind. Fire-and-forget. */
export function loadTerrainFrames(level, kind) {
  return loadLevelAsset(level, kind);
}

// --- Tiling ---------------------------------------------------------------------

/**
 * Longest-first decomposition: [3,3,2,1,...] summing to n units.
 * @param {number} n positive integer
 * @returns {number[]} variant sizes, largest first
 */
export function decompose(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`decompose: need positive int, got ${n}`);
  const out = [];
  let r = n;
  while (r > 0) {
    const v = WIDTH_VARIANTS.find((c) => c <= r);
    out.push(v);
    r -= v;
  }
  return out;
}

/** Pick a frame index for one tile (deterministic per rng stream + kind). */
function pickFrame(rng, kind, frameCount) {
  const best = Math.min(BEST_FRAME[kind], frameCount - 1);
  const pool = RANDOM_POOL[kind].filter((i) => i < frameCount);
  if (rng.next() < BEST_FRAME_WEIGHT) return best;
  return pool.length > 0 ? pool[Math.floor(rng.next() * pool.length)] : best;
}

/**
 * Tile one solid/platform AABB into draw commands (WORLD coordinates).
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

  const widths = decompose(wUnits);
  const rows = kind === 'block' ? decompose(hUnits) : [1];
  const asset = getLevelAsset(level, kind);
  const anim = asset?.data?.anims[asset.animName];
  const frameCount = anim?.frames.length ?? (kind === 'platform' ? 4 : 2);

  const tiles = [];
  let rowY = s.y + s.h; // bottom edge (screen coords: y grows down)
  for (let r = 0; r < rows.length; r++) {
    const rowH = rows[r] * UNIT_PX_Y;
    rowY -= rowH;
    let colX = s.x;
    for (let c = 0; c < widths.length; c++) {
      const variant = widths[c];
      const frame = pickFrame(rng, kind, frameCount);
      // imgKey: resolved from the parsed sheet when available; otherwise a
      // deterministic placeholder that getTerrainFrameImage() can match once
      // the asset lands (frame file names follow the <kind>_<variant>_f<N>.png
      // convention — see assets/levels/).
      let imgKey = null;
      if (anim) {
        imgKey = anim.frames[frame % anim.frames.length].file;
      } else {
        const vname = variant === 1 ? 'single' : variant === 2 ? 'double' : 'triple';
        imgKey = `${kind}_${vname}_f${frame + 1}.png`;
      }
      tiles.push({
        x: colX,
        y: rowY,
        w: variant * UNIT_PX_X,
        // Both blocks and platforms draw at their natural row height (48px per
        // unit) — no stretching. Platforms are 1 unit thick by definition;
        // blocks stack rows bottom-up. The art keeps its full visual height.
        h: rowH,
        frame,
        kind,
        variant,
        imgKey,
      });
      colX += variant * UNIT_PX_X;
    }
  }
  return tiles;
}

/**
 * Convenience: ensure sheets are parsed, compute tiles, kick off frame loading.
 * Tiles carry imgKey immediately (from parsed sheets); the image MAP fills in
 * when the asset load settles — the render loop skips tiles whose image
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
    e.sprite = { anchor: 'bottom-center', targetH: ZONE_FLOOR_UNITS, tile: true, anims: {}, frames: new Map() };
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
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
