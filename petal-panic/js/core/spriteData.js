// Petal Panic — SpriteData: pure parser for Animation Studio _sheet.json.
//
// Source of truth: docs/architecture/sprites.md §2 (Animation Structure).
// The sheet JSON is the source of truth for frame count and frame geometry.
// There is NO global eight-frame assumption — frames come from JSON only.
//
// This module is PURE (no DOM, no game state). It turns raw sheet JSON into a
// runtime-ready model:
//
//   SpriteData = { anims: { [animName]: AnimData } }
//   AnimData   = { fps, mode, direction, timing,
//                  frames: [{ file, bbox: {x,y,w,h} }],
//                  collisionBox: {x,y,w,h} | null,
//                  pivot: {x,y} | null }
//
// Current sheets carry only {name, anim, frames[{file,row,col,bbox}],
// frames_dir}. Timing/playback fields are OPTIONAL (the Animation Studio
// revision adds them); defaults preserve simple loop behavior:
//   fps: 12, mode: 'loop', direction: 'forward', timing: 'fps'
//
// Scaling reference (§4 v1): until sheets export per-anim collision boxes +
// target heights, the FIRST FRAME'S BBOX is the scaling reference. The
// runtime scales it to the entity's collision box height (uniform scalar).

/** Playback defaults (sprites.md §6: forward when omitted; loop for idle art). */
export const SPRITE_DEFAULTS = Object.freeze({
  fps: 12,
  mode: 'loop',          // 'loop' | 'once'
  direction: 'forward',  // 'forward' | 'reverse' | 'ping_pong' | 'ping_pong_reverse'
  timing: 'fps',         // 'fps' | 'relative'
});

const MODES = new Set(['loop', 'once']);
const DIRECTIONS = new Set(['forward', 'reverse', 'ping_pong', 'ping_pong_reverse']);
const TIMINGS = new Set(['fps', 'relative']);

/**
 * Parse one or more Animation Studio sheet JSON objects into SpriteData.
 * Accepts a single sheet object or an array of them (an entity may span
 * several sheets, e.g. checkpoint level + boss flags).
 *
 * @param {object|object[]} sheetJson parsed _sheet.json content(s)
 * @returns {{anims: Object<string, object>}} SpriteData
 */
export function parseSheet(sheetJson) {
  const sheets = Array.isArray(sheetJson) ? sheetJson : [sheetJson];
  const anims = {};

  for (const sheet of sheets) {
    const entities = sheet?.entities;
    if (!Array.isArray(entities)) {
      throw new Error('parseSheet: missing "entities" array in sheet JSON');
    }
    for (const ent of entities) {
      const name = ent.anim ?? ent.name;
      if (!name) throw new Error('parseSheet: entity without anim/name');
      const frames = parseFrames(ent);
      // Later sheets with the same anim name replace earlier ones (explicit
      // override), which keeps multi-sheet parsing order-predictable.
      anims[name] = {
        fps: numIn(ent.fps, 1, 1000, 'fps') ?? SPRITE_DEFAULTS.fps,
        mode: enumIn(ent.mode, MODES, 'mode'),
        direction: enumIn(ent.direction, DIRECTIONS, 'direction'),
        timing: enumIn(ent.timing, TIMINGS, 'timing'),
        frames,
        // Optional richer geometry (Animation Studio revision): per-anim
        // collision box + pivot in source coordinates. Null until exported.
        collisionBox: parseBox(ent.collisionBox),
        pivot: parsePoint(ent.pivot),
        // Per-frame optional extras (duration overrides, typed boxes,
        // point/radius markers) — carried through verbatim when present.
        framesMeta: ent.frames?.map((f) => ({
          duration: f.duration != null ? Number(f.duration) : null,
          boxes: Array.isArray(f.boxes) ? f.boxes : [],
          points: Array.isArray(f.points) ? f.points : [],
          radii: Array.isArray(f.radii) ? f.radii : [],
        })) ?? [],
      };
    }
  }

  if (Object.keys(anims).length === 0) {
    throw new Error('parseSheet: no animations found');
  }
  return { anims };
}

/** Parse the frame list of one entity: files + bboxes, validated. */
function parseFrames(ent) {
  const raw = ent.frames;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`parseSheet: anim "${ent.anim ?? ent.name}" has no frames`);
  }
  return raw.map((f, i) => {
    if (!f.file) throw new Error(`parseSheet: frame ${i} of "${ent.anim}" missing file`);
    const b = f.bbox;
    if (!Array.isArray(b) || b.length !== 4) {
      throw new Error(`parseSheet: frame ${i} of "${ent.anim}" has bad bbox`);
    }
    const [x, y, w, h] = b.map(Number);
    if (!(w > 0) || !(h > 0)) {
      throw new Error(`parseSheet: frame ${i} of "${ent.anim}" has zero-size bbox`);
    }
    return { file: f.file, bbox: { x, y, w, h } };
  });
}

/** Validate an optional numeric field; returns undefined when absent. */
function numIn(v, lo, hi, label) {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) {
    throw new Error(`parseSheet: bad ${label} (${v})`);
  }
  return n;
}

/** Validate an optional enum field against its default. */
function enumIn(v, allowed, label) {
  if (v == null) return SPRITE_DEFAULTS[label === 'mode' ? 'mode' : label === 'timing' ? 'timing' : 'direction'];
  if (!allowed.has(v)) throw new Error(`parseSheet: bad ${label} ("${v}")`);
  return v;
}

/** Parse an optional [x,y,w,h] box; null when absent. */
function parseBox(b) {
  if (b == null) return null;
  if (!Array.isArray(b) || b.length !== 4) throw new Error('parseSheet: bad collisionBox');
  const [x, y, w, h] = b.map(Number);
  if (!(h > 0)) throw new Error('parseSheet: collisionBox height must be nonzero (sprites.md §4)');
  return { x, y, w, h };
}

/** Parse an optional {x,y} point; null when absent. */
function parsePoint(p) {
  if (p == null) return null;
  const x = Number(p.x), y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('parseSheet: bad pivot');
  return { x, y };
}

/**
 * The scaling reference box for an animation (sprites.md §4, v1 rule):
 * the anim's authored collision box when present, else the first frame's bbox.
 *
 * @param {object} animData AnimData from parseSheet()
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function scaleReference(animData) {
  return animData.collisionBox ?? animData.frames[0].bbox;
}

/**
 * Uniform scale factor that fits an animation's reference box height onto a
 * target pixel height (§4: one scalar for everything — art, boxes, markers).
 *
 * @param {object} animData AnimData from parseSheet()
 * @param {number} targetHeightPx desired rendered height in px
 * @returns {number} uniform scalar
 */
export function uniformScale(animData, targetHeightPx) {
  const ref = scaleReference(animData);
  if (!(ref.h > 0)) throw new Error('uniformScale: zero-height reference box');
  return targetHeightPx / ref.h;
}
