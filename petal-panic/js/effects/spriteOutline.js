// Petal Panic — sprite outline effect.
// Draws a solid-color contour around the sprite silhouette using the
// tintedImage pipeline (same as spriteFlash). The outline is rendered by
// drawing the tinted silhouette 4 times, offset by `thickness` px in each
// cardinal direction, then the real frame on top. No pixel manipulation.
//
// This is a STATE effect (not timed): it draws every frame while active.
// Call complete() to remove it. Useful for: selection highlights, target
// indicators, "currently actionable" glows, debug emphasis.
//
// params: { color?, thickness?, opacity? }
//   color      — outline CSS color (default '#000000')
//   thickness  — outline width in px (default 2)
//   opacity    — outline alpha 0..1 (default 1.0)
//
// carrier: entity with spriteFrame() for silhouette mode. Falls back to
// worldBox() stroke for carriers without a sheet frame.

import { tintedImage } from './spriteFlash.js';

/**
 * @param {{color?:string, thickness?:number, opacity?:number}} params
 * @param {object|null} [carrier]
 * @returns {{render:Function, complete:Function, done:boolean}}
 */
export function spriteOutline(params = {}, carrier = null) {
  const color = params.color ?? '#000000';
  const t = Math.max(1, Math.round(params.thickness ?? 2));
  const opacity = Math.min(1, Math.max(0, params.opacity ?? 1.0));

  return {
    space: 'world',
    done: false,
    render(ctx) {
      if (this.done) return;
      // Silhouette mode: tinted offsets behind the real frame.
      if (carrier && typeof carrier.spriteFrame === 'function') {
        const f = carrier.spriteFrame();
        if (f && f.img) {
          const tinted = tintedImage(f.img, color);
          if (tinted) {
            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.translate(f.anchorX, f.anchorY);
            if (f.mirrorX) ctx.scale(-1, 1);
            if (f.mirrorY) ctx.scale(1, -1);
            if (f.rotation) ctx.rotate(f.rotation);
            ctx.scale(f.scale, f.scale);
            // Draw tinted silhouette offset in 4 directions.
            ctx.drawImage(tinted, 0, 0, tinted.width, tinted.height, f.dx - t, f.dy, f.w, f.h);
            ctx.drawImage(tinted, 0, 0, tinted.width, tinted.height, f.dx + t, f.dy, f.w, f.h);
            ctx.drawImage(tinted, 0, 0, tinted.width, tinted.height, f.dx, f.dy - t, f.w, f.h);
            ctx.drawImage(tinted, 0, 0, tinted.width, tinted.height, f.dx, f.dy + t, f.w, f.h);
            // Real frame on top.
            ctx.drawImage(f.img, 0, 0, f.img.naturalWidth, f.img.naturalHeight, f.dx, f.dy, f.w, f.h);
            ctx.restore();
            return;
          }
        }
      }
      // Box fallback: stroke the world box.
      const box = carrier?.worldBox?.() ?? params.box;
      if (!box || !(box.w > 0 && box.h > 0)) return;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = color;
      // Stroke the ACTUAL box: the stroke is centered on the path, so
      // lineWidth = 2t paints exactly t px outside and t px inside —
      // flush with the box edge, no gap, no overshoot.
      ctx.lineWidth = t * 2;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    },
    complete() { this.done = true; },
  };
}
