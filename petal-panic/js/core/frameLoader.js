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
      // Cache key MUST be the resolved URL: different sheets reuse the same
      // frame filenames (thorn/saw/spread all ship shoot_f1..f8.png), so a
      // bare-filename key cross-contaminates sheets AND loses onload events
      // (a cached image that already fired onload for another file never
      // resolves this caller's promise → boot hangs on a black screen).
      const src = new URL(`./${frame.file}`, baseDir).href;
      let img = frameCache.get(src);
      if (!img) {
        img = new Image();
        img.src = src;
        frameCache.set(src, img);
      }
      out.set(frame.file, img);
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
