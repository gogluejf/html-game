// Shared Theater Engine — ONE backbone for Effect Theater (F2) and Attack Theater (F4).
// Both theaters share: open/close/step/replay, input routing (arrows/WASD/gamepad),
// param selection + adjust with repeat cadence, draw layout (black fill, title, demo
// area, right panel, hint bar), and the Escape/confirm nav contract.
//
// Content providers implement a small interface:
//   { id, title, entries[], currentMeta(), liveParams(), drawDemo(ctx,w,h,t), onStep?, onReplay? }
//
// This module exports `createTheater(provider)` which returns a fully-wired
// theater object with the standard API: active, index, paramIndex, open, close,
// step, replay, update(dt), updateControls, draw(ctx,w,h).

import { navLabelString, navLabels, input } from '../core/input.js';

// --- Repeat cadence (fixed-step 60Hz) ----------------------------------------
const REPEAT_DELAY_FRAMES = 13; // ~217ms before first auto-repeat
const REPEAT_FRAMES = 5;        // ~83ms between repeats while held

/** Keyboard arrow/WASD held state. */
function keyboardDir() {
  let raw = input?.heldKeys;
  if (typeof raw === 'function') { try { raw = raw.call(input) ?? []; } catch { raw = []; } }
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

/** Mapped adjust buttons: lockDir (default I) = decrease, lockMove (default O) = increase. */
function mappingAdjust() {
  let l2 = false, r2 = false;
  try {
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      if (pad.buttons[6]?.pressed || (pad.buttons[6]?.value ?? 0) > 0.5) l2 = true;
      if (pad.buttons[7]?.pressed || (pad.buttons[7]?.value ?? 0) > 0.5) r2 = true;
    }
  } catch { /* no gamepad API */ }
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

/**
 * Create a wired theater from a content provider.
 * @param {object} provider
 * @param {string} provider.id - unique identifier ('effect' | 'attack')
 * @param {string} provider.title - display title ("EFFECT THEATER")
 * @param {Function} provider.entries - () => array of entry objects
 * @param {Function} provider.currentMeta - (index) => { name, desc, params: [{key, config, desc}] }
 * @param {Function} provider.liveParams - (index) => flat param object
 * @param {Function} provider.drawDemo - (ctx, w, h, t, index) => void
 * @param {Function} [provider.onOpen] - called after active=true
 * @param {Function} [provider.onClose] - called after active=false
 * @param {Function} [provider.onStep] - (newIndex) called after step
 * @param {Function} [provider.onReplay] - called on replay
 * @param {Function} [provider.adjustParam] - (dir, key, currentVal) => newVal; override default stepping
 * @param {number} [provider.panelW] - right panel width (default 260)
 * @param {string} [provider.toggleKey] - "F2" or "F4" for hint text
 * @param {string} [provider.stamp] - version stamp string
 */
export function createTheater(provider) {
  const panelW = provider.panelW ?? 260;
  const _rep = {};

  /** Fixed-interval repeater. */
  function repeat(channel, dirNow, fire) {
    const st = _rep[channel] ?? (_rep[channel] = { dir: 0, count: 0 });
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
  }

  const theater = {
    active: false,
    index: 0,
    paramIndex: 0,
    _rep,

    get count() { return provider.entries().length; },

    open() {
      this.active = true;
      this.index = 0;
      this.paramIndex = 0;
      Object.keys(_rep).forEach(k => delete _rep[k]);
      provider.onOpen?.();
    },

    close() {
      this.active = false;
      provider.onClose?.();
    },

    step(dir) {
      if (!this.active) return;
      const n = this.count;
      if (!n) return;
      this.index = (this.index + dir + n) % n;
      this.paramIndex = 0;
      provider.onStep?.(this.index);
    },

    replay() {
      if (!this.active) return;
      provider.onReplay?.();
    },

    /** Per-frame tick (advance internal clock / sandbox). */
    update(dt) {
      if (!this.active) return;
      provider.onTick?.(dt, this);
    },

    /** Per-frame input poll: select / param / adjust with repeat. */
    updateControls() {
      if (!this.active) return;
      const kb = keyboardDir();
      const padX = (() => { try { return input?.state?.moveX ?? 0; } catch { return 0; } })();
      const selX = kb.x !== 0 ? kb.x : (padX < -0.2 ? -1 : padX > 0.2 ? 1 : 0);
      const selY = kb.y;
      repeat('select', selX, () => { this.step(selX); });
      repeat('param', selY, () => {
        const meta = provider.currentMeta(this.index);
        const cps = (meta?.params ?? []).filter(p => p.config);
        if (cps.length) this.paramIndex = (this.paramIndex + selY + cps.length) % cps.length;
      });
      const adj = mappingAdjust();
      const adjDir = adj.down && !adj.up ? -1 : adj.up && !adj.down ? 1 : 0;
      repeat('adjust', adjDir, () => {
        const meta = provider.currentMeta(this.index);
        const cps = (meta?.params ?? []).filter(p => p.config);
        if (!cps.length) return;
        const p = cps[this.paramIndex % cps.length];
        const params = provider.liveParams(this.index);
        if (!params) return;
        const cur = params[p.key];
        let next;
        if (provider.adjustParam) {
          next = provider.adjustParam(adjDir, p.key, cur);
        } else if (typeof cur === 'boolean') {
          next = !cur;
        } else if (typeof cur === 'number') {
          const step = (provider.stepByKey?.[p.key] ?? 0.1) * adjDir;
          next = Math.round((cur + step) * 1000) / 1000;
        } else {
          return;
        }
        if (next !== undefined) {
          provider.setParam?.(this.index, p.key, next);
        }
      });
    },

    /** Draw the full overlay: black fill, title, demo, panel, hints. */
    draw(ctx, w, h) {
      if (!this.active) return;
      ctx.save();

      // 1. Black fill.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);

      const panelX = w - panelW;
      const demoW = panelX - 20;

      // 2. Title + stamp.
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px monospace';
      ctx.fillText(provider.title, demoW / 2, 44);
      if (provider.stamp) {
        ctx.font = '10px monospace';
        ctx.fillStyle = '#555';
        ctx.fillText(provider.stamp, w - panelW + (panelW - 10) / 2, 20);
      }

      // 3. Current entry name.
      const meta = provider.currentMeta(this.index);
      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = '#7df';
      ctx.fillText(meta?.name ?? '(none)', demoW / 2, 92);

      // 4. Index indicator.
      ctx.font = '14px monospace';
      ctx.fillStyle = '#888';
      ctx.fillText(`${this.index + 1} / ${this.count}`, demoW / 2, h - 40);

      // 5. Demo area (provider draws its own content).
      provider.drawDemo(ctx, demoW, h, this);

      // 6. Right info panel.
      if (meta) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(panelX, 60, panelW - 10, h - 100);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(panelX, 60, panelW - 10, h - 100);

        let py = 80;
        ctx.textAlign = 'left';

        // Description (word-wrap at ~32 chars).
        ctx.font = '12px monospace';
        ctx.fillStyle = '#aaa';
        const words = (meta.desc ?? '').split(' ');
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

        // Params header.
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#7df';
        ctx.fillText('PARAMS', panelX + 12, py);
        const adjLabels = [...navLabels('lockDir', { simple: true }), ...navLabels('lockMove', { simple: true })].join('/');
        ctx.fillStyle = '#555';
        ctx.font = '9px monospace';
        ctx.fillText(`(▲▼ select · ${adjLabels}/L2R2 adjust)`, panelX + 60, py);
        py += 18;

        // Param list.
        ctx.font = '11px monospace';
        const cps = (meta.params ?? []).filter(p => p.config);
        let cIdx = -1;
        for (const p of meta.params ?? []) {
          const isSel = p.config && cps[++cIdx] === p && this.paramIndex % Math.max(1, cps.length) === cIdx;
          const icon = p.config ? (isSel ? '▶' : '✅') : '❌';
          ctx.fillStyle = isSel ? '#ff0' : (p.config ? '#ccc' : '#666');
          let line = `${icon} ${p.key}`;
          if (p.config) {
            const v = provider.liveParams(this.index)?.[p.key];
            if (v !== undefined) line += ` = ${typeof v === 'number' ? (Math.round(v * 1000) / 1000) : String(v)}`;
          }
          ctx.fillText(line, panelX + 12, py);
          ctx.fillStyle = '#666';
          ctx.fillText(`   ${p.desc ?? ''}`, panelX + 12, py + 12);
          py += 26;
          if (py > h - 60) break;
        }
        ctx.restore();
      }

      // 7. Hint bar.
      const stepIcons = [...navLabels('left', { simple: true }), ...navLabels('right', { simple: true })].join('/');
      const confirmLabel = navLabelString('confirm');
      const backLabel = navLabelString('back');
      const adjHint = [...navLabels('lockDir', { simple: true }), ...navLabels('lockMove', { simple: true })].join('/');
      const toggleKey = provider.toggleKey ?? 'F2';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#666';
      ctx.font = '12px monospace';
      ctx.fillText(
        `${stepIcons} select   ▲▼ param   [${adjHint}/L2R2] adjust   [${confirmLabel}] replay   [${backLabel}] close   ${toggleKey} toggle`,
        demoW / 2, h - 16
      );

      ctx.restore();
    },
  };

  return theater;
}
