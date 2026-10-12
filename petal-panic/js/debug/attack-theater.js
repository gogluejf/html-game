// Petal Panic — Attack Theater (Wave 1 cut; full spec lands in Wave 5).
// A DEBUG-ONLY sandbox that lists every registered attack primitive, lets you
// pick one (arrows), and fires it at a dummy target with live-tweakable params.
// Same UX pattern as the Effect Theater (F2): black overlay, demo arena left,
// info/params panel right, arrows navigate, confirm replays, back closes.
//
// Unlike the Effect Theater this runs a LIVE mini-simulation: real pools,
// real collision world, real damage routing. The attacker is a placeholder
// box on the left; the dummy target stands on the right and flashes + loses HP.
//
// Keys: F4 toggle · ←/→ select · ↑/↓ select param · Shift+←/→ adjust value ·
//       Enter/Space replay · Esc close.

import { listPrimitives, getPrimitive } from '../combat/attack/registry.js';
import { invoke } from '../combat/attack/engine.js';
import { makeContext } from '../combat/attack/context.js';
import { stepProjectile } from '../combat/attack/primitives/projectile.js';
import { stepBomb } from '../combat/attack/primitives/bomb.js';
import { Pool, Projectile, Special } from '../objects/projectile.js';
import { CollisionWorld } from '../core/collision.js';
import { LAYER } from '../consts.js';
import { VIEW_W, VIEW_H } from '../core/view.js';
import { navLabelString, navLabels } from '../core/input.js';

// --- Sandbox constants --------------------------------------------------------
const GROUND_Y = 420;
const ATTACKER_POS = { x: 160, y: GROUND_Y - 48, w: 32, h: 48 };
const TARGET_POS = { x: 700, y: GROUND_Y - 48, w: 32, h: 48 };
const DT = 1 / 60;

// Per-primitive default param presets for the sandbox (override registry
// defaults where they'd be boring or point the wrong way).
const SANDBOX_PRESETS = {
  projectile: { direction: 0, speed: 600, ttl: 2, damage: 10, solidBehavior: 'pass', gravity: 0 },
  spread: { count: 3, direction: 0, angle: Math.PI / 3 },
  bomb: { direction: -Math.PI / 4, speed: 300, arc: 800, bounce: true, ttl: 4, damage: 40, radius: 60 },
  explosion: { x: 700, y: GROUND_Y - 24, radius: 60, damage: 40, alignment: 'neutral' },
  meleeHitbox: { activeFrames: 8, w: 48, h: 40, offset: { x: 40, y: 0 }, damage: 12 },
  charge: { direction: 0, speed: 600, duration: 0.5, distance: null, acceleration: 0 },
  bodyContact: { damage: 20, enabled: true, temporaryOverride: true },
};

/**
 * Import every Wave-1 primitive module for its registration side effect.
 * The game's normal boot path imports these via gameplay code; the theater
 * does it explicitly so F4 works even before any attack has fired in-game.
 */
import '../combat/attack/primitives/projectile.js';
import '../combat/attack/primitives/spread.js';
import '../combat/attack/primitives/bomb.js';
import '../combat/attack/primitives/explosion.js';
import '../combat/attack/primitives/meleeHitbox.js';
import '../combat/attack/primitives/movement.js';
import '../combat/attack/primitives/bodyContact.js';

/** Numeric params the sandbox exposes for tweaking (in display order). */
export const TWEAKABLE = {
  projectile: ['speed', 'ttl', 'damage'],
  spread: ['count', 'angle'],
  bomb: ['speed', 'arc', 'ttl', 'damage', 'radius'],
  explosion: ['x', 'y', 'radius', 'damage'],
  meleeHitbox: ['activeFrames', 'w', 'h', 'damage'],
  charge: ['speed', 'duration'],
  bodyContact: ['damage'],
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
  _handles: [],   // active attack handles this run
  _params: {},    // current tweak values per selected entry
  _flash: 0,      // target hit-flash timer
  _log: [],       // event log lines (hit/detonate/expire)

  get entries() { return listPrimitives(); },

  currentId() { return this.entries[this.index] ?? null; },

  /** Current tweakable key names for the selected entry. */
  _tweakKeys() {
    return TWEAKABLE[this.currentId()] ?? [];
  },

  open() {
    this.active = true;
    this.index = 0;
    this.paramIndex = 0;
    this._resetSandbox();
  },

  close() {
    this.active = false;
    this._teardown();
  },

  step(dir) {
    if (!this.active) return;
    const n = this.entries.length;
    this.index = (this.index + dir + n) % n;
    this.paramIndex = 0;
    this._loadParams();
    this._replay();
  },

  /** Select previous/next tweakable param. */
  stepParam(dir) {
    const keys = this._tweakKeys();
    if (!keys.length) return;
    this.paramIndex = (this.paramIndex + dir + keys.length) % keys.length;
  },

  /** Adjust the selected param by `delta` (already scaled by caller). */
  adjustParam(delta) {
    const keys = this._tweakKeys();
    if (!keys.length) return;
    const key = keys[this.paramIndex];
    this._params[key] = round2((this._params[key] ?? 0) + delta);
  },

  replay() {
    if (!this.active) return;
    this._replay();
  },

  // --- Sandbox lifecycle ------------------------------------------------------

  _resetSandbox() {
    this._teardown();
    this._pools = { projectilePool: new Pool(Projectile, 64), specialPool: new Pool(Special, 16) };
    this._world = new CollisionWorld({ cellSize: 64 });
    this._attacker = { ...ATTACKER_POS, alive: true, layer: LAYER.HERO, facing: 1 };
    this._target = { ...TARGET_POS, alive: true, hp: 999, layer: LAYER.ENEMY, hitFlash: 0 };
    this._world.add(this._attacker);
    this._world.add(this._target);
    this._handles = [];
    this._flash = 0;
    this._log = [];
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
      effects: null, // no VFX in v0 (Effect Engine wiring lands with Wave 5)
    });
  },

  _replay() {
    // Clear any live shots from the previous run.
    for (const p of this._pools?.projectilePool.activeItems ?? []) p.alive = false;
    for (const s of this._pools?.specialPool.activeItems ?? []) s.alive = false;
    if (this._pools) {
      this._pools.projectilePool.active.length = 0;
      this._pools.specialPool.active.length = 0;
    }
    for (const h of this._handles) { try { h.cancel?.(); } catch { /* noop */ } }
    this._handles = [];
    this._target.hp = 999;
    this._target.alive = true;
    this._log = [];

    const id = this.currentId();
    if (!id) return;
    let h;
    try {
      h = invoke(id, { ...this._params }, this._ctx());
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
    // Synchronous primitives (spread/bodyContact) finish during invoke().
    if (h.entity == null && !h.step && h.state == null) {
      this._log.unshift(`${id} finished (synchronous)`);
    }
    // Composable direction-generator: fan its angles out as projectiles so
    // the sandbox shows something real (macros do this composition natively).
    if (id === 'spread' && Array.isArray(h.angles)) {
      for (const ang of h.angles) {
        const shot = invoke('projectile', { ...this._params, direction: ang, count: undefined }, this._ctx());
        if (shot?.entity) this._handles.push(shot);
      }
      this._log.unshift(`spread → ${h.angles.length} shots`);
    }
  },

  /** Advance the sandbox one fixed step. Called from update() while active. */
  update(dt) {
    if (!this.active || !this._pools) return;
    // Fixed-step accumulation so behavior matches gameplay determinism.
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
    projectilePool.updateAll(DT);
    specialPool.updateAll(DT);
    // Off-screen cull (sandbox bounds instead of level zone).
    for (const p of [...projectilePool.activeItems, ...specialPool.activeItems]) {
      if (p.x + p.w < -40 || p.x > VIEW_W + 40 || p.y + p.h < -40 || p.y > VIEW_H + 40) {
        p.alive = false;
      }
    }
    this._world.update();

    // Step each live handle's entity.
    for (let i = this._handles.length - 1; i >= 0; i--) {
      const h = this._handles[i];
      let finished = false;
      if (h.id === 'meleeHitbox' && typeof h.step === 'function') {
        finished = h.step([this._target]); // melee needs the target list
      } else if (h.entity) {
        if (h.id === 'projectile') finished = stepProjectile(h.entity, h);
        else if (h.id === 'bomb') finished = stepBomb(h.entity, this._params, this._ctx(), h);
        else if (typeof h.step === 'function') finished = h.step(DT);
      }
      if (finished) this._handles.splice(i, 1);
    }

    // Target bookkeeping: flash decay + death → respawn next replay.
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

    const panelW = 260;
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
    // Ground line.
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, GROUND_Y);
    ctx.lineTo(demoW - 40, GROUND_Y);
    ctx.stroke();

    // Attacker (placeholder box, pink).
    if (this._attacker) {
      ctx.fillStyle = '#ff6ec7';
      ctx.fillRect(this._attacker.x, this._attacker.y, this._attacker.w, this._attacker.h);
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ATTACKER', this._attacker.x + this._attacker.w / 2, this._attacker.y - 8);
    }

    // Dummy target (green, flashes white when hit).
    if (this._target) {
      ctx.fillStyle = this._flash > 0 ? '#fff' : (this._target.alive ? '#6d6' : '#444');
      ctx.fillRect(this._target.x, this._target.y, this._target.w, this._target.h);
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.fillText(this._target.alive ? `HP ${Math.max(0, Math.round(this._target.hp))}` : 'DOWN',
        this._target.x + this._target.w / 2, this._target.y - 8);
    }

    // Live projectiles/specials (debug rects — sprites land with Wave 5).
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

    // Event log (last 5 lines, bottom-left of arena).
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

    // Description (wrapped).
    if (meta?.desc) {
      ctx.font = '12px monospace';
      ctx.fillStyle = '#aaa';
      let line = '';
      for (const word of meta.desc.split(' ')) {
        if ((line + word).length > 34) {
          ctx.fillText(line, panelX + 12, py); py += 15; line = word + ' ';
        } else line += word + ' ';
      }
      if (line) { ctx.fillText(line.trim(), panelX + 12, py); py += 15; }
    }
    py += 10;

    // Param list (tweakable ones highlighted + selectable).
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#f7d';
    ctx.fillText('PARAMS (↑/↓ select · Shift+←/→ adjust)', panelX + 12, py);
    py += 18;
    ctx.font = '11px monospace';
    const keys = this._tweakKeys();
    const allKeys = Object.keys(this._params ?? {});
    for (const key of allKeys) {
      if (py > h - 70) break;
      const tweakIdx = keys.indexOf(key);
      const selected = tweakIdx === this.paramIndex && keys.length > 0;
      ctx.fillStyle = selected ? '#fd6' : (tweakIdx >= 0 ? '#ccc' : '#666');
      const val = this._params[key];
      const valStr = typeof val === 'number' ? round2(val).toString()
        : (val && typeof val === 'object' ? JSON.stringify(val) : String(val));
      ctx.fillText(`${selected ? '▶' : '·'} ${key} = ${valStr}`, panelX + 12, py);
      py += 15;
    }

    // Hint bar.
    const stepIcons = [...navLabels('left', { simple: true }), ...navLabels('right', { simple: true })].join('/');
    const confirmLabel = navLabelString('confirm');
    const backLabel = navLabelString('back');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#666';
    ctx.font = '12px monospace';
    ctx.fillText(
      `${stepIcons} select   ↑↓ param   Shift+${stepIcons} adjust   [${confirmLabel}] replay   [${backLabel}] close   F4 toggle`,
      demoW / 2, h - 16
    );

    ctx.restore();
  },
};

function round2(n) {
  return Math.round(n * 100) / 100;
}
