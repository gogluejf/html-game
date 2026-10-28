// Petal Panic — Frame image loader (DOM adapter for spriteData.js).
//
// Loads the PNGs referenced by a SpriteData model and caches them module-wide
// so every entity sharing a sheet pays the network cost once. Browser-only in
// effect: in node (tests) Image is undefined and loadFrames() resolves with an
// empty map — callers fall back to placeholder rendering until real images
// exist, which is exactly the legacy behavior.

/** Module-level cache: absolute frame path → HTMLImageElement. */
const frameCache = new Map();

/**
 * Load all frames of one or more anims.
 *
 * @param {object} spriteData SpriteData from parseSheet()
 * @param {string} baseDir directory (relative to the CALLING module) that
 *   contains the frame files, e.g. 'objects/checkpoint' resolved via
 *   `new URL(baseDir, import.meta.url)`. In practice callers pass the frames_dir
 *   minus the project prefix, or an explicit path they own.
 * @returns {Promise<Map<string, HTMLImageElement>>} file → image
 */
export function loadFrames(spriteData, baseDir) {
  if (typeof Image === 'undefined') return Promise.resolve(new Map());
  const out = new Map();
  const jobs = [];
  for (const anim of Object.values(spriteData.anims)) {
    for (const frame of anim.frames) {
      const key = frame.file;
      if (out.has(key)) continue;
      let img = frameCache.get(key);
      if (!img) {
        img = new Image();
        // Resolve relative to baseDir (a URL built by the caller).
        img.src = new URL(`./${frame.file}`, baseDir).href;
        frameCache.set(key, img);
      }
      out.set(key, img);
      if (!(img.complete && img.naturalWidth > 0)) {
        jobs.push(new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve; // still resolve — caller checks .complete
        }));
      }
    }
  }
  return Promise.all(jobs).then(() => out);
}

/** Test helper: clear the image cache. */
export function _clearFrameCache() {
  frameCache.clear();
}
