// Petal Panic — Effect Theater overlay ().
// A DEBUG-ONLY preview surface that steps through every registered effect in
// catalog order (theaterList() from effects/index.js, ). When active it
// paints the whole viewport black, shows a title + the current effect's name and
// id/type, an index indicator, and runs the current effect's stateless demo each
// frame with an increasing elapsed time `t`.
// This module is self-contained: update.js / render.js / debug.js only CALL into
// it (open/close/step/update/draw). It never touches the effect engine's core
// lifecycle (fire/update/draw/reset) directly — it just invokes the demos, which
// internally reuse the engine's own record/render path.
// Pure + deterministic: no Math.random, no DOM. The demo clock (`clock`) is the
// single piece of mutable state; it advances in update(dt) while active and
// restarts at 0 on open() and step(). Node-testable without a canvas (draw takes
// a ctx stub).

import { theaterList, makeDemo } from './theater-scenes.js';
import { resetEffects, DEMO_VIEW } from '../effects/index.js';
import { particles } from '../effects/particles.js';
import { navLabelString, navLabels, input } from '../core/input.js';
import { EFFECT_META } from './theater-meta.js';

// Built once at import: the catalog is static for the life of the process.
const list = theaterList();

// --- Param tweaking (Attack-Theater-style controls) --------------------------
// Held-control repeat cadence in FIXED STEPS (60Hz): first press fires
// immediately, then a short pause, then a steady tick — same feel as the
// Attack Theater's _repeat(). Frame-counting keeps the cadence even under
// the fixed-step accumulator.
const REPEAT_DELAY_FRAMES = 13; // ~217ms before the first auto-repeat
const REPEAT_FRAMES = 5;        // ~83ms between repeats while held

/** Per-param nudge step for numeric values (sensible defaults per key name). */
const STEP_BY_KEY = {
  duration: 0.1, buildTime: 0.1, gapTime: 0.1, blinkTime: 0.1, timeToTarget: 0.1,
  radius: 4, minRadius: 4, maxRadius: 4, size: 2, width: 4, length: 20, height: 4,
  x: 8, y: 8, offset: 4, count: 1, fragmentCount: 2, particleCount: 2, explosionCount: 1,
  speed: 20, velocity: 20, expansionSpeed: 20, fallSpeed: 20, descentSpeed: 20,
  intensity: 0.5, strength: 0.1, opacity: 0.05, amount: 0.5, scale: 0.05,
  pulseRate: 0.5, rotationSpeed: 0.5, sweepSpeed: 0.5, spinSpeed: 0.5,
  tickRate: 1, spawnInterval: 0.05, lifetime: 0.1, fadeIn: 0.05, fadeOut: 0.05,
  holdTime: 0.05, flashInTime: 0.05, fadeOutTime: 0.05, angle: 5 * Math.PI / 180,
};
const DEFAULT_STEP = 0.1;

/** Current config-params of the selected effect (EFFECT_META order). */
function configParams() {
  const meta = EFFECT_META[list[Theater.index]?.type];
  return (meta?.params ?? []).filter((p) => p.config);
}

/** Live param object for the selected effect: CATALOG entry + saved tweaks. */
function liveParams() {
  const entry = list[Theater.index];
  if (!entry) return null;
  return { ...entry.params, ...(Theater.tweaks[entry.type] ?? {}) };
}

/** Nudge the selected param by dir (-1/1). Booleans toggle; numbers step. */
function adjustParam(dir) {
  const cps = configParams();
  if (!cps.length) return;
  const p = cps[Theater.paramIndex % cps.length];
  const params = liveParams();
  if (!params) return;
  const cur = params[p.key];
  let next;
  if (typeof cur === 'boolean') {
    next = !cur;
  } else if (typeof cur === 'number') {
    const step = (STEP_BY_KEY[p.key] ?? DEFAULT_STEP) * dir;
    next = Math.round((cur + step) * 1000) / 1000;
  } else {
    return; // unsupported kind (string enums etc.) — leave alone
  }
  const type = list[Theater.index].type;
  Theater.tweaks[type] = { ...(Theater.tweaks[type] ?? {}), [p.key]: next };
  // Replay so the change is visible immediately (demos re-fire from params).
  Theater.clock = -0.5;
}

/**
 * PURE INPUT-MAPPING adjust buttons: the user's OWN mapped keys — lockDir
 * (default I) decreases, lockMove (default O) increases — plus L2/R2 on the
 * pad. No hardcoded letters: remapping I/O in Controls follows automatically
 * (same pattern as mappingAdjust() in attack-theater.js).
 */
function mappingAdjust() {
  let l2 = false, r2 = false;
  try {
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      if (pad.buttons[6]?.pressed || (pad.buttons[6]?.value ?? 0) > 0.5) l2 = true;
      if (pad.buttons[7]?.pressed || (pad.buttons[7]?.value ?? 0) > 0.5) r2 = true;
    }
  } catch { /* no gamepad API (node tests) */ }
  let down = l2, up = r2;
  const inp = typeof input !== 'undefined' ? input : null;
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
    const gp = inp.mapping?.gamepad ?? {};
    for (const b of gp.lockDir ?? []) if (pressed.has(`g:${b}`) || held.get(`g:${b}`)) down = true;
    for (const b of gp.lockMove ?? []) if (pressed.has(`g:${b}`) || held.get(`g:${b}`)) up = true;
  }
  return { down, up };
}

/** Keyboard arrow/WASD held state (per-frame poll; keydown edges are ignored).
 *  `heldKeys` is a getter on the live engine, so it's read through an optional
 *  call — tests stub it with `input.heldKeys = () => [...]`. */
function keyboardDir() {
  const inp = typeof input !== 'undefined' ? input : null;
  if (!inp) return { x: 0, y: 0 };
  let raw = inp.heldKeys;
  if (typeof raw === 'function') { try { raw = raw.call(inp) ?? []; } catch { raw = []; } }
  const held = new Set(raw ?? []);
  const left = held.has('ArrowLeft') || held.has('KeyA');
  const right = held.has('ArrowRight') || held.has('KeyD');
  const up = held.has('ArrowUp') || held.has('KeyW');
  const down = held.has('ArrowDown') || held.has('KeyS');
  return {
    x: left && !right ? -1 : right && !left ? 1 : 0,
    y: up && !down ? -1 : down && !up ? 1 : 0,
  };
}

export const Theater = {
  active: false,
  index: 0,
  // Elapsed time within the current effect's demo (seconds). Stateless demos
  // re-fire fresh at t=0 and advance to `t`, so this is the only clock needed.
  // Negative = pre-roll delay before the demo starts (gives the eye a beat).
  clock: -0.5,
  // Param tweaking state: per-effect saved overrides + selected param index.
  tweaks: {},
  paramIndex: 0,
  _rep: {},           // held-control repeater state per channel

  /** Number of previewable effects (== theaterList().length). */
  get count() { return list.length; },

  /** The currently-selected entry ({ type, name, demo }). */
  current() { return list[this.index]; },

  /** Open the theater: activate, reset to the first effect, restart the clock.
   *  Also clears any in-flight engine instances so a mid-flight gameplay effect
   *  (e.g. a live camera-shake) doesn't linger behind the black overlay. */
  open() {
    this.active = true;
    this.index = 0;
    this.clock = -0.5;
    resetEffects(); // clean slate: no real-gameplay instances under the overlay
  },

  /** Close the theater (return to normal debug mode). Clears any demo instance
   *  left in the shared engine by the last demo so it doesn't leak into
   *  gameplay on resume (a lingering camera-shake/vignette/flash would otherwise
   *  show for one frame after the overlay lifts). */
  close() {
    this.active = false;
    resetEffects(); // drop the last demo's instances before gameplay resumes
    particles.reset(); // clear any demo particles so they don't leak into gameplay
  },

  /**
   * Step to the previous (-1) or next (+1) effect, wrapping around at both ends.
   * Restarts the demo clock so the new effect plays from t=0.
   * @param {-1|1} dir -1 = prev, +1 = next
   */
  step(dir) {
    if (!this.active) return;
    this.index = (this.index + dir + list.length) % list.length;
    this.clock = -0.5;
    this.paramIndex = 0; // fresh param selection per effect
  },

  /** Advance the demo clock by dt seconds. No-op when inactive. */
  update(dt) {
    if (this.active) this.clock += dt;
  },

  /** Per-frame input poll (fixed-step driven, like AttackTheater.updateGamepad).
   *  ←/→ select effect · ↑/↓ select param · I/O (mapped lockDir/lockMove) or
   *  L2/R2 nudge the selected param. Held controls repeat on the standard
   *  cadence. Call once per frame while active. */
  updateControls() {
    if (!this.active) return;
    const kb = keyboardDir();
    const padX = (() => { try { return input?.state?.moveX ?? 0; } catch { return 0; } })();
    const selX = kb.x !== 0 ? kb.x : (padX < -0.2 ? -1 : padX > 0.2 ? 1 : 0);
    const selY = kb.y;
    this._repeat('select', selX, () => { this.step(selX); });
    this._repeat('param', selY, () => {
      const n = configParams().length;
      if (n) this.paramIndex = (this.paramIndex + selY + n) % n;
    });
    const adj = mappingAdjust();
    const adjDir = adj.down && !adj.up ? -1 : adj.up && !adj.down ? 1 : 0;
    this._repeat('adjust', adjDir, () => adjustParam(adjDir));
  },

  /** Fixed-interval repeater for held controls (same contract as the Attack
   *  Theater's _repeat): first press fires immediately; holding re-fires every
   *  REPEAT_FRAMES after a REPEAT_DELAY_FRAMES pause. */
  _repeat(channel, dirNow, fire) {
    const st = this._rep[channel] ?? (this._rep[channel] = { dir: 0, count: 0 });
    if (dirNow === 0) { st.dir = 0; st.count = 0; return; }
    if (st.dir !== dirNow) {
      st.dir = dirNow;
      st.count = REPEAT_DELAY_FRAMES;
      fire();
      return;
    }
    st.count--;
    if (st.count <= 0) {
      st.count = REPEAT_FRAMES;
      fire();
    }
  },

  /** Replay the current demo from t=0 (Enter / gamepad A — existing behavior). */
  replay() {
    if (this.active) this.clock = -0.5;
  },

  /**
   * Draw the black-screen theater overlay. Must be called LAST (on top of all
   * game + debug HUD rendering) so the black fill covers everything. No-op when
   * inactive.
   * @param {object} ctx CanvasRenderingContext2D
   * @param {number} w viewport width (VIEW_W)
   * @param {number} h viewport height (VIEW_H)
   */
  draw(ctx, w, h) {
    if (!this.active) return;
    const entry = list[this.index];
    const meta = EFFECT_META[entry.type];
    ctx.save();

    // 1. Fill the entire viewport black.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // Layout: demo area on left/center, info panel on right (~240px)
    const panelW = 240;
    const panelX = w - panelW;
    const demoW = panelX - 20;

    // 2. Title at top center of demo area.
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('EFFECT THEATER', demoW / 2, 44);

    // 3. Current effect name (large) + section number.
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#7df';
    ctx.fillText(`${entry.section}. ${entry.name}`, demoW / 2, 96);

    // 4. Index indicator.
    ctx.font = '14px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText(`${this.index + 1} / ${list.length}`, demoW / 2, h - 40);

    // 5. Run the current demo (centered in demo area) with live params
    //    (catalog defaults + saved tweaks). makeDemo re-wraps per call — cheap.
    ctx.save();
    ctx.translate((demoW - DEMO_VIEW.w) / 2, (h - DEMO_VIEW.h) / 2);
    const live = { ...entry, params: liveParams() };
    makeDemo(live)(ctx, this.clock);
    ctx.restore();

    // 6. Right info panel.
    if (meta) {
      ctx.save();
      // Panel background
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(panelX, 60, panelW - 10, h - 100);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.strokeRect(panelX, 60, panelW - 10, h - 100);

      let py = 80;
      ctx.textAlign = 'left';

      // Description
      ctx.font = '12px monospace';
      ctx.fillStyle = '#aaa';
      const words = meta.desc.split(' ');
      let line = '';
      for (const word of words) {
        if ((line + word).length > 32) {
          ctx.fillText(line, panelX + 12, py);
          py += 16;
          line = word + ' ';
        } else {
          line += word + ' ';
        }
      }
      if (line) { ctx.fillText(line.trim(), panelX + 12, py); py += 16; }
      py += 12;

      // Params header
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#7df';
      ctx.fillText('PARAMS', panelX + 12, py);
      const adjLabels = [...navLabels('lockDir', { simple: true }), ...navLabels('lockMove', { simple: true })].join('/');
      ctx.fillStyle = '#555';
      ctx.font = '9px monospace';
      ctx.fillText(`(▲▼ select · ${adjLabels}/L2R2 adjust)`, panelX + 60, py);
      py += 18;

      // Param list (config params get a value + selection marker)
      ctx.font = '11px monospace';
      const cps = configParams();
      let cIdx = -1;
      for (const p of meta.params) {
        const isSel = p.config && cps[++cIdx] === p && Theater.paramIndex % Math.max(1, cps.length) === cIdx;
        const icon = p.config ? (isSel ? '▶' : '✅') : '❌';
        ctx.fillStyle = isSel ? '#ff0' : (p.config ? '#ccc' : '#666');
        let line = `${icon} ${p.key}`;
        if (p.config) {
          const v = liveParams()?.[p.key];
          if (v !== undefined) line += ` = ${typeof v === 'number' ? (Math.round(v * 1000) / 1000) : String(v)}`;
        }
        ctx.fillText(line, panelX + 12, py);
        ctx.fillStyle = '#666';
        ctx.fillText(`   ${p.desc}`, panelX + 12, py + 12);
        py += 26;
        if (py > h - 60) break; // don't overflow into hint bar
      }
      ctx.restore();
    }

    // 7. Hint text at bottom (dynamic labels from input API).
    const stepIcons = [...navLabels('left', { simple: true }), ...navLabels('right', { simple: true })].join('/');
    const confirmLabel = navLabelString('confirm');
    const backLabel = navLabelString('back');
    const adjHint = [...navLabels('lockDir', { simple: true }), ...navLabels('lockMove', { simple: true })].join('/');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#666';
    ctx.font = '12px monospace';
    ctx.fillText(`${stepIcons} effect   ▲▼ param   [${adjHint}/L2R2] adjust   [${confirmLabel}] replay   [${backLabel}] close   F2 toggle`, demoW / 2, h - 16);

    ctx.restore();
  },
};
