// Self-contained sprite replacement: hide the original while this owns drawing.
// Retains its destination until complete(), or hands off via onFinish with hold=false.
// When the carrier exposes spriteFrame(), frames are drawn through the entity's
// transform pipeline (silhouette-accurate). Otherwise falls back to box stretch.
import { tintedImage } from './spriteFlash.js';

const positive = (v, fallback) => Number.isFinite(v) && v > 0 ? v : fallback;

export function blinkTransition(params = {}, carrier = null) {
  const duration = positive(params.duration, 2);
  const speed = positive(params.speed, 2); // initial switches/second
  const endSpeed = Math.max(speed, positive(params.endSpeed, 30));
  const acceleration = positive(params.acceleration, 2);
  const frames = [params.frameA ?? null, params.frameB ?? null];
  const reverse = params.direction === 'reverse';
  const source = reverse ? 1 : 0;
  const destination = 1 - source;
  const hold = params.hold !== false;
  return {
    space: 'world', done: false, settled: false, elapsed: 0,
    // Integral of the ease-in switch rate: independent of timestep partitioning.
    phase() {
      const p = Math.min(1, this.elapsed / duration);
      return duration * (speed * p + (endSpeed - speed) * p ** (acceleration + 1) / (acceleration + 1));
    },
    frameIndex() { return this.settled ? destination : (Math.floor(this.phase() + 1e-9) % 2 ? destination : source); },
    frame() { return frames[this.frameIndex()]; },
    update(dt) {
      if (this.done || this.settled || !Number.isFinite(dt) || dt <= 0) return;
      this.elapsed = Math.min(duration, this.elapsed + dt);
      if (this.elapsed >= duration - 1e-9) {
        this.elapsed = duration;
        this.settled = true;
        if (!hold) this.done = true;
        if (typeof params.onFinish === 'function') params.onFinish(this.frame(), this.frameIndex());
      }
    },
    render(ctx) {
      if (this.done) return;
      const frame = this.frame();
      if (frame == null) return;
      // Silhouette mode: carrier has spriteFrame() and frame is a color string.
      // Tint the actual PNG silhouette (same pipeline as spriteFlash).
      if (carrier && typeof carrier.spriteFrame === 'function' && typeof frame === 'string') {
        const f = carrier.spriteFrame();
        if (f && f.img) {
          const tinted = tintedImage(f.img, frame);
          if (tinted) {
            ctx.save();
            ctx.translate(f.anchorX, f.anchorY);
            if (f.mirrorX) ctx.scale(-1, 1);
            if (f.mirrorY) ctx.scale(1, -1);
            if (f.rotation) ctx.rotate(f.rotation);
            ctx.scale(f.scale, f.scale);
            ctx.drawImage(tinted, 0, 0, tinted.width, tinted.height, f.dx, f.dy, f.w, f.h);
            ctx.restore();
            return;
          }
        }
      }
      // Box fallback: stretch frame into the bounding rect.
      let box = carrier?.worldBox?.();
      if (!box && carrier?.origin && carrier?.size) {
        const o = carrier.origin(), s = carrier.size();
        box = { x: o.x - s.w / 2, y: o.y - s.h / 2, w: s.w, h: s.h };
      }
      box ??= params.box;
      if (!box || !(box.w > 0 && box.h > 0)) return;
      ctx.save();
      try {
        if (typeof frame === 'string') {
          ctx.fillStyle = frame;
          ctx.fillRect(box.x, box.y, box.w, box.h);
        } else {
          ctx.drawImage(frame, box.x, box.y, box.w, box.h);
        }
      } finally { ctx.restore(); }
    },
    complete() { this.done = true; },
  };
}
