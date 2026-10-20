// Attack Engine — Shockwave Projectile (macro). ONE object, one id.
//
// Straight-line twin of shockwaveBomb: projectile CARRIER → telegraph blink
// at impact → SHOCKWAVE primitive. The shot flies, hits a wall/ground/target,
// blinks briefly, then the expanding ring deals ring-pass damage.
//
// Sequencing (stompWave pattern): the MACRO owns the beat clock. On impact it
// fires the telegraph effect and arms a timer; when the timer reaches
// gap + blink + impactDelay it invokes the shockwave primitive. No delay lives
// in the primitive — it fires exactly when invoked.
//
// Handle wiring: createCarrierHandle's setInner is a plain reference (NO event
// proxy) so carrier completion can't escape as root completion while children
// are live. That means terminal events emitted by hosts do NOT automatically
// cross between h and carrier. So the detonate logic lives in a named function
// (doDetonate) called DIRECTLY from the bridge — no reliance on event proxies.
// The bridge listens on BOTH handles because hosts emit terminal events on
// whichever handle they step (theater: stepProjectile(ent, h) → emits on h;
// BombAttackHost: steps the carrier → emits on carrier). doDetonate is guarded
// idempotent so double-firing is harmless.

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { createCarrierHandle } from '../carrierMacro.js';
import { fireDeclared } from '../../../effects/index.js';
// Ensure the shockwave primitive is registered (it is otherwise only pulled in
// by the theater). Without this, invoke('shockwave') throws in gameplay.
import '../primitives/shockwave.js';

const DEFAULTS = Object.freeze({
  speed: 700,
  direction: 0,
  ttl: 2,
  // Shockwave params
  radius: 150,
  damage: 70,
  duration: 1.2,
  easing: 'easeIn',
  knockbackIntensity: 8,
  shakeIntensity: 5,
  // Telegraph timing: gap → blink (mode 'skip' = no build phase)
  telegraphGap: 0.3,
  telegraphBlink: 0.5,
  // Pause between blink end and ring launch (the "move NOW" beat)
  impactDelay: 0.5,
  origin: null,
  solidBehavior: 'stop',
  gravity: 0,
  team: 'ally',
  size: 12,
  blastTeam: 'neutral',
});

defineMacro('shockwaveProjectile', {
  attacks: [
    { id: 'projectile', role: 'carrier' },
    { id: 'shockwave', role: 'payload' },
  ],
  params: { ...DEFAULTS },
  meta: {
    name: 'Shockwave Projectile',
    desc: 'Straight-line shot that detonates into an expanding shockwave ring at its impact point. Telegraph blink warns before the ring launches.',
    effects: [
      { type: 'telegraph-circle', desc: 'blink warning at impact point' },
      { type: 'shockwave', desc: 'expanding damage ring' },
      { type: 'camera-shake', desc: 'shake on shockwave launch' },
    ],
    params: [
      { key: 'speed', desc: 'px/s travel speed' },
      { key: 'direction', desc: 'radians (0 = right)' },
      { key: 'ttl', desc: 'seconds before auto-cull' },
      { key: 'radius', desc: 'shockwave max radius (px)' },
      { key: 'damage', desc: 'ring-pass damage' },
      { key: 'duration', desc: 'ring expansion time (s)' },
      { key: 'easing', desc: 'growth curve' },
      { key: 'knockbackIntensity', desc: 'radial push strength' },
      { key: 'solidBehavior', desc: 'phase | stop | reflect' },
      { key: 'gravity', desc: 'px/s² (>0 = ballistic arc)' },
      { key: 'team', desc: 'ally | foe — who the carrier shot hurts' },
      { key: 'size', desc: 'box size (px)' },
      { key: 'blastTeam', desc: 'foe | ally | neutral — who the ring hurts' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };

    // Beat total: gap + blink (telegraph) + impactDelay (the "move NOW" beat).
    const beatTotal = (p.telegraphGap ?? 0.3) + (p.telegraphBlink ?? 0.5) + (p.impactDelay ?? 0.5);

    // Detonate logic as a named function so the bridge can call it DIRECTLY
    // (no event-proxy reliance). Idempotent via the _shockwaveArmed latch.
    const doDetonate = ({ x, y }) => {
      if (h._shockwaveArmed) return;
      try {
        fireDeclared(
          { type: 'telegraph-circle', params: { x, y, radius: Math.min(p.radius * 0.4, 60), mode: 'skip', gapTime: p.telegraphGap ?? 0.3, blinkTime: p.telegraphBlink ?? 0.5, color: '#ff5a5a' } },
          ['telegraph-circle'],
        );
        h._shockwaveArmed = true;
        h._armShockwave({ x, y });
      } catch (err) {
        console.error(`attack/shockwaveProjectile: telegraph failed`, err.message);
      }
    };

    // Beat clock state (declared up front so the _complete guard can read it).
    const swState = { t: 0, fired: false, x: 0, y: 0 };

    const h = createCarrierHandle('shockwaveProjectile', p, ctx, {
      onDetonate(impact, macroH) { doDetonate(impact); },
    });

    // Block completion while the shockwave beat is pending. The base step calls
    // h._complete() the instant the carrier dies (parentDone, no children yet),
    // which makes the host prune h and kill the beat clock. Defer _complete
    // until the ring has actually launched.
    const realComplete = h._complete.bind(h);
    h._complete = (...args) => {
      if (h._shockwaveArmed && !swState.fired) return; // hold open
      realComplete(...args);
    };

    h._armShockwave = ({ x, y }) => { swState.x = x; swState.y = y; };
    h._stepShockwave = (dt) => {
      if (swState.fired || !h._shockwaveArmed) return;
      swState.t += dt;
      if (swState.t < beatTotal) return;
      swState.fired = true;
      try {
        const targets = new Set();
        for (const t of ctx.world?.targets ?? []) if (t) targets.add(t);
        const aimed = p.target ?? ctx.target;
        if (aimed) targets.add(aimed);
        const sw = invoke('shockwave', {
          x: swState.x, y: swState.y,
          radius: p.radius,
          damage: p.damage,
          duration: p.duration,
          easing: p.easing,
          knockbackIntensity: p.knockbackIntensity,
          shake: true,
          shakeIntensity: p.shakeIntensity,
          team: p.blastTeam,
          targets: [...targets],
        }, ctx);
        sw.on('hit', (...args) => h._emit('hit', ...args));
        sw.on('complete', (...args) => h._emit('complete', ...args));
        h.handles.push(sw);
      } catch (err) {
        console.error(`attack/shockwaveProjectile: shockwave failed`, err.message);
      }
    };

    const carrier = invoke('projectile', {
      speed: p.speed,
      direction: p.direction,
      ttl: p.ttl,
      damage: 0, // no contact damage — the shockwave IS the damage
      origin: p.origin,
      solidBehavior: p.solidBehavior,
      gravity: p.gravity,
      team: p.team,
      size: p.size,
    }, ctx);

    if (!carrier?.entity) {
      h._emit('expire');
      h._complete();
      return h;
    }

    carrier._params = p;
    h.setInner(carrier); // plain reference (no proxy) — see header note
    h.entity = carrier.entity;
    h.inner = carrier;

    // Bridge projectile hit/expire → doDetonate at the impact point. Listen on
    // BOTH handles (hosts emit on whichever they step). doDetonate is guarded.
    const fireAtImpact = () => {
      const ent = carrier.entity;
      doDetonate({ x: ent.x + ent.w / 2, y: ent.y + ent.h / 2 });
    };
    h.on('hit', fireAtImpact);
    h.on('expire', fireAtImpact);
    carrier.on('hit', fireAtImpact);
    carrier.on('expire', fireAtImpact);

    h._wireCarrier(carrier);

    // Wrap the base step: advance the beat clock each frame AND keep the macro
    // alive while the shockwave beat is pending. The base step would otherwise
    // mark the macro complete the instant the carrier dies (parentDone with no
    // children yet), which makes the host prune h from its update list — killing
    // the beat clock before the ring ever fires. Returning false while armed-but-
    // not-fired holds the handle live until _stepShockwave launches the ring.
    const baseStep = h.step;
    h.step = (dt, targets) => {
      h._stepShockwave(dt);
      const done = baseStep(dt, targets);
      if (h._shockwaveArmed && !swState.fired) return false;
      return done;
    };
    return h;
  },
});
