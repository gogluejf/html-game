// Petal Panic — Animation controller (design §11).
//
// The Anim class is a lightweight, per-entity frame sequencer. It answers two
// questions only: WHICH frame to show and HOW FAST to advance. All transform
// state (rotation, scale, mirrorX/Y) lives on the Entity (§3); draw() reads
// those fields so the entity remains the single source of truth for its look.
//
// Typical usage:
//   const anim = new Anim(frames, { speed: 100, loop: true });
//   entity.anim = anim;
//   // in update:  entity.anim.tick(dt);
//   // in render:  entity.draw(ctx)  →  calls anim.draw(ctx, entity) internally

export class Anim {
  /**
   * @param {Array<HTMLImageElement|HTMLCanvasElement>} frames
   *        Array of drawable images (or canvases). Must be non-empty.
   * @param {object} [opts]
   * @param {number} [opts.speed=100]  Milliseconds per frame.
   * @param {boolean} [opts.loop=true] If false, the animation stops at the
   *                                   last frame and sets `done` to true.
   */
  constructor(frames, { speed = 100, loop = true } = {}) {
    this.frames = frames;
    this.speed = speed;
    this.loop = loop;
    this.i = 0;       // current frame position (float; fractional part = time within frame)
    this.done = false; // true when a non-looping anim has reached its final frame
  }

  /**
   * Advance the animation by dt seconds.
   * No-op if the animation is already done (non-looping finished).
   * @param {number} dt delta time in seconds
   */
  tick(dt) {
    if (this.done) return;
    this.i += (dt * 1000) / this.speed;
    if (this.i >= this.frames.length) {
      if (this.loop) {
        this.i %= this.frames.length;
      } else {
        // Clamp to last frame and mark finished.
        this.i = this.frames.length - 1;
        this.done = true;
      }
    }
  }

  /**
   * Current integer frame index (safe to use as an array subscript).
   * @returns {number}
   */
  get frameIndex() {
    return Math.floor(this.i);
  }

  /**
   * Override the current frame immediately (e.g., melee active-frame,
   * one-shot direction swap). Resets the done flag so a finished non-looping
   * anim can be re-driven from the chosen frame.
   * @param {number} n frame index to jump to
   */
  pickFrame(n) {
    this.i = n;
    this.done = false;
  }

  /** Reset to the first frame and clear the done flag. */
  reset() {
    this.i = 0;
    this.done = false;
  }

  /**
   * Draw the current frame. Assumes the caller (Entity.draw) has ALREADY
   * applied translate/mirror/rotate/scale — the context origin is at the
   * entity's visual center with all transforms in place. Anim only decides
   * WHICH frame to show; transform state lives on the Entity (§3).
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./entity.js').Entity} entity
   */
  draw(ctx, entity) {
    const img = this.frames[this.frameIndex];
    if (!img) return;
    // Caller (Entity.draw) has already applied translate/mirror/rotate/scale.
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
  }
}

/**
 * Create a simple colored-rectangle "frame" as an offscreen canvas.
 * Useful for testing the animation system before real sprites are loaded.
 *
 * @param {number} w width in px
 * @param {number} h height in px
 * @param {string} color CSS fill color
 * @returns {HTMLCanvasElement}
 */
export function makeTestFrame(w, h, color) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  // Thin border so adjacent frames are distinguishable even if colors are similar.
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, w - 2, h - 2);
  return c;
}
