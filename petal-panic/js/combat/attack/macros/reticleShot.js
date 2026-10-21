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
// Handle events: 'complete' ({point}) when the shot has been spawned; 'hit'
// and 'expire' are forwarded from the shot so hosts dismiss the telegraph
// with the bullet's terminal event. handle.state carries the timing + the
// live effect instance (state._fx) for renderers/debug.

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { targetCenter } from '../context.js';
import { fireDeclared } from '../../../effects/index.js';
// Ensure payload macros are registered (otherwise only pulled in by the theater).
import './explosiveProjectile.js';
import './shockwaveProjectile.js';
import './napalm.js';

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
  blastType: 'plain',   // plain | explosion | shockwave | napalm — payload on impact
  speed: 500,          // projectile speed px/s
  ttl: 2,              // projectile lifetime (s)
  damage: 10,          // projectile / contact damage
  blast: {             // per-payload size params (each payload reads its own key)
    explosionRadius: 70, // explosion blast circle (px)
    shockRadius: 150,    // shockwave ring max radius (px)
    fireWidth: 96,       // napalm burn zone width (px)
  },
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
      { key: 'target', desc: 'entity to track (default ctx.target)' },
      { key: 'duration', desc: 'warning window (s)' },
      { key: 'lockTime', desc: 's after start when the aim freezes' },
      { key: 'color', desc: 'VFX color' },
      { key: 'radius', desc: 'reticle size (px)' },
      { key: 'tracking', desc: 'follow the target until lockTime' },
      { key: 'blastType', desc: "plain | explosion | shockwave | napalm — payload on impact" },
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
    h.step = (dt) => {
      const s = h.state;
      if (s.done && !h.shot?.entity?.alive) return true; // shot finished, macro done
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
        const dir = Math.atan2(pt.y - o.y, pt.x - o.x);
        const blastType = params.blastType ?? 'plain';
        const blast = params.blast ?? {};
        // Plain: the primitive itself. Anything else: a payload macro that
        // composes the projectile carrier with its detonation. Each payload
        // reads its OWN size key from `blast`.
        let shot;
        if (blastType === 'plain') {
          shot = invoke('projectile', {
            origin: { x: o.x, y: o.y },
            direction: dir,
            speed: params.speed,
            ttl: params.ttl,
            damage: params.damage,
          }, ctx);
        } else {
          const payloadId = blastType === 'shockwave' ? 'shockwaveProjectile'
            : blastType === 'napalm' ? 'napalm'
            : 'explosiveProjectile';
          const payloadSize = blastType === 'shockwave'
            ? { radius: blast.shockRadius }
            : blastType === 'napalm'
              ? { fireWidth: blast.fireWidth }
              : { radius: blast.explosionRadius };
          shot = invoke(payloadId, {
            origin: { x: o.x, y: o.y },
            direction: dir,
            speed: params.speed,
            ttl: params.ttl,
            damage: params.damage,
            ...payloadSize,
          }, ctx);
        }
        if (shot?.entity) {
          h.shot = shot;
          // Promote the payload macro into the root's deferred-children list
          // so hosts (theater/gameplay) step AND draw its zone children
          // uniformly — same pattern as skyMissile. Without this the napalm
          // fire zone / explosion is invisible: it lives only under h.shot.
          if (!h.handles) h.handles = [];
          h.handles.push(shot);
          shot.on('hit', (info) => h._emit('hit', info));
          shot.on('expire', () => h._emit('expire'));
        }
        h._complete({ point: s.locked ?? s.pt });
      }
      return false;
    };

    h.cancel = () => {
      // Tear down the telegraph instance so a cancelled attack never leaves a
      // ghost reticle in the engine's active set.
      try { h.state._fx?.complete?.(); } catch { /* noop */ }
      h.state._fx = null;
      h.shot?.cancel?.();
    };
    return h;
  },
});
