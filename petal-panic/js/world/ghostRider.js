// Ghost rider — drives a headless hero through a macro draft using the REAL
// game physics step. Pure logic: importable from Node tests and the editor.
//
// World model (screen px, y DOWN — same as the game runtime):
//   floor top at y = groundY; unit row r surface at groundY - r*UY
// Entry is on the left (horizontal) or bottom (vertical); exit right / top.

import { createHeadlessHero, stepHeadless } from '../hero/headless.js';
import { HEROES } from '../hero/heroDefs.js';
import { GRAVITY, DOUBLE_JUMP_FACTOR, SUPERMOVE_DUR, SUPERMOVE_BURST_FRAC, SUPERMOVE_SPEED, SUPERMOVE_RESIDUAL, UNIT_PX_X, UNIT_PX_Y } from '../consts.js';
import { doubleJumpReachForStats, superAssistReachForStats, PLATFORM_DRAW_H } from './macros.js';

const DT = 1 / 60;
const MAX_ATTEMPTS = 8;
const MAX_STEPS_PER_LAP = 60 * 90; // 90 s of sim per lap — runaway guard

/**
 * Convert a macro draft (unit space, y-up rows) into ride solids + bounds.
 */
export function buildRideWorld(macro, c = {}) {
  // Authoritative grid (square-grid-v1): one shared 48×48 cell for every ride
  // consumer (browser editor + headless node). No caller overrides — the game
  // and the editor must never diverge on units.
  const UX = UNIT_PX_X;
  const UY = UNIT_PX_Y;
  const PDH = c.platformDrawH ?? PLATFORM_DRAW_H;
  const vertical = macro.orientation === 'vertical';
  const units = macro.units || [];

  let maxX = 0, maxY = 0;
  for (const u of units) {
    maxX = Math.max(maxX, (u.x ?? 0) + (u.width ?? 1));
    maxY = Math.max(maxY, (u.y ?? 0) + (u.kind === 'block' ? (u.height ?? 1) : 1));
  }
  const zoneW = vertical ? Math.max(maxX, 13) : Math.max(maxX, 56);
  const zoneRows = vertical ? Math.max(maxY, 56) : Math.max(maxY, 10);

  const W = zoneW * UX;
  const H = zoneRows * UY;
  const groundY = H; // floor top (feet rest here)

  const solids = [{ x: 0, y: groundY, w: W, h: UY }]; // continuous floor
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const px = (u.x ?? 0) * UX;
    if (u.kind === 'block') {
      const h = (u.height ?? 1) * UY;
      const py = groundY - (u.y ?? 0) * UY - h;
      solids.push({ x: px, y: py, w: (u.width ?? 1) * UX, h, oneWay: false, unitIndex: i });
    } else {
      const faceRow = (u.y ?? 0) + 1; // landing face elevation (rows up)
      const py = groundY - faceRow * UY;
      solids.push({ x: px, y: py, w: (u.width ?? 1) * UX, h: PDH, oneWay: true, unitIndex: i });
    }
  }

  return {
    vertical,
    W, H, groundY, UX, UY,
    solids,
    entry: vertical ? { x: W / 2, y: groundY } : { x: UX * 0.5, y: groundY },
    exit: vertical ? { x: W / 2, y: UY } : { x: W - UX * 0.5, y: groundY },
    landings: units.map((u, i) => {
      const px = (u.x ?? 0) * UX;
      if (u.kind === 'block') {
        const topRow = (u.y ?? 0) + (u.height ?? 1);
        return { index: i, x0: px, x1: px + (u.width ?? 1) * UX, y: groundY - topRow * UY, kind: 'block' };
      }
      const faceRow = (u.y ?? 0) + 1;
      return { index: i, x0: px, x1: px + (u.width ?? 1) * UX, y: groundY - faceRow * UY, kind: 'platform' };
    }),
  };
}

/**
 * Run the ghost ride over a macro draft.
 * @returns {{cleared:boolean, path:Array<{x,y}>, visited:number[],
 *            failPoint:{x,y,reason}|null, attempts:number}}
 */
export function runGhostRide(macro, opts = {}) {
  const world = buildRideWorld(macro, opts);
  const result = { cleared: false, path: [], visited: new Set(), failPoint: null, attempts: 0 };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result.attempts = attempt;
    const outcome = rideOnce(world, attempt);
    if (outcome.cleared) {
      return { cleared: true, path: outcome.path, visited: [...result.visited], failPoint: null, attempts: attempt };
    }
    result.failPoint = { x: outcome.failX, y: outcome.failY, reason: outcome.reason };
    result.path = outcome.path; // keep the latest attempt's trail for display
    if (attempt < MAX_ATTEMPTS && outcome.safeX != null) {
      world._retryFrom = { x: outcome.safeX, y: outcome.safeY };
      world._preferSuper = attempt % 2 === 0;
    }
  }
  return { cleared: false, path: result.path, visited: [...result.visited], failPoint: result.failPoint, attempts: result.attempts };
}

// ---------------------------------------------------------------------------
// One lap: deterministic rule-driven driving until exit, fall, or timeout.
// ---------------------------------------------------------------------------

export function rideOnce(world, attempt) {
  const { vertical, W, H, groundY, UX, UY, solids, landings } = world;
  const heroKey = 'balthazar'; // weakest hero governs
  // UNIT→PX conversion point (pixel-hardcode-audit.md Tier 2): def stats are unit-native.
  const stats = { ...HEROES[heroKey].stats, speed: HEROES[heroKey].stats.speed * UNIT_PX_X, jump: HEROES[heroKey].stats.jump * UNIT_PX_Y };
  const start = world._retryFrom ?? world.entry;
  const hero = createHeadlessHero(heroKey, { x: start.x - 8, y: start.y - 40 });

  const path = [];
  const visited = new Set();
  let lastSafe = { x: start.x, y: start.y };
  let lastSafeFrame = 0;
  let superUsed = false;
  let steps = 0;
  let onOneWayNow = false;
  let jumpHeld = false;

  const feetY = () => hero.worldBox().y + hero.worldBox().h;
  const centerX = () => hero.worldBox().x + hero.worldBox().w / 2;

  const doubleJumpApexPx = (() => {
    const first = (stats.jump * stats.jump) / (2 * GRAVITY);
    const second = DOUBLE_JUMP_FACTOR * stats.jump;
    return first + (second * second) / (2 * GRAVITY);
  })();

  /** Highest solid under the hero within tolerance (actual support). */
  const supportUnder = () => {
    const cx = centerX(), fy = feetY();
    let best = null;
    for (const s of solids) {
      if (s.oneWay && hero.droppingThrough) continue;
      if (cx < s.x || cx > s.x + s.w) continue;
      const gap = s.y - fy;
      if (gap >= -4 && gap <= 6) {
        if (!best || s.y < best.y) best = s;
      }
    }
    return best;
  };

  /** Next surface ahead of the current support's far edge. */
  const nextAhead = (support) => {
    const edgeX = support.x + support.w;
    const win = 16 * UX;
    let best = null;
    for (const s of solids) {
      if (s.x < edgeX - 2 || s.x >= edgeX + win) continue;
      if (s.x + s.w <= edgeX) continue;
      if (!best || s.x < best.x) best = s;
    }
    return best;
  };

  /** Solid directly in front of the hero (side collision)? */
  const wallInFront = () => {
    const cx = centerX(), fy = feetY();
    const noseX = cx + 18;
    let best = null;
    for (const s of solids) {
      if (s.oneWay) continue;
      if (s.x > noseX - 4 && s.x < noseX + 24) {
        const botRow = s.y + s.h;
        if (botRow > fy - 4 && s.y < fy + UY * 0.5) {
          if (!best || s.x < best.x) best = s;
        }
      }
    }
    return best;
  };

  /** Seek a higher landing ahead (staircase/platform hop) and jump for it. */
  const seekLanding = () => {
    const cx = centerX(), fy = feetY();
    let target = null;
    for (const l of landings) {
      if (l.x0 < cx - UX * 0.5) continue;
      if (l.x0 > cx + 14 * UX) continue;
      const rise = fy - l.y;
      if (rise < UY * 0.3) continue;
      if (rise > doubleJumpApexPx * 0.92) continue;
      if (!target || l.x0 < target.x0) target = l;
    }
    if (target) {
      const distToTarget = target.x0 - cx;
      const rise = fy - target.y;
      const djReach = minDoubleJumpReach(stats, rise);
      // Take off only when close enough that the arc actually lands on the
      // target: within ~1 cell of its left edge, and never farther than the
      // double-jump reach minus a landing margin.
      const maxTakeoff = Math.min(UX * 1.0, Math.max(0, djReach - UX * 0.5));
      if (distToTarget <= maxTakeoff) {
        jumpHeld = true;
        return true; // jumped
      }
    }
    // No elevated target: try crossing a gap to the next surface.
    const support = supportUnder();
    if (support) {
      const next = nextAhead(support);
      if (next) {
        const dist = next.x - (support.x + support.w);
        const rise = support.y - next.y;
        const djReach = minDoubleJumpReach(stats, rise);
        const fullReach = minFullReach(stats, rise);
        const toEdge = (support.x + support.w) - cx;
        if (dist > 0 && rise > -UY * 0.5) {
          if (djReach > 0 && dist <= djReach && toEdge < UX * 1.2) {
            jumpHeld = true;
            return true;
          }
          if (fullReach > 0 && dist <= fullReach && !superUsed && toEdge < UX * 1.5) {
            // Signal super via closure flag.
            world._doSuper = true;
            return true;
          }
        }
      }
    }
    return false;
  };

  while (steps < MAX_STEPS_PER_LAP) {
    const cx = centerX();
    const fy = feetY();
    const inp = { left: false, right: false, jump: false, down: false, super: false, onOneWay: false };
    world._doSuper = false;

    if (vertical) {
      const targetX = W / 2;
      if (cx < targetX - 6) inp.right = true;
      else if (cx > targetX + 6) inp.left = true;

      if (fy <= UY * 1.5) break;

      if (hero.grounded) {
        let nextAbove = null;
        for (const l of landings) {
          if (l.y >= fy - 4) continue;
          if (l.x1 < cx - UX * 1.5 || l.x0 > cx + UX * 1.5) continue;
          if (!nextAbove || l.y > nextAbove.y) nextAbove = l;
        }
        if (nextAbove) {
          const rise = fy - nextAbove.y;
          if (rise <= doubleJumpApexPx * 0.9) {
            jumpHeld = true;
            inp.jump = true;
          } else if (!superUsed && (world._preferSuper || rise <= doubleJumpApexPx * 1.3)) {
            inp.super = true;
            superUsed = true;
          }
        }
      }
    } else {
      inp.right = true;
      if (cx >= W - 4) break;

      const support = supportUnder();
      if (support && hero.grounded) {
        const wall = wallInFront();
        if (wall) {
          const climb = fy - wall.y;
          if (climb > 0 && climb <= doubleJumpApexPx * 0.95) {
            jumpHeld = true;
            inp.jump = true;
          } else if (climb > 0 && climb <= doubleJumpApexPx * 1.5 && !superUsed) {
            inp.super = true;
            superUsed = true;
          } else {
            // Too tall to climb directly: jump anyway — we may land on a
            // platform/staircase that sits above the current level, or use
            // the double jump + super to vault over.
            jumpHeld = true;
            inp.jump = true;
            if (!superUsed && world._preferSuper) {
              inp.super = true;
              superUsed = true;
            }
          }
        } else {
          seekLanding();
          if (world._doSuper && !superUsed) { inp.super = true; superUsed = true; }
        }
      }

      // Airborne: fresh press for the double jump when rising slows.
      if (!hero.grounded && hero.jumpsUsed === 1 && !jumpHeld) {
        if (hero.vy > -stats.jump * DOUBLE_JUMP_FACTOR * 0.3) {
          jumpHeld = true;
          inp.jump = true;
        }
      }
      // Drop-through: standing on a one-way platform with a lower target below.
      if (hero.grounded && onOneWayNow) {
        const below = landings.find(l => l.kind === 'platform' && l.x0 <= cx && l.x1 >= cx && l.y > fy + UY * 0.8);
        if (below) {
          inp.down = true;
          inp.jump = true;
        }
      }
    }

    const eff = { ...inp, jump: jumpHeld, down: inp.down };
    const res = stepHeadless(hero, DT, eff, solids);
    onOneWayNow = res.onOneWay;
    steps++;

    if (steps % 2 === 0) path.push({ x: centerX(), y: feetY() });
    if (hero.grounded && steps - lastSafeFrame > 10) {
      lastSafe = { x: centerX(), y: feetY() };
      lastSafeFrame = steps;
      for (const l of landings) {
        if (centerX() >= l.x0 && centerX() <= l.x1 && Math.abs(l.y - feetY()) <= 4) visited.add(l.index);
      }
    }

    if (feetY() > H + UY * 2 || centerX() < -UX * 2 || centerX() > W + UX * 2) {
      return { cleared: false, path, visited, reason: 'fell', failX: lastSafe.x, failY: lastSafe.y, safeX: lastSafe.x, safeY: lastSafe.y };
    }
  }

  const atExit = vertical ? feetY() <= UY * 1.5 : centerX() >= W - 4;
  if (atExit) {
    for (const l of landings) {
      if (centerX() >= l.x0 && centerX() <= l.x1 && Math.abs(l.y - feetY()) <= 4) visited.add(l.index);
    }
    return { cleared: true, path, visited, safeX: lastSafe.x, safeY: lastSafe.y };
  }
  return { cleared: false, path, visited, reason: 'timeout', failX: centerX(), failY: feetY(), safeX: lastSafe.x, safeY: lastSafe.y };
}

// ---------------------------------------------------------------------------
// Reach envelopes — single source of truth lives in macros.js. These aliases
// keep the local call sites readable while guaranteeing the ghost and the
// validator can never disagree about reach math.
// ---------------------------------------------------------------------------

const minDoubleJumpReach = doubleJumpReachForStats;
const minFullReach = superAssistReachForStats;
