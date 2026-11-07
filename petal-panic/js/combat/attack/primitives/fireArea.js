// Attack Engine — Fire / Persistent Area primitive (Task 1.13).
//
// A damaging area that persists for a duration, ticking damage at a fixed rate
// against anything inside it. The canonical form is the ground-anchored
// horizontal strip left by a Molotov: placed at a point on the ground, it
// burns for `duration` seconds and damages per tick.
//
// SIZING IS UNIT-BASED. One fire unit is a square FIRE_UNIT px cell
// (FIRE_UNIT = 48). Callers pass `segments` (integer count of units); the
// primitive owns all pixel math. Macros never compute pixels from units —
// they pass intent, this primitive converts.
//
// SEGMENTED PHYSICS. The area is N independent 48×48 segments laid out side
// by side around the spawn center. Each segment has its OWN gravity and
// resolves support in its OWN column only: a segment over a platform or block
// sticks to it; a segment over a gap keeps falling to the lower surface; a
// destroyed support releases that segment alone. Enemies and attacks NEVER
// support fire. Damage is one hitbox per segment (a target standing in two
// segments takes ticks from each — no double-dip within one segment's tick).
// The zone completes after `duration` regardless of segment positions.

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { HazardZone } from '../../../objects/hazardZone.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../../../combat/hitbox.js';
import { GRAVITY, LAYER } from '../../../consts.js';
import { parseSheet, placeSheetFrame } from '../../../core/spriteData.js';
import { loadFrames } from '../../../core/frameLoader.js';
import { SpritePlayer } from '../../../core/spritePlayer.js';
import { isHighGraphic } from '../../../core/renderMode.js';
import { fireDeclared } from '../../../effects/index.js';
import { blastFallbackDrawer } from '../../../effects/spriteBurst.js';
import { getSpecialSpriteData } from '../../../objects/projectile.js';

/** One fire unit in world pixels — the square cell size (width AND height). */
export const FIRE_UNIT = 48;

// Eased-drop feel: segments don't plummet in lockstep. Each starts falling
// a beat after its neighbors (appearance delay) with a reduced gravity scale
// (sinks instead of dropping like a rock). Low gravity gives the ease-in for
// free — starts slow, accelerates gently. Landing/snapping and damage logic
// are untouched; only the fall FEEL changes.
//
// APPEARANCE = SPREAD: flames POP in CENTER-OUT (center first, then ±1,
// ±2 …) with a small jitter, so a multi-segment area reads as fire SPREADING
// from the impact point instead of a row popping in at once. Appearance gates
// VISIBILITY + DAMAGE + the per-segment ignition burst (ignitePerSegment) —
// physics are immediate: a segment falls and settles from t=0 (invisible
// while counting down), so landing/position contracts are spread-untouched.
// The zone clock runs from detonation, so the outermost flames live a beat
// shorter — imperceptible at real durations, and the fade-out still ends
// them all together at the finish line.
const SPREAD_STEP = 0.06;              // s of added delay per step from center
const SPREAD_JITTER_MAX = 0.02;        // small random so the spread feels organic
const GRAV_SCALE_MIN = 0.4;            // floatiest a segment can fall
const GRAV_SCALE_MAX = 0.7;            // heaviest a segment can fall
// Eased fade-out: EVERY segment reaches full fade exactly when the zone ends
// (total duration unchanged) — only the RAMP start varies per segment: a
// random point in the last ~35% of the lifetime. Flames burn at FULL strength
// for at least 65% of their life; early starters ease out slowly, late
// starters dip quickly, but all reach zero together at the finish line.
const FADE_START_EARLIEST = 0.65;     // earliest fade start (frac of lifetime)
const FADE_START_LATEST = 0.85;       // latest fade start

const DEFAULTS = Object.freeze({
  x: 0,               // center x of the area (world coords)
  y: 0,               // center y
  segments: 3,        // number of 48px units wide (integer)
  duration: 2,        // seconds the area stays active
  tickRate: 5,        // damage ticks per second
  damage: 8,          // damage per tick
  team: 'ally',       // ally | foe | neutral
  method: 'fire',     // telemetry label
  ignitePerSegment: false, // fire explosion + sprite-burst at each segment's spawn point (molotov/napalm opt in)
});

/** Fixed vertical extent of a fire area (px): always exactly one unit. */
export const FIRE_HEIGHT = FIRE_UNIT;

/** Resolve the width in px from the unit-based param surface. */
export function fireWidthPx(p) {
  const segs = Math.max(1, Math.round(Number(p.segments) || DEFAULTS.segments));
  return segs * FIRE_UNIT;
}

/** World-space AABB for the area (center-based → top-left). */
export function fireAreaBox(p) {
  const w = fireWidthPx(p);
  return { x: p.x - w / 2, y: p.y - FIRE_HEIGHT / 2, w, h: FIRE_HEIGHT };
}

// Context terrain plus live solid world objects. Never use damage targets:
// enemies and other attacks cannot hold fire up. Read anew every step so a
// destroyed/moved support releases the segments standing on it.
function fireSurfaces(ctx) {
  const surfaces = [];
  const entities = ctx.collisionWorld?.entities;
  const live = (e) => e && e.alive !== false && !e.destroyed;
  const terrain = (e) => e.layer == null || e.layer === LAYER.SOLID || e.layer === LAYER.PLATFORM;
  for (const s of [...(ctx.platforms ?? []), ...(ctx.solids ?? [])]) {
    if (!live(s) || !terrain(s)) continue;
    const owner = s.owner;
    if (owner && (!live(owner) || !terrain(owner) || (entities && !entities.has(owner)))) continue;
    surfaces.push(owner?.worldBox?.() ?? s.worldBox?.() ?? s);
  }
  for (const e of entities ?? []) {
    if (!live(e)) continue;
    if (e.layer !== LAYER.SOLID && e.layer !== LAYER.PLATFORM) continue;
    surfaces.push(e.worldBox?.() ?? e);
  }
  return surfaces;
}

/**
 * Per-segment gravity + swept landing in the segment's OWN column.
 * A segment only considers tops that span its own 48px x-range — a segment
 * over a gap falls past a neighbor's platform; a segment over a barrel stops
 * on the barrel. Resting contact uses an FP epsilon so a settled segment does
 * not fall through its support between frames. Physics run from t=0 (the
 * center-out appearance delay gates drawing/damage, not landing).
 */
function stepSegment(seg, dt, ctx, surfaces) {
  const bottom = seg.y + FIRE_HEIGHT;
  seg.vy += GRAVITY * seg.gravScale * dt;   // floaty weight per segment
  const nextBottom = bottom + seg.vy * dt;
  let landing = Infinity;
  const consider = (y) => {
    if (!Number.isFinite(y) || y < bottom - 1e-6 || y > nextBottom + 1e-6) return;
    landing = Math.min(landing, y);
  };
  consider(ctx.groundY);
  for (const s of surfaces) {
    if (seg.x < s.x + s.w && seg.x + FIRE_UNIT > s.x) consider(s.y);
  }
  if (landing < Infinity) {
    seg.y = landing - FIRE_HEIGHT;
    seg.vy = 0;
  } else {
    seg.y = nextBottom - FIRE_HEIGHT;
  }
}

/**
 * Build the N segment bodies for a fire area. Each segment is a plain object
 * (not a pool entity): fixed x column, own y/vy, own per-tick hitbox.
 * Initial placement honors carrier top-contact (surfaceY) or a shallow
 * overlap with a surface at/below the spawn center — never a teleport to a
 * surface overhead or a distant floor below.
 * Appearance: each segment's `appear` delay counts down before it becomes
 * visible/damaging/falling (center-out spread — see SPREAD_STEP).
 */
export function buildSegments(p, ctx) {
  const n = Math.max(1, Math.round(Number(p.segments) || DEFAULTS.segments));
  const totalW = n * FIRE_UNIT;
  const left = p.x - totalW / 2;
  const centerY = Number.isFinite(p.surfaceY) ? p.surfaceY - FIRE_HEIGHT / 2 : p.y;
  const surfaces = fireSurfaces(ctx);
  const centerStep = (n - 1) / 2;
  const segs = [];
  for (let i = 0; i < n; i++) {
    const x = left + i * FIRE_UNIT;
    let y = centerY - FIRE_HEIGHT / 2;
    if (!Number.isFinite(p.surfaceY)) {
      // Shallow-overlap resolve in THIS column only: the highest top that
      // already intersects the segment box (spawn sunk into a surface).
      const tops = [ctx.groundY, ...surfaces.filter(b => x < b.x + b.w && x + FIRE_UNIT > b.x).map(b => b.y)];
      const top = Math.min(...tops.filter(yy => Number.isFinite(yy) && yy >= centerY && yy <= y + FIRE_HEIGHT));
      if (Number.isFinite(top)) y = top - FIRE_HEIGHT;
    }
    const seg = { x, y, vy: 0, w: FIRE_UNIT, h: FIRE_HEIGHT };
    // Eased-drop rolls: appearance is CENTER-OUT (steps from center × step +
    // small jitter) so the row reads as fire spreading; gravity scale stays
    // random per segment so the fall feel never clacks in sync.
    seg.appear = Math.abs(i - centerStep) * SPREAD_STEP + Math.random() * SPREAD_JITTER_MAX;
    seg.gravScale = GRAV_SCALE_MIN + Math.random() * (GRAV_SCALE_MAX - GRAV_SCALE_MIN);
    segs.push(seg);
  }
  return segs;
}

/** Segment-aware drawer: glow + flicker per segment box. */
function segmentedFireDrawer(ctx, z) {
  if (!z.alive) return;
  const frac = 1 - z.t / z.duration;
  const alpha = frac < 0.2 ? frac / 0.2 : 1;
  const t = performance.now() * 0.003;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const s of z.segs) {
    if (s.appear > 0) continue; // center-out spread: not born yet
    const grad = ctx.createLinearGradient(s.x, s.y + FIRE_HEIGHT, s.x, s.y);
    grad.addColorStop(0, 'rgba(255,80,0,0.7)');
    grad.addColorStop(0.5, 'rgba(255,160,0,0.4)');
    grad.addColorStop(1, 'rgba(255,220,0,0.1)');
    ctx.fillStyle = grad;
    ctx.fillRect(s.x, s.y, FIRE_UNIT, FIRE_HEIGHT);
    ctx.fillStyle = 'rgba(255,120,0,0.5)';
    const cols = Math.floor(FIRE_UNIT / 12);
    for (let i = 0; i < cols; i++) {
      const fx = s.x + i * 12 + 4;
      const fh = (Math.sin(t + (s.x + i) * 0.17) * 0.5 + 0.5) * FIRE_HEIGHT * 0.7;
      ctx.fillRect(fx, s.y + FIRE_HEIGHT - fh, 6, fh);
    }
  }
  ctx.restore();
}

// --- Sprite mode (high-graphic) ---------------------------------------------
// Each fire segment plays ONE randomly picked flame anim (fire_1 / fire_2 /
// fire_3) from the objects/fire sheets, with a random mirrorX and a random
// start frame — N segments never play in lockstep. The sheet's authored
// collision box is SQUARE (48x48, bottom-anchored), so uniformScale() fits the
// art to exactly one FIRE_UNIT cell; the pivot sits at the box center so the
// flame is centered on the segment and its bottom edge lands on the box
// bottom (feet-planted on the surface the segment rests on).
//
// Playback uses standalone SpritePlayer instances (one per segment) ticked in
// h.step() — HazardZone has no Entity.setAnim pipeline of its own, so we drive
// the players directly. The fade-out contract (last 20% of duration → alpha
// ramp to 0) is identical to the primitive drawer.
const FIRE_SPRITE_ANIMS = Object.freeze(['fire_1', 'fire_2', 'fire_3']);
const fireSpriteData = new Map();   // animName -> parsed AnimData
const fireSpriteFrames = new Map(); // animName -> Map(file -> img)
let fireSpriteLoadStarted = false;

/** Boot-time loader for the three flame anims. Idempotent; node-safe.
 *  file:// support mirrors projectile.js: read the sheet JSON from disk via
 *  node:fs when the page is opened directly (fetch of local files fails). */
export function initFireSprites() {
  if (fireSpriteLoadStarted) return Promise.resolve();
  fireSpriteLoadStarted = true;
  const base = new URL('../../../../assets/objects/fire/', import.meta.url).href;
  const jobs = FIRE_SPRITE_ANIMS.map((anim) => {
    const file = `${anim}_sheet.json`;
    const load = base.startsWith('file:')
      ? readFileJson(new URL(file, base))
      : fetch(base + file).then((r) => r.json());
    return load
      .then((sheet) => {
        const data = parseSheet(sheet);
        fireSpriteData.set(anim, data.anims[anim]);
        return loadFrames(data, base);
      })
      .then((imgs) => {
        if (imgs && imgs.size > 0) fireSpriteFrames.set(anim, imgs);
      })
      .catch((e) => console.warn(`[sprite] fire ${anim} sheet failed to load`, e));
  });
  return Promise.all(jobs);
}
async function readFileJson(url) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  return JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
}

/** True when at least one flame anim has live frames (else fall back to primitive). */
function fireSpritesReady() {
  return FIRE_SPRITE_ANIMS.some((a) => fireSpriteFrames.get(a)?.size > 0);
}

/**
 * Per-segment sprite state. Built once per zone; each segment rolls its own
 * anim, mirror and start slot so a row of flames flickers independently.
 */
function buildSegmentSprites(segs) {
  const ready = FIRE_SPRITE_ANIMS.filter((a) => fireSpriteFrames.get(a)?.size > 0);
  if (ready.length === 0) return null;
  return segs.map(() => {
    const animName = ready[Math.floor(Math.random() * ready.length)];
    const data = fireSpriteData.get(animName);
    const frames = fireSpriteFrames.get(animName);
    const player = new SpritePlayer(data, Math.floor(Math.random() * data.frames.length));
    // Eased fade roll: this segment holds FULL alpha until a random point in
    // the last 35% of the lifetime, then ramps to 0 exactly at zone end.
    const fadeStart = FADE_START_EARLIEST + Math.random() * (FADE_START_LATEST - FADE_START_EARLIEST);
    return { data, frames, player, mirrorX: Math.random() < 0.5, fadeStart };
  });
}

/**
 * Segmented sprite drawer: one flame image per segment, placed EXACTLY like
 * Entity.spriteFrame() places sheet frames — the frame's natural size (×
 * per-frame tuning scale) is positioned by the DELTA RULE (frame.offset −
 * anim.pivot), uniformly scaled so the authored collision box height fits the
 * FIRE_UNIT cell, and anchored at the segment's box center. Bottom of the box
 * (= flame base) stays planted on the surface the segment rests on. Fade-out
 * over the last 20% of the zone lifetime matches the primitive drawer.
 */
function segmentedFireSpriteDrawer(ctx, z) {
  if (!z.alive || !z.segSprites) return;
  const frac = 1 - z.t / z.duration;   // 1 → 0 over the zone lifetime
  for (let i = 0; i < z.segs.length; i++) {
    const s = z.segs[i];
    if (s.appear > 0) continue; // center-out spread: not born yet
    const sp = z.segSprites[i];
    // Per-segment eased fade: full alpha until this segment's random fade
    // start, then linear ramp to 0 that lands EXACTLY at zone end (frac=0).
    // alpha = frac / (1 - fadeStart): at frac=fadeStart → 1, at frac=0 → 0.
    let alpha = 1;
    if (frac < sp.fadeStart) {
      alpha = Math.min(1, Math.max(0, frac / (1 - sp.fadeStart)));
    }
    if (alpha <= 0) continue;
    const data = sp.data;
    const frame = data.frames[sp.player.frameIndex % data.frames.length];
    const img = sp.frames.get(frame.file);
    // Same delta-rule placement as Entity.spriteFrame() — one shared helper.
    // dx/dy/w/h are UNSCALED; ctx.scale(s) applies the uniform scale once.
    const placed = placeSheetFrame(data, frame, img, FIRE_UNIT);
    if (!placed) continue;
    const cx = s.x + FIRE_UNIT / 2;
    const cy = s.y + FIRE_HEIGHT / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    if (sp.mirrorX) ctx.scale(-1, 1);
    ctx.scale(placed.scale, placed.scale);
    ctx.drawImage(placed.img, 0, 0, placed.img.naturalWidth, placed.img.naturalHeight,
      placed.dx, placed.dy, placed.w, placed.h);
    ctx.restore();
  }
}

function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

registerPrimitive('fireArea', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Fire / Persistent Area',
    desc: 'Ground-anchored damaging area that persists for a duration, ticking damage (Molotov pattern). Width is unit-based: N × 48px segments, each with its own gravity and column support.',
    effects: [
      { type: 'dust-cloud', desc: 'fire particles at the zone (optional visual)' },
      { type: 'sprite-burst', desc: 'bomb-explode art at each segment spawn point (ignitePerSegment: molotov/napalm)' },
    ],
    params: [
      { key: 'x', desc: 'center x (world)' },
      { key: 'y', desc: 'center y (world)' },
      { key: 'segments', desc: 'number of 48px fire units wide (integer, default 2); height is always 1 unit' },
      { key: 'duration', desc: 'seconds active' },
      { key: 'tickRate', desc: 'damage ticks per second' },
      { key: 'damage', desc: 'damage per tick' },
      { key: 'team', desc: 'ally | foe | neutral' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('fireArea', null, declaredEffectsOf('fireArea'));
    const segs = buildSegments(p, ctx);

    // The zone is the shared lifecycle/draw container: one clock, one
    // duration, one alive flag. Damage is per-segment (see step below).
    const zone = new HazardZone({
      x: segs[0].x, y: Math.min(...segs.map(s => s.y)),
      w: segs.length * FIRE_UNIT, h: FIRE_HEIGHT,
      duration: p.duration, tickRate: p.tickRate, damage: p.damage,
      team: p.team, color: 'rgba(255,120,30,0.35)', label: 'fire',
    });
    zone.setOwner(ctx.attacker);
    // Sprite mode (high-graphic): per-segment flame anims. Built lazily so a
    // zone spawned before initFireSprites() resolved still picks them up on
    // its first step; null → primitive drawer only.
    zone.segSprites = buildSegmentSprites(segs);
    zone.drawer = (ctx, z) => {
      if (isHighGraphic()) {
        if (!z.segSprites && fireSpritesReady()) z.segSprites = buildSegmentSprites(z.segs);
        if (z.segSprites) { segmentedFireSpriteDrawer(ctx, z); return; }
      }
      segmentedFireDrawer(ctx, z);
    };
    zone.segs = segs;
    // Per-segment ignition VFX (molotov/napalm): each segment's sprite-burst
    // pops when ITS flame appears (center-out spread), so a multi-segment
    // area reads as fire spreading from the impact point — one burst per
    // flame, in order. Bursts fire at the segment's LIVE position at appear
    // time (it has been silently falling since t=0, so the pop lands where
    // the flame is igniting). Queued here, fired lazily in h.step().
    const igniteQueue = [];
    if (p.ignitePerSegment) {
      const ex = getSpecialSpriteData('bomb_explode')?.anims.explode;
      for (const s of segs) igniteQueue.push({ seg: s, done: false, ex });
    }
    // Per-segment hitboxes: each tracks its OWN segment position so damage
    // follows the fall. A single processHitboxes() call with ALL boxes means
    // the hitSet guard prevents double-dip when a target straddles a seam.
    h._segHbs = segs.map(s => makeHitbox({ owner: ctx.attacker, team: p.team, box: { x: s.x, y: s.y, w: FIRE_UNIT, h: FIRE_HEIGHT }, damage: p.damage, method: p.method }));

    const cancel = h.cancel.bind(h);
    h.cancel = () => {
      zone.alive = false;
      zone._hb.active = false;
      for (const hb of h._segHbs) hb.active = false;
      cancel();
    };
    h.zone = zone; // expose for host drawing/world integration
    h.state = { done: false, t: 0 };
    h._params = p;
    h.step = (dt, targets) => {
      if (h.state.done) return true;
      const list = targets ?? [];
      const surfaces = fireSurfaces(ctx);
      for (const s of segs) stepSegment(s, dt, ctx, surfaces);
      // Center-out appearance clock: count down each segment's appear delay
      // with the zone clock (physics already ran — the flame is just hidden).
      for (const s of segs) {
        if (s.appear > 0) s.appear = Math.max(0, s.appear - dt);
      }
      // Ignition bursts pop when each segment APPEARS (center-out order).
      // Position is read LIVE at fire time — the segment has been falling
      // since t=0, so the pop lands exactly where the flame ignites.
      for (const b of igniteQueue) {
        if (b.done || b.seg.appear > 0) continue;
        b.done = true;
        const sx = b.seg.x + FIRE_UNIT / 2, sy = b.seg.y + FIRE_HEIGHT / 2;
        fireDeclared({ type: 'sprite-burst', params: { x: sx, y: sy, size: 48, duration: 0.5, anim: b.ex, fallback: blastFallbackDrawer } }, h.declaredEffectTypes());
      }
      // Advance per-segment sprite playback (sprite mode only). Unborn
      // segments hold their start frame — they begin flickering on appear.
      if (zone.segSprites) {
        for (let i = 0; i < segs.length; i++) {
          if (segs[i].appear > 0) continue;
          zone.segSprites[i].player.tick(dt);
        }
      }
      // Advance the zone clock manually (t/duration/alive) WITHOUT running its
      // internal damage tick — the union hitbox owns all damage. This avoids
      // the double-damage from zone.update() resetting _hb.active/box.
      zone.t += dt;
      if (zone.t >= zone.duration) {
        zone.alive = false;
        zone._hb.active = false;
      }
      // Per-segment damage: each hitbox tracks its OWN segment position so
      // damage follows the fall. ONE processHitboxes() call with ALL boxes —
      // the shared hitSet guard means a target straddling a seam is hit once,
      // not twice. Tick rate matches the unsegmented contract exactly.
      const interval = 1 / Math.max(1, p.tickRate);
      h._tickAcc = (h._tickAcc ?? 0) + dt;
      if (h._tickAcc >= interval) {
        h._tickAcc -= interval;
        // Shared hitSet across ALL segment boxes: a target straddling a seam
        // is hit ONCE per tick, not once per overlapping segment.
        const sharedHitSet = new Set();
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          h._segHbs[i].box = { x: s.x, y: s.y, w: FIRE_UNIT, h: FIRE_HEIGHT };
          h._segHbs[i].damage = p.damage;
          h._segHbs[i].hitSet = sharedHitSet;
          // Damage is born with the flame: center-out spread segments don't
          // hurt (or draw) while their appearance delay is counting down.
          h._segHbs[i].active = s.appear <= 0;
        }
        processHitboxes(h._segHbs, list, (_hb, t, dealt) => {
          h._emit('hit', { target: t, dealt });
        });
      }
      if (!zone.alive) {
        h.state.done = true;
        h._complete({ ticks: Math.round(zone.t * p.tickRate) });
        return true;
      }
      h.state.t = zone.t;
      return false;
    };
    return h;
  },
});
