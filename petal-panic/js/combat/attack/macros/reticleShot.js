// Attack Engine — Reticle Shot macro (target-reticle effect → Projectile).
//
// The canonical "telegraph then fire" attack: a target-reticle EFFECT tracks
// the target, LOCKS its position at lockTime, and when the warning window ends
// (duration) ONE projectile is fired from the attacker's center at the LOCKED
// point — not where the target happens to be at that moment.
//
// The telegraph is the `target-reticle` effect (effects.md §10). This macro
// owns its lifecycle directly — fire it once, move its origin while tracking,
// freeze it at lock. Other attacks that want a warning fire whichever effect
// they need the same way (spike → telegraph-circle, boss slam →
// surface-target-marker...).
//
// Owning this here (not in a debug demo) means heroes/enemies get identical
// behavior. See attack-macros.md §3.
//
// Params (flat):
//   - Telegraph: target, duration, lockTime, color, radius, tracking
//   - Shot: speed, ttl, damage
//
// Handle events: 'complete' ({point}) when the shot/payload has finished; 'hit'
// and 'expire' are forwarded from the shot so hosts dismiss the telegraph
// with the bullet's terminal event. handle.state carries the timing + the
// live effect instance (state._fx) for renderers/debug.

import { defineMacro } from '../defineMacro.js';
import { AttackHandle } from '../engine.js';
import { invokeChild, CHILD_TARGETS } from '../attackIds.js';
import { targetCenter } from '../context.js';
import { fireDeclared } from '../../../effects/index.js';
import { ballisticAt } from '../../targeting.js';
// Ensure payload macros are registered (otherwise only pulled in by the theater).
import './explosiveProjectile.js';
import './shockwaveProjectile.js';
import './napalm.js';
import './explosiveBomb.js';
import './shockwaveBomb.js';
import './throwMine.js';
import './molotov.js';
import { MINE_DEFAULTS } from './mine.js';
import { THROW_ENEMY_DEFAULTS } from './throwEnemy.js';

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
  // Telegraph stage.
  target: null,        // entity to track (default ctx.target)
  duration: 1.3,       // total warning window (s): track → lock → fire
  lockTime: 1.1,       // seconds after start when the aim freezes
  color: '#ff5555',
  radius: 30,          // reticle size (px)
  tracking: true,      // follow the target until lockTime
  // Shot stage.
  child: 'projectile', // any ATTACK_IDS child — payload on impact
  speed: 500,          // projectile speed px/s
  ttl: 2,              // projectile lifetime (s)
  damage: 10,          // projectile / contact damage
  blast: {             // legacy per-payload size params (fallback)
    explosionRadius: 70, // explosion blast circle (px)
    shockRadius: 150,    // shockwave ring max radius (px)
    fireWidth: 96,       // napalm burn zone width (px)
  },
  // Sub-payload config (M3 completion): keys per the child's CHILD_PARAM_SPECS
  // (attackIds.js). NULL by default — a concrete default object would clobber
  // the caller's flat legacy keys (blast.*, mineType, mineTtl, blinkDuration)
  // at every `sub(child).x ?? p.flat` read. With null, flat keys fall through
  // and unconfigured children read their OWN macro defaults.
  payload: null,
});

/**
 * Resolve the current aim point: tracked target center → attacker center.
 * A dead/missing target falls back to the attacker so the math never NaNs.
 */
function aimPoint(params, ctx) {
  const t = params.target ?? ctx.target;
  if (t && t.alive !== false) return targetCenter(t);
  const a = ctx.attacker;
  return { x: (a?.x ?? 0) + (a?.w ?? 0) / 2, y: (a?.y ?? 0) + (a?.h ?? 0) / 2 };
}

defineMacro('reticleShot', {
  attacks: [
    { id: 'projectile', role: 'payload' },
    { id: 'explosiveBomb', role: 'payload' },
    { id: 'shockwaveBomb', role: 'payload' },
    { id: 'throwMine', role: 'payload' },
    { id: 'molotov', role: 'payload' },
    { id: 'throwEnemy', role: 'payload' },
    { id: 'explosiveProjectile', role: 'payload' },
    { id: 'shockwaveProjectile', role: 'payload' },
    { id: 'napalm', role: 'payload' },
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Reticle Shot',
    effects: [
      { type: 'target-reticle', desc: 'telegraph reticle that tracks then locks' },
    ],
    desc: 'Target-reticle effect tracks the target, locks at lockTime, then fires one projectile at the locked point when duration ends.',
    params: [
      { key: 'child', desc: "any ATTACK_IDS child — projectile | expl_proj | shock_proj | napalm (straight) · bomb | shock_bomb | mine | molotov | enemy (arc, host-settled)" },
      { key: 'target', desc: 'entity to track (default ctx.target)' },
      { key: 'duration', desc: 'warning window (s)' },
      { key: 'lockTime', desc: 's after start when the aim freezes' },
      { key: 'color', desc: 'VFX color' },
      { key: 'radius', desc: 'reticle size (px)' },
      { key: 'tracking', desc: 'follow the target until lockTime' },
      { key: 'payload', desc: 'sub-payload config for the shot (keys per the child; see CHILD_PARAM_SPECS)' },
      { key: 'speed', desc: 'projectile speed px/s' },
      { key: 'ttl', desc: 'projectile lifetime (s)' },
      { key: 'damage', desc: 'projectile / contact damage' },
      { key: 'blast.explosionRadius', desc: 'explosion blast circle (px)' },
      { key: 'blast.shockRadius', desc: 'shockwave ring max radius (px)' },
      { key: 'blast.fireWidth', desc: 'napalm burn zone width (px)' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('reticleShot', null, declaredEffectsOf('reticleShot'));
    const pt0 = aimPoint(params, ctx);
    h.state = { t: 0, done: false, pt: pt0, locked: null, _fx: null };

    // Fire the telegraph effect ONCE. Fixed-mode instance (null carrier):
    // THIS macro owns tracking by mutating body.origin each step — no
    // per-frame re-fire, no stacking. Duration covers warning + bullet
    // flight so the same instance survives the shot. lockAt drives the
    // effect's own zoom/blink lock-on visual (no external mutation).
    // No-op (state._fx stays null) when the context has no effect engine,
    // e.g. pure-logic tests — timing still works.
    try {
      h.state._fx = fireDeclared({
        type: 'target-reticle',
        params: {
          x: pt0.x, y: pt0.y, color: params.color, size: params.radius,
          duration: params.duration + params.ttl, pulseRate: 1,
          lockAt: params.lockTime > 0 ? params.lockTime : null,
        },
      });
    } catch {
      h.state._fx = null; // unknown type in a minimal context — timing only
    }

    let fired = false;
    h.step = (dt, targets) => {
      const s = h.state;
      if (h._completed || h._cancelled) return true;
      if (fired) {
        h.shot?.step?.(dt, targets);
        if (!h.shot || h.shot._completed || h.shot._cancelled) {
          s.done = true;
          h._complete({ point: s.locked ?? s.pt });
          return true;
        }
      }
      s.t += dt;

      // Track the target until lockTime, then freeze the aim point.
      if (!s.locked && (!params.tracking || params.lockTime == null || s.t >= params.lockTime)) {
        s.locked = aimPoint(params, ctx);
        s.pt = s.locked;
      } else if (params.tracking && !s.locked) {
        s.pt = aimPoint(params, ctx);
      }
      // Move the live effect with the aim (no re-fire).
      if (s._fx?.body) s._fx.body.origin = { x: s.pt.x, y: s.pt.y };

      // Reticle disappears when the projectile passes over it (the locked
      // point). The macro owns both — no host involvement.
      const ent = h.shot?.entity;
      if (ent?.alive && s._fx?.body && s.locked) {
        const r = s._fx.body.radius ?? 0;
        const dx = ent.x + (ent.w ?? 12) / 2 - s.locked.x;
        const dy = ent.y + (ent.h ?? 12) / 2 - s.locked.y;
        if (dx * dx + dy * dy <= (r + 8) * (r + 8)) {
          try { s._fx.complete?.(); } catch { /* noop */ }
          s._fx = null;
        }
      }

      if (s.t < params.duration) return false;
      if (!fired) {
        fired = true; // exactly ONE shot, at the end of the warning window
        const pt = s.locked ?? s.pt;
        const o = targetCenter(ctx.attacker) ?? { x: 0, y: 0 };
        const child = params.child ?? 'projectile';
        const blast = params.blast ?? {};
        const pl = params.payload ?? {};
        const sub = pl[child] ?? {};
        const isArcChild = child === 'bomb' || child === 'shock_bomb' || child === 'mine' || child === 'molotov' || child === 'enemy';
        // Fallback chain that HONORS null (sub.ttl null = "contact only" for
        // mine/molotov — a ?? chain would swallow it and arm the default fuse).
        const pick = (...vals) => vals.find((v) => v != null);
        // Gravity is owned by the invoked child. Read the same registered
        // default invoke() uses; never substitute a reticle-specific weight.
        const childDefaults = getMacro(CHILD_TARGETS[child])?.params ?? {};
        const arcGravity = sub.arc ?? childDefaults.arc;
        let speed = params.speed;
        let dir = Math.atan2(pt.y - o.y, pt.x - o.x);
        if (isArcChild) {
          // Minimum launch speed at fixed gravity: v² >= g (distance - dy).
          // Preserve requested speed when reachable, otherwise increase only
          // launch speed (small margin avoids a roundoff-negative discriminant).
          const dx = pt.x - o.x, dy = pt.y - o.y;
          const minimumSpeed = Math.sqrt(Math.max(0, arcGravity * (Math.hypot(dx, dy) - dy)));
          speed = Math.max(speed, minimumSpeed * 1.001);
          dir = ballisticAt(o, { x: pt.x, y: pt.y, w: 0, h: 0 }, {
            speed, gravity: arcGravity, style: params.aimStyle ?? 'flat',
          }).direction;
        }
        // 'projectile' is the primitive itself; the other straight values are
        // payload macros that compose the projectile carrier with their
        // detonation — invokeChild (attackIds.js) resolves child to the
        // concrete id. Sub-payload config lives in the nested `payload`
        // object (keys per CHILD_PARAM_SPECS in attackIds.js); the legacy
        // `blast` keys are the fallback.
        //
        // ARC children (bomb/mine/molotov/enemy): the SAME telegraph, but the
        // fired body is an arcing carrier (arc from the locked point toward
        // the aim). Terrain settling is the host's job (theater's global arc
        // pass / update.js's global carrier pass) — same contract as
        // spawnSplit's arc children.
        //   bomb    → explosiveBomb: arcs, detonates at first contact/settle
        //   shock_bomb → shockwaveBomb: arcs, telegraph blink, shockwave ring
        //   mine    → throwMine: arcs, settles, arms (payload.mine.ttl null = contact)
        //   molotov → molotov: arcs, shatters into a burn area at death point
        //   enemy   → throwEnemy: arcs, lands as a real enemy
        const payloadSize = child === 'shock_proj'
          ? { radius: sub.radius ?? blast.shockRadius }
          : child === 'napalm'
            ? { fireWidth: sub.fireWidth ?? blast.fireWidth }
            : child === 'projectile'
              ? {}
              : { radius: sub.radius ?? blast.explosionRadius };
        const shot = invokeChild(child, {
          origin: { x: o.x, y: o.y },
          direction: dir,
          speed,
          ttl: params.ttl,
          damage: child === 'projectile' ? (sub.damage ?? params.damage) : params.damage,
          // Collision policy belongs to the child, not the telegraph.
          // Only forward caller-supplied overrides; omission preserves defaults.
          ...(sub.solidBehavior !== undefined ? { solidBehavior: sub.solidBehavior } : {}),
          ...payloadSize,
          ...(isArcChild ? {
            ...(sub.arc != null ? { arc: sub.arc } : {}),
            ...(sub.bounce !== undefined ? { bounce: sub.bounce } : {}),
            ...(sub.explodeOnContact !== undefined ? { explodeOnContact: sub.explodeOnContact } : {}),
            // Arc children own their fuse/flight config (payload first,
            // legacy flat keys as fallback, then the child macro's OWN
            // defaults). Never pass explicit undefined — `invoke` spreads
            // caller params over the macro defaults, so an undefined key
            // CLOBBERS the default (this is why reticle mines never
            // detonated: ttl undefined broke the mine fuse clock).
            ...(child === 'mine' ? {
              // ttl null is MEANINGFUL (contact-only) — honor explicit null,
              // fall through only on undefined:
              ttl: sub.ttl !== undefined ? sub.ttl : pick(params.mineTtl, MINE_DEFAULTS.ttl),
              blinkDuration: pick(sub.blinkDuration, params.blinkDuration, MINE_DEFAULTS.blinkDuration),
              mineType: pick(sub.mineType, params.mineType, MINE_DEFAULTS.mineType),
              team: pick(params.blastTeam, MINE_DEFAULTS.team),
              radius: pick(sub.radius, MINE_DEFAULTS.radius),
            } : {}),
            ...(child === 'molotov' ? {
              fireWidth: sub.fireWidth ?? blast.fireWidth,
              team: params.blastTeam,
            } : {}),
            ...(child === 'shock_bomb' ? {
              radius: sub.radius ?? blast.shockRadius,
              duration: sub.duration,
              team: params.blastTeam,
            } : {}),
            ...(child === 'enemy' ? {
              enemyType: sub.enemyType ?? params.enemyType ?? THROW_ENEMY_DEFAULTS.enemyType,
            } : {}),
          } : {}),
        }, ctx);
        if (shot?.entity) {
          h.shot = shot;
          // Promote the payload macro into the root's deferred-children list
          // for registry drawing; this parent alone steps the payload.
          // Same pattern as skyMissile. Without this the napalm
          // fire zone / explosion is invisible: it lives only under h.shot.
          if (!h.handles) h.handles = [];
          h.handles.push(shot);
          shot.on('hit', (info) => h._emit('hit', info));
          shot.on('expire', () => h._emit('expire'));
          // Enemy child: relay the landing so hosts register the landed enemy
          // (same contract as throwEnemy's 'land' + spawnSplit's h.enemies).
          if (child === 'enemy') {
            if (!h.enemies) h.enemies = [];
            shot.on('land', ({ enemy }) => {
              if (enemy) { h.enemies.push(enemy); h._emit('land', { enemy }); }
            });
          }
        }
      }
      return false;
    };

    const cancel = h.cancel.bind(h);
    h.cancel = () => {
      // Tear down the telegraph instance so a cancelled attack never leaves a
      // ghost reticle in the engine's active set.
      try { h.state._fx?.complete?.(); } catch { /* noop */ }
      h.state._fx = null;
      h.shot?.cancel?.();
      cancel();
    };
    return h;
  },
});
