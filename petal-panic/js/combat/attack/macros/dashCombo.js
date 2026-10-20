// Attack Engine — Dash Combo (macro, doc §13). ONE object, one id.
//
// A frame-scripted multi-hit dash: a timeline of N segments, each holding ONE
// sprite frame for its whole movement, then FREEZING on that frame — the hit
// lands during the freeze. N segments = N hits. The readable "get in close and
// commit" melee verb: fast, aggressive, beatable by design.
//
//   seg1 move → seg1 FREEZE(hit) → seg2 move → seg2 FREEZE(hit) → ... →
//   segN FREEZE(hit + launch) → RECOVERY
//
// The macro owns the WHOLE sequence itself (like stomp): it moves the attacker
// directly during move phases, runs the segment's Melee Hitbox during freezes,
// shoves overlapping victims during travel, and fires the declared effects.
// It does NOT invoke the Movement primitive per segment — the motion is part
// of the frame script, not a separate charge. `meta.invokes` still lists
// 'meleeHitbox' because the freeze hit IS the unified hitbox system.
//
// Gravity rule (§13 defyGravity): while the timeline runs the attacker HOLDS
// its altitude (vy pinned to 0, gravity suspended by the host reading this
// flag). When the last freeze ends — or the timeline breaks/cancels — the
// macro seeds vx/vy from the FINAL segment's speed + direction and releases;
// normal physics takes over from that launch velocity.
//
// Handle shape:
//   h.step(dt, targets) — advance the timeline; true when done
//   state.phase         — 'startup' | 'move' | 'freeze' | 'recovery' | 'done'
//   state.segmentIndex  — current segment (0-based)
//   state.frame         — current segment's frame label (theater/renderer seam)
//   state.shoveBox      — current move-phase body AABB (tests/debug)
//   events: hit { target, dealt, segmentIndex }
//           complete { broken?, connections }

import { defineMacro } from '../defineMacro.js';
import { AttackHandle } from '../engine.js';
import { makeHitbox, resetHitbox, processHitboxes } from '../../hitbox.js';
import { applyKnockback } from '../../knockback.js';
import { aabbOverlap } from '../../../core/collision.js';
import { fireDeclared } from '../../../effects/index.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel
// renders). Read at construction so synchronous fires inside impl()
// see the real declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}
import { getPrimitive, getMacro } from '../registry.js';

const DEFAULTS = Object.freeze({
  segments: null,       // REQUIRED — [{ frame, speed, duration, distance?, freezeFrames, hitbox, damage, knockback?, shove? }]
  direction: 0,         // radians; horizontal only (clamp to 0 or π)
  startup: 0.2,         // s before the first segment moves (commitment tell)
  recovery: 0.4,        // ONE window after the last freeze (punish zone)
  team: 'ally',         // who the freeze hitboxes hurt
  method: 'melee',      // damage telemetry label
  afterimage: null,     // effect override (count/fadeRate/lifetime/color...)
  shakeStyle: null,     // victim sprite-shake override (amount scales w/ segmentIndex)
});

/** Horizontal-only clamp: 0 (right) or π (left). */
export function clampDashDirection(rad) {
  return Math.cos(rad) < 0 ? Math.PI : 0;
}

/** Per-segment defaults (merged over caller data). */
export function normalizeSegment(seg = {}) {
  const out = {
    frame: seg.frame ?? null,
    speed: seg.speed ?? 420,
    duration: seg.duration ?? 0.18,
    distance: seg.distance ?? null,
    freezeFrames: seg.freezeFrames ?? 0.12,
    hitbox: seg.hitbox ?? { w: 48, h: 40, offset: { x: 30, y: 0 }, activeFrames: null },
    damage: seg.damage ?? 10,
    knockback: seg.knockback ? { ...seg.knockback } : null,
    shove: seg.shove ?? 0.6,
  };
  // Relative knockback: if the segment declares knockback but no explicit base,
  // derive it from the segment's own dash speed (faster dash = harder launch).
  // 0.25 keeps it punchy without rocket-launching the victim — the shove during
  // travel already does most of the physical work.
  if (out.knockback && out.knockback.base == null) {
    out.knockback.base = Math.round(out.speed * 0.25);
  }
  return out;
}

/** World-space AABB of a segment's freeze hitbox, relative to the attacker. */
export function segmentHitboxBox(seg, attacker) {
  const hb = seg.hitbox;
  if (!hb) return null;
  const cx = (attacker.x ?? 0) + (attacker.w ?? 0) / 2 + (hb.offset?.x ?? 0);
  const cy = (attacker.y ?? 0) + (attacker.h ?? 0) / 2 + (hb.offset?.y ?? 0);
  return { x: cx - hb.w / 2, y: cy - hb.h / 2, w: hb.w, h: hb.h };
}

defineMacro('dashCombo', {
  attacks: [{ id: 'meleeHitbox', role: 'freeze-hit' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Dash Combo',
    desc: 'Frame-scripted multi-hit dash: per segment, hold a frame and MOVE (afterimage trail, shoves overlapping victims), then FREEZE (hitbox live — this is the hit). Last freeze carries the knockback launch. One recovery window at the end.',
    effects: [
      { type: 'afterimage', desc: 'trail during each segment move phase' },
      { type: 'sprite-shake', desc: 'victim shake on connected freeze hits' },
      { type: 'hit-sparkle', desc: 'hit juice on connected freeze hits' },
    ],
    params: [
      { key: 'segments', desc: 'timeline: [{ frame, speed, duration, distance?, freezeFrames, hitbox, damage, knockback?, shove? }]' },
      { key: 'direction', desc: 'dash direction (radians; clamped horizontal)' },
      { key: 'startup', desc: 's before the first segment moves (commitment tell)' },
      { key: 'recovery', desc: 'ONE punish window after the last freeze (s)' },
      { key: 'team', desc: 'who the freeze hitboxes hurt' },
      { key: 'afterimage', desc: 'trail effect override' },
      { key: 'shakeStyle', desc: 'victim shake override' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const dir = clampDashDirection(p.direction);
    const sign = Math.cos(dir); // +1 right, -1 left
    const segs = (Array.isArray(p.segments) && p.segments.length > 0 ? p.segments : [{}]).map(normalizeSegment);
    const lastIdx = segs.length - 1;

    const h = new AttackHandle('dashCombo', null, declaredEffectsOf('dashCombo'));
    let pendingTargets = [];
    let connections = 0;
    let aiInst = null; // live afterimage instance for the current move phase
    h._aiInst = () => aiInst; // test seam: inspect the live trail instance

    h.state = {
      phase: p.startup > 0 ? 'startup' : 'move',
      t: 0,
      segmentIndex: 0,
      frame: segs[0].frame,
      shoveBox: null,
      hbFrame: 0,
      done: false,
      broken: false,
      dir: sign, // dash direction (+1 right, -1 left) — for host knockback routing
    };

    // Gravity hold (§13 defyGravity): while the timeline runs the host
    // suspends the attacker's gravity (reads this flag); releaseGravity()
    // clears it and seeds the launch velocity.
    if (ctx.attacker) ctx.attacker.dashDefyingGravity = true;

    /** Release the gravity hold: seed velocity from the FINAL segment + direction. */
    const releaseGravity = () => {
      const fin = segs[lastIdx];
      const a = ctx.attacker;
      if (!a || typeof a.vx !== 'number') return;
      a.vx = sign * fin.speed;
      a.vy = 0;
      a.dashDefyingGravity = false;
    };

    /** Abort the timeline (breaker / cancel): drop pending state, release gravity. */
    const abort = (broken) => {
      const s = h.state;
      if (s.done) return;
      s.broken = !!broken;
      s.phase = 'done';
      s.done = true;
      s.shoveBox = null;
      releaseGravity();
      h._complete({ broken: s.broken, connections });
    };

    /** Start a segment's move phase: fresh afterimage trail. */
    const beginMove = (idx) => {
      const s = h.state;
      s.phase = 'move';
      s.t = 0;
      s.segmentIndex = idx;
      s.frame = segs[idx].frame;
      s.traveled = 0;
      s.pendingFreeze = false;
      s.hbFrame = 0;
      s.hb = null;
      const a = ctx.attacker;
      aiInst = fireDeclared({
        type: 'afterimage',
        params: {
          box: { x: a.x, y: a.y, w: a.w, h: a.h },
          spawnInterval: 0, // per-frame ghosts while moving
          count: 10,        // longer trail — readable at dash speeds
          lifetime: 1.2,    // match the effect studio demo
          opacity: 0.5,     // match the effect studio demo
          color: '#ff0000', // red, like the effect studio
          ...(p.afterimage ?? {}),
        },
      }, h.declaredEffectTypes());
    };

    /** After a freeze completes: next segment or recovery. */
    const nextAfterFreeze = (idx) => {
      const s = h.state;
      s.hb = null;
      if (idx + 1 < segs.length) {
        beginMove(idx + 1);
      } else {
        // Last freeze done: release the gravity hold NOW (seeded velocity),
        // then run the single recovery window.
        releaseGravity();
        s.phase = 'recovery';
        s.t = 0;
      }
    };

    /** Move phase: translate the attacker, feed the trail, shove overlaps. */
    const stepMove = (dt) => {
      const s = h.state;
      const seg = segs[s.segmentIndex];
      const a = ctx.attacker;
      const dist = seg.speed * dt;
      a.x += sign * dist;
      a.vy = 0; // hold altitude (host gravity suspended while dashDefyingGravity)

      // Feed the afterimage trail with the attacker origin each frame.
      if (aiInst && !aiInst.done && typeof aiInst.body?.addGhost === 'function') {
        aiInst.body.addGhost(a.x + a.w / 2, a.y + a.h / 2);
      }

      // Shove: any live target whose body overlaps the attacker gets its vx
      // SET toward the dash direction at shove × speed (continuous push, not
      // an impulse). Physics only — no damage, no hitstun.
      s.shoveBox = { x: a.x, y: a.y, w: a.w, h: a.h };
      if (seg.shove > 0) {
        const shoveVx = sign * seg.speed * seg.shove;
        for (const t of pendingTargets) {
          if (!t || t.alive === false || t === a) continue;
          const tb = t.worldBox ? t.worldBox() : t;
          if (aabbOverlap(s.shoveBox, tb)) t.vx = shoveVx;
        }
      }

      // End conditions: distance cap or duration. The freeze begins on the
      // NEXT step() call — this frame is still pure travel (no hitbox yet).
      s.traveled = (s.traveled ?? 0) + dist;
      s.t += 0; // s.t already advanced by the caller
      const hitDistance = seg.distance != null && s.traveled >= seg.distance;
      const hitDuration = seg.duration != null && s.t >= seg.duration;
      if (hitDistance || hitDuration) s.pendingFreeze = true;
    };

    /** Freeze phase: run the segment hitbox against targets until frames elapse. */
    const stepFreeze = () => {
      const s = h.state;
      const seg = segs[s.segmentIndex];
      // Kill the afterimage trail NOW — it's a movement effect, not a freeze effect.
      if (aiInst && !aiInst.done) aiInst.complete();
      const box = segmentHitboxBox(seg, ctx.attacker);
      if (!box) { nextAfterFreeze(s.segmentIndex); return; }
      if (s.hbFrame === 0) {
        // First freeze frame: activate the hitbox NOW (the move phase never
        // carried one — hits land on the freeze, not during travel).
        s.hb = makeHitbox({ owner: ctx.attacker, team: p.team, box, damage: seg.damage, method: p.method });
        s.hb.knockback = seg.knockback ?? null;
        resetHitbox(s.hb);
        s.hbFrames = Math.max(1, Math.round((seg.freezeFrames ?? 0.12) / (1 / 60)));
      }
      if (!s.hb) { nextAfterFreeze(s.segmentIndex); return; }
      s.hb.box = box;
      s.hb.damage = seg.damage;
      // Knockback is set ONCE (first freeze frame) and applied by the onHit
      // callback below when the hit connects. Re-setting it every frame would
      // let a host that applies-on-read double/triple-apply across the freeze
      // window; the hitSet already dedupes per swing, so the callback fires
      // once per victim per segment regardless.
      s.hb.active = true;
      s.hbFrame++;

      processHitboxes([s.hb], pendingTargets, (hb, target, dealt) => {
        connections++;
        h._emit('hit', { target, dealt, segmentIndex: s.segmentIndex });
        // Knockback rides the hitbox and is applied HERE — the shared
        // applyKnockback() path every host uses (gameplay's hitboxes.js does
        // the same in its onHit callback). Direction = dash direction (the
        // attacker may have already passed the target by the finisher), so
        // the push always follows the committed dash, not current positions.
        // Fires only when the box actually connected (onHit gate), so a whiff
        // never shoves — same once-per-freeze guarantee as before.
        if (hb.knockback && target.alive !== false) {
          applyKnockback(target, ctx.attacker, hb.knockback, { x: sign, y: 0 });
        }
        // Hit juice on the VICTIM: sparkle + shake scaling with segment index
        // (early hits shake less than the finisher).
        const tcx = target.x + target.w / 2, tcy = target.y + target.h / 2;
        fireDeclared({ type: 'hit-sparkle', params: { x: tcx, y: tcy, count: 6 } }, h.declaredEffectTypes());
        const amount = (p.shakeStyle?.amount ?? 3) + s.segmentIndex;
        fireDeclared({ type: 'sprite-shake', params: { amount }, carrier: target }, h.declaredEffectTypes());
      });

      if (s.hbFrame >= s.hbFrames) {
        s.hb.active = false;
        nextAfterFreeze(s.segmentIndex);
      }
    };

    h.step = (dt, targets) => {
      const s = h.state;
      if (s.done) return true;
      if (targets) pendingTargets = targets;
      s.t += dt;

      switch (s.phase) {
        case 'startup':
          // Commitment tell: planted, no motion, no hitbox.
          if (ctx.attacker && typeof ctx.attacker.vy === 'number') ctx.attacker.vy = 0;
          if (s.t >= p.startup) beginMove(0);
          break;

        case 'move':
          stepMove(dt);
          // The freeze starts on the frame AFTER travel ends — the ending
          // frame is still pure travel (no hitbox), so hits land on the
          // freeze, not during movement.
          if (s.pendingFreeze) {
            s.phase = 'freeze';
            s.t = 0;
            s.shoveBox = null;
          }
          break;

        case 'freeze':
          stepFreeze();
          break;

        case 'recovery':
          // Committed and punishable; the host reads state.phase. No special
          // code — the combo is already complete, any hit is a free punish.
          if (s.t >= p.recovery) {
            s.done = true;
            h._complete({ broken: false, connections });
            return true;
          }
          break;
      }
      return false;
    };

    // Breaker hook: the host reports a MELEE hit landed on the attacker while
    // the timeline is running (any move/freeze phase). Projectiles do NOT
    // break — ranged contact is damage only, the timeline continues.
    h.breakOnMeleeHit = () => {
      const s = h.state;
      if (s.done || s.phase === 'recovery') return; // recovery = punish, not breaker
      abort(true);
    };

    // Cancel safety: no ghost hitboxes, trails fade on their own clock (B2).
    const origCancel = h.cancel.bind(h);
    h.cancel = () => {
      if (h.state && !h.state.done) {
        h.state.hb = null;
        releaseGravity();
      }
      origCancel();
    };

    return h;
  },
});
