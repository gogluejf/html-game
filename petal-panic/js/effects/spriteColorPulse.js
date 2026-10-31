// Petal Panic — sprite color pulse effect.
// Smoothly fades a sprite's tint from colorA → colorB → colorA over its lifetime,
// clipped to the sprite silhouette (same pipeline as spriteFlash). Supports
// two colors or one color + transparent. Easing controls the fade curve.
//
// The pulse is a single smooth cycle: 0% = colorA, 50% = colorB, 100% = colorA.
// At any point the effective tint is a lerp between A and B; alpha follows the
// same eased progress so at 0% and 100% the sprite shows no tint (or colorA
// at full opacity if colorA is opaque).
//
// params: { colorA?, colorB?, duration?, cycles?, easing?, opacity?, box? }
//   colorA       — start/end CSS color (default 'transparent' = no tint)
//   colorB       — peak CSS color (default '#ffffff')
//   duration     — total lifetime of ONE cycle in seconds (default 0.6)
//   cycles       — number of A→B→A pulses (default 1). -1 = infinite loop.
//   easing       — easing name: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
//                  (default 'easeInOut')
//   opacity      — peak alpha multiplier 0..1 (default 0.9). Scales the final
//                  tint alpha so the pulse never fully obscures the art.
//   box          — fallback geometry {x,y,w,h} for carriers without spriteFrame()
//
// carrier: entity with spriteFrame() for silhouette mode, or worldBox()/origin()+size()
//   for box fallback. Null carrier uses params.box only.

import { tintedImage } from './spriteFlash.js';

const EASINGS = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => 1 - (1 - t) * (1 - t),
  easeInOut: t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
};

/** Parse a CSS color to [r,g,b,a]. Supports '#rgb', '#rrggbb', 'rgba(r,g,b,a)', 'transparent'. */
function parseColor(str) {
  if (!str || str === 'transparent') return [0, 0, 0, 0];
  if (str.startsWith('#')) {
    const h = str.slice(1);
    if (h.length === 3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16), 255];
    if (h.length === 6) return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 255];
    return [0, 0, 0, 0];
  }
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) return [+m[1], +m[2], +m[3], m[4] !== undefined ? +m[4] * 255 : 255];
  return [0, 0, 0, 0];
}

function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ];
}

function toCSS([r, g, b, a]) {
  if (a <= 0) return 'transparent';
  if (a >= 255) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

/**
 * @param {{colorA?:string, colorB?:string, duration?:number, easing?:string,
 *         box?:{x:number,y:number,w:number,h:number}}} params
 * @param {object|null} [carrier]
 * @returns {{update:Function, render:Function, complete:Function, done:boolean}}
 */
export function spriteColorPulse(params = {}, carrier = null) {
  const cycleDuration = Math.max(0.01, params.duration ?? 0.6);
  const cycles = params.cycles ?? 1; // -1 = infinite
  const infinite = cycles === -1;
  const totalDuration = infinite ? Infinity : cycleDuration * Math.max(1, cycles);
  const easingFn = EASINGS[params.easing] ?? EASINGS.easeInOut;
  const colA = parseColor(params.colorA ?? 'transparent');
  const colB = parseColor(params.colorB ?? '#ffffff');
  const peakOpacity = Math.min(1, Math.max(0, params.opacity ?? 0.9));

  return {
    space: 'world',
    done: false,
    elapsed: 0,
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      if (!infinite && this.elapsed >= totalDuration - 1e-9) {
        this.elapsed = totalDuration;
        this.done = true;
      }
    },
    /** Current blended color at this.elapsed, with peakOpacity applied. */
    currentColor() {
      // Which cycle are we in? Progress within that cycle drives A→B→A.
      const cycleIdx = Math.floor(this.elapsed / cycleDuration);
      const cycleProgress = (this.elapsed % cycleDuration) / cycleDuration;
      const raw = Math.min(1, cycleProgress);
      const eased = easingFn(raw);
      const t = eased < 0.5 ? eased * 2 : (1 - eased) * 2;
      const [r, g, b, a] = lerpColor(colA, colB, t);
      // Scale alpha by peakOpacity so the tint never fully obscures the art.
      const finalA = Math.round(a * peakOpacity);
      return toCSS([r, g, b, finalA]);
    },
    render(ctx) {
      if (this.done) return;
      const color = this.currentColor();
      if (color === 'transparent') return;
      // Silhouette mode.
      if (carrier && typeof carrier.spriteFrame === 'function') {
        const f = carrier.spriteFrame();
        if (f && f.img) {
          const tinted = tintedImage(f.img, color);
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
      // Box fallback.
      let box = carrier?.worldBox?.();
      if (!box && carrier?.origin && carrier?.size) {
        const o = carrier.origin(), s = carrier.size();
        box = { x: o.x - s.w / 2, y: o.y - s.h / 2, w: s.w, h: s.h };
      }
      box ??= params.box;
      if (!box || !(box.w > 0 && box.h > 0)) return;
      ctx.save();
      ctx.fillStyle = color;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    },
    complete() { this.done = true; },
  };
}
