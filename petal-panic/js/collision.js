// Petal Panic — Collision system (design §3 "Collision API" & §8).
// Responsibilities:
//   - aabbOverlap(a, b)          strict AABB overlap test (touching edges = false)
//   - resolve(entity, solids)    positional correction so an entity can't pass
//                                through SOLID boxes; axis-separated (X then Y)
//   - CollisionWorld             spatial-hash broadphase + declarative mask rules
//                                narrowphase; fires per-rule callbacks on overlap
// Design goals:
//   - Adding a new interaction = one line in COLLISION_RULES (no if-chains).
//   - Broadphase is a uniform spatial hash grid → O(n·k), not O(n²).
//   - All boxes are plain {x, y, w, h} world-space AABBs.

import { LAYER } from './consts.js';

// ---------------------------------------------------------------------------
// aabbOverlap
// ---------------------------------------------------------------------------

/**
 * Strict AABB overlap test. Two boxes overlap only when they share interior
 * area — touching at exactly an edge or corner counts as NOT overlapping.
 *
 * @param {{x:number,y:number,w:number,h:number}} a
 * @param {{x:number,y:number,w:number,h:number}} b
 * @returns {boolean}
 */
export function aabbOverlap(a, b) {
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}

// ---------------------------------------------------------------------------
// resolve() — solid positional correction
// ---------------------------------------------------------------------------

/**
 * Push `entity` out of every box in `solids` using minimum-penetration-axis
 * resolution. For each solid the axis with the smallest penetration is
 * resolved first (ties → X), then the other axis is re-tested against the
 * corrected position. Mutates entity.x / entity.y and zeroes the velocity
 * component into the wall.
 *
 * Works with any object exposing x/y plus a worldBox()-like shape; for Entity
 * instances we read/write e.x/e.y directly (the box offset is baked into the
 * penetration math via worldBox()).
 *
 * One-way solids (design §13): a solid flagged `oneWay: true` behaves
 * directionally. It NEVER blocks upward traversal — while the entity rises
 * (vy < 0) or its previous frame's bottom was at/below the solid's top
 * (it came from underneath), the solid is skipped entirely, so a jump passes
 * straight up through it. Falling onto it from above (prev bottom ≤ top)
 * lands normally as ground. While `opts.ignoreOneWay` is set (drop-through
 * window, design §13 "Drop Through") one-way solids are skipped unconditionally
 * so the hero drops through; SOLID terrain (floor, barrels) is never affected.
 *
 * @param {object} entity  object with x, y, vx, vy and worldBox()
 * @param {Array<{x:number,y:number,w:number,h:number,oneWay?:boolean}>} solids
 *        static AABBs (plain boxes or Entity instances; plain boxes may carry
 *        an optional oneWay flag)
 * @param {object} [opts]
 * @param {number} [opts.prevBottom] entity's bottom edge BEFORE this frame's
 *        integration (y + h). Required for correct one-way landing detection:
 *        after integrate(), a falling hero has already sunk below the platform
 *        top, so the prev-frame bottom is the only reliable "came from above"
 *        signal. Solid (non-one-way) resolution ignores this value.
 * @param {boolean} [opts.ignoreOneWay] when true, skip all one-way solids
 *        this frame (hero drop-through window).
 * @returns {{axis:'x'|'y', dir:1|-1}|null} last axis resolved (dir = push
 *         direction), or null if no correction was needed.
 */
export function resolve(entity, solids, opts = {}) {
  let resolved = null;
  let blockedX = false;

  for (const s of solids) {
    // Recompute the box after each axis push so the second axis sees the
    // corrected position (stale-reference bug otherwise).
    let b = entity.worldBox ? entity.worldBox() : entity;

    // --- One-way rule (design §13) ------------------------------------------
    // Never block upward traversal: rising, or arriving from underneath
    // (previous bottom strictly BELOW the solid top), skips the solid entirely.
    // Drop-through window skips one-way solids unconditionally. Solid terrain
    // carries no oneWay flag and is unaffected by both conditions.
    if (s.oneWay) {
      const prevBottom = opts.prevBottom ?? (b.y + b.h);
      // Skip when: drop-through window active, hero rising, OR the previous
      // bottom was strictly below the platform top (came from underneath).
      // Exact-edge contact (prevBottom === s.y, standing on the surface) must
      // NOT skip — the hero is at rest ON the platform and gravity will pull it
      // in this frame; skipping would let it sink through every frame.
      if (opts.ignoreOneWay || entity.vy < 0 || prevBottom > s.y) continue;
      // Must actually overlap the platform box (X AND Y) before snapping:
      // a hero far to the left/right of the platform must not be teleported
      // onto it just because its bottom crossed the top edge.
      const penX = Math.min(b.x + b.w - s.x, s.x + s.w - b.x);
      const penY = Math.min(b.y + b.h - s.y, s.y + s.h - b.y);
      if (penX <= 0 || penY <= 0) continue; // no AABB overlap → skip
      // Hero is falling from above onto a one-way platform → LAND on top.
      // The generic minimum-penetration push would push UP out of the surface
      // here (the hero has already integrated below the top this frame, so the
      // upward penetration is smaller than the downward one). Landing is not a
      // "push out": snap the box's bottom to the platform top and zero vy.
      // Box offset is baked into worldBox(): for an Entity the box is at
      // (x + ox, y + oy) with height bh. Compute the box bottom's distance
      // from entity.y and set entity.y so that bottom lands exactly on s.y —
      // this works for standing AND crouching boxes alike (crouchBox has a
      // non-zero oy), so a crouched hero still rests its feet on the surface.
      const boxBottomOffset = b.y - entity.y + b.h;
      entity.y = s.y - boxBottomOffset;
      if (entity.vy > 0) entity.vy = 0;
      resolved = { axis: 'y', dir: 1 };
      continue; // skip generic AABB push for this solid
    }

    // Penetration depths along each axis (0 = no overlap on that axis).
    const penX = Math.min(b.x + b.w - s.x, s.x + s.w - b.x);
    const penY = Math.min(b.y + b.h - s.y, s.y + s.h - b.y);
    if (penX <= 0 || penY <= 0) continue; // no overlap at all

    // Landing snap for regular solids: if the entity is falling and was
    // previously at or above the solid top, it's a landing — snap the box
    // bottom to the surface. Prevents minimum-penetration oscillation when
    // the box is tall enough to fit inside the solid (crouch box in thin platform).
    const prevBottom = opts.prevBottom ?? (b.y + b.h);
    if (entity.vy >= 0 && prevBottom <= s.y + 2) {
      const boxBottomOffset = b.y - entity.y + b.h;
      entity.y = s.y - boxBottomOffset;
      entity.vy = 0;
      resolved = { axis: 'y', dir: 1 };
      continue;
    }

    /** Push out along one axis by its minimum penetration. */
    const pushAxis = (axis) => {
      if (axis === 'x') {
        const dLeft  = (b.x + b.w) - s.x;   // distance to push left
        const dRight = (s.x + s.w) - b.x;   // distance to push right
        if (dLeft < dRight) {
          entity.x -= dLeft;
          if (entity.vx > 0) entity.vx = 0;
          resolved = { axis: 'x', dir: -1 };
        } else {
          entity.x += dRight;
          if (entity.vx < 0) entity.vx = 0;
          resolved = { axis: 'x', dir: 1 };
        }
        blockedX = true;
      } else {
        const dUp    = (b.y + b.h) - s.y;   // distance to push up
        const dDown  = (s.y + s.h) - b.y;   // distance to push down
        if (dUp < dDown) {
          entity.y -= dUp;
          if (entity.vy > 0) entity.vy = 0;
          resolved = { axis: 'y', dir: -1 };
        } else {
          entity.y += dDown;
          if (entity.vy < 0) entity.vy = 0;
          resolved = { axis: 'y', dir: 1 };
        }
      }
      b = entity.worldBox ? entity.worldBox() : entity;
    };

    // Minimum-penetration axis first (tie → X); then re-test the other axis.
    if (penX <= penY) {
      pushAxis('x');
      const p2 = Math.min(b.y + b.h - s.y, s.y + s.h - b.y);
      const px2 = Math.min(b.x + b.w - s.x, s.x + s.w - b.x);
      if (p2 > 0 && px2 > 0) pushAxis('y');
    } else {
      // The hero is falling and was above this solid's top before integration:
      // it Landed on the surface. The generic minimum-penetration choice would
      // push UP out of the floor here (the downward penetration from a fast
      // fall exceeds the upward one), which reads as "floor must not stop the
      // hero". Landing always resolves to the top surface regardless of
      // penetration depth — snap down onto it instead of picking by min-depth.
      const prevBottom = opts.prevBottom ?? (b.y + b.h);
      if (entity.vy >= 0 && prevBottom <= s.y) {
        const oy = b.oy ?? 0;
        const boxH = b.h ?? b.bh;
        entity.y = s.y - (oy + boxH);
        if (entity.vy > 0) entity.vy = 0;
        resolved = { axis: 'y', dir: 1 };
      } else {
        pushAxis('y');
        const p2 = Math.min(b.x + b.w - s.x, s.x + s.w - b.x);
        const py2 = Math.min(b.y + b.h - s.y, s.y + s.h - b.y);
        if (p2 > 0 && py2 > 0) pushAxis('x');
      }
    }
  }

  // Stamp the per-frame block flag so hero.update() (next step) can tell a
  // solid-pinned hero apart from one standing still at rest.
  entity._blockedX = blockedX;

  return resolved;
}

/**
 * Per-frame horizontal-block flag for an entity (design §8 solid-obstacle case).
 * resolve() zeroes vx into a wall, so a hero pinned against a solid can never
 * accumulate horizontal velocity — but that alone is indistinguishable from a
 * grounded hero standing still about to move. This flag is the reliable signal:
 * it is true only when a solid actually cancelled horizontal displacement this
 * frame. The main loop stamps it on the hero after resolve(); hero.update()
 * clears it at the start of each step and reads it in the horizontal branch.
 */
export function wasBlockedX(entity) {
  return !!entity._blockedX;
}

// ---------------------------------------------------------------------------
// Declarative collision rules
// ---------------------------------------------------------------------------

/**
 * The single source of truth for inter-layer interactions.
 * Each rule: two layers + an action tag. CollisionWorld.update() tests every
 * unordered pair whose masks intersect ANY rule, then dispatches to the
 * registered callback for that action.
 *
 * Add a new interaction here — one line, no other code changes.
 */
export const COLLISION_RULES = [
  { a: LAYER.HERO,      b: LAYER.SOLID,       action: 'resolve'    },
  { a: LAYER.ENEMY,     b: LAYER.SOLID,       action: 'resolve'    },
  { a: LAYER.PROJ_ALLY, b: LAYER.ENEMY,       action: 'hit'        },
  { a: LAYER.PROJ_ALLY, b: LAYER.BOSS,        action: 'hit'        },
  { a: LAYER.PROJ_ALLY, b: LAYER.SOLID,       action: 'hit'        }, // thorns chip barrels ()
  { a: LAYER.PROJ_FOE,  b: LAYER.HERO,        action: 'hit'        },
  { a: LAYER.HERO,      b: LAYER.PICKUP,      action: 'pickup'     },
  { a: LAYER.HERO,      b: LAYER.COIN,        action: 'collect'    },
  { a: LAYER.HERO,      b: LAYER.CHECKPOINT,  action: 'checkpoint' },
  { a: LAYER.HERO,      b: LAYER.ENEMY,       action: 'contact'    },
  { a: LAYER.HERO,      b: LAYER.HAZARD,      action: 'damage'     },
];

// Precompute the set of layer-bit pairs that should be tested. Key =
// `${minBit}:${maxBit}` → array of actions (a pair may match several rules).
// This lets update() skip mask arithmetic per candidate pair.
const RULE_PAIRS = (() => {
  const map = new Map();
  for (const r of COLLISION_RULES) {
    const lo = Math.min(r.a, r.b);
    const hi = Math.max(r.a, r.b);
    const key = lo + ':' + hi;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r.action);
  }
  return map;
})();

/**
 * Does an entity with `layerA` bits interact with one having `layerB` bits?
 * True when any rule's two layer bits are both present across the pair.
 */
export function masksInteract(layerA, layerB) {
  // A rule matches if (r.a ⊆ A ∧ r.b ⊆ B) OR (r.a ⊆ B ∧ r.b ⊆ A).
  for (const r of COLLISION_RULES) {
    if ((layerA & r.a) === r.a && (layerB & r.b) === r.b) return true;
    if ((layerA & r.b) === r.b && (layerB & r.a) === r.a) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Spatial hash grid (broadphase)
// ---------------------------------------------------------------------------

/**
 * Uniform-grid spatial hash. Entities are inserted into every cell their AABB
 * covers; candidate pairs are recovered from shared cells. Cell size is
 * configurable (default 64 px ≈ typical hero/enemy size, keeping occupancy low).
 */
class SpatialHash {
  /**
   * @param {number} cellSize grid cell edge length in logical px
   */
  constructor(cellSize = 64) {
    this.cellSize = cellSize;
    this.cells = new Map(); // integer key -> Set<entity>
  }

  clear() {
    this.cells.clear();
  }

  _key(cx, cy) {
    // Pack two signed ints into one string-free numeric-ish key.
    // (string keys would also work; numbers avoid GC churn from concat)
    return cx * 73856093 ^ cy * 19349663;
  }

  /** Insert an entity covering all cells its box overlaps. */
  insert(e) {
    const box = e.worldBox ? e.worldBox() : e;
    const cs = this.cellSize;
    const x0 = Math.floor(box.x / cs);
    const y0 = Math.floor(box.y / cs);
    const x1 = Math.floor((box.x + box.w - 1e-6) / cs);
    const y1 = Math.floor((box.y + box.h - 1e-6) / cs);

    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this._key(cx, cy);
        let set = this.cells.get(k);
        if (!set) { set = new Set(); this.cells.set(k, set); }
        set.add(e);
      }
    }
  }

  /** Collect unique candidate pairs sharing at least one cell. */
  forEachPair(fn) {
    const seen = new Set();
    for (const set of this.cells.values()) {
      const arr = [...set];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const ea = arr[i], eb = arr[j];
          // Unordered pair id: use reference ordering via identity check.
          const id = ea === eb ? null : (ea._pairId ?? 0) < (eb._pairId ?? 0)
            ? ea._pairId + '_' + eb._pairId
            : eb._pairId + '_' + ea._pairId;
          if (seen.has(id)) continue;
          seen.add(id);
          fn(ea, eb);
        }
      }
    }
  }
}

// Assign a cheap stable id to entities on first insert so pair dedup is O(1).
let _nextPairId = 1;
function ensurePairId(e) {
  if (e._pairId == null) e._pairId = _nextPairId++;
}

// ---------------------------------------------------------------------------
// CollisionWorld
// ---------------------------------------------------------------------------

/**
 * Central collision registry. Holds live entities, runs broadphase →
 * narrowphase each frame, and dispatches rule actions to registered handlers.
 *
 * Usage:
 *   const world = new CollisionWorld({ cellSize: 64 });
 *   world.on('hit', (a, b) => { ... });
 *   world.add(hero); world.add(enemy);
 *   // each fixed step, AFTER integration:
 *   world.update();
 */
export class CollisionWorld {
  /**
   * @param {object} [opts]
   * @param {number} [opts.cellSize=64] spatial-hash cell size (logical px)
   */
  constructor(opts = {}) {
    this.entities = new Set();
    this.grid = new SpatialHash(opts.cellSize ?? 64);
    /** @type {Map<string, Function>} action → handler(a, b) */
    this.handlers = new Map();
    /** Per-frame event log (ring buffer, capped) for debug overlay / testing. */
    this.events = [];
    this.maxEvents = 64;
  }

  /** Register a callback for a rule action ('hit', 'pickup', 'collect', ...). */
  on(action, fn) {
    this.handlers.set(action, fn);
    return this;
  }

  add(e) {
    ensurePairId(e);
    this.entities.add(e);
    return this;
  }

  remove(e) {
    this.entities.delete(e);
    return this;
  }

  /**
   * Per-frame collision pass (call once per fixed step, after integrate):
   *   1. rebuild spatial hash
   *   2. for each candidate pair from shared cells:
   *        - skip if layer masks don't interact (declarative rules)
   *        - narrowphase aabbOverlap
   *        - dispatch matching rule actions
   */
  update() {
    this.grid.clear();
    for (const e of this.entities) {
      if (e.alive === false || e.visible === false) continue;
      this.grid.insert(e);
    }

    this.events.length = 0;
    this.grid.forEachPair((a, b) => {
      if (!masksInteract(a.layer, b.layer)) return;
      const boxA = a.worldBox ? a.worldBox() : a;
      const boxB = b.worldBox ? b.worldBox() : b;
      if (!aabbOverlap(boxA, boxB)) return;

      // DEBUG: log HERO×CHECKPOINT pairs specifically.
      const isHeroCp = (a.layer === 1 && b.layer === 256) || (b.layer === 1 && a.layer === 256);
      if (isHeroCp) {
        const cp = a.layer === 256 ? a : b;
        console.log(`[collision] HERO×CP! id=${cp.checkpointId} pos=(${Math.round(cp.x)},${Math.round(cp.y)}) box=${JSON.stringify(cp.box)} worldBox=${JSON.stringify(cp.worldBox())}`);
      }

      // Dispatch every rule this pair satisfies. Order: smaller layer bit first
      // so handlers see a consistent (a, b) orientation.
      const [lo, hi] = a.layer <= b.layer ? [a, b] : [b, a];
      const key = Math.min(lo.layer, hi.layer) + ':' + Math.max(lo.layer, hi.layer);
      const actions = RULE_PAIRS.get(key);
      if (!actions) return;
      for (const action of actions) {
        this.events.push({ action, a, b });
        const fn = this.handlers.get(action);
        if (fn) fn(a, b);
      }
    });
  }
}
