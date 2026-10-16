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
// into it, melee throws a visible punch). Explosions fire directly — the real
// Effect-Engine burst is the visual (a proper telegraph primitive lands in Wave 2).
//
// Keys:  F4 toggle · ←/→ (A/D) select · ↑/↓ (W/S) select param · I/O adjust
//        (the user's mapped lockDir/lockMove keys — remappable in Controls) ·
//        Enter/Space replay · Esc close.
// Pad:   ◀▶ select · ▲▼ param · L2/R2 adjust · A replay · B close.

import { listPrimitives, listMacros, getPrimitive, getMacro } from '../combat/attack/registry.js';
import { invoke } from '../combat/attack/engine.js';
import { makeContext } from '../combat/attack/context.js';
import { stepProjectile } from '../combat/attack/primitives/projectile.js';
import { stepBomb, stepBombTerrain } from '../combat/attack/primitives/bomb.js';
import { Pool, Projectile, Special } from '../objects/projectile.js';
import { CollisionWorld, resolve } from '../core/collision.js';
import { LAYER } from '../consts.js';
import { ENEMY_TYPES } from '../world/build.js';
import { VIEW_W, VIEW_H } from '../core/view.js';
import { navLabelString, navLabels, input } from '../core/input.js';
import { Effects } from '../effects.js';
import { updateEffects, drawEffects, resetEffects, fireManual, CATALOG } from '../effects/index.js';
import { particles } from '../effects/particles.js';
import { aabbOverlap } from '../core/collision.js';
import { damage } from '../combat/damage.js';

// Import every primitive module for its registration side effect.
import '../combat/attack/primitives/projectile.js';
import '../combat/attack/primitives/bomb.js';
import '../combat/attack/primitives/explosion.js';
import '../combat/attack/primitives/meleeHitbox.js';
import '../combat/attack/primitives/movement.js';
import '../combat/attack/primitives/bodyContact.js';
import '../combat/attack/macros/reticleShot.js';
import '../combat/attack/macros/spawnSplit.js';
import '../combat/attack/macros/homingMissile.js';
import '../combat/attack/macros/predictiveShot.js';
import '../combat/attack/macros/spreadShot.js';
import '../combat/attack/macros/bodyExplosion.js';
import '../combat/attack/primitives/beam.js';
import '../combat/attack/primitives/fireArea.js';
import '../combat/attack/primitives/spike.js';
import '../combat/attack/primitives/orbit.js';
import '../combat/attack/primitives/boomerang.js';

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
  projectile: { direction: 0, speed: 600, ttl: 2, damage: 10, solidBehavior: 'phase', gravity: 0 },
  bomb: { direction: -0.5, speed: 600, arc: 800, bounce: true, explodeOnContact: true, ttl: 4, damage: 40, radius: 70 },
  explosion: { x: TARGET_POS.x + 16, y: GROUND_Y - 24, radius: 70, damage: 40, alignment: 'neutral' },
  meleeHitbox: { activeFrames: 10, w: 48, h: 44, offset: { x: 44, y: 0 }, damage: 12 },
  charge: { direction: 0, speed: 700, duration: 0.6, distance: null, acceleration: 0 },
  bodyContact: { damage: 20, enabled: true, temporaryOverride: true },
  // --- Wave 2 -----------------------------------------------------------------
  reticleShot: { duration: 1.3, lockTime: 1.1, color: '#ff5555', radius: 30, tracking: true, speed: 500, ttl: 2, damage: 10 },
  homingMissile: { direction: -0.3, turnRate: 3, speed: 400, ttl: 2, damage: 10 },
  predictiveShot: { speed: 300, ttl: 3, damage: 10 },
  beam: { direction: 0, length: 450, width: 24, duration: 0.6, damage: 15, tickRate: 8, team: 'ally' },
  fireArea: { x: TARGET_POS.x + 16, y: GROUND_Y - 24, length: 96, height: 48, duration: 2, tickRate: 5, damage: 8, team: 'ally' },
  spike: { x: TARGET_POS.x + 16, y: GROUND_Y - 16, size: 32, warningTime: 0.5, visibleTTL: 0.8, hiddenTTL: 0.5, repeatCount: 2, damage: 15, tickRate: 10, team: 'ally' },
  orbit: { count: 3, minRadius: 40, maxRadius: 90, pulseSpeed: 1.5, speed: 1.5, ttl: null, damage: 10, ejectable: true, ejectTtl: 2 },
  boomerang: { direction: 0, speed: 500, returnSpeed: 700, outboundDuration: 0.7, outboundDistance: null, ttl: 4, damage: 12, count: 3 },
  spawnSplit: { x: TARGET_POS.x + 16, y: GROUND_Y - 100, count: 4, centerDirection: -Math.PI / 2, angle: 120 * DEG, force: 300, inheritVelocity: 0, delay: 0, spawnType: 'bomb', enemyType: 'jester' },
  spreadShot: { count: 3, direction: 0, angle: 60 * DEG, speed: 500, ttl: 2, damage: 10 },
  bodyExplosion: { deathBehavior: 'kill', triggerPayloadFirst: true, payloadDelay: 0.1 },
};

/** Tweakable params per primitive: [key, kind, step]. kind: num | angle | int. */
export const TWEAKABLE = {
  projectile: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['ttl', 'num', 0.25], ['damage', 'num', 2]],
  spreadShot: [['count', 'int', 1], ['angle', 'angle', 15 * DEG]],
  bomb: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['arc', 'num', 100], ['ttl', 'num', 0.5], ['damage', 'num', 5], ['radius', 'num', 10]],
  explosion: [['x', 'num', 20], ['y', 'num', 20], ['radius', 'num', 10], ['damage', 'num', 5]],
  meleeHitbox: [['activeFrames', 'int', 2], ['w', 'num', 8], ['h', 'num', 8], ['damage', 'num', 2]],
  charge: [['speed', 'num', 100], ['duration', 'num', 0.1]],
  bodyContact: [['damage', 'num', 5]],
  // --- Wave 2 -----------------------------------------------------------------
  reticleShot: [['duration', 'num', 0.1], ['lockTime', 'num', 0.1], ['speed', 'num', 50]],
  homingMissile: [['turnRate', 'num', 0.5], ['direction', 'angle', 15 * DEG], ['ttl', 'num', 0.25]],
  predictiveShot: [['speed', 'num', 50]],
  beam: [['direction', 'angle', 15 * DEG], ['length', 'num', 20], ['width', 'num', 4], ['duration', 'num', 0.1], ['damage', 'num', 2], ['tickRate', 'int', 1]],
  fireArea: [['x', 'num', 20], ['length', 'num', 16], ['height', 'num', 8], ['duration', 'num', 0.25], ['damage', 'num', 2], ['tickRate', 'int', 1]],
  spike: [['x', 'num', 16], ['size', 'num', 8], ['warningTime', 'num', 0.1], ['visibleTTL', 'num', 0.1], ['hiddenTTL', 'num', 0.1], ['repeatCount', 'int', 1], ['damage', 'num', 2]],
  orbit: [['count', 'int', 1], ['minRadius', 'num', 10], ['maxRadius', 'num', 10], ['pulseSpeed', 'num', 0.25], ['speed', 'num', 0.25]],
  boomerang: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['returnSpeed', 'num', 50], ['outboundDuration', 'num', 0.1], ['count', 'int', 1]],
  spawnSplit: [['count', 'int', 1], ['centerDirection', 'angle', 15 * DEG], ['angle', 'angle', 15 * DEG], ['force', 'num', 50], ['spawnType', 'enum', ['projectile', 'bomb', 'enemy']], ['enemyType', 'enum', ENEMY_TYPES]],
  bodyExplosion: [['payloadDelay', 'num', 0.05]],
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
  _padConfirmHeld: false, // gamepad A edge-trigger memory (replay)
  _rep: {},           // held-control repeater state per channel
  _repeatDir: {},     // current direction per repeat channel
  _tweaks: {},        // per-id user param tweaks (survive per-replay reload)

  get entries() { return [...listPrimitives(), ...listMacros()]; },
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
    const [key, kind, stepSize] = list[this.paramIndex];
    // Record the tweak per-id so it survives the per-replay param rebuild.
    const id = this.currentId();
    if (!this._tweaks[id]) this._tweaks[id] = {};
    // Enum params: cycle through the allowed values instead of numeric stepping.
    if (kind === 'enum' && Array.isArray(stepSize)) {
      const cur = this._params[key];
      const idx = stepSize.indexOf(cur);
      const next = stepSize[(idx + deltaSign + stepSize.length) % stepSize.length];
      this._params[key] = next;
      this._tweaks[id][key] = next;
      return;
    }
    const nextNum = round2((this._params[key] ?? 0) + deltaSign * stepSize);
    this._params[key] = nextNum;
    this._tweaks[id][key] = nextNum;
  },

  replay() {
    if (!this.active) return;
    this._replay();
  },

  /**
   * Orbit eject (Space): if a live orbit handle exists and is ejectable,
   * release its satellites as real projectiles along their tangents.
   * Returns true when an eject happened (caller skips the replay action).
   */
  tryEjectOrbit() {
    if (!this.active || this.currentId() !== 'orbit') return false;
    const h = this._handles.find((x) => x.id === 'orbit' && typeof x.eject === 'function');
    if (!h || h.state?.ejected) return false;
    const launches = h.eject(420);
    if (!launches.length) return false;
    for (const l of launches) {
      const shot = invoke('projectile', {
        origin: { x: l.x, y: l.y }, direction: l.angle,
        speed: Math.hypot(l.vx, l.vy), ttl: l.ttl ?? 2, damage: this._params.damage ?? 10,
      }, this._ctx());
      if (shot?.entity) this._handles.push(shot);
    }
    this._log.unshift(`EJECT → ${launches.length} shots`);
    return true;
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
    // Keyboard confirm comes from the RAW DOM keydown listener in debugHarness
    // (one event per physical press — never merged), so fast taps can't be
    // collapsed by the per-frame poll. Only the GAMEPAD side is polled here,
    // edge-triggered (a held A button replays once, not every frame).
    if (s.padConfirm && !this._padConfirmHeld) this.replay();
    this._padConfirmHeld = s.padConfirm;
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
    // Flat floor solid so spawned enemies land and stick (resolve() against it),
    // mirroring the real engine's ctx.solids. Bombs use stepBombTerrain(GROUND_Y);
    // enemies use resolve() against this box — same shared collision path.
    this._floorSolid = { x: -200, y: GROUND_Y, w: VIEW_W + 400, h: 400 };
    this._attacker = { ...ATTACKER_HOME, alive: true, layer: LAYER.HERO, facing: 1, bodyKnockback: null };
    this._target = { ...TARGET_POS, alive: true, hp: 999, layer: LAYER.ENEMY, hitFlash: 0 };
    // REAL damage pipeline (same as Enemy.takeDamage): central damage() +
    // white hit-flash. Blood sparkles are NOT spawned here — they belong to
    // the attack side (hitbox onHit / collision handlers), so the theater sees
    // them via the real path, not a theater-local hack.
    this._target.takeDamage = (amt, source, method = 'melee') => {
      const dealt = damage(source ?? this._attacker, this._target, amt, method);
      if (dealt > 0) this._target.hitFlash = 0.1;
      return dealt;
    };
    this._world.add(this._attacker);
    this._world.add(this._target);
    this._handles = [];
    this._flash = 0;
    this._log = [];
    this._choreo = null;
    this._aimPoint = null;
    this._kamikaze = null;
    this._attackerVisible = true;
    // Spawned enemies (spawnSplit spawnType='enemy'): removed from the world
    // on replay/teardown so they don't leak into the next run.
    for (const e of this._spawnedEnemies ?? []) { try { this._world?.remove(e); } catch { /* noop */ } }
    this._spawnedEnemies = [];
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
    const def = getPrimitive(id)?.params ?? getMacro(id)?.params ?? {};
    const preset = SANDBOX_PRESETS[id] ?? {};
    // User tweaks (adjustParam) are stored per-id in _tweaks and merged on top,
    // so they survive the per-replay rebuild without leaking demo mutations.
    this._params = { ...def, ...preset, ...(this._tweaks?.[id] ?? {}) };
  },

  _ctx() {
    return makeContext(this._attacker, {
      world: { targets: [this._target], hero: null },
      pools: this._pools,
      collisionWorld: this._world,
      effects: { ...Effects, fireManual }, // REAL VFX + fireManual for telegraphs
    });
  },

  _replay() {
    // Additive attacks declare themselves via h.rearm (boomerang, orbit):
    // replaying with a live rearm-capable handle skips the full reset so the
    // new throw/ring joins the live one. Switching FROM another primitive
    // always gets a full reset — the check is "live handle of THIS id with
    // rearm()", never "which id is selected" (the index already moved by the
    // time we're here).
    const id0 = this.currentId();
    const additive = this._handles.some((h) => h.id === id0 && typeof h.rearm === 'function');
    if (!additive) {
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
      // Face the target again (charge/punch/kamikaze choreos flip facing).
      this._attacker.facing = 1;
      // Respawn the attacker body: vanish (spawnSplit) and kamikaze (bodyExplosion)
      // demos hide it for the whole run — every new run starts visible again.
      this._attackerVisible = true;
      this._kamikaze = null;
      // Drop enemies spawned by the previous spawnSplit run (real world entities).
      for (const e of this._spawnedEnemies ?? []) { try { this._world?.remove(e); } catch { /* noop */ } }
      this._spawnedEnemies = [];
    }
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
    } else if (id === 'homingMissile') {
      // Homing demo: the target WEAVES (slow drift + jump bursts) trying to
      // dodge; the missile must visibly curve after it. Fires immediately.
      this._choreo = { kind: 'dodgeWeave', t: 0, jumping: false, jumpT: 0, nextJump: 0.8 };
    } else if (id === 'reticleShot') {
      // Reticle Shot macro demo: the ATTACKER hovers on a platform high to the
      // left; the target WALKS LEFT along the ground. The macro tracks → locks
      // → fires ONE shot at the locked point when duration ends. Staging only —
      // the composition itself lives in combat/attack/macros/reticleShot.js.
      this._choreo = { kind: 'walkLeft', t: 0, baseX: TARGET_POS.x };
      this._attacker.x = 140;
      this._attacker.y = 150; // up on the platform
      this._attacker.facing = 1;
    } else if (id === 'predictiveShot') {
      // Predictive demo: the ATTACKER hovers on a platform high to the left;
      // the target WALKS LEFT along the ground. One shot is fired at the
      // PREDICTED position (intercept point from bullet speed) — no reticle,
      // no aim marker: you judge success by watching the bullet arrive where
      // the walker is ABOUT to be. The macro fires the shot itself at invoke;
      // the strafe velocity just needs to exist when that happens.
      this._choreo = { kind: 'strafe', t: 0, baseX: TARGET_POS.x };
      this._attacker.x = 140;
      this._attacker.y = 150; // up on the platform
      this._attacker.facing = 1;
      // Give the walker its real velocity BEFORE the invoke so the intercept
      // math has something to lead against (the choreo keeps moving it).
      this._target.vx = -160;
      this._target.vy = 0;
    } else if (id === 'orbit') {
      // Orbit demo: the ATTACKER walks up to the target so the satellites
      // sweep through its body. Space toggles eject (when ejectable).
      this._choreo = { kind: 'walkToTarget', speed: 120, ejected: false };
      this._params.ejectable = true; // sandbox always allows the eject demo
    } else if (id === 'bodyExplosion') {
      // Kamikaze demo: the attacker WALKS to the target, then vanishes and
      // explodes ON IT. No standing-around payload pre-fire.
      this._choreo = { kind: 'kamikaze', speed: 200, exploded: false };
    } else if (id === 'explosion') {
      // Explosion demo: the ATTACKER detonates on itself — the blast is
      // centered on the attacker's body and it vanishes (same read as
      // spawnSplit: the body IS the attack). The target takes the blast.
      this._params.x = this._attacker.x + this._attacker.w / 2;
      this._params.y = this._attacker.y + this._attacker.h / 2;
      this._choreo = { kind: 'vanishOnReplay' };
    } else if (id === 'spawnSplit') {
      // Split demo: default to ballistic bombs that arc down, bounce off the
      // ground, and detonate. But if the user explicitly retuned spawnType
      // (projectile/enemy) via the param list, honor that — don't clobber it.
      const chosen = this._params.spawnType;
      if (chosen !== 'enemy' && chosen !== 'projectile') {
        this._params.spawnType = 'bomb';
        this._params.bomb = { arc: 700, bounce: true, ttl: 4, damage: 25, radius: 60, explodeOnContact: true };
      }
      // centerDirection + angle come from SANDBOX_PRESETS (the demo fan) and are
      // user-tweakable — do NOT reset them here or every replay clobbers the choice.
      this._params.x = this._attacker.x + this._attacker.w / 2;
      this._params.y = this._attacker.y + 10;
      this._choreo = { kind: 'vanishOnReplay' };
    }
    // (explosion + spawnSplit stage the origin at the attacker and hide its
    // body via vanishOnReplay — the body IS the attack in both demos.)

    // Additive attacks (boomerang, orbit): if a live handle of THIS primitive
    // exists and supports rearm(), replay RE-ARMS it instead of re-invoking.
    // The primitive owns the semantics (cap, extra ring) — the host just asks.
    const live = this._handles.find((x) => x.id === id && typeof x.rearm === 'function');
    if (live) {
      const r = live.rearm();
      if (r?.spawned) this._log.unshift(`${id.toUpperCase()} +1 (alive ${r.alive ?? r.rings})`);
      else this._log.unshift(`${id.toUpperCase()} AT CAP`);
      return;
    }

    let h;
    try {
      // Choreographed attacks gate the actual invoke:
      //  - punch (melee): starts once the attacker is beside the target
      const gated = this._choreo?.kind === 'punch' || this._choreo?.kind === 'kamikaze';
      if (!gated) {
        // Every attack is a single invoke. Macros own their composition
        // (homingMissile = projectile + steering, predictiveShot = aim math +
        // projectile, spreadShot = fan + projectiles, bodyExplosion = payload
        // + death) — the theater only stages the scene and passes params.
        h = invoke(id, { ...this._params, target: this._target }, this._ctx());
        if (id === 'spawnSplit') {
          // Dumb host follow-up: the spawnSplit MACRO owns all materialization
          // (fan → live projectiles/bombs/enemies + launch velocity + hitstun).
          // The theater only registers the returned enemy entities with its
          // sandbox world and steps their AI each frame — that per-frame enemy
          // AI is the game loop's job, never the engine's.
          for (const e of h.enemies ?? []) {
            this._spawnedEnemies.push(e);
            this._world.add(e);
          }
          for (const ch of h.handles ?? []) this._handles.push(ch);
          const st = this._params.spawnType;
          this._log.unshift(`split → ${h.children?.length ?? 0} ${st === 'bomb' ? 'bombs' : st === 'enemy' ? 'enemies' : 'shots'}`);
        } else if (id === 'predictiveShot') {
          this._log.unshift(`intercept → flight ${h.flightTime != null ? Math.round(h.flightTime * 1000) + 'ms' : '∅'}`);
        }
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
    updateEffects(DT);   // advance effect instances (beams, flashes...)
    particles.updateAll(DT); // advance hit-sparkles / explosion debris —
                             // WITHOUT this they spawn frozen at full alpha
                             // and never fly/fade (main loop does this in barrelSync)

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
      } else if (c.kind === 'dodgeWeave') {
        // Homing demo: target drifts slowly left/right and periodically JUMPS
        // (vertical burst + pause) to try to shake the missile. The missile's
        // visible re-curve after each jump is the whole point of the demo.
        // FINITE run: parks back home after ~4s so the next demo is clean.
        c.t += DT;
        const base = TARGET_POS.x;
        if (c.t < 4) {
          this._target.x = base + Math.sin(c.t * 1.2) * 90;
          if (!c.jumping && c.t >= c.nextJump) {
            c.jumping = true; c.jumpT = 0;
          }
          if (c.jumping) {
            c.jumpT += DT;
            // Jump arc: up then down over ~0.7s (parabola), then a brief pause.
            const jt = c.jumpT / 0.7;
            if (jt < 1) this._target.y = TARGET_POS.y - Math.sin(jt * Math.PI) * 70;
            else if (jt < 1.4) this._target.y = TARGET_POS.y; // hang at apex end
            else { c.jumping = false; c.nextJump = c.t + 1.6; this._target.y = TARGET_POS.y; }
          }
        } else if (!c.parked) {
          c.parked = true;
          this._target.x = TARGET_POS.x;
          this._target.y = TARGET_POS.y;
        }
      } else if (c.kind === 'walkLeft') {
        // ReticleShot demo staging: target WALKS LEFT at constant speed. The
        // macro owns track → lock → fire; this only moves the dummy. FINITE
        // run: parks after ~3s so the next demo starts clean. The dummy also
        // HITS when the bullet overlaps it — its body vanishes on impact and
        // respawns home when the run ends (the "target disappears" read).
        c.t += DT;
        if (c.t < 3) {
          this._target.x = c.baseX - c.t * 160;
          this._target.vx = -160;
          this._target.vy = 0;
        } else if (!c.parked) {
          c.parked = true;
          this._target.x = TARGET_POS.x;
          this._target.vx = 0;
          this._target.vy = 0;
          // Respawn the dummy (it may have been killed by the bullet): full HP,
          // visible again at home.
          this._target.hp = 999;
          this._target.alive = true;
        }
      } else if (c.kind === 'strafe') {
        // Predictive demo: target WALKS LEFT at constant speed (real velocity,
        // so the lead math has something to predict). FINITE run: after ~3s it
        // parks back home so the next demo starts from a clean scene.
        c.t += DT;
        if (c.t < 3) {
          this._target.x = c.baseX - c.t * 160; // steady leftward walk
          this._target.vx = -160;               // d/dt for the aim math
          this._target.vy = 0;
        } else if (!c.parked) {
          c.parked = true;
          this._target.x = TARGET_POS.x;
          this._target.vx = 0;
          this._target.vy = 0;
        }
      } else if (c.kind === 'walkToTarget') {
        // Orbit demo: attacker walks toward the target so satellites sweep
        // through its body. Space toggles eject (handled in key routing).
        // When every live orbit ring is gone (ejected / ttl), WALK BACK home —
        // additive replay never resets position, so without this the attacker
        // stays parked at the target for all following demos.
        const orbitsLive = this._handles.some((h) => h.id === 'orbit');
        if (!orbitsLive) {
          if (Math.abs(gap) > 4) {
            this._attacker.x -= Math.sign(gap) * c.speed * DT;
            this._attacker.facing = -Math.sign(gap) || -1;
          } else {
            this._attacker.x = ATTACKER_HOME.x;
            this._attacker.y = ATTACKER_HOME.y;
            this._attacker.facing = 1;
            this._choreo = null;
          }
        } else if (Math.abs(gap) > 26) {
          this._attacker.x += Math.sign(gap) * c.speed * DT;
          this._attacker.facing = Math.sign(gap) || 1;
        }
      } else if (c.kind === 'kamikaze') {
        // Self-destruct demo: attacker walks to the target, then VANISHES and
        // explodes on it. The explosion payload was pre-aimed at the target.
        if (!c.exploded) {
          if (Math.abs(gap) > 20) {
            this._attacker.x += Math.sign(gap) * c.speed * DT;
            this._attacker.facing = Math.sign(gap) || 1;
          } else {
            // Contact: trigger the body explosion NOW (payload blast centered
            // on the target), and hide the attacker body — it IS the bomb.
            c.exploded = true;
            this._attackerVisible = false;
            const victim = { ...this._attacker, alive: true, hp: 999, layer: LAYER.ENEMY, takeDamage(a) { this.hp -= a; if (this.hp <= 0) this.alive = false; return a; } };
            const kh = invoke('bodyExplosion', { ...this._params }, makeContext(victim, { world: { targets: [this._target] }, target: this._target, pools: this._pools, collisionWorld: this._world, effects: Effects }));
            kh.on('detonate', () => this._log.unshift('KAMIKAZE BOOM'));
            kh.on('complete', () => this._log.unshift('COMPLETE'));
            this._handles.push(kh);
          }
        }
      } else if (c.kind === 'vanishOnReplay') {
        // Spawn/split demo: the attacker disappears the instant the split
        // happens (it BECOMES the bombs).
        this._attackerVisible = false;
      }
    }

    projectilePool.updateAll(DT);
    specialPool.updateAll(DT);

    // Spawned enemies (spawnSplit spawnType='enemy'): run their real update each
    // frame. Enemy.update() drives ai() + gravity + integration internally and
    // honors hit-stun (skips ai() while stunned), so a launched enemy's fan
    // velocity integrates freely during its arc — same as knockback in gameplay.
    // Do NOT call e.ai() separately: it bypasses the stun guard and stomps vx.
    for (const e of this._spawnedEnemies ?? []) {
      if (!e.alive) continue;
      // The attacker fires the split, so its spawned minions hunt the TARGET
      // (the opposing side), not the attacker. Enemy AI takes the hero/chase
      // reference as a param — the caller (us) decides who they chase.
      e.update?.(DT, this._target, this._world);
      // Ground resolution: same shared resolve() the real engine uses. Gravity
      // is integrated inside e.update(); this snaps the body onto the floor so
      // it lands and sticks instead of falling off-screen. Flyers skip.
      if (e.gravity > 0) resolve(e, [this._floorSolid]);
    }
    // Off-screen cull (sandbox bounds instead of level zone).
    for (const p of [...projectilePool.activeItems, ...specialPool.activeItems]) {
      if (p.x + p.w < -40 || p.x > VIEW_W + 40 || p.y + p.h < -40 || p.y > VIEW_H + 40) p.alive = false;
    }

    // --- Sandbox hit detection -------------------------------------------------
    // The real game routes PROJ×ENEMY through registerCollisionHandlers()
    // (gameplay-only: it needs the live hero, boss zone, barrels...). The
    // sandbox keeps its CollisionWorld for future terrain/solid work but does
    // its own minimal projectile→target check here — same aabbOverlap, damage
    // routed through the target's OWN takeDamage() (real Enemy pipeline or the
    // placeholder shim below), plus the _attackHit flag the lifecycle bridging
    // reads. No theater-local damage math.
    for (const p of [...projectilePool.activeItems, ...specialPool.activeItems]) {
      if (!p.alive || !this._target?.alive) continue;
      if (!aabbOverlap(p, this._target)) continue;
      const dealt = typeof this._target.takeDamage === 'function'
        ? this._target.takeDamage(p.damage ?? 10, this._attacker, 'projectile')
        : damage(this._attacker, this._target, p.damage ?? 10, 'projectile');
      if (dealt > 0) {
        p._attackHit = true;
        this._flash = 0.15;
        Effects.spawnHitSparkles(p.x + p.w / 2, p.y + p.h / 2, 6);
        this._log.unshift(`HIT ${dealt} dmg`);
      }
      p.alive = false; // consumed on impact (matches gameplay behavior)
    }

    // Bomb terrain: the ENGINE owns bounce/settle/detonate (stepBombTerrain) —
    // same rules + numbers as gameplay. The sandbox just supplies the flat
    // ground line; stepBomb() detonates settled bombs on the handle pass below.
    for (const s of specialPool.activeItems) {
      if (!s.alive || s._attackId !== 'bomb' || s._attackDone) continue;
      stepBombTerrain(s, DT, GROUND_Y);
    }
    this._world.update();

    // Step each live handle's entity.
    for (let i = this._handles.length - 1; i >= 0; i--) {
      const h = this._handles[i];
      let finished = false;
      if (h.id === 'meleeHitbox' && typeof h.step === 'function') {
        finished = h.step([this._target]);
      } else if (h.id === 'reticleShot') {
        // Dumb host: the macro owns track → lock → fire, and its shot handle
        // owns flight. We just step both; when the bullet ends (hit/expire)
        // the macro emits its terminal event and the reticle effect dismisses
        // with it — no distance math or manual fx.complete() here.
        finished = h.step(DT);
        if (h.shot?.entity) {
          finished = stepProjectile(h.shot.entity, h.shot) || finished;
        }
      } else if (h.entity) {
        if (h.id === 'projectile') finished = stepProjectile(h.entity, h);
        else if (h.id === 'bomb') finished = stepBomb(h.entity, this._params, this._ctx(), h);
        else if (typeof h.step === 'function') finished = h.step(DT); // homingMissile / predictiveShot / ...
      } else if (typeof h.step === 'function') {
        // State-based primitives: charge (motion profile), reticle (timing),
        // beam/fireArea/spike (tick damage vs the dummy target), orbit
        // (position update), boomerang (outbound/return profile).
        if (h.id === 'beam' || h.id === 'fireArea' || h.id === 'spike') {
          finished = h.step(DT, [this._target]);
        } else if (h.id === 'boomerang') {
          finished = h.step(DT);
          // Contact check: every live boomerang body vs the dummy target.
          for (const s of h.states ?? []) {
            if (!s || s.done || !this._target?.alive) continue;
            if (s.x + 8 > this._target.x && s.x - 8 < this._target.x + this._target.w &&
                s.y + 8 > this._target.y && s.y - 8 < this._target.y + this._target.h) {
              const dealt = this._target.takeDamage(this._params.damage ?? 12, this._attacker, 'melee');
              if (dealt > 0) {
                this._flash = 0.15;
                Effects.spawnHitSparkles(s.x, s.y, 6);
                this._log.unshift(`BOOMERANG HIT ${dealt} dmg`);
              }
            }
          }
        } else if (h.id === 'orbit') {
          finished = h.step(DT);
          // Contact check: every live ring's entities vs the dummy target.
          for (const st of h._rings ?? [h.state]) {
            if (st.done || !this._target?.alive) continue;
            for (const e of st.entities ?? []) {
              if (e.x + 6 > this._target.x && e.x - 6 < this._target.x + this._target.w &&
                  e.y + 6 > this._target.y && e.y - 6 < this._target.y + this._target.h) {
                const dealt = this._target.takeDamage(this._params.damage ?? 10, this._attacker, 'melee');
                if (dealt > 0) {
                  this._flash = 0.15;
                  Effects.spawnHitSparkles(e.x, e.y, 4);
                  this._log.unshift(`ORBIT HIT ${dealt} dmg`);
                }
                break; // one hit per ring per frame is enough for the sandbox
              }
            }
          }
        } else {
          finished = h.step(DT);
        }
      }
      if (finished) this._handles.splice(i, 1);
    }

    // Charge choreography: end the dash when the bodies meet.
    if (c?.kind === 'chargeToTarget') {
      const touching = this._attacker.x + this._attacker.w > this._target.x &&
        this._attacker.x < this._target.x + this._target.w &&
        this._attacker.y + this._attacker.h > this._target.y;
      if (touching) {
        const dealt = this._target.takeDamage(this._params.damage ?? 20, this._attacker, 'contact');
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
        const dealt = this._target.takeDamage(this._params.damage ?? 20, this._attacker, 'contact');
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
    const meta = getPrimitive(id)?.meta ?? getMacro(id)?.meta;
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

        const c = this._choreo;

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

    // Elevated-shooter demos (reticleShot, predictiveShot): the attacker hovers on
    // a small platform — draw it so the staging reads as intentional.
    if ((c?.kind === 'strafe' || c?.kind === 'walkLeft') && this._attacker) {
      ctx.fillStyle = '#445';
      ctx.fillRect(this._attacker.x - 16, this._attacker.y + this._attacker.h, this._attacker.w + 32, 8);
      ctx.fillStyle = '#667';
      ctx.fillRect(this._attacker.x - 16, this._attacker.y + this._attacker.h, this._attacker.w + 32, 3);
    }

    // Attacker (hidden during vanish/kamikaze demos — the body IS the attack).
    if (this._attacker && this._attackerVisible !== false) {
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

    // Orbit satellites (2D pulsing ring) — drawn after the attacker box.
    for (const h of this._handles) {
      if (h.id !== 'orbit') continue;
      for (const st of h._rings ?? [h.state]) {
        if (st.done) continue;
        for (const e of st.entities ?? []) {
          const sc = 1 + 0.3 * ((e.radius - (this._params.minRadius ?? 40)) / Math.max(1, (this._params.maxRadius ?? 90) - (this._params.minRadius ?? 40)));
          ctx.fillStyle = '#9feaff';
          ctx.save();
          ctx.translate(e.x, e.y);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-5 * sc, -5 * sc, 10 * sc, 10 * sc);
          ctx.restore();
        }
      }
    }

    // Dummy target. A dead dummy (walkLeft one-shot hit) shows only a small
    // impact X where it died — the body is GONE until the run respawns it.
    if (this._target) {
      if (this._target.alive) {
        ctx.fillStyle = this._flash > 0 ? '#fff' : '#6d6';
        ctx.fillRect(this._target.x, this._target.y, this._target.w, this._target.h);
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`HP ${Math.max(0, Math.round(this._target.hp))}`,
          this._target.x + this._target.w / 2, this._target.y - 8);
      } else {
        const dx = this._target.x + this._target.w / 2, dy = this._target.y + this._target.h / 2;
        ctx.strokeStyle = 'rgba(255,90,90,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(dx - 8, dy - 8); ctx.lineTo(dx + 8, dy + 8);
        ctx.moveTo(dx + 8, dy - 8); ctx.lineTo(dx - 8, dy + 8);
        ctx.stroke();
      }
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

    // Spawned enemies (spawnSplit spawnType='enemy').
    for (const e of this._spawnedEnemies ?? []) {
      if (!e.alive) continue;
      ctx.fillStyle = e.hitFlash > 0 ? '#fff' : '#e74c3c';
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = '#fff';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.max(0, Math.round(e.hp))}`, e.x + e.w / 2, e.y - 6);
    }

    // --- Wave-2 state visuals ---------------------------------------------------
    for (const h of this._handles) {
      const st = h.state;
      if (!st) continue;
      if (h.id === 'orbit' && (h._rings ?? [st]).some((r) => !r.done)) {
        // 2D pulsing ring: guide circle at the CURRENT pulse radius + one
        // satellite marker per entity.
        const ocx = this._attacker.x + this._attacker.w / 2, ocy = this._attacker.y + this._attacker.h / 2;
        for (const ring of h._rings ?? [st]) {
          if (ring.done) continue;
          const r = ring.entities?.[0]?.radius ?? (this._params.maxRadius ?? 90);
          ctx.strokeStyle = 'rgba(120,220,255,0.18)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(ocx, ocy, r, 0, Math.PI * 2);
          ctx.stroke();
          for (const e of ring.entities ?? []) {
            ctx.fillStyle = '#9feaff';
            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.rotate(Math.PI / 4);
            ctx.fillRect(-5, -5, 10, 10);
            ctx.restore();
          }
        }
      } else if (h.id === 'boomerang' && !(h.states?.every((s) => s.done))) {
        // Boomerang bodies: one spinning square per live throw, phase-colored.
        for (const st of h.states ?? [h.state]) {
          if (st?.done) continue;
          ctx.fillStyle = st.phase === 'outbound' ? '#7fd' : '#fd7';
          ctx.save();
          ctx.translate(st.x, st.y);
          ctx.rotate(st.t * 10);
          ctx.fillRect(-7, -7, 14, 14);
          ctx.restore();
          ctx.fillStyle = '#fff';
          ctx.font = '9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(st.phase, st.x, st.y - 12);
        }
      } else if ((h.id === 'fireArea' || h.id === 'spike') && !st.done) {
        // Persistent area / spike hazard: tinted box by phase.
        let box = null;
        if (h.id === 'fireArea') box = { x: this._params.x - this._params.length / 2, y: this._params.y - this._params.height / 2, w: this._params.length, h: this._params.height };
        else if (st.phase === 'visible') box = { x: this._params.x - this._params.size / 2, y: this._params.y - this._params.size / 2, w: this._params.size, h: this._params.size };
        if (box) {
          const active = h.id === 'fireArea' || st.phase === 'visible';
          ctx.fillStyle = h.id === 'fireArea'
            ? `rgba(255,${active ? 120 : 60},30,${active ? 0.4 : 0.15})`
            : (st.phase === 'warning' ? `rgba(255,80,80,${0.3 + 0.3 * Math.sin(st.t * 20)})` : (active ? 'rgba(255,220,80,0.7)' : 'rgba(255,255,255,0.06)'));
          ctx.fillRect(box.x, box.y, box.w, box.h);
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.strokeRect(box.x, box.y, box.w, box.h);
        }
      }
    }
    // (No aim-point marker for predictiveShot: the demo is pure "shoot where it
    // will be" — a crosshair would turn it into a reticle demo.)
    // Kamikaze dummy (bodyExplosion demo victim at home position).
    if (this._kamikaze && this._kamikaze.alive !== false) {
      ctx.fillStyle = this._kamikaze?.alive ? '#c96' : '#444';
      ctx.fillRect(this._kamikaze.x, this._kamikaze.y, this._kamikaze.w, this._kamikaze.h);
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('KAMIKAZE', this._kamikaze.x + this._kamikaze.w / 2, this._kamikaze.y - 8);
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

    // --- Right panel (full height) --------------------------------------------------
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(panelX, 8, panelW - 10, h - 16);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX, 8, panelW - 10, h - 16);

    let py = 30;
    ctx.textAlign = 'left';
    const bottomLimit = () => h - 36; // hint bar lives at h-16

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
      if (py > bottomLimit()) break;
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

    // Invokes section (macros only): what this macro composes, straight from
    // its registration meta — no theater-side knowledge of compositions.
    const invokes = meta?.invokes;
    if (Array.isArray(invokes) && invokes.length > 0) {
      py += 8;
      if (py <= bottomLimit()) {
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#f7d';
        ctx.fillText('INVOKES', panelX + 12, py);
        py += 15;
        ctx.font = '11px monospace';
        for (const invId of invokes) {
          if (py > bottomLimit()) break;
          const invName = getPrimitive(invId)?.meta?.name ?? getMacro(invId)?.meta?.name ?? invId;
          ctx.fillStyle = '#9feaff';
          ctx.fillText(`→ ${invName}`, panelX + 12, py);
          py += 14;
        }
      }
    }

    // Effects section: VFX this attack fires, straight from its registration
    // meta (primitives AND macros declare meta.effects the same way). The
    // effect name resolves through the Effect Engine catalog when available.
    const effectsMeta = meta?.effects;
    if (Array.isArray(effectsMeta) && effectsMeta.length > 0) {
      py += 8;
      if (py <= bottomLimit()) {
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#f7d';
        ctx.fillText('EFFECTS', panelX + 12, py);
        py += 15;
        ctx.font = '11px monospace';
        for (const fx of effectsMeta) {
          if (py > bottomLimit()) break;
          const catName = CATALOG.find((c) => c.type === fx.type)?.name ?? fx.type;
          ctx.fillStyle = '#b9f6ca';
          ctx.fillText(`✦ ${catName}`, panelX + 12, py);
          py += 13;
          // Dimmed description on the next line (wrapped at ~34 chars).
          if (fx.desc) {
            ctx.fillStyle = '#777';
            let line = '';
            for (const word of fx.desc.split(' ')) {
              if ((line + word).length > 34) {
                if (py > bottomLimit()) break;
                ctx.fillText(line.trim(), panelX + 20, py); py += 12; line = word + ' ';
              } else line += word + ' ';
            }
            if (line && py <= bottomLimit()) { ctx.fillText(line.trim(), panelX + 20, py); py += 12; }
          }
          py += 3;
        }
      }
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
/** Raw gamepad confirm (btn 0) — polled per frame for the REPLAY action. */
function padConfirm() {
  try {
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      if (pad.buttons[0]?.pressed || (pad.buttons[0]?.value ?? 0) > 0.5) return true;
    }
  } catch { /* no gamepad API (node tests) */ }
  return false;
}

/** Thin indirection so the gamepad code reads cleanly + stays testable. */
function inputState() {
  // Imported lazily to avoid a module-load cycle (input.js ← debugHarness).
  if (!inputState._ref) {
    import('../core/input.js').then((m) => { inputState._ref = m.input; });
  }
  const inp = inputState._ref;
  const shoulders = typeof navigator !== 'undefined' ? padShoulders() : { l2: false, r2: false };
  if (!inp) return { moveX: 0, moveY: 0, ...shoulders, navPressed: [], padConfirm: false };
  return {
    moveX: inp.state.moveX ?? 0,
    moveY: inp.state.moveY ?? 0,
    ...shoulders,
    navPressed: inp.nav.pressed ?? [],
    padConfirm: padConfirm(),
  };
}
