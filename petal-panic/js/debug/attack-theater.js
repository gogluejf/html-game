// Petal Panic — Attack Theater (Wave 1 cut; full spec lands in Wave 5).
// A DEBUG-ONLY sandbox that lists every registered attack primitive, lets you
// pick one (arrows / d-pad), and fires it at a dummy target with live-tweakable
// params. Same UX pattern as the Effect Theater (F2): black overlay, demo arena
// left, info/params panel right, arrows navigate, confirm replays, back closes.
//
// Unlike the Effect Theater this runs a LIVE mini-simulation: real pools,
// real collision world, real damage routing, REAL effect engine VFX. The
// attacker is a placeholder box on the left; the dummy target stands on the
// right and flashes + loses HP. Per-primitive choreography stages each attack
// so it's actually watchable (charge dashes AT the target, body contact walks
// into it, explosions telegraph before they pop).
//
// Keys:  F4 toggle · ←/→ (A/D) select · ↑/↓ (W/S) select param · I/O adjust
//        (the user's mapped lockDir/lockMove keys — remappable in Controls) ·
//        Enter/Space replay · Esc close.
// Pad:   ◀▶ select · ▲▼ param · L2/R2 adjust · A replay · B close.

import { listPrimitives, getPrimitive } from '../combat/attack/registry.js';
import { invoke } from '../combat/attack/engine.js';
import { makeContext } from '../combat/attack/context.js';
import { stepProjectile } from '../combat/attack/primitives/projectile.js';
import { stepBomb } from '../combat/attack/primitives/bomb.js';
import { Pool, Projectile, Special } from '../objects/projectile.js';
import { CollisionWorld } from '../core/collision.js';
import { LAYER } from '../consts.js';
import { VIEW_W, VIEW_H } from '../core/view.js';
import { navLabelString, navLabels, input } from '../core/input.js';
import { Effects } from '../effects.js';
import { updateEffects, drawEffects, resetEffects } from '../effects/index.js';
import { particles } from '../effects/particles.js';
import { aabbOverlap } from '../core/collision.js';

// Import every Wave-1 primitive module for its registration side effect.
import '../combat/attack/primitives/projectile.js';
import '../combat/attack/primitives/spread.js';
import '../combat/attack/primitives/bomb.js';
import '../combat/attack/primitives/explosion.js';
import '../combat/attack/primitives/meleeHitbox.js';
import '../combat/attack/primitives/movement.js';
import '../combat/attack/primitives/bodyContact.js';

// --- Sandbox constants --------------------------------------------------------
const GROUND_Y = 400;
const ATTACKER_HOME = { x: 140, y: GROUND_Y - 48, w: 32, h: 48 };
const TARGET_POS = { x: 560, y: GROUND_Y - 48, w: 32, h: 48 }; // clear of the side panel
const DT = 1 / 60;
const DEG = Math.PI / 180;
// Held-control repeat cadence, in FIXED STEPS (60Hz): first press fires
// immediately, then a short pause, then a steady tick — standard menu feel.
const REPEAT_DELAY_FRAMES = 13; // ~217ms before the first auto-repeat
const REPEAT_FRAMES = 5;        // ~83ms between repeats while held

/** Angle display helper: radians → "−45° ↗" style string. */
function angleLabel(rad) {
  const deg = Math.round(rad / DEG);
  const oct = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  const idx = ((Math.round(-rad / (Math.PI / 4)) % 8) + 8) % 8;
  return `${deg}° ${oct[idx]}`;
}

// Per-primitive default param presets for the sandbox.
const SANDBOX_PRESETS = {
  projectile: { direction: 0, speed: 600, ttl: 2, damage: 10, solidBehavior: 'pass', gravity: 0 },
  spread: { count: 3, direction: 0, angle: 60 * DEG },
  bomb: { direction: -0.5, speed: 600, arc: 800, bounce: true, explodeOnContact: true, ttl: 4, damage: 40, radius: 70 },
  explosion: { x: TARGET_POS.x + 16, y: GROUND_Y - 24, radius: 70, damage: 40, alignment: 'neutral' },
  meleeHitbox: { activeFrames: 10, w: 48, h: 44, offset: { x: 44, y: 0 }, damage: 12 },
  charge: { direction: 0, speed: 700, duration: 0.6, distance: null, acceleration: 0 },
  bodyContact: { damage: 20, enabled: true, temporaryOverride: true },
};

/** Tweakable params per primitive: [key, kind, step]. kind: num | angle | int. */
export const TWEAKABLE = {
  projectile: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['ttl', 'num', 0.25], ['damage', 'num', 2]],
  spread: [['count', 'int', 1], ['angle', 'angle', 15 * DEG]],
  bomb: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['arc', 'num', 100], ['ttl', 'num', 0.5], ['damage', 'num', 5], ['radius', 'num', 10]],
  explosion: [['x', 'num', 20], ['y', 'num', 20], ['radius', 'num', 10], ['damage', 'num', 5]],
  meleeHitbox: [['activeFrames', 'int', 2], ['w', 'num', 8], ['h', 'num', 8], ['damage', 'num', 2]],
  charge: [['speed', 'num', 100], ['duration', 'num', 0.1]],
  bodyContact: [['damage', 'num', 5]],
};

export const AttackTheater = {
  active: false,
  index: 0,
  paramIndex: 0,
  // Live sandbox state (rebuilt on open/replay).
  _pools: null,
  _world: null,
  _attacker: null,
  _target: null,
  _handles: [],
  _params: {},
  _flash: 0,
  _log: [],
  _choreo: null,      // per-run choreography state
  _padWasHeld: 0,     // gamepad edge-trigger memory (entry selection)
  _rep: {},           // held-control repeater state per channel
  _repeatDir: {},     // current direction per repeat channel

  get entries() { return listPrimitives(); },
  currentId() { return this.entries[this.index] ?? null; },

  _tweakList() { return TWEAKABLE[this.currentId()] ?? []; },

  open() {
    this.active = true;
    this.index = 0;
    this.paramIndex = 0;
    this._padWasHeld = 0;
    this._rep = {};
    this._repeatDir = {};
    this._resetSandbox();
  },

  close() {
    this.active = false;
    this._teardown();
    resetEffects(); // drop in-flight effect instances (beams, flashes...)
    particles.reset(); // clear demo sparkles/explosion particles so they don't
                       // leak into gameplay — same guard the Effect Theater uses
  },

  step(dir) {
    if (!this.active) return;
    const n = this.entries.length;
    this.index = (this.index + dir + n) % n;
    this.paramIndex = 0;
    this._loadParams();
    this._replay();
  },

  stepParam(dir) {
    const keys = this._tweakList();
    if (!keys.length) return;
    this.paramIndex = (this.paramIndex + dir + keys.length) % keys.length;
  },

  adjustParam(deltaSign) {
    const list = this._tweakList();
    if (!list.length) return;
    const [key, , stepSize] = list[this.paramIndex];
    this._params[key] = round2((this._params[key] ?? 0) + deltaSign * stepSize);
  },

  replay() {
    if (!this.active) return;
    this._replay();
  },

  // --- Gamepad (called from update loop while active) --------------------------

  /**
   * Edge-triggered gamepad routing, same convention as the Effect Theater:
   * d-pad/stick X = select entry, Y = select param, L2/R2 = adjust value,
   * A (confirm) = replay, B (back) = close.
   */
  updateGamepad() {
    if (!this.active) return;
    const s = inputState();
    // Merge pad + keyboard direction so BOTH devices feed the same repeat
    // system (keyboard edges from keydown are ignored — heldKeys polling is
    // the single source of truth, which is what makes debouncing work).
    const kb = keyboardDir();
    const dirX = s.moveX < -0.2 ? -1 : s.moveX > 0.2 ? 1 : 0;
    const dirY = s.moveY < -0.2 ? -1 : s.moveY > 0.2 ? 1 : 0;
    const x = dirX !== 0 ? dirX : kb.x;
    const y = dirY !== 0 ? dirY : kb.y;
    // --- Entry selection (←/→): edge-triggered, one step per press ----------
    if (x !== 0 && x !== this._padWasHeld) {
      this.step(x);
    }
    this._padWasHeld = x;
    // --- Param selection (↑/↓): repeat with a fixed interval -----------------
    this._repeat('param', y, () => {
      if (this._repeatDir.param !== 0) this.stepParam(this._repeatDir.param);
    });
    // --- Value adjust (I/O + L2/R2): same repeat cadence --------------------
    const adj = mappingAdjust();
    const adjDir = adj.down && !adj.up ? -1 : adj.up && !adj.down ? 1 : 0;
    this._repeat('adjust', adjDir, () => {
      if (this._repeatDir.adjust !== 0) this.adjustParam(this._repeatDir.adjust);
    });
    // Buttons via the abstracted nav layer (same lib as menus/pause).
    if (s.navPressed.includes('confirm')) this.replay();
    if (s.navPressed.includes('back')) { this.close(); }
  },

  /**
   * Fixed-interval repeater for held controls, driven by the sandbox's FIXED
   * step (called once per _stepOnce, i.e. exactly 60Hz). First press fires
   * immediately (edge); holding then re-fires every REPEAT_FRAMES after an
   * initial REPEAT_DELAY_FRAMES pause. Frame-counting (not timestamps) keeps
   * the cadence perfectly even under the fixed-step accumulator — no jitter.
   * Two independent channels ('param', 'adjust') so ↑+I held both work.
   */
  _repeat(channel, dirNow, fire) {
    const st = this._rep[channel] ?? (this._rep[channel] = { dir: 0, count: 0 });
    if (dirNow === 0) {
      st.dir = 0; st.count = 0;
      return;
    }
    if (st.dir !== dirNow) {
      // Fresh press or direction flip: fire once immediately, arm the delay.
      st.dir = dirNow;
      st.count = REPEAT_DELAY_FRAMES;
      this._repeatDir[channel] = dirNow;
      fire();
      return;
    }
    // Still held: count down, then tick on a steady cadence.
    st.count--;
    if (st.count <= 0) {
      st.count = REPEAT_FRAMES;
      this._repeatDir[channel] = dirNow;
      fire();
    }
  },

  // --- Sandbox lifecycle ------------------------------------------------------

  _resetSandbox() {
    this._teardown();
    this._pools = { projectilePool: new Pool(Projectile, 64), specialPool: new Pool(Special, 16) };
    this._world = new CollisionWorld({ cellSize: 64 });
    this._attacker = { ...ATTACKER_HOME, alive: true, layer: LAYER.HERO, facing: 1, bodyKnockback: null };
    this._target = { ...TARGET_POS, alive: true, hp: 999, layer: LAYER.ENEMY, hitFlash: 0,
      takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; } };
    this._world.add(this._attacker);
    this._world.add(this._target);
    this._handles = [];
    this._flash = 0;
    this._log = [];
    this._choreo = null;
    this._loadParams();
  },

  _teardown() {
    for (const h of this._handles) { try { h.cancel?.(); } catch { /* already done */ } }
    this._handles = [];
    if (this._pools) {
      for (const p of this._pools.projectilePool.activeItems) p.alive = false;
      for (const s of this._pools.specialPool.activeItems) s.alive = false;
      this._pools.projectilePool.active.length = 0;
      this._pools.specialPool.active.length = 0;
    }
    this._pools = null;
    this._world = null;
    this._attacker = null;
    this._target = null;
    this._choreo = null;
  },

  _loadParams() {
    const id = this.currentId();
    const def = getPrimitive(id)?.params ?? {};
    const preset = SANDBOX_PRESETS[id] ?? {};
    this._params = { ...def, ...preset };
  },

  _ctx() {
    return makeContext(this._attacker, {
      world: { targets: [this._target], hero: null },
      pools: this._pools,
      collisionWorld: this._world,
      effects: Effects, // REAL VFX: explosions flash, sparkles spawn, shake kicks
    });
  },

  _replay() {
    for (const p of this._pools?.projectilePool.activeItems ?? []) p.alive = false;
    for (const s of this._pools?.specialPool.activeItems ?? []) s.alive = false;
    if (this._pools) {
      this._pools.projectilePool.active.length = 0;
      this._pools.specialPool.active.length = 0;
    }
    // Fresh VFX slate: drop the previous run's leftover sparkles/particles so
    // replays don't stack. (resetEffects only clears effect instances, not the
    // particle system — same distinction as close().)
    resetEffects();
    particles.reset();
    for (const h of this._handles) { try { h.cancel?.(); } catch { /* noop */ } }
    this._handles = [];
    this._target.hp = 999;
    this._target.alive = true;
    // BOTH opponents reset home each replay — otherwise the target stays
    // stuck at wherever the last movement demo left it.
    this._target.x = TARGET_POS.x;
    this._target.y = TARGET_POS.y;
    this._attacker.x = ATTACKER_HOME.x;
    this._attacker.y = ATTACKER_HOME.y;
    this._log = [];
    this._choreo = null;

    const id = this.currentId();
    if (!id) return;

    // --- Choreography: stage the scene so the attack is watchable -------------
    const tCx = this._target.x + this._target.w / 2;
    if (id === 'charge') {
      // Charge DASHES AT the target: face it, run until body contact ends it.
      this._params.direction = this._attacker.x < tCx ? 0 : Math.PI;
      this._params.duration = 99; // stop only on completion below
      this._choreo = { kind: 'chargeToTarget' };
    } else if (id === 'bodyContact') {
      // Body contact: the VICTIM walks into the attacker (like an enemy
      // shoving you) — opposite of charge, where the attacker moves. The
      // attacker's body is the weapon; the dummy closes the distance.
      this._choreo = { kind: 'victimWalksIn', speed: 260 };
    } else if (id === 'meleeHitbox') {
      // Melee: start side by side, then throw a VISIBLE punch — the swing arc
      // sweeps out in sync with the live hitbox frames.
      this._choreo = { kind: 'punch', dist: 56, done: false, swingFrame: 0 };
    } else if (id === 'explosion') {
      // Explosion: brief telegraph, then pop at the blast point.
      this._choreo = { kind: 'telegraph', delay: 0.6, fired: false };
    }

    let h;
    try {
      // Choreographed attacks delay or gate the actual invoke:
      //  - telegraph (explosion): fires after the warning window
      //  - punch (melee): starts once the attacker is beside the target
      const delayed = this._choreo?.kind === 'telegraph';
      const gated = this._choreo?.kind === 'punch';
      if (!delayed && !gated) {
        h = invoke(id, { ...this._params }, this._ctx());
      }
    } catch (err) {
      this._log.push(`ERROR: ${err.message}`);
      return;
    }
    if (!h) return;
    h.on('hit', (info) => {
      this._flash = 0.15;
      this._log.unshift(`HIT ${info.dealt ?? ''} dmg`.trim());
    });
    h.on('detonate', () => this._log.unshift('DETONATE'));
    h.on('expire', () => this._log.unshift('EXPIRE'));
    h.on('complete', () => this._log.unshift('COMPLETE'));
    this._handles.push(h);
    if (h.entity == null && !h.step && h.state == null) {
      this._log.unshift(`${id} finished (synchronous)`);
    }
    // Composable direction-generator: fan its angles out as projectiles.
    if (id === 'spread' && Array.isArray(h.angles)) {
      for (const ang of h.angles) {
        const shot = invoke('projectile', { ...this._params, direction: ang }, this._ctx());
        if (shot?.entity) this._handles.push(shot);
      }
      this._log.unshift(`spread → ${h.angles.length} shots`);
    }
  },

  /** Advance the sandbox one fixed step. Called from update() while active. */
  update(dt) {
    if (!this.active || !this._pools) return;
    this._acc = (this._acc ?? 0) + dt;
    let steps = 0;
    while (this._acc >= DT && steps < 4) {
      this._acc -= DT;
      steps++;
      this._stepOnce();
    }
    if (this._flash > 0) this._flash -= dt;
  },

  _stepOnce() {
    const { projectilePool, specialPool } = this._pools;
    // Input repeat ticks at FIXED-step rate (exactly 60Hz) so the debounce
    // cadence is even — calling it here, not in update(), keeps it locked to
    // the simulation clock instead of the variable rAF delta.
    this.updateGamepad();
    updateEffects(DT); // advance real effect instances (explosions, sparkles)

    // --- Choreography (moves the attacker to stage the attack) ----------------
    const c = this._choreo;
    if (c) {
      const gap = (this._target.x + this._target.w / 2) - (this._attacker.x + this._attacker.w / 2);
      if (c.kind === 'victimWalksIn') {
        // The dummy target walks toward the stationary attacker.
        if (Math.abs(gap) > this._target.w / 2 + 2) {
          this._target.x -= Math.sign(gap) * c.speed * DT;
        }
      } else if (c.kind === 'punch') {
        if (!c.done) {
          if (Math.abs(gap) > c.dist) {
            // Walk beside the target first.
            this._attacker.x += Math.sign(gap) * 420 * DT;
            this._attacker.facing = Math.sign(gap) || 1;
          } else {
            // Beside: throw the punch. The swing visual (drawn in draw()) is
            // driven by c.swingFrame, which advances here IN SYNC with the
            // live hitbox frames from the meleeHitbox handle.
            c.done = true;
            const mh = invoke('meleeHitbox', { ...this._params }, this._ctx());
            mh.on('hit', (i) => { this._flash = 0.15; this._log.unshift(`HIT ${i.dealt ?? ''} dmg`.trim()); });
            mh.on('complete', () => this._log.unshift('COMPLETE'));
            this._handles.push(mh);
            c.swingTotal = this._params.activeFrames ?? 10;
          }
        } else if (c.swingFrame < c.swingTotal) {
          c.swingFrame++;
        }
      } else if (c.kind === 'telegraph') {
        c.t = (c.t ?? 0) + DT;
        if (!c.fired && c.t >= c.delay) {
          c.fired = true;
          const e = this._params;
          const eh = invoke('explosion', { ...e }, this._ctx());
          eh.on('hit', (i) => { this._flash = 0.2; this._log.unshift(`HIT ${i.dealt ?? ''} dmg`.trim()); });
          eh.on('complete', () => this._log.unshift('COMPLETE'));
          this._handles.push(eh);
        }
      }
    }

    projectilePool.updateAll(DT);
    specialPool.updateAll(DT);
    // Off-screen cull (sandbox bounds instead of level zone).
    for (const p of [...projectilePool.activeItems, ...specialPool.activeItems]) {
      if (p.x + p.w < -40 || p.x > VIEW_W + 40 || p.y + p.h < -40 || p.y > VIEW_H + 40) p.alive = false;
    }

    // --- Sandbox hit detection -------------------------------------------------
    // The real game routes PROJ×ENEMY through registerCollisionHandlers()
    // (gameplay-only: it needs the live hero, boss zone, barrels...). The
    // sandbox keeps its CollisionWorld for future terrain/solid work but does
    // its own minimal projectile→target check here — same aabbOverlap, same
    // damage routing, plus the _attackHit flag the lifecycle bridging reads.
    for (const p of [...projectilePool.activeItems, ...specialPool.activeItems]) {
      if (!p.alive || !this._target?.alive) continue;
      if (!aabbOverlap(p, this._target)) continue;
      const dealt = this._target.takeDamage(p.damage ?? 10);
      if (dealt > 0) {
        p._attackHit = true;
        this._flash = 0.15;
        Effects.spawnHitSparkles(p.x + p.w / 2, p.y + p.h / 2, 6);
        this._log.unshift(`HIT ${dealt} dmg`);
      }
      p.alive = false; // consumed on impact (matches gameplay behavior)
    }

    // Bomb in flight: detonate when it reaches ground level (the sandbox has
    // no terrain to bounce off — landing IS the impact).
    for (const s of specialPool.activeItems) {
      if (!s.alive || s._attackId !== 'bomb' || s._attackDone) continue;
      if (s.y + s.h >= GROUND_Y) {
        s._attackHit = true;
        s.alive = false;
      }
    }
    this._world.update();

    // Step each live handle's entity.
    for (let i = this._handles.length - 1; i >= 0; i--) {
      const h = this._handles[i];
      let finished = false;
      if (h.id === 'meleeHitbox' && typeof h.step === 'function') {
        finished = h.step([this._target]);
      } else if (h.entity) {
        if (h.id === 'projectile') finished = stepProjectile(h.entity, h);
        else if (h.id === 'bomb') finished = stepBomb(h.entity, this._params, this._ctx(), h);
        else if (typeof h.step === 'function') finished = h.step(DT);
      } else if (typeof h.step === 'function') {
        // State-based primitives (charge): no entity, just a motion profile.
        finished = h.step(DT);
      }
      if (finished) this._handles.splice(i, 1);
    }

    // Charge choreography: end the dash when the bodies meet.
    if (c?.kind === 'chargeToTarget') {
      const touching = this._attacker.x + this._attacker.w > this._target.x &&
        this._attacker.x < this._target.x + this._target.w &&
        this._attacker.y + this._attacker.h > this._target.y;
      if (touching) {
        const dealt = this._target.takeDamage(this._params.damage ?? 20);
        if (dealt > 0) {
          this._flash = 0.2;
          Effects.spawnHitSparkles(this._target.x + 16, this._target.y + 24, 8);
          this._log.unshift(`CHARGE HIT ${dealt} dmg`);
        }
        for (const h of this._handles) { if (h.id === 'charge') h._complete({ traveled: h.state?.traveled, blocked: false }); }
        this._handles = this._handles.filter((h) => h.id !== 'charge');
        this._choreo = null;
      }
    }

    // Body-contact choreography: the victim walked into the attacker's body —
    // overlap IS the attack. Route contact damage through the target's pipeline
    // with a per-hit cooldown (mirrors the gameplay CONTACT_COOLDOWN rule).
    if (c?.kind === 'victimWalksIn') {
      c.cd = Math.max(0, (c.cd ?? 0) - DT);
      const overlapping = this._attacker.x + this._attacker.w > this._target.x &&
        this._attacker.x < this._target.x + this._target.w &&
        this._attacker.y + this._attacker.h > this._target.y;
      if (overlapping && c.cd <= 0 && this._target.alive) {
        c.cd = 0.5;
        const dealt = this._target.takeDamage(this._params.damage ?? 20);
        if (dealt > 0) {
          this._flash = 0.2;
          Effects.spawnHitSparkles(this._target.x + 16, this._target.y + 24, 6);
          this._log.unshift(`CONTACT ${dealt} dmg`);
        }
      }
    }

    // Target bookkeeping.
    if (this._target.hitFlash > 0) this._target.hitFlash -= DT;
    if (this._target.hp <= 0) {
      this._target.alive = false;
      this._log.unshift('TARGET DOWN');
    }
  },

  // --- Rendering ----------------------------------------------------------------

  draw(ctx, w, h) {
    if (!this.active) return;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    const panelW = 280;
    const panelX = w - panelW;
    const demoW = panelX - 20;

    // Title.
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('ATTACK THEATER', demoW / 2, 44);

    const id = this.currentId();
    const meta = getPrimitive(id)?.meta;
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#f7d';
    ctx.fillText(meta?.name ?? id ?? '(none)', demoW / 2, 92);

    // --- Arena ------------------------------------------------------------------
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, GROUND_Y);
    ctx.lineTo(demoW - 40, GROUND_Y);
    ctx.stroke();

    // Telegraph ring for pending explosions.
    const c = this._choreo;
    if (c?.kind === 'telegraph' && !c.fired) {
      const r = (this._params.radius ?? 60) * Math.min(1, (c.t ?? 0) / c.delay);
      ctx.strokeStyle = `rgba(255,120,60,${0.4 + 0.5 * Math.sin((c.t ?? 0) * 20)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this._params.x, this._params.y, Math.max(4, r), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Melee punch: a visible swing bar that sweeps out from the fist in sync
    // with the live hitbox frames (ease-out extension, quick retract). This is
    // what makes the invisible hitbox readable — imagine a fist extending.
    if (c?.kind === 'punch' && c.done && c.swingFrame < c.swingTotal) {
      const total = c.swingTotal || 10;
      const t = c.swingFrame / total;            // 0 → 1 across the swing
      const ext = t < 0.7 ? (t / 0.7) : (1 - (t - 0.7) / 0.3); // out then back
      const eased = 1 - Math.pow(1 - ext, 3);    // easeOutCubic
      const dir = this._attacker.facing >= 0 ? 1 : -1;
      const ax = this._attacker.x + this._attacker.w / 2;
      const ay = this._attacker.y + this._attacker.h * 0.45;
      const len = (this._params.w ?? 48) * eased;
      const thick = 10;
      // Swing trail (faded wedge behind the bar).
      ctx.fillStyle = `rgba(255,220,120,${0.18 * ext})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + dir * len, ay - 14);
      ctx.lineTo(ax + dir * len, ay + 14);
      ctx.closePath();
      ctx.fill();
      // The "fist" bar itself.
      ctx.fillStyle = `rgba(255,240,180,${0.5 + 0.5 * ext})`;
      ctx.fillRect(dir > 0 ? ax : ax - len, ay - thick / 2, len, thick);
      // Fist cap.
      ctx.fillStyle = '#fff';
      ctx.fillRect(ax + dir * len - 5, ay - 8, 10, 16);
    }

    // Attacker.
    if (this._attacker) {
      ctx.fillStyle = '#ff6ec7';
      ctx.fillRect(this._attacker.x, this._attacker.y, this._attacker.w, this._attacker.h);
      // Facing wedge.
      ctx.fillStyle = '#fff';
      const fx = this._attacker.facing >= 0 ? this._attacker.x + this._attacker.w : this._attacker.x - 8;
      ctx.fillRect(fx, this._attacker.y + this._attacker.h / 2 - 3, 8, 6);
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ATTACKER', this._attacker.x + this._attacker.w / 2, this._attacker.y - 8);
    }

    // Dummy target.
    if (this._target) {
      ctx.fillStyle = this._flash > 0 ? '#fff' : (this._target.alive ? '#6d6' : '#444');
      ctx.fillRect(this._target.x, this._target.y, this._target.w, this._target.h);
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this._target.alive ? `HP ${Math.max(0, Math.round(this._target.hp))}` : 'DOWN',
        this._target.x + this._target.w / 2, this._target.y - 8);
    }

    // Live projectiles/specials.
    if (this._pools) {
      for (const p of this._pools.projectilePool.activeItems) {
        ctx.fillStyle = '#ff6ec7';
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
      for (const s of this._pools.specialPool.activeItems) {
        ctx.fillStyle = '#fa4';
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }
    }

    // Event log.
    ctx.textAlign = 'left';
    ctx.font = '11px monospace';
    this._log.slice(0, 5).forEach((line, i) => {
      ctx.fillStyle = i === 0 ? '#fd6' : '#777';
      ctx.fillText(line, 48, GROUND_Y + 20 + i * 14);
    });

    // Index indicator.
    ctx.textAlign = 'center';
    ctx.fillStyle = '#888';
    ctx.font = '14px monospace';
    ctx.fillText(`${this.index + 1} / ${this.entries.length}`, demoW / 2, h - 40);

    // --- Right panel --------------------------------------------------------------
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(panelX, 60, panelW - 10, h - 100);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX, 60, panelW - 10, h - 100);

    let py = 84;
    ctx.textAlign = 'left';

    if (meta?.desc) {
      ctx.font = '12px monospace';
      ctx.fillStyle = '#aaa';
      let line = '';
      for (const word of meta.desc.split(' ')) {
        if ((line + word).length > 36) {
          ctx.fillText(line, panelX + 12, py); py += 15; line = word + ' ';
        } else line += word + ' ';
      }
      if (line) { ctx.fillText(line.trim(), panelX + 12, py); py += 15; }
    }
    py += 10;

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#f7d';
    ctx.fillText('PARAMS (▲▼ select · L2/R2 adjust)', panelX + 12, py);
    py += 18;
    ctx.font = '11px monospace';
    const tweakList = this._tweakList();
    // Render in NAVIGATION order (the TWEAKABLE array) so ↑/↓ matches what you
    // see. Non-tweakable params follow below, dimmed + read-only.
    const shown = new Set();
    const rows = [];
    for (const [key] of tweakList) { rows.push({ key, tweak: true }); shown.add(key); }
    for (const key of Object.keys(this._params ?? {})) {
      if (!shown.has(key)) rows.push({ key, tweak: false });
    }
    for (const { key, tweak } of rows) {
      if (py > h - 70) break;
      const tIdx = tweak ? tweakList.findIndex(([k]) => k === key) : -1;
      const selected = tIdx === this.paramIndex && tweakList.length > 0;
      ctx.fillStyle = selected ? '#fd6' : (tweak ? '#ccc' : '#666');
      const val = this._params[key];
      const valStr = typeof val === 'number'
        ? (key === 'direction' || key === 'angle' ? angleLabel(val) : String(round2(val)))
        : (val && typeof val === 'object' ? JSON.stringify(val) : String(val));
      ctx.fillText(`${selected ? '▶' : '·'} ${key} = ${valStr}${tweak ? '' : '  (fixed)'}`, panelX + 12, py);
      py += 15;
    }

    // Hint bar — same nav-label lib as the menus (keyboard + pad glyphs).
    const leftR = [...navLabels('left', { simple: true }), ...navLabels('right', { simple: true })].join('/');
    const upDn = [...navLabels('up', { simple: true }), ...navLabels('down', { simple: true })].join('/');
    const confirmLabel = navLabelString('confirm');
    const backLabel = navLabelString('back');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#666';
    ctx.font = '12px monospace';
    const adjLbl = adjustLabels();
    ctx.fillText(`${leftR} select   ${upDn} param   ${adjLbl.down}/${adjLbl.up} adjust (L2/R2)   [${confirmLabel}] replay   [${backLabel}] close   F4`, demoW / 2, h - 16);

    ctx.restore();

    // Real effect-engine pass, mirroring the main render loop's three draws:
    // 1. particles (hit-sparkles, explosion debris) — world space
    // 2. effect instances (beams, flashes) — world space
    // 3. screen-space overlays (flash/vignette/shake)
    for (const p of particles.activeItems) p.draw(ctx);
    drawEffects(ctx, undefined, { space: 'world' });
    Effects.drawOverlay(ctx, VIEW_W, VIEW_H);
  },
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Read raw gamepad state for theater controls (L2/R2 have no nav mapping, so
 * we read the standard button indices directly — 6 = L2/LT/ZL, 7 = R2/RT/ZR
 * across PS/Xbox/Switch layouts). Returns zeros when no pad is connected.
 */
function padShoulders() {
  let l2 = false, r2 = false;
  try {
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      if (pad.buttons[6]?.pressed || (pad.buttons[6]?.value ?? 0) > 0.5) l2 = true;
      if (pad.buttons[7]?.pressed || (pad.buttons[7]?.value ?? 0) > 0.5) r2 = true;
    }
  } catch { /* no gamepad API (node tests) */ }
  return { l2, r2 };
}

/**
 * PURE INPUT-MAPPING controls: the adjust buttons are the user's OWN mapped
 * keys — lockDir (default I) decreases, lockMove (default O) increases — plus
 * L2/R2 on the pad. No hardcoded letters: if the user remaps I/O in Controls,
 * the theater follows automatically. Reads input.pressedBindings / heldBindings
 * (per-binding edge/held state) against input.mapping.
 */
function mappingAdjust() {
  const inp = typeof input !== 'undefined' ? input : null;
  const shoulders = typeof navigator !== 'undefined' ? padShoulders() : { l2: false, r2: false };
  let down = shoulders.l2, up = shoulders.r2;
  if (inp) {
    const pressed = new Set(inp.pressedBindings ?? []);
    const held = inp.heldBindings ?? new Map();
    const kb = inp.mapping?.keyboard ?? {};
    for (const b of kb.lockDir ?? []) {
      const k = `k:${b}`;
      if (pressed.has(k) || held.get(k)) down = true;
    }
    for (const b of kb.lockMove ?? []) {
      const k = `k:${b}`;
      if (pressed.has(k) || held.get(k)) up = true;
    }
    // Gamepad side of those actions too (if the user bound a pad button).
    const gp = inp.mapping?.gamepad ?? {};
    for (const b of gp.lockDir ?? []) if (pressed.has(`g:${b}`) || held.get(`g:${b}`)) down = true;
    for (const b of gp.lockMove ?? []) if (pressed.has(`g:${b}`) || held.get(`g:${b}`)) up = true;
  }
  return { down, up };
}

/**
 * Keyboard arrow state for the theater's repeat system. The keydown handler
 * (debugHarness) only reports EDGES (press/release); this polls input.heldKeys
 * each frame so held arrows feed the same _repeat() cadence as the pad — no
 * browser auto-repeat racing through the list.
 */
function keyboardDir() {
  const inp = typeof input !== 'undefined' ? input : null;
  if (!inp) return { x: 0, y: 0 };
  const held = new Set(inp.heldKeys ?? []);
  const left = held.has('ArrowLeft') || held.has('KeyA');
  const right = held.has('ArrowRight') || held.has('KeyD');
  const up = held.has('ArrowUp') || held.has('KeyW');
  const down = held.has('ArrowDown') || held.has('KeyS');
  return {
    x: left && !right ? -1 : right && !left ? 1 : 0,
    y: up && !down ? -1 : down && !up ? 1 : 0,
  };
}

/** Labels for the hint bar from the live mapping (e.g. "I/O"). */
function adjustLabels() {
  const kb = input?.mapping?.keyboard ?? {};
  const fmt = (list) => (list ?? []).map((b) => b.replace(/^Key/, '')).join('/') || '?';
  return { down: fmt(kb.lockDir), up: fmt(kb.lockMove) };
}
/** Thin indirection so the gamepad code reads cleanly + stays testable. */
function inputState() {
  // Imported lazily to avoid a module-load cycle (input.js ← debugHarness).
  if (!inputState._ref) {
    import('../core/input.js').then((m) => { inputState._ref = m.input; });
  }
  const inp = inputState._ref;
  const shoulders = typeof navigator !== 'undefined' ? padShoulders() : { l2: false, r2: false };
  if (!inp) return { moveX: 0, moveY: 0, ...shoulders, navPressed: [] };
  return {
    moveX: inp.state.moveX ?? 0,
    moveY: inp.state.moveY ?? 0,
    ...shoulders,
    navPressed: inp.nav.pressed ?? [],
  };
}
