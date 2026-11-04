// Attack Engine — Sky Missile (macro, doc §22). ONE object, one id.
//
// A single missile arriving from above at a FIXED ground position:
//   warning (Surface Target Marker at the impact point) → timeToTarget →
//   Explosive Projectile drops straight down and detonates on the marked spot.
//
// The vertical, telegraphed twin of explosiveProjectile — same blast, but the
// approach vector is always straight down and the impact point is announced in
// advance. Fairness comes from the WARNING, not from prediction: no homing,
// no drift, strictly vertical.
//
// Column resolution: the impact y is the TOP of the highest surface in the
// drop column (floor, platform, or block) — the marker AND the blast land on
// whatever is actually there, not on an invisible floor below it. Same
// "highest top at or below the reference" rule as surfaceWave's resolveSurface.
//
// This is the building block for Missile Rain (§7): the rain is N sky missiles
// with staggered positions/timing plus the launch-up visual. One missile, one id.
//
// Handle shape:
//   h.step(dt, targets) — advance the sequence; true when the missile is done
//   state.phase         — 'warning' | 'drop'
//   state.impact        — { x, y } of the resolved impact point (marker placement)
//   hit / complete      — hit per damaged target (via the blast); complete {}

import { defineMacro } from '../defineMacro.js';
import { AttackHandle } from '../engine.js';
import { invokeChild } from '../attackIds.js';
import { fireDeclared } from '../../../effects/index.js';
import { VIEW_H } from '../../../core/view.js';
// Ensure payload macros are registered (otherwise only pulled in by the theater).
import './explosiveProjectile.js';
import './shockwaveProjectile.js';
import './napalm.js';
import './throwMine.js';
import './explosiveBomb.js';
import './molotov.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read lazily at construction so synchronous fires inside
// impl() see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}
import { getPrimitive, getMacro } from '../registry.js';

const DEFAULTS = Object.freeze({
  x: 0,               // impact x (world) — marker AND drop share it
  groundY: null,      // fallback impact y; null → resolve from ctx (surface column)
  timeToTarget: 1.0,  // s between marker appearance and impact (the survival window)
  fallSpeed: 500,     // px/s descent speed
  damage: 30,         // carrier contact + blast damage (one value, like explosiveProjectile)
  team: 'ally',       // who the falling carrier hurts
  blastTeam: 'neutral', // who the blast hurts
  size: 14,           // carrier box size (px)
  markerStyle: null,  // surface-target-marker effect override
  mineType: 'explosion',
  mineTtl: 2,
  blinkDuration: 2,
  child: 'explosion',    // any ATTACK_IDS child — payload that resolves on the marked surface
  // Sub-payload config (M3 completion): keys per the child's CHILD_PARAM_SPECS
  // (attackIds.js). NULL by default — a concrete default object would clobber
  // the caller's flat legacy keys (blast.*, mineType, mineTtl, blinkDuration)
  // at every `sub(child).x ?? p.flat` read. With null, flat keys fall through
  // and unconfigured children read their OWN macro defaults.
  payload: null,
  blast: {               // per-payload size params (each payload reads its own key)
    explosionRadius: 60, // explosion blast circle (px)
    shockRadius: 150,    // shockwave ring max radius (px)
    fireWidth: 96,       // napalm burn zone width (px)
  },
});

/**
 * Resolve the impact point for a sky missile.
 *
 * x is the caller's drop column. y is the TOP of the highest surface in that
 * column: explicit `groundY` param wins outright; otherwise the host's
 * ctx.groundY floor plus any ctx.platforms whose span contains x — the
 * HIGHEST top among them (same "highest top" rule as surfaceWave's
 * resolveSurface, minus the horizontal extent we don't need). A platform
 * catches the drop even when no floor line was provided.
 *
 * @param {object} p   merged params (x, groundY)
 * @param {object} ctx AttackContext (groundY, platforms)
 * @returns {{x:number,y:number}}
 */
export function resolveImpactPoint(p, ctx) {
  if (typeof p.groundY === 'number') return { x: p.x, y: p.groundY };
  let best = null;
  if (typeof ctx?.groundY === 'number') best = ctx.groundY;
  for (const pl of ctx?.platforms ?? []) {
    if (p.x < pl.x || p.x > pl.x + pl.w) continue;
    if (best == null || pl.y < best) best = pl.y;
  }
  return { x: p.x, y: best ?? 0 };
}

defineMacro('skyMissile', {
  attacks: [
    { id: 'projectile', role: 'payload' },
    { id: 'explosiveProjectile', role: 'payload' },
    { id: 'shockwaveProjectile', role: 'payload' },
    { id: 'napalm', role: 'payload' },
    { id: 'throwMine', role: 'payload' },
    { id: 'explosiveBomb', role: 'payload' },
    { id: 'molotov', role: 'payload' },
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Sky Missile',
    desc: 'Ground marker warns a fixed spot → timeToTarget → vertical carrier drops and resolves on the marked surface (any child type).',
    effects: [
      { type: 'surface-target-marker', desc: 'landing warning fixed at the impact point for the whole warning window' },
    ],
    params: [
      { key: 'child', desc: 'any ATTACK_IDS child: projectile | bomb | mine | molotov | explosion | shockwave | napalm (enemy = dropped monkey)' },
      { key: 'payload', desc: 'sub-payload config for the drop (keys per the child; see CHILD_PARAM_SPECS)' },
      { key: 'mineType', desc: 'explosion | shockwave (mine payload)' },
      { key: 'x', desc: 'impact x (world) — marker and drop share it' },
      { key: 'groundY', desc: 'fallback impact y; null → highest surface in the drop column' },
      { key: 'timeToTarget', desc: 'seconds between marker and impact (survival window)' },
      { key: 'fallSpeed', desc: 'descent speed (px/s)' },
      { key: 'damage', desc: 'contact + blast damage' },
      { key: 'team', desc: 'who the falling carrier hurts' },
      { key: 'blastTeam', desc: 'who the blast hurts' },
      { key: 'size', desc: 'carrier box size (px)' },
      { key: 'specialType', desc: 'optional projectile style override; omitted inherits payload default, null selects plain projectile' },
      { key: 'mineTtl', desc: 'resting mine/fuse seconds (mine/bomb/molotov); null = contact only' },
      { key: 'blinkDuration', desc: 'mine warning seconds' },
      { key: 'blast.explosionRadius', desc: 'explosion blast circle (px)' },
      { key: 'blast.shockRadius', desc: 'shockwave ring max radius (px)' },
      { key: 'blast.fireWidth', desc: 'napalm burn zone width (px)' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('skyMissile', null, declaredEffectsOf('skyMissile'));
    const pt = resolveImpactPoint(p, ctx);
    // The missile ALWAYS enters from the top of the view — that is what "sky"
    // means. Spawn just above the visible area; fallSpeed alone sets fall time.
    const spawnY = -p.size;

    h.state = {
      phase: 'warning',
      t: 0,
      impact: pt,
      markerFired: false,
      missile: null,
      done: false,
    };

    const launchMissile = () => {
      // Strictly vertical: direction π/2 = straight down (radians, 0 = right).
      // ttl covers the full fall from the view top to the impact line (+ small
      // margin so the surface contact resolves first, not the fuse).
      const fallTtl = ((pt.y - spawnY) / Math.max(1, p.fallSpeed)) + 0.25;
      // Payload choice: any of the 8 ATTACK_IDS children. All share the same
      // carrier surface (origin/direction/speed/ttl/team), so one call site
      // works; invokeChild (attackIds.js) resolves p.child to the concrete
      // payload id.
      //   projectile — plain drop thorn: contact damage on the way down, dies
      //     at the marked line (crossing check) or on target contact. No
      //     payload — the drop shot IS the hit.
      //   explosion | shockwave | napalm — straight impact carriers (each
      //     reads its OWN size key from `blast`), killed at the marked line by
      //     the drop-phase crossing check → payload materializes there.
      //   mine — arc carrier (arc 0), settles at the marked surface via the
      //     host terrain step, then arms (mine-only overrides below).
      //   bomb — arc carrier (arc 0, no bounce): falls and detonates at the
      //     marked surface on first contact (stepBombTerrain 'stop' settle).
      //   molotov — arc carrier (arc 0, no bounce): falls and shatters into a
      //     burning area at the marked surface.
      const blast = p.blast ?? {};
      // Sub-payload resolution: the nested `payload` object (keys per
      // CHILD_PARAM_SPECS in attackIds.js) is the unified config surface —
      // one sub-object per child, read ONLY by its child (no cross-child key
      // collisions). Legacy flat keys (blast.*, mineType, mineTtl,
      // blinkDuration) keep working and are the fallback.
      const pl = p.payload ?? {};
      const sub = (child) => pl[child] ?? {};
      // Map our named keys → the param each impact-carrier payload reads:
      //   explosiveProjectile reads `radius`
      //   shockwaveProjectile reads `radius`
      //   napalm reads `fireWidth`
      const payloadSize = {
        explosionRadius: () => ({ radius: sub('explosion').radius ?? blast.explosionRadius }),
        shockwave: () => ({ radius: sub('shockwave').radius ?? blast.shockRadius }),
        napalm: () => ({ fireWidth: sub('napalm').fireWidth ?? blast.fireWidth }),
      }[p.child === 'shockwave' ? 'shockwave' : p.child === 'napalm' ? 'napalm' : 'explosionRadius']();
      const m = invokeChild(p.child, {
        origin: { x: pt.x, y: spawnY },
        direction: Math.PI / 2,
        speed: p.fallSpeed,
        ttl: fallTtl,
        damage: p.damage,
        team: p.team,
        blastTeam: p.blastTeam,
        size: p.size,
        solidBehavior: 'stop',
        ...(p.child === 'projectile' ? {} : payloadSize),
        // Do not pass an absent override: the named payload owns its default.
        ...(p.specialType !== undefined ? { specialType: p.specialType } : {}),
        ...(p.child === 'mine' ? {
          origin: { x: pt.x, y: spawnY }, groundY: pt.y, arc: 0, bounce: false,
          // ?? (not ||): an explicit null fuse (contact-only) must survive.
          // No `?? 2` fallback — an ABSENT fuse falls through to the mine
          // macro's own default (2s); an explicit null stays null.
          ttl: sub('mine').ttl ?? p.mineTtl,
          blinkDuration: sub('mine').blinkDuration ?? p.blinkDuration,
          mineType: sub('mine').mineType ?? p.mineType,
          team: p.blastTeam,
          radius: sub('mine').radius ?? (p.mineType === 'shockwave' ? blast.shockRadius : blast.explosionRadius),
        } : {}),
        ...(p.child === 'bomb' ? {
          origin: { x: pt.x, y: spawnY }, arc: 0, bounce: false,
          ttl: sub('bomb').ttl ?? p.mineTtl ?? 2,
          radius: sub('bomb').radius ?? blast.explosionRadius,
          explodeOnContact: true,
        } : {}),
        ...(p.child === 'molotov' ? {
          origin: { x: pt.x, y: spawnY }, arc: 0, bounce: false,
          ttl: sub('molotov').ttl ?? p.mineTtl ?? 2,
          fireWidth: sub('molotov').fireWidth ?? blast.fireWidth,
          team: p.blastTeam,
        } : {}),
        ...(p.child === 'enemy' ? {
          origin: { x: pt.x, y: spawnY }, arc: 0, bounce: false,
          ttl: null,
          enemyType: sub('enemy').enemyType ?? 'explosive_monkey',
          mineType: sub('enemy').mineType ?? p.mineType,
          team: p.blastTeam,
          target: ctx.world?.hero ?? null,
        } : {}),
      }, ctx);
      h.state.missile = m;
      // Promote the payload macro into the root's deferred-children list so
      // hosts (theater/gameplay) step AND draw its zone children uniformly —
      // the carrierMacro base walks h.handles for both. Without this the
      // napalm fire zone is invisible: it lives only under state.missile.
      if (m && !h.handles) h.handles = [];
      if (m) h.handles.push(m);
      if (m) {
        m.on('hit', (...args) => h._emit('hit', ...args));
        m.on('complete', () => { h._complete(); });
      } else {
        // Pool exhausted — soft-fail: nothing to drop, finish cleanly.
        h._complete();
      }
    };

    h.step = (dt, _targets) => {
      const s = h.state;
      if (s.done || h._completed || h._cancelled) return true;
      s.t += dt;

      if (s.phase === 'warning') {
        // The warning is the REAL Surface Target Marker effect (effects.md #9):
        // FIXED at the impact point for the whole window — the player reads
        // "leave this spot", never "track a moving thing".
        if (s.t <= dt && !s.markerFired) {
          s.markerFired = true;
          fireDeclared({ type: 'surface-target-marker', params: { x: pt.x, y: pt.y, duration: Math.max(0.1, p.timeToTarget), ...(p.markerStyle ?? {}) } }, h.declaredEffectTypes());
        }
        if (s.t >= p.timeToTarget) { s.phase = 'drop'; s.t = 0; launchMissile(); }
      } else if (s.phase === 'drop') {
        // Step the child carrier (flight + detonation are its job). The macro
        // completes when the child handle has completed (its 'complete' event
        // already forwarded via on('complete') above — _complete is idempotent).
        if (s.missile?.step) s.missile.step(dt, _targets);
        // Surface landing: plain projectiles get NO terrain handling (only
        // bombs do), so without this the carrier would phase through the
        // marked surface and fizzle at TTL below it — marker says "boom HERE",
        // boom happens elsewhere. Kill the carrier when its bottom CROSSES
        // the impact line this frame; _attackHit routes the death through
        // stepProjectile's 'hit' → the blast resolves at exactly the marked
        // point. Marker and blast share state.impact, so they can never
        // drift apart. Crossing check (prev <= line < new) is exact: the
        // landing test runs AFTER integration, so a same-frame `>=` test
        // overshoots by up to one frame of travel.
        const ent = s.missile?.entity;
        if (ent?.alive && !ent._arcRecipe && !ent._attackDone) {
          const prevBottom = ent._bombPrevBottom; // captured before integration in Projectile.update
          const newBottom = ent.y + ent.h;
          if (prevBottom <= pt.y && newBottom >= pt.y) {
            ent.alive = false;
            ent._attackHit = true;
          }
        }
        if (s.missile?._completed) {
          s.done = true;
          h._complete();
          return true;
        }
      }
      return false;
    };

    const cancel = h.cancel.bind(h);
    h.cancel = () => {
      for (const child of h.handles ?? []) child.cancel();
      cancel();
    };
    return h;
  },
});
