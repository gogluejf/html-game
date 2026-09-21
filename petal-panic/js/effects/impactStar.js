// Petal Panic — impact-star / hit-pop effect (effects.md §16, catalog #16).
// A very short stylized star/burst/flash at the EXACT impact point for
// punches, kicks, bullets, melee contacts, and lighter impacts.
//
// Draw effect: render() draws a scaling 4-point star centered on the impact
// origin. The pop starts at full size and pops OUT — it scales down along the
// scale curve while fading to zero opacity, then completes exactly when the
// declared `duration` elapses.
//
// params: { x?, y?, size?, duration?, rotation?, opacity?, style?, scaleCurve? }
//   x, y       — impact point in world space; default {0,0}. When the carrier
//                exposes origin(), the DRAW-time carrier position wins over
//                params.x/y (tracks a moving carrier); params are the
//                standalone fallback (theater fires with null carrier).
//   size       — star radius in px at t=0 (default 12)
//   duration   — TOTAL lifetime in seconds; done exactly when `duration`
//                elapses (default 0.1 — "very short")
//   rotation   — base star rotation in radians (default 0)
//   opacity    — peak opacity 0..1, clamped (default 1)
//   style      — 'star' (default, 4-point star) | 'burst' (radial spokes)
//   scaleCurve — name of a predefined curve applied to both scale and alpha
//                over the lifetime: 'linear' (default), 'easeOut', 'easeIn'.
//                Unknown names fall back to 'linear'.

const DEFAULT_SIZE = 12;
const DEFAULT_DURATION = 0.1; // "very short" (effects.md §16)
const DEFAULT_OPACITY = 1;
const STAR_COLOR = '#ffffff';
const BURST_COLOR = '#ffd93b';

/** Scale/alpha curves: progress p in [0,1] → remaining strength in [0,1]. */
const CURVES = {
  linear: (p) => 1 - p,
  easeOut: (p) => Math.pow(1 - p, 2),
  easeIn: (p) => 1 - Math.pow(p, 2),
};

/**
 * @param {{x?:number, y?:number, size?:number, duration?:number,
 *          rotation?:number, opacity?:number, style?:string,
 *          scaleCurve?:string}} params
 * @param {object} [carrier]
 * @param {object} [ctx]
 * @returns {{update:Function, render:Function, complete:Function, done:boolean}}
 */
export function impactStar(params = {}, carrier = null) {
  const size = Math.max(0, params.size ?? DEFAULT_SIZE);
  const duration = Math.max(0, params.duration ?? DEFAULT_DURATION);
  const rotation = params.rotation ?? 0;
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const style = params.style === 'burst' ? 'burst' : 'star';
  const curve = CURVES[params.scaleCurve] ?? CURVES.linear;
  const px = params.x ?? 0;
  const py = params.y ?? 0;

  return {
    space: 'world', // pops at a world-space impact point (two-pass render model, effects.md §Lifecycle)
    elapsed: 0,
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      // <= (not <): floating-point accumulation lands at ~1e-16 past the
      // exact boundary, so a strict comparison would never mark done.
      if (this.elapsed >= duration - 1e-9) this.done = true;
    },
    render(c2d) {
      if (this.done || size <= 0 || opacity <= 1e-9) return;
      // Impact point: prefer the live carrier anchor (tracks a moving
      // carrier); fall back to factory-time params for standalone demos.
      let x = px, y = py;
      if (carrier && typeof carrier.origin === 'function') {
        const o = carrier.origin();
        x = o.x; y = o.y;
      }
      const p = Math.min(1, this.elapsed / duration);
      const s = curve(p); // 1 → 0 over the lifetime
      c2d.save();
      c2d.translate(x, y);
      c2d.rotate(rotation);
      c2d.globalAlpha = opacity * s;
      c2d.fillStyle = style === 'burst' ? BURST_COLOR : STAR_COLOR;
      if (style === 'burst') {
        drawBurst(c2d, size * s);
      } else {
        drawStar(c2d, size * s);
      }
      c2d.restore();
    },
    complete() { this.done = true; },
    done: false,
  };
}

/** 4-point star path (spikes out to r, inner radius r*0.382 ≈ r·sin22.5/sin67.5). */
function drawStar(c2d, r) {
  const inner = r * 0.382;
  c2d.beginPath();
  for (let i = 0; i < 8; i++) {
    const rad = i % 2 === 0 ? r : inner;
    const a = (i * Math.PI) / 4;
    const vx = Math.cos(a) * rad;
    const vy = Math.sin(a) * rad;
    if (i === 0) c2d.moveTo(vx, vy); else c2d.lineTo(vx, vy);
  }
  c2d.closePath();
  c2d.fill();
}

/** Radial burst: 8 spokes from center out to r. */
function drawBurst(c2d, r) {
  c2d.lineWidth = Math.max(1, r * 0.15);
  c2d.lineCap = 'round';
  c2d.strokeStyle = c2d.fillStyle;
  c2d.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    c2d.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
    c2d.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c2d.stroke();
}
