// Petal Panic — sprite-burst effect (Step A, M4 handoff). Plays a sheet anim's
// frames in sequence at a fixed world point: the bomb detonation art.
//
// Draw effect: render() draws the current frame centered on (x, y) at the
// uniform scale that fits the anim's reference box height onto `size` px —
// the same §4 scaling contract as entity sprites. Frame advance is time-based
// via the anim's fps; done exactly when elapsed >= duration.
//
// params: { x?, y?, size?, duration?, anim? }
//   x, y     — burst center in world space (default {0,0})
//   size     — rendered height in px (default 64)
//   duration — total lifetime in s (default 0.5); the anim plays until it
//              ends or this elapses, whichever comes first
//   anim     — REQUIRED AnimData from parseSheet() ({ fps, mode, frames,
//              collisionBox, pivot }). No default: an effect without art has
//              nothing to draw.

const DEFAULT_SIZE = 64;
const DEFAULT_DURATION = 0.5;

/**
 * @param {{x?:number, y?:number, size?:number, duration?:number, anim?:object}} params
 * @returns {{update:Function, render:Function, done:boolean}}
 */
export function spriteBurst(params = {}) {
  const { x = 0, y = 0, size = DEFAULT_SIZE, duration = DEFAULT_DURATION, anim } = params;
  if (!anim?.frames?.length || !anim.collisionBox) {
    throw new Error('spriteBurst: requires an anim with frames + collisionBox');
  }
  const frames = anim.frames;
  const scale = size / anim.collisionBox.h;
  let t = 0;
  return {
    update(dt) { t += dt; if (t >= duration - 1e-9) this.complete(); },
    render(ctx) {
      const idx = Math.min(frames.length - 1, Math.floor(t * (anim.fps ?? 14)));
      const img = anim._frames?.get(frames[idx].file);
      if (!img || !(img.complete && img.naturalWidth > 0)) return;
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / duration);
      ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
      ctx.restore();
    },
    done: false,
    complete() { this.done = true; },
  };
}
