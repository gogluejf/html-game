// Attack Engine — Shockwave primitive.
//
// Expanding ring that deals damage when its edge PASSES over a target
// (ring-pass model). The visual IS the mechanic: you see the ring grow,
// and if it crosses you, you take the hit + radial knockback.
//
// Asynchronous: the handle steps each frame until the ring reaches maxRadius
// or duration expires. Targets are checked per-tick against the band
// [prevRadius, currentRadius] so each entity is hit exactly once.
//
// VFX: fires the shockwave effect (eased expansion, colorIn membrane) +
// one camera shake at t=0. No screen flash (the ring IS the visual).

import { registerPrimitive, getPrimitive, getMacro } from '../registry.js';
import { AttackHandle } from '../engine.js';
import { fireDeclared } from '../../../effects/index.js';
import { VIEW_W, VIEW_H } from '../../../core/view.js';

const DEFAULTS = Object.freeze({
  x: 0,               // ring center (world coords)
  y: 0,
  radius: 150,        // max ring radius (px) — the damaging extent
  damage: 70,         // raw damage per target caught by the ring
  team: 'neutral',    // ally | foe | neutral
  duration: 1.2,      // s — total expansion time
  easing: 'easeIn',   // linear | easeIn (t²) | easeInCubic (t³)
  knockbackIntensity: 8, // radial push strength (px/frame impulse)
  shake: true,        // camera shake on launch
  shakeIntensity: 5,  // shake magnitude
});

/** Eased progress: maps linear t∈[0,1] to eased t∈[0,1]. */
function ease(t, mode) {
  if (mode === 'easeInCubic') return t * t * t;
  if (mode === 'easeIn') return t * t;
  return t;
}

function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}

registerPrimitive('shockwave', {
  params: { ...DEFAULTS },
  meta: {
    name: 'Shockwave',
    effects: [
      { type: 'shockwave', desc: 'expanding ring (the attack itself)' },
      { type: 'camera-shake', desc: 'shake on launch' },
    ],
    desc: 'Expanding pressure ring. Damage applies when the ring edge passes over a target (ring-pass model). Radial knockback launches victims away from center. Eased growth (default t²) sells the building-pressure feel.',
    params: [
      { key: 'x', desc: 'ring center x' },
      { key: 'y', desc: 'ring center y' },
      { key: 'radius', desc: 'max ring radius (px)' },
      { key: 'damage', desc: 'damage per target caught' },
      { key: 'team', desc: 'ally | foe | neutral' },
      { key: 'duration', desc: 'expansion time (s)' },
      { key: 'easing', desc: 'growth curve (linear/easeIn/easeInCubic)' },
      { key: 'knockbackIntensity', desc: 'radial push strength' },
      { key: 'shake', desc: 'camera shake on launch (true)' },
      { key: 'shakeIntensity', desc: 'shake magnitude' },
    ],
  },
  impl(params, ctx) {
    const h = new AttackHandle('shockwave', null, [
      'shockwave',
      ...(params.shake !== false ? ['camera-shake'] : []),
    ]);

    const cx = params.x;
    const cy = params.y;
    const maxR = params.radius;
    const dmg = params.damage;
    const team = params.team;
    const dur = params.duration;
    const easingMode = params.easing;
    const kbInt = params.knockbackIntensity;
    const targets = ctx.world?.targets ?? [];

    let elapsed = 0;
    let prevRadius = 0;
    const hitSet = new Set();
    let done = false;

    // Fire VFX immediately (ring visual + shake). Sequencing (telegraph →
    // gap → blink → beat) is owned by the CALLING MACRO (stompWave pattern) —
    // the primitive fires exactly when it is invoked.
    fireDeclared(
      { type: 'shockwave', params: { x: cx, y: cy, startRadius: 4, maxRadius: maxR, duration: dur, easing: easingMode, colorIn: '#4488ff', opacity: 0.9, thickness: 6, color: '#ffe9a8' } },
      h.declaredEffectTypes(),
    );
    if (params.shake !== false) {
      fireDeclared(
        { type: 'camera-shake', params: { intensity: params.shakeIntensity ?? 5, duration: 0.25 } },
        h.declaredEffectTypes(),
      );
    }

    h._emit('launch', { x: cx, y: cy, radius: maxR });

    h.step = (dt, targetsOverride) => {
      if (done) return true;
      const tList = targetsOverride ?? targets;
      elapsed += dt;
      const t = Math.min(1, elapsed / dur);
      const eased = ease(t, easingMode);
      const curRadius = 4 + (maxR - 4) * eased; // start at 4px like the effect

      // Ring-pass damage: targets whose distance falls in [prevRadius, curRadius]
      for (const ent of tList) {
        if (hitSet.has(ent)) continue;
        if (ent.alive === false) continue;
        // Team check: skip same-team entities
        if (team !== 'neutral' && ent.team === team) continue;

        const ex = (ent.x ?? 0) + (ent.w ?? 0) / 2;
        const ey = (ent.y ?? 0) + (ent.h ?? 0) / 2;
        const dist = Math.hypot(ex - cx, ey - cy);

        // Ring passed over this entity this tick?
        if (dist <= curRadius && dist > prevRadius) {
          hitSet.add(ent);
          // Apply damage
          if (typeof ent.takeDamage === 'function') {
            ent.takeDamage(dmg, { source: ctx.attacker ?? null, kind: 'shockwave' });
          } else if (typeof ent.hp !== 'undefined') {
            ent.hp -= dmg;
            if (ent.hp <= 0) ent.alive = false;
          }
          // Radial knockback: push away from center
          const angle = Math.atan2(ey - cy, ex - cx);
          const kx = Math.cos(angle) * kbInt;
          const ky = Math.sin(angle) * kbInt;
          if (typeof ent.applyKnockback === 'function') {
            ent.applyKnockback(kx, ky);
          } else {
            ent.vx = (ent.vx ?? 0) + kx;
            ent.vy = (ent.vy ?? 0) + ky;
          }
        }
      }

      prevRadius = curRadius;

      if (t >= 1) {
        done = true;
        h._emit('complete', { hit: hitSet.size });
        h._complete({ hit: [...hitSet] });
        return true;
      }
      return false;
    };

    return h;
  },
});
