// Petal Panic — sprite-burst effect (Step A, M4 handoff). Plays a sheet anim's
// frames in sequence at a fixed world point: the bomb detonation art.
//
// Dual-mode (same contract as entity sprites — gated on isHighGraphic(), NOT
// on whether the asset happens to be loaded):
//   - high-graphic: render() draws the current frame centered on (x, y) at
//     the uniform scale that fits the anim's reference box height onto `size`
//     px — the same §4 scaling contract as entity sprites. Frame advance is
//     time-based via the anim's fps; done exactly when elapsed >= duration.
//     If the sheet isn't loaded yet, falls through to the fallback drawer.
//   - primitive-graphic: render() calls the PROCEDURAL drawer passed as
//     `fallback` — an expanding flash core + shock ring. The caller
//     (explosion primitive) owns what the fallback looks like; this effect
//     just renders whichever input the mode selects.
//
// params: { x?, y?, size?, duration?, anim?, fallback? }
//   x, y     — burst center in world space (default {0,0})
//   size     — rendered height in px (default 64)
//   duration — total lifetime in s (default 0.5); the anim plays until it
//              ends or this elapses, whichever comes first
//   anim     — AnimData from parseSheet() ({ fps, mode, frames, collisionBox,
//              pivot } + _frames image map). Used in high-graphic mode.
//   fallback — procedural drawer (ctx, state) => void for primitive mode.
//              state = { x, y, size, t, duration, progress }. No default:
//              without a fallback, primitive mode renders nothing.

import { isHighGraphic } from '../core/renderMode.js';

const DEFAULT_SIZE = 64;
const DEFAULT_DURATION = 0.5;

/**
 * @param {{x?:number, y?:number, size?:number, duration?:number, anim?:object, fallback?:Function}} params
 * @returns {{update:Function, render:Function, done:boolean}}
 */
export function spriteBurst(params = {}) {
  const { x = 0, y = 0, size = DEFAULT_SIZE, duration = DEFAULT_DURATION, anim, fallback } = params;
  const hasSheet = !!(anim?.frames?.length && anim.collisionBox);
  if (!hasSheet && typeof fallback !== 'function') {
    throw new Error('spriteBurst: requires an anim with frames + collisionBox, or a fallback drawer');
  }
  const frames = hasSheet ? anim.frames : null;
  const scale = hasSheet ? size / anim.collisionBox.h : 1;
  let t = 0;
  return {
    update(dt) { t += dt; if (t >= duration - 1e-9) this.complete(); },
    render(ctx) {
      // High-graphic: draw the current sheet frame. Missing/unloaded frames
      // fall through to the procedural fallback so pre-boot still shows it.
      if (isHighGraphic() && frames) {
        const idx = Math.min(frames.length - 1, Math.floor(t * (anim.fps ?? 14)));
        const img = anim._frames?.get(frames[idx].file);
        // Real images expose complete/naturalWidth; synthetic demo frames
        // (theater fallback) don't — accept anything non-null in that case.
        if (img && !((img.complete !== undefined) && !(img.complete && img.naturalWidth > 0))) {
          const w = (img.naturalWidth ?? 32) * scale;
          const h = (img.naturalHeight ?? 32) * scale;
          if (typeof ctx.drawImage === 'function') {
            ctx.save();
            ctx.globalAlpha = Math.max(0, 1 - t / duration);
            ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
            ctx.restore();
          }
          return;
        }
      }
      // Primitive mode (or unloaded sheet): procedural drawer owned by the caller.
      if (typeof fallback === 'function') {
        fallback(ctx, { x, y, size, t, duration, progress: Math.min(1, t / duration) });
      }
    },
    done: false,
    complete() { this.done = true; },
  };
}
