// Petal Panic — Per-level parallax background.
//
// Draws the level's background art BEHIND the world (before the camera
// translate in render.js), offset by a fraction of the camera position so it
// drifts slowly as the hero moves.
//
// Sizing rules (simple, per user spec):
//   - horizontal areas: bg_f1.png scaled to VIEW_H tall, tiled horizontally.
//     Parallax factor 1/BG_PARALLAX_DIVISOR on x only.
//   - vertical areas: vertical_f1.png scaled to VIEW_W wide, tiled vertically.
//     Parallax factor 1/BG_PARALLAX_DIVISOR on y only.
//   - boss zone: reuses the horizontal bg (the approach is a horizontal run).
//
// The divisor is the single tuning knob: 4 = quarter-speed drift, 8 = eighth.

import { VIEW_W, VIEW_H } from '../core/view.js';
import { gameplaySurfaceBounds } from '../core/layout.js';

/** Background drift speed relative to the camera (higher = slower drift). */
export const BG_PARALLAX_DIVISOR = 4;

/** Cache of loaded bg images keyed by asset path. */
const bgImages = new Map();

/**
 * Get (and lazily load) a background image for a level + orientation.
 * @param {number} level 1-based level index (assets live under assets/levels/levelN/)
 * @param {'horizontal'|'vertical'} orientation which sheet variant to use
 * @returns {HTMLImageElement|null} null when no DOM / not yet complete
 */
export function getBgImage(level, orientation) {
  if (typeof Image === 'undefined') return null; // node tests
  const file = orientation === 'vertical' ? 'vertical_f1.png' : 'bg_f1.png';
  const path = `../../assets/levels/level${level}/${file}`;
  let img = bgImages.get(path);
  if (!img) {
    img = new Image();
    img.src = new URL(path, import.meta.url).href;
    bgImages.set(path, img);
  }
  return (img.complete && img.naturalWidth > 0) ? img : null;
}

/**
 * Draw the parallax background for the active zone into the gameplay surface.
 * Must be called BEFORE the camera translate (viewport space).
 *
 * Covers the FULL visible gameplay surface — in fullscreen layout mode that
 * extends past the 960px logical box into the side strips, so the tile range
 * is computed from gameplaySurfaceBounds(), not VIEW_W alone.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number}} cam camera top-left in world coords
 * @param {number} level 1-based level index
 * @param {'horizontal'|'vertical'|'boss'} orientation active zone orientation
 */
export function drawParallaxBg(ctx, cam, level, orientation) {
  const vertical = orientation === 'vertical';
  const img = getBgImage(level, vertical ? 'vertical' : 'horizontal');
  if (!img) return; // still loading — caller's flat fill shows through

  // Visible window in centered gameplay coordinates (may exceed VIEW_W in
  // fullscreen layout mode — the side strips must show bg too).
  const surf = gameplaySurfaceBounds();
  const winX = surf.x;
  const winW = surf.w;
  const winH = surf.h;

  const offX = -cam.x / BG_PARALLAX_DIVISOR;
  const offY = -cam.y / BG_PARALLAX_DIVISOR;

  if (vertical) {
    // Scale to the LOGICAL viewport width and tile down the climb, anchored
    // to the centered 960x540 gameplay box — NOT the fullscreen surface. The
    // level itself never fills the side strips (the lethal bottom keeps the
    // hero inside the logical view), so the bg must stay there too.
    // Tiles are aligned to the camera grid (mirroring horizontal): the first
    // tile sits AT the camera's bottom edge (offY), so at cam.y = 0 the art
    // starts exactly at the top of the view — same as horizontal starting at
    // camera x = 0.
    // Clip to the logical box so any tile overflow is hidden (overflow:hidden)
    // — in fullscreen layout the box is smaller than the canvas.
    const scale = VIEW_W / img.naturalWidth;
    const w = VIEW_W;
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();
    for (let i = 0; i * h < offY + VIEW_H; i++) {
      ctx.drawImage(img, 0, offY + i * h, w, h);
    }
    ctx.restore();
  } else {
    // Scale to viewport height, tile across the corridor.
    const scale = winH / img.naturalHeight;
    const h = winH;
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    // First tile that overlaps the visible window [winX, winX+winW).
    const first = Math.floor((winX - offX) / w);
    for (let i = first; i * w + offX < winX + winW; i++) {
      ctx.drawImage(img, offX + i * w, 0, w, h);
    }
  }
}
