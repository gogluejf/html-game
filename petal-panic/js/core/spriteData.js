// Petal Panic — SpriteData: pure parser for Animation Studio _sheet.json.
//
// Source of truth: docs/architecture/sprites.md §2 (Animation Structure).
// The sheet JSON is the source of truth for frame count and frame geometry.
// There is NO global eight-frame assumption — frames come from JSON only.
//
// This module is PURE (no DOM, no game state). It turns raw sheet JSON into a
// runtime-ready model:
//
//   SpriteData = { anims: { [animName]: AnimData },
//                  outline: number | undefined }  // task 2.1: sheet-declared
//                                                 // contour thickness (0 = none)
//   AnimData   = { fps, mode, direction, timing,
//                  frames: [{ file, offset: {x,y}|null, scale: {sx,sy}|null }],
//                  collisionBox: {x,y,w,h},
//                  pivot: {x,y} | null }
//
// Frames are standalone PNGs (the crop happened at asset-creation time) —
// there is NO sheet rect / bbox at runtime. Size and position come from the
// image's natural size + per-frame TUNING (offset/scale in anchor space, the
// Animation Studio contract); the collision box is the §4 scaling reference
// and MUST be authored on every sheet. Timing/playback fields are OPTIONAL;
// defaults preserve simple loop behavior:
//   fps: 12, mode: 'loop', direction: 'forward', timing: 'fps'

/** Playback defaults (sprites.md §6: forward when omitted; loop for idle art). */
export const SPRITE_DEFAULTS = Object.freeze({
  fps: 8,
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
 * @returns {{anims: Object<string, object>, outline: (number|undefined)}} SpriteData
 */
export function parseSheet(sheetJson) {
  const sheets = Array.isArray(sheetJson) ? sheetJson : [sheetJson];
  const anims = {};
  // Per-sheet outline thickness (task 2.1): top-level `outline` field in the
  // sheet JSON (e.g. rock = 0 → no outline). Last declared wins (same
  // replace semantics as anims); only finite non-negative NUMBERS are
  // accepted (booleans/strings rejected); absent → undefined (consumer
  // applies its own default — Projectile uses 2).
  let outline;

  for (const sheet of sheets) {
    const o = sheet?.outline;
    if (typeof o === 'number' && Number.isFinite(o) && o >= 0) outline = o;
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
        // fps: the sheet-schema field is `speed` (editor writes it, "frames per
        // second"); `fps` is accepted as an alias for hand-authored sheets.
        // speed wins when both are present (it's the editor's source of truth).
        fps: numIn(ent.fps, 1, 1000, 'fps') ?? numIn(ent.speed, 1, 1000, 'speed') ?? SPRITE_DEFAULTS.fps,
        // mode: the sheet-schema field is `playback` (editor writes it);
        // `mode` is accepted as an alias for hand-authored sheets. Both
        // absent → default 'loop' (enumIn returns the default on null).
        mode: enumIn(ent.playback ?? ent.mode, MODES, 'mode'),
        direction: enumIn(ent.direction, DIRECTIONS, 'direction'),
        timing: enumIn(ent.timing, TIMINGS, 'timing'),
        // Optional start offset for the playback loop: "random" (resolved per
        // setAnim call — pooled entities like coins get a random phase so N
        // instances don't play in lockstep) or an int slot index. Absent = 0
        // (today's behavior; authored start pose for hero/enemy anims).
        startFrame: ent.startFrame === 'random' ? 'random'
          : (Number.isInteger(ent.startFrame) && ent.startFrame >= 0 ? ent.startFrame : 0),
        // Optional per-anim height scale (pose transform): crouch/crouch_shoot/
        // jump declare 0.5 so the body tucks to half standing height; absent =
        // 1.0 (full height). Declarative — setAnim() applies it, so no shared
        // mutable scalar can leak across states (the old _targetHScale bug).
        hScale: numIn(ent.hScale, 0.05, 4, 'hScale') ?? 1,
        frames,
        // Optional richer geometry (Animation Studio revision): per-anim
        // collision box + pivot in source coordinates. Null until exported.
        collisionBox: parseBox(ent.collision) ?? parseBox(ent.collisionBox),
        pivot: parsePoint(ent.pivot),
        markers: Array.isArray(ent.markers) ? ent.markers : [],
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
  return { anims, outline };
}

/** Parse the frame list of one entity: files + optional per-frame tuning. */
function parseFrames(ent) {
  const raw = ent.frames;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`parseSheet: anim "${ent.anim ?? ent.name}" has no frames`);
  }
  return raw.map((f, i) => {
    if (!f.file) throw new Error(`parseSheet: frame ${i} of "${ent.anim}" missing file`);
    // Per-frame tuning is OPTIONAL: size/position come from the image's
    // natural size + offset/scale (anchor space). Sheets without tuning render
    // via the legacy placement (centered, bottom on the anchor line).
    return {
      file: f.file,
      offset: parsePoint(f.offset),
      scale: parseFrameScale(f.scale),
      // Typed per-frame boxes (Animation Studio): [{label, x, y, w, h}] in
      // anchor space — same transform as the frame art. Carried verbatim so
      // gameplay can resolve sheet-authored hitboxes (Hero._sheetAttackBox).
      boxes: Array.isArray(f.boxes) ? f.boxes : [],
    };
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
  // Two on-disk shapes: legacy [x,y,w,h] arrays and Animation Studio editor
  // saves as {x,y,w,h} objects. Normalize both.
  let x, y, w, h;
  if (Array.isArray(b)) {
    if (b.length !== 4) throw new Error('parseSheet: bad collisionBox');
    [x, y, w, h] = b.map(Number);
  } else if (typeof b === 'object') {
    ({ x, y, w, h } = b);
    [x, y, w, h] = [x, y, w, h].map(Number);
  } else {
    throw new Error('parseSheet: bad collisionBox');
  }
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

/** Parse an optional per-frame {sx,sy} scale; null when absent. */
function parseFrameScale(s) {
  if (s == null) return null;
  const sx = Number(s.sx), sy = Number(s.sy);
  if (!(sx > 0) || !(sy > 0)) throw new Error(`parseSheet: bad frame scale (${JSON.stringify(s)})`);
  return { sx, sy };
}

/**
 * The scaling reference box for an animation (sprites.md §4): the anim's
 * authored collision box. Every sheet must carry one — there is no fallback.
 *
 * @param {object} animData AnimData from parseSheet()
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function scaleReference(animData) {
  if (!animData.collisionBox) {
    throw new Error('scaleReference: anim has no collision box (sheets must author one — sprites.md §4)');
  }
  return animData.collisionBox;
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

/**
 * Total playback duration in seconds for one full pass of the animation.
 * Accounts for: frame count, fps, per-frame durUnits (multiplier on the
 * base 1/fps slot), and playback mode ('once' = 1 pass, 'loop' = 1 pass
 * for VFX purposes, 'pingpong' = 2 passes).
 * @param {object} animData - AnimData from parseSheet()
 * @returns {number} duration in seconds
 */
export function getAnimDuration(animData) {
  const frames = animData.frames ?? [];
  const n = frames.length;
  if (n === 0) return 0;
  const fps = animData.fps ?? 12;
  const baseSlot = 1 / fps;
  // Sum per-frame durations (durUnits multiplies the base slot)
  let totalSlots = 0;
  for (let i = 0; i < n; i++) {
    const du = frames[i].duration != null ? frames[i].duration : 1;
    totalSlots += du;
  }
  let dur = totalSlots * baseSlot;
  // Pingpong plays forward then backward (minus first/last to avoid repeat)
  if (animData.mode === 'pingpong') dur *= 2;
  return dur;
}

/**
 * Place ONE sheet frame relative to its animation's collision box — the
 * single source of truth for the DELTA RULE (§22): the frame's natural size
 * (× per-frame tuning scale) is positioned by (frameOffset − pivot), and the
 * uniform scale that fits the authored collision-box height onto `targetBoxH`
 * is returned so callers can apply it via ctx.scale. Callers anchor the
 * result at their own box center; this returns the frame rect (w, h) in
 * UNSCALED (natural × tuning) space and dx/dy in UNSCALED offset space —
 * matching Entity.spriteFrame()'s contract exactly (drawSprite applies
 * ctx.scale(s) once for everything).
 *
 * This is the same math Entity.spriteFrame() applies — extracted here so
 * non-Entity consumers (fire segments, sprite bursts, tests) place frames
 * identically instead of re-implementing the rule.
 *
 * Untuned frames (no offset) fall back to bottom-center placement: centered
 * horizontally, base on the box bottom (feet-planted).
 *
 * @param {object} animData AnimData from parseSheet() (needs collisionBox)
 * @param {object} frame one entry of animData.frames ({file, offset?, scale?})
 * @param {object} img loaded image (naturalWidth/naturalHeight)
 * @param {number} targetBoxH collision-box height in target px (e.g. FIRE_UNIT)
 * @returns {?{img:object, w:number, h:number, dx:number, dy:number, scale:number}}
 *   null when the image or box is unusable (caller falls back to primitive).
 */
export function placeSheetFrame(animData, frame, img, targetBoxH) {
  const cb = animData.collisionBox;
  if (!cb || !(img && img.complete && img.naturalWidth > 0)) return null;
  const s = targetBoxH / cb.h;
  if (!(s > 0)) return null;
  const fsx = frame.scale?.sx ?? 1;
  const fsy = frame.scale?.sy ?? 1;
  // w/h in UNSCALED space (natural × per-frame tuning) — ctx.scale(s) applies s.
  const w = img.naturalWidth * fsx;
  const h = img.naturalHeight * fsy;
  let dx, dy;
  if (frame.offset) {
    // UNSCALED delta rule: dx/dy = offset − pivot (ctx.scale applies s).
    const pivot = animData.pivot ?? { x: cb.x + cb.w / 2, y: cb.y + cb.h / 2 };
    dx = frame.offset.x - pivot.x;
    dy = frame.offset.y - pivot.y;
  } else {
    // Legacy untuned placement: centered, bottom on the box bottom.
    dx = -w / 2;
    dy = -h;
  }
  return { img, w, h, dx, dy, scale: s };
}
