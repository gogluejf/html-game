// Petal Panic — Targeting toolbox (shared aim math).
//
// WHO USES THIS: AI and hero input code — the layers that OWN targeting
// (Design contract rule 9: macros never target; they take a finished
// direction). The attack library itself also consumes `leadAt` internally
// (predictiveShot's intercept pattern), which is why this lives in combat/
// shared logic rather than an enemy-AI folder: dependency stays one-way
// (AI → engine, never engine → AI), and the hero can use it too.
//
// THREE HELPERS, THREE DISTINCT INTENTS:
//   • aimAt       — "point at where it IS"        (bullets, beams, charges)
//   • leadAt      — "point at where it WILL BE"   (intercept / predictive)
//   • ballisticAt — "what launch angle LANDS ON it" (bombs, flat or high lob)
//
// All pure math, no DOM, no state. Entities are read as {x,y,w,h} (+ vx/vy
// for leadAt); origins are {x,y} world points (usually attacker center).

/** Center of an entity box. */
const center = (e) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 });

/**
 * Angle (radians) from origin to the target's CURRENT center.
 * Screen-y-down convention — atan2 handles it; callers pass the result
 * straight into a primitive's `direction`.
 * @param {{x:number,y:number}} origin world point (attacker center)
 * @param {{x:number,y:number,w:number,h:number}} target live entity
 * @returns {number} radians
 */
export function aimAt(origin, target) {
  const c = center(target);
  return Math.atan2(c.y - origin.y, c.x - origin.x);
}

/**
 * Intercept aim: where a projectile (fired at `speed`) and a moving target
 * meet if the target keeps its current velocity. Returns the aim POINT plus
 * the flight time — callers aim at the point (or derive the angle with
 * aimAt-style math on it).
 *
 * @param {{x:number,y:number,w:number,h:number,vx?:number,vy?:number}} target
 * @param {{x:number,y:number}} origin fire origin (world point)
 * @param {number} speed projectile speed px/s
 * @returns {{x:number,y:number,t:number}|null} null when no solution exists
 *   (target outruns the projectile, or geometry has no meeting point).
 */
export function leadAt(target, origin, speed) {
  const c = center(target);
  const vx = target.vx ?? 0, vy = target.vy ?? 0;
  // Relative position of target w.r.t. origin.
  const px = c.x - origin.x, py = c.y - origin.y;
  const v2 = vx * vx + vy * vy;
  const s2 = speed * speed;
  if (v2 >= s2) return null; // target outruns the bullet — no catch-up
  // Quadratic from |p + v·t|² = s²·t²:
  //   (v² − s²)·t² + 2(p·v)·t + |p|² = 0
  const a = v2 - s2;                       // negative (see guard above)
  const b = 2 * (px * vx + py * vy);
  const cc = px * px + py * py;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;               // bullet too slow to ever meet
  const sq = Math.sqrt(disc);
  // Two roots: nearest future meeting (smaller positive t).
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  let t = Infinity;
  if (t1 > 0) t = Math.min(t, t1);
  if (t2 > 0) t = Math.min(t, t2);
  if (!isFinite(t)) return null;
  return { x: c.x + vx * t, y: c.y + vy * t, t };
}

/**
 * Ballistic aim: the launch ANGLE that lands a gravity-affected throw on the
 * target's current position, given fixed launch speed and gravity.
 *
 * Physics: for horizontal distance d and height difference h (positive when
 * the target is BELOW the origin — screen coords), the two valid launch
 * angles share the same speed and both land on the point:
 *
 *   θ = atan( (v² ± √(v⁴ − g·(g·d² + 2·h·v²))) / (g·d) )
 *
 *   style 'flat' → the LOW arc (fast, direct, dangerous-looking)
 *   style 'high' → the HIGH arc (big lob, slow to arrive, readable)
 *
 * Both are real gameplay choices, not cosmetic: flat arrives fast and
 * telegraphs little; high gives the player time to move out from under it.
 *
 * Out of range: when even the 45°-ish maximum can't reach the point at this
 * speed, the discriminant goes negative — we return the max-range angle
 * (π/4 toward the target) so the bomb falls SHORT predictably instead of
 * NaN. Callers who need a guaranteed hit should raise speed or gravity
 * accordingly (that's a weapon-tuning decision, not aiming).
 *
 * @param {{x:number,y:number}} origin launch point (world)
 * @param {{x:number,y:number,w:number,h:number}} target landing point entity
 * @param {{speed?:number, gravity?:number, style?:'flat'|'high'}} opts
 * @returns {{direction:number, reached:boolean}} direction in radians
 *   (screen-y-down); `reached` false when the point was out of range and the
 *   returned angle is the max-range fallback.
 */
export function ballisticAt(origin, target, opts = {}) {
  const v = opts.speed ?? 300;
  const g = opts.gravity ?? 800;
  const style = opts.style ?? 'flat';
  const c = center(target);

  const dx = c.x - origin.x;
  const dy = c.y - origin.y;          // +down (screen convention)
  const d = Math.abs(dx);
  const h = dy;                       // target below origin → h > 0
  const sign = dx >= 0 ? 1 : -1;      // left/right of the launcher

  // Maximum reachable range at this speed/gravity (h = 0 case): v²/g.
  // Beyond it, no angle lands on the point — fall back to 45° toward target.
  const maxRange = (v * v) / g;
  if (d > maxRange || d < 1e-6) {
    // Max-range lobe is 45° UP (screen: negative y).
    return { direction: sign > 0 ? -Math.PI / 4 : Math.PI + Math.PI / 4, reached: false };
  }

  const v2 = v * v;
  const inner = v2 * v2 - g * (g * d * d + 2 * h * v2);
  if (inner < 0) {
    // Height offset ate the range budget — same graceful short-fall.
    return { direction: sign > 0 ? -Math.PI / 4 : Math.PI + Math.PI / 4, reached: false };
  }

  const sq = Math.sqrt(inner);
  // Magnitude of the launch angle ABOVE horizontal. High arc uses the '+'
  // branch (steeper); flat arc uses '−'. Screen coords have +y DOWN, so an
  // upward launch means NEGATIVE vy → direction is −θ for rightward throws.
  const theta = style === 'high'
    ? Math.atan((v2 + sq) / (g * d))
    : Math.atan((v2 - sq) / (g * d));

  // Mirror for targets left of the launcher (up-left = π + θ).
  return { direction: sign > 0 ? -theta : Math.PI + theta, reached: true };
}
