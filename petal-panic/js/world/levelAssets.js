// Petal Panic — Level asset loader (single pipeline for per-level art).
//
// ONE path template, ONE fetch/parse/load pipeline, ONE cache, ONE failure
// policy for everything that lives under assets/levels/levelN/:
//   - terrain sheets: block / platform (merged single+double+triple variants)
//   - floor strip:    fg
//   - parallax bg:    bg (+ vertical variant file)
//
// This replaces three hand-rolled loaders (parallax.js bgImages,
// terrainTiles.js sheet/frame caches) that had divergent caching and failure
// behavior — the divergence is how the "barrels/floor stop drawing after
// level 1" bug class happened twice.
//
// Failure policy: a rejected load EVICTS its cache entry so the next call
// retries. A poisoned session cache is how one transient miss used to black
// out terrain for the whole game, including restarts.
//
// Node-safe: with no DOM/Image (tests) image maps resolve empty; JSON still
// parses via fs so headless tests can assert on sheet data.

import { parseSheet } from '../core/spriteData.js';
import { loadFrames } from '../core/frameLoader.js';

/** Asset names owned by this loader. */
export const LEVEL_ASSET_NAMES = ['block', 'platform', 'fg', 'bg', 'vertical'];

/**
 * Read one JSON file relative to THIS module (browser: fetch, node: fs).
 * @param {string} relPath e.g. 'assets/levels/level1/fg_sheet.json'
 */
async function readJson(relPath) {
  const url = new URL(`../../${relPath}`, import.meta.url).href;
  if (url.startsWith('file:') || typeof fetch === 'undefined') {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    return JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`levelAssets: HTTP ${res.status} for ${relPath}`);
  return res.json();
}

/**
 * Parse the sheet JSON(s) behind an asset name. Terrain kinds merge their
 * three width variants into one SpriteData (the tiler picks frames across
 * them); fg/bg/vertical are single-entity sheets.
 * @param {number} level 1-based level index
 * @param {string} name one of LEVEL_ASSET_NAMES
 * @returns {Promise<{data:object, animName:string, baseDir:string}>}
 */
async function parseAsset(level, name) {
  const dir = `assets/levels/level${level}`;
  let json;
  if (name === 'block' || name === 'platform') {
    const variants = [1, 2, 3].map((v) =>
      readJson(`${dir}/${name}_${v === 1 ? 'single' : v === 2 ? 'double' : 'triple'}_sheet.json`));
    const sheets = await Promise.all(variants);
    // Merge the three variant sheets into one SpriteData (frame files are
    // uniquely named <kind>_<variant>_f<N>.png, so no key collisions).
    json = sheets.map((s) => ({
      entities: (s.entities ?? []).map((e) => ({
        ...e,
        frames: e.frames.map((f) => ({ file: f.file, bbox: f.bbox })),
      })),
    }));
  } else {
    json = await readJson(`${dir}/${name}_sheet.json`);
  }
  const data = parseSheet(json);
  const animName = Object.keys(data.anims)[0];
  const baseDir = new URL(`../../${dir}/`, import.meta.url).href;
  return { data, animName, baseDir };
}

/** Cache: `${level}:${name}` → { promise, value } (value set on settle). */
const assetJobs = new Map();

/**
 * Load one level asset: parsed SpriteData + frame images.
 * Resolves `{ data, animName, frames }`; frames is an empty Map in node or
 * while images are still decoding (callers render what they have).
 *
 * @param {number} level 1-based level index
 * @param {string} name one of LEVEL_ASSET_NAMES
 */
export function loadLevelAsset(level, name) {
  const key = `${level}:${name}`;
  let entry = assetJobs.get(key);
  if (!entry) {
    entry = { promise: null, value: null };
    entry.promise = (async () => {
      const { data, animName, baseDir } = await parseAsset(level, name);
      const frames = await loadFrames(data, baseDir);
      return { data, animName, frames };
    })().then((v) => { entry.value = v; return v; }, (err) => {
      console.warn(`[level-assets] ${key} failed to load`, err);
      assetJobs.delete(key); // retry on next call — never poison the session
      return { data: null, animName: null, frames: new Map() };
    });
    assetJobs.set(key, entry);
  }
  return entry.promise;
}

/**
 * Synchronous lookup for the render loop: the SETTLED value of a loaded asset
 * ({data, animName, frames}), or null while loading / after eviction.
 */
export function getLevelAsset(level, name) {
  return assetJobs.get(`${level}:${name}`)?.value ?? null;
}

/** Test helper: clear all cached asset jobs. */
export function _clearLevelAssetCache() {
  assetJobs.clear();
}
