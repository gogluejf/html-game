// Attack Engine — Rock (macro). ONE object, ONE id.
//
// A rock is a basic arcing projectile: it flies a gravity arc and BOUNCES off
// terrain (classic decay, bomb-style) — but unlike a bomb it does NOT explode.
// If it never hits anyone it simply expires on ttl and disappears. If it DOES
// hit, it behaves exactly like a normal projectile: contact damage through the
// standard handlers, nothing more.
//
// It composes the `projectile` primitive's arcing recipe (`arc != null`) with
// `rock: true`, which gives the carrier the rock look (rock_medium sheet in
// high-res, rockDrawer in primitive mode, NO outline). The rock look is
// opt-in: the DEFAULT typeless arcing carrier keeps the thorn look.

import { defineMacro } from '../defineMacro.js';
import { invoke } from '../engine.js';
import { blinkTransition } from '../../../effects/blinkTransition.js';

const ROCK_DEFAULTS = Object.freeze({
  speed: 600,            // launch force (px/s)
  direction: -0.5,       // radians — up-right throw
  arc: 1200,             // gravity px/s² (throw height)
  damage: 40,            // contact damage (rock is heavy)
  ttl: 2,                // fuse seconds — the only thing that kills it if it never hits
  spin: 4,               // tumble angular rate (rad/s, center — random ±50% per rock)
  origin: null,          // marker label | {x,y} | null → attacker center
  team: 'ally',
  vanishTime: 1.0,       // blink-out transition after fuse expiry (s); 0 = instant
});
export { ROCK_DEFAULTS };

defineMacro('rock', {
  attacks: [{ id: 'projectile', role: 'carrier' }],
  params: { ...ROCK_DEFAULTS },
  meta: {
    name: 'Rock',
    // Inherited from the projectile primitive it composes: the rock handle
    // carries the primitive's effects (h.id is rewritten to 'rock' at invoke,
    // but declared types ride on the handle). The guard checks THIS set, so
    // hit-sparkle/debris must be declared here or the first hit throws.
    effects: [
      { type: 'hit-sparkle', desc: 'blood sparkles on enemy impact (hit juice)' },
      { type: 'debris', desc: 'dusty grain puff when the rock dies on terrain' },
    ],
    desc: 'Arcing rock: gravity arc + decay bounce, NO explosion. Contact damage like a projectile; expires on ttl if it never hits.',
    params: [
      { key: 'speed', desc: 'launch force (px/s)' },
      { key: 'direction', desc: 'throw direction (radians)' },
      { key: 'arc', desc: 'gravity px/s² (throw height)' },
      { key: 'damage', desc: 'damage per enemy contact' },
      { key: 'ttl', desc: 'fuse seconds (disappears if it never hits)' },
      { key: 'spin', desc: 'tumble rate (rad/s, random ±50% per rock)' },
      { key: 'origin', desc: 'marker label | {x,y} | null → attacker center' },
      { key: 'team', desc: 'ally | foe' },
      { key: 'vanishTime', desc: 'blink-out transition before the rock disappears (s); 0 = instant' },
    ],
  },
  impl(params, ctx) {
    const p = { ...ROCK_DEFAULTS, ...params };
    const h = invoke('projectile', {
      speed: p.speed,
      direction: p.direction,
      arc: p.arc,
      bounce: true,          // bomb-style decay bounce (classic 0.5 restitution)
      rock: true,            // rock look: rock_medium / rockDrawer, no outline
      spin: p.spin,          // tumble rate — random start + slow spin on tangent
      damage: p.damage,
      ttl: p.ttl,
      origin: p.origin,
      team: p.team,
    }, ctx);
    if (!h?.entity) return h;
    const ent = h.entity;
    // --- Blink-out vanish (COIN PATTERN, skyDiveStomp contract) --------------
    // On fuse expiry the rock does NOT pop out of existence: for `vanishTime`
    // the entity itself blinks between its normal art and NOTHING (the coin's
    // exact technique — a plain blinkTransition factory instance owned by the
    // entity, consulted in its own draw(); no effect-engine instance, so no
    // white box over the rock). When the window ends the entity is culled, a
    // 'vanish' event fires with the death point, and stepBomb() completes the
    // handle the next step (untouched terminal contract). Contact kills skip
    // the transition entirely: ttlExpired is only set by the TTL flip, never
    // by an impact consume.
    const vt = Math.max(0, Number(p.vanishTime) || 0);
    if (vt > 0 && !ent._vanishArmed) {
      ent._vanishArmed = true;
      ent._vanishFired = false;
      ent._vanishT = 0;
      const prevUpdate = typeof ent.update === 'function' ? ent.update.bind(ent) : () => {};
      const prevDraw = typeof ent.draw === 'function' ? ent.draw.bind(ent) : () => {};
      ent.update = (dt) => {
        prevUpdate(dt);
        // First frame the fuse expired: revive the entity for the blink
        // window (tickTtl would re-kill it every frame) and build the blink.
        if (!ent._vanishFired && ent.ttlExpired) {
          ent._vanishFired = true;
          ent._vanishT = 0;
          ent.alive = true;
          ent._bombFuseDisabled = true;
          ent._blink = blinkTransition({
            duration: vt,
            speed: 6,                    // initial switches/s (matches stomp vanish)
            endSpeed: 30,                 // final switches/s (ease-in acceleration)
            frameA: 'rock',               // source half-cycles → draw the rock
            frameB: null,                 // destination half-cycles → nothing
            direction: 'forward',
            hold: false,                  // done flips at the end
          }, ent);
        }
        // Blink window: advance the blink clock, then cull at the end.
        if (ent._vanishFired && ent.alive) {
          ent._vanishT += dt;
          if (ent._blink && !ent._blink.done) ent._blink.update(dt);
          if (ent._vanishT >= vt) {
            ent.alive = false;
            h._emit('vanish', { x: ent.x + ent.w / 2, y: ent.y + ent.h / 2 });
          }
        }
      };
      ent.draw = (c2d) => {
        // Coin pattern: the entity owns its own visibility during the blink.
        // 'rock' half → normal art (sheet or primitive drawer), null half →
        // hidden. Nothing else renders — no overlay box.
        if (ent._vanishFired && ent._blink && !ent._blink.done) {
          if (ent._blink.frame() === 'rock') prevDraw(c2d);
          return;
        }
        prevDraw(c2d);
      };
    }
    return h;
  },
});
