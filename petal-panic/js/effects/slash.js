// Petal Panic — Slash effect (effects.md §21, catalog #21).
// Three parallel claw/blade traces appear instantly in front of a carrier and
// fade quickly. Presentation only; gameplay collision remains separate.

const DEFAULT_ANGLE = -Math.PI / 4; // -45° relative to carrier facing
const DEFAULT_LENGTH = 52;          // px per trace
const DEFAULT_SPACING = 9;          // px between parallel traces
const DEFAULT_THICKNESS = 4;        // px stroke width
const DEFAULT_TRACE_COUNT = 3;
const DEFAULT_FORWARD_OFFSET = 34;  // px in front of carrier origin
const DEFAULT_DURATION = 0.1;       // s — fast hit flash
const DEFAULT_OPACITY = 0.95;
const DEFAULT_COLOR = '#ffffff';
const DEFAULT_FOLLOW_ENTITY = false;
const EPS = 1e-9;

/**
 * @param {{angle?:number, length?:number, spacing?:number, thickness?:number,
 *          traceCount?:number, forwardOffset?:number, duration?:number,
 *          opacity?:number, color?:string, followEntity?:boolean,
 *          orientation?:number, x?:number, y?:number}} params
 * @param {object} [carrier]
 */
export function slash(params = {}, carrier = null) {
  const angle = Number.isFinite(params.angle) ? params.angle : DEFAULT_ANGLE;
  const length = Math.max(0, params.length ?? DEFAULT_LENGTH);
  const spacing = Math.max(0, params.spacing ?? DEFAULT_SPACING);
  const thickness = Math.max(0, params.thickness ?? DEFAULT_THICKNESS);
  const traceCount = Math.max(1, Math.round(params.traceCount ?? DEFAULT_TRACE_COUNT));
  const forwardOffset = params.forwardOffset ?? DEFAULT_FORWARD_OFFSET;
  const duration = params.duration > 0 ? params.duration : DEFAULT_DURATION;
  const opacity = Math.min(1, Math.max(0, params.opacity ?? DEFAULT_OPACITY));
  const color = params.color ?? DEFAULT_COLOR;
  const followEntity = !!params.followEntity;
  const fallback = { x: params.x ?? 0, y: params.y ?? 0 };
  const fallbackOrientation = Number.isFinite(params.orientation) ? params.orientation : 0;

  const frozenOrigin = resolveOrigin(carrier, fallback);
  const frozenFacing = facingAngleOf(carrier, fallbackOrientation);

  return {
    space: 'world',
    done: false,
    elapsed: 0,
    origin: frozenOrigin,
    facingAngle: frozenFacing,

    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      if (followEntity) {
        this.origin = resolveOrigin(carrier, fallback);
        this.facingAngle = facingAngleOf(carrier, fallbackOrientation);
      }
      if (this.elapsed >= duration - EPS) this.done = true;
    },

    render(c2d) {
      if (this.done || length <= EPS || thickness <= EPS || opacity <= EPS) return;

      const origin = followEntity ? resolveOrigin(carrier, fallback) : this.origin;
      const facing = followEntity ? facingAngleOf(carrier, fallbackOrientation) : this.facingAngle;
      const slashAngle = facing + angle;
      const fx = Math.cos(facing), fy = Math.sin(facing);
      const dx = Math.cos(slashAngle), dy = Math.sin(slashAngle);
      const nx = -dy, ny = dx;
      const centerX = origin.x + fx * forwardOffset;
      const centerY = origin.y + fy * forwardOffset;
      const alpha = opacity * Math.max(0, 1 - this.elapsed / duration);
      if (alpha <= EPS) return;

      // Each trace is a tapered polygon: full width at the BASE (near carrier),
      // tapering to a point at the TIP — matching the trail's head→tail visual.
      // Shape: isoceles triangle with a rounded base (two perpendicular half-
      // widths at the base, converging to a single point at the tip).
      c2d.save();
      c2d.globalAlpha = alpha;
      c2d.fillStyle = color;
      const mid = (traceCount - 1) / 2;
      const halfW = thickness / 2;
      for (let i = 0; i < traceCount; i++) {
        const lane = (i - mid) * spacing;
        const cx = centerX + nx * lane;
        const cy = centerY + ny * lane;
        // Base center (near carrier side) and tip (far side)
        const baseX = cx - dx * (length / 2);
        const baseY = cy - dy * (length / 2);
        const tipX = cx + dx * (length / 2);
        const tipY = cy + dy * (length / 2);
        // Perpendicular spread at the base
        const bLx = baseX + nx * halfW;
        const bLy = baseY + ny * halfW;
        const bRx = baseX - nx * halfW;
        const bRy = baseY - ny * halfW;
        c2d.beginPath();
        c2d.moveTo(bLx, bLy);
        c2d.lineTo(tipX, tipY);
        c2d.lineTo(bRx, bRy);
        c2d.closePath();
        c2d.fill();
      }
      c2d.restore();
    },

    complete() { this.done = true; },
  };
}

function resolveOrigin(carrier, fallback) {
  if (carrier && typeof carrier.origin === 'function') {
    const o = carrier.origin();
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x, y: o.y };
  }
  return { x: fallback.x, y: fallback.y };
}

function facingAngleOf(carrier, fallback) {
  if (carrier && typeof carrier.facing === 'function') {
    const f = carrier.facing();
    if (Number.isFinite(f)) return f;
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y) && Math.hypot(f.x, f.y) > EPS) {
      return Math.atan2(f.y, f.x);
    }
  }
  return fallback;
}
