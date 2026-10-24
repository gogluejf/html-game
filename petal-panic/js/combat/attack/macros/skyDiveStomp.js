// Attack Engine — Sky Dive Stomp (macro). ONE object, one id.
//
// An enemy drops from the sky onto a FIXED ground spot and slams a stomp wave
// on landing. The vertical twin of the stomp macro's 'wave' impact mode, with a telegraphed approach:
//   warning (Surface Target Marker at the impact point) → timeToTarget →
//   the diver falls straight down → on impact the STOMP WAVE attack fires:
//   dust + screen shake + one Surface Wave per side rolls out from there.
//   After the stomp settles, the enemy lingers briefly on the ground, then
//   BLINKS OUT (vanish): a blink-transition effect plays and the macro emits a
//   'vanish' event carrying { x, y, linger } so the host can hide the real
//   entity (visible=false) and schedule its reappearance at that spot.
//
// It composes the two existing building blocks instead of reinventing them:
//   • the DROP is skyMissile's column resolution (resolveImpactPoint) + a
//     strictly-vertical fall to the resolved surface line;
//   • the IMPACT invokes the STOMP macro (impact: 'wave') at the impact point — one stomp
//     wave per side rolls out from there. We pass sides through so the diver
//     slams exactly as many waves as configured ('both' = two, one per side).
//
// Because stomp resolves its impact from ctx.attacker's FEET, we hand it a
// child context whose attacker is a stand-in box placed AT the impact point.
// That makes stomp's own telegraph / hop / feet-center math land exactly
// where the diver hit — marker, dust, shake, and waves all agree.
//
// Fairness comes from the WARNING, not from prediction: no homing, no drift,
// strictly vertical — same rule as skyMissile. The player reads "leave this
// spot" during the marker window, then the diver commits.
//
// Handle shape:
//   h.step(dt, targets) — advance the sequence; true when the dive is done
//                         (stomp settled + vanish finished, or vanished off)
//   state.phase         — 'warning' | 'drop' | 'slam' | 'linger' | 'vanish'
//   state.impact        — { x, y } of the resolved impact point
//   h.stomp             — the live stomp handle (theater can render it)
//   hit / complete      — hits forwarded from the stomp wave; complete { waves }
//   land                — fired once at impact with { x, y } (host snaps the
//                         real entity here + makes it visible)
//   vanish              — fired once at the end of the blink with { x, y, linger }

import { defineMacro } from '../defineMacro.js';
import { invoke, AttackHandle } from '../engine.js';
import { fireDeclared } from '../../../effects/index.js';
import { makeContext } from '../context.js';
import { resolveImpactPoint } from './skyMissile.js'; // shared column-resolution rule

// Ensure the payload macro is registered (otherwise only pulled in by the theater).
import './stomp.js';

// Declared effect types for THIS registration (single source of truth:
// the same meta.effects array the guard checks and the theater panel renders).
// Read lazily at construction so synchronous fires inside impl() see the real
// declaration — no timing race with invoke().
function declaredEffectsOf(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  return (def?.meta?.effects ?? []).map((e) => e.type).filter(Boolean);
}
import { getPrimitive, getMacro } from '../registry.js';

const DEFAULTS = Object.freeze({
  // --- Drop (mirrors skyMissile's approach vector) ---------------------------
  x: 0,               // impact x (world) — marker AND drop share it
  groundY: null,      // fallback impact y; null → resolve from ctx (surface column)
  timeToTarget: 1.0,  // s between marker appearance and the first visible fall
  dropHeight: 260,    // px above the impact point where the diver becomes visible
  fallSpeed: 500,     // px/s descent speed
  size: 14,           // carrier box size (px) — visual footprint while falling
  // --- Impact shape ----------------------------------------------------------
  impact: 'wave',       // 'wave' | 'strike' — what slams on landing
  // --- Impact: stomp payload configuration, passed through -------------------
  // The stomp that fires on landing IS the stomp macro in the mode chosen by
  // `impact`. `stomp` is a params object shared by both modes (damage, team,
  // hop, dust/shake); wave-mode keys (sides, waveSpeed...) apply when
  // impact='wave'. The ONLY thing this macro owns itself is the IMPACT POINT —
  // stomp always resolves its origin from ctx.attacker's feet, so we place a
  // stand-in attacker at the landing spot; no stomp param can move it.
  stomp: {
    sides: 'both',       // 'left' | 'right' | 'both'
    hopHeight: 0,        // tiny visual hop (px) — 0 = no hop, instant slam
    hopTime: 0.001,      // hop duration (s) — kept >0 to avoid a div-by-zero
    waveSpeed: 300,      // px/s along the surface
    waveHeight: 24,      // dangerous area height above the surface (px)
    waveWidth: 28,       // leading-edge length (px)
    damage: 20,          // per target (each target hit once per wave)
    ttl: null,           // wave lifetime cap (s); null = until surface ends
    team: 'foe',         // who the waves hurt (enemy attack default)
    dustStyle: null,     // dust-cloud effect override
    shakeStrength: 6,    // camera shake on impact
  },
  // --- Vanish (blink-out after the stomp settles) ----------------------------
  vanish: true,         // master switch; false = enemy stays on the ground
  lingerOnGround: 0.4,  // s the enemy stands idle before the blink starts
  vanishTime: 2,       // s the blink-out effect plays before the enemy is gone (matches effect default)
});

defineMacro('skyDiveStomp', {
  attacks: [{ id: 'stomp', role: 'payload' }],
  params: { ...DEFAULTS },
  meta: {
    name: 'Sky Dive Stomp',
    desc: 'Ground marker warns a fixed spot → the enemy dives straight down → on impact a stomp wave slams out per side.',
    effects: [
      { type: 'surface-target-marker', desc: 'landing warning fixed at the impact point for the whole warning window' },
      { type: 'blink-transition', desc: 'blink-out effect that plays while the enemy vanishes' },
    ],
    params: [
      { key: 'impact', desc: "'wave' | 'strike' — landing payload" },
      { key: 'x', desc: 'impact x (world) — marker and drop share it' },
      { key: 'groundY', desc: 'fallback impact y; null → highest surface in the drop column' },
      { key: 'timeToTarget', desc: 'seconds between marker and the first visible fall (survival window)' },
      { key: 'dropHeight', desc: 'px above the impact where the diver appears' },
      { key: 'fallSpeed', desc: 'descent speed (px/s)' },
      { key: 'size', desc: 'carrier box size (px) while falling' },
      { key: 'stomp.sides', desc: "'left' | 'right' | 'both'" },
      { key: 'stomp.hopHeight', desc: 'tiny visual hop (px); 0 = no hop' },
      { key: 'stomp.waveSpeed', desc: 'travel speed (px/s)' },
      { key: 'stomp.waveHeight', desc: 'dangerous area height (px)' },
      { key: 'stomp.damage', desc: 'per target (once per wave)' },
      { key: 'stomp.ttl', desc: 'wave lifetime cap (s); null = unlimited' },
      { key: 'stomp.team', desc: 'who the waves hurt' },
      { key: 'stomp.shakeStrength', desc: 'camera shake on impact' },
      { key: 'vanish', desc: 'blink-out after the stomp; false = enemy stays put' },
      { key: 'lingerOnGround', desc: 's the enemy idles before the blink starts' },
      { key: 'vanishTime', desc: 's the blink-out plays before the enemy is gone' },
    ],
  },
  impl(params, ctx) {
    const p = { ...DEFAULTS, ...params };
    const h = new AttackHandle('skyDiveStomp', null, declaredEffectsOf('skyDiveStomp'));
    const pt = resolveImpactPoint(p, ctx);
    const spawnY = pt.y - p.dropHeight;

    h.state = {
      phase: 'warning',
      t: 0,
      impact: pt,
      markerFired: false,
      diverY: spawnY,   // top of the falling carrier body (visual + landing test)
      done: false,
    };
    h.stomp = null;

    const land = () => {
      h.state.phase = 'slam';
      h.state.t = 0;

      // Impact signal: the host snaps the real entity to this point and makes
      // it visible HERE (it was hidden while "in the sky"). Fires once, before
      // the stomp waves — mirrors throwEnemy's 'land' contract.
      h._emit('land', { x: pt.x, y: pt.y });

      // Fire the REAL stomp macro (impact: 'wave') at the impact point. Stomp reads its
      // origin from ctx.attacker's feet, so give it a child context whose
      // attacker is a stand-in box sitting ON the impact line (bottom = pt.y).
      // Its own telegraph/hop/dust/shake/waves then all resolve to that spot.
      // The whole `stomp` config maps onto stomp's wave-mode keys — configure it here
      // exactly as you would calling it directly.
      const standIn = { x: pt.x - 16, y: pt.y - 48, w: 32, h: 48 };
      const stompCtx = makeContext(standIn, {
        world: ctx.world,
        target: ctx.target,
        pools: ctx.pools,
        collisionWorld: ctx.collisionWorld,
        effects: ctx.effects,
        groundY: ctx.groundY,
        platforms: ctx.platforms,
        solids: ctx.solids,
      });
      const stomp = invoke('stomp', {
        impact: p.impact === 'strike' ? 'strike' : 'wave',
        damage: p.stomp.damage,
        team: p.stomp.team,
        wave: { sides: p.stomp.sides, speed: p.stomp.waveSpeed, height: p.stomp.waveHeight, width: p.stomp.waveWidth, ttl: p.stomp.ttl },
        buildTime: 0, gapTime: 0, blinkTime: 0, impactDelay: 0,
        count: 1, interval: 0, hopHeight: p.stomp.hopHeight ?? 0, hopTime: p.stomp.hopTime ?? 0.001,
        shakeStrength: p.stomp.shakeStrength, dustStyle: p.stomp.dustStyle,
      }, stompCtx);
      stomp.on('hit', (...args) => h._emit('hit', ...args));
      h.stomp = stomp;
    };

    h.step = (dt, _targets) => {
      const s = h.state;
      if (s.done || h._completed || h._cancelled) return true;
      s.t += dt;

      if (s.phase === 'warning') {
        // The warning is the REAL Surface Target Marker effect: FIXED at the
        // impact point for the whole window — the player reads "leave this
        // spot", never "track a moving thing".
        if (s.t <= dt && !s.markerFired) {
          s.markerFired = true;
          fireDeclared({ type: 'surface-target-marker', params: { x: pt.x, y: pt.y, duration: Math.max(0.1, p.timeToTarget) } }, h.declaredEffectTypes());
        }
        if (s.t >= p.timeToTarget) { s.phase = 'drop'; s.t = 0; }
        return false;
      }

      if (s.phase === 'drop') {
        // Strictly vertical fall from spawnY to the impact line. The carrier
        // is macro-owned state (not a pool entity): the host draws it from
        // state.diverY, and we own the landing test so the slam lands EXACTLY
        // on the marked surface — no tunneling through a platform top.
        s.diverY += p.fallSpeed * dt;
        if (s.diverY + p.size >= pt.y) { s.diverY = pt.y - p.size; land(); }
        return false;
      }

      if (s.phase === 'linger') {
        // The enemy stands idle on the ground at the impact point. No VFX —
        // just a beat so the slam reads before it teleports out.
        if (s.t >= p.lingerOnGround) { s.phase = 'vanish'; s.t = 0; }
        return false;
      }

      if (s.phase === 'vanish') {
        // Play the REAL blink-transition effect for the whole vanish window,
        // then emit 'vanish' with everything the host needs to hide the entity
        // and schedule its reappearance. The macro does NOT touch the real
        // entity — it is host-agnostic; the host owns visible=false + reappear.
        if (s.t <= dt && !s.vanishFired) {
          s.vanishFired = true;
          // The blink IS the enemy: size the box to the ATTACKER's real body
          // (not the tiny falling carrier) so it reads as the enemy itself
          // alternating visible / nothing, fast→slow, then gone. frameA = the
          // enemy color, frameB = null (nothing). No separate small square.
          const aw = ctx.attacker?.w ?? p.size;
          const ah = ctx.attacker?.h ?? p.size;
          const bx = pt.x - aw / 2;
          const by = pt.y - ah; // feet on the impact line, body above
          fireDeclared({ type: 'blink-transition', params: { box: { x: bx, y: by, w: aw, h: ah }, frameA: '#ff6ec7', frameB: null, duration: Math.max(0.1, p.vanishTime), speed: 6, endSpeed: 30, direction: 'forward', hold: false } }, h.declaredEffectTypes());
        }
        if (s.t >= p.vanishTime) {
          s.done = true;
          h._emit('vanish', { x: pt.x, y: pt.y, linger: p.lingerOnGround });
          h._complete({ waves: p.stomp.sides === 'both' ? 2 : 1, vanished: true });
          return true;
        }
        return false;
      }

      // --- slam phase: step the stomp child (wave or strike mode) --------------
      const finished = typeof h.stomp?.step === 'function' ? h.stomp.step(dt, _targets ?? []) : true;
      if (finished || h.stomp?._completed) {
        // Stomp settled. Either vanish (linger → blink-out) or finish now.
        if (p.vanish) {
          h.state.phase = p.lingerOnGround > 0 ? 'linger' : 'vanish';
          h.state.t = 0;
          return false;
        }
        s.done = true;
        h._complete({ waves: p.stomp.sides === 'both' ? 2 : 1 });
        return true;
      }
      return false;
    };

    const cancel = h.cancel.bind(h);
    h.cancel = () => {
      h.stomp?.cancel?.();
      cancel();
    };
    return h;
  },
});
