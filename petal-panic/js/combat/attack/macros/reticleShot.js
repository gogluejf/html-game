// Attack Engine — Reticle Shot macro (Reticle → Projectile).
//
// The canonical "telegraph then fire" composition: a reticle TRACKS the
// target, LOCKS its position at lockTime, and when the warning window ends
// (duration) ONE projectile is fired from the attacker's center at the LOCKED
// point — not where the target happens to be at that moment.
//
// Owning this here (not in a debug demo) means heroes/enemies get identical
// behavior. See attack-macros.md.
//
// Params (flat, same names as the underlying primitives):
//   - Reticle: target, duration, lockTime, style, color, radius, tracking
//   - Projectile: speed, ttl, damage
//
// Handle events: 'complete' ({point}) when the shot has been spawned; 'hit'
// is forwarded from the shot once the host routes contact. handle.state
// mirrors the reticle timing state so renderers can draw the telegraph.

import { registerMacro } from '../registry.js';
import { invoke, AttackHandle } from '../engine.js';

const DEFAULTS = Object.freeze({
  // Reticle stage.
  target: null,        // entity to track (default ctx.target)
  duration: 1.6,       // total warning window (s): track → lock → fire
  lockTime: 0.5,       // seconds after start when the aim freezes
  style: 'reticle',    // telegraph visual (maps to target-reticle effect)
  color: '#ff5555',
  radius: 30,          // visual size hint for the effect
  tracking: true,
  // Shot stage (plain projectile params).
  speed: 500,          // projectile speed px/s
  ttl: 2,              // projectile lifetime (s)
  damage: 10,          // projectile damage
});

registerMacro('reticleShot', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Reticle Shot',
    desc: 'Reticle tracks the target, locks at lockTime, then fires one projectile at the locked point when duration ends.',
    params: [
      { key: 'target', desc: 'entity to track (default ctx.target)' },
      { key: 'duration', desc: 'warning window (s)' },
      { key: 'lockTime', desc: 's after start when the aim freezes' },
      { key: 'style', desc: 'circle | reticle | marker' },
      { key: 'color', desc: 'VFX color' },
      { key: 'radius', desc: 'visual size' },
      { key: 'speed', desc: 'projectile speed px/s' },
      { key: 'ttl', desc: 'projectile lifetime (s)' },
      { key: 'damage', desc: 'projectile damage' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('reticleShot');

    const reticle = invoke('reticle', {
      target: params.target ?? ctx.target,
      duration: params.duration,
      lockTime: params.lockTime,
      style: params.style,
      color: params.color,
      radius: params.radius,
      tracking: params.tracking,
    }, ctx);

    // Expose the reticle timing state for renderers (telegraph ring drawing).
    h.state = reticle.state;

    let fired = false;
    h.step = (dt) => {
      const done = reticle.step(dt);
      if (done && !fired) {
        fired = true; // exactly ONE shot, at the end of the warning window
        const pt = reticle.state.locked ?? reticle.state.pt;
        const a = ctx.attacker;
        const ox = (a?.x ?? 0) + (a?.w ?? 0) / 2;
        const oy = (a?.y ?? 0) + (a?.h ?? 0) / 2;
        const dir = Math.atan2(pt.y - oy, pt.x - ox);
        const shot = invoke('projectile', {
          origin: { x: ox, y: oy },
          direction: dir,
          speed: params.speed,
          ttl: params.ttl,
          damage: params.damage,
        }, ctx);
        if (shot?.entity) {
          h.shot = shot;
          // The telegraph effect outlives the warning window on purpose: it
          // stays up while the bullet is in flight and dismisses itself when
          // the shot ends. 'hit' forwards damage; 'expire' (missed/expired
          // shot) closes the macro so hosts can drop the reticle. The host
          // needs no distance math or manual dismissal.
          shot.on('hit', (info) => h._emit('hit', info));
          shot.on('expire', () => h._emit('expire'));
        }
        h._complete({ point: pt });
      }
      return done;
    };
    h.cancel = () => { reticle.cancel(); h.shot?.cancel?.(); };
    return h;
  },
});
