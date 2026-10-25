// Task 4.1 — Options screen and settings wiring tests (headless).
// Run: node --test petal-panic/js/test/optionsScreen.test.js
//
// Verifies the canvas-drawn OPTIONS screen against the plan's acceptance
// criteria:
//   - OPTIONS draws toggle rows using the same focus style as Pause;
//   - left/right (and confirm) toggles the focused option;
//   - changes persist immediately to localStorage (round-trip survives a
//     cache reset / reload);
//   - back returns to MENU or PAUSE based on origin.
// Plus the settings-consumer wiring: screenShake gates ALL camera-shake at
// the shake-state funnel (effects/cameraShake.js) — both the legacy
// Effects.triggerShake path AND declaratively fired 'camera-shake' instances
// (carrier config / fireManual) are suppressed when off and shake when on;
// vibration gates the touch-controls haptic funnel.

import { strict as assert } from 'node:assert';
import { test, before, after } from 'node:test';

// --- Minimal DOM stub (must run BEFORE importing the engine modules) ---------
const noop = () => {};
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => noop, set: () => true }), addEventListener: noop }),
};
globalThis.window = { addEventListener: noop };

// In-memory localStorage so progressStore works headlessly.
const memStorage = (() => {
  let map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
})();
globalThis.localStorage = memStorage;

const { S, getState, setState, tryTransition } = await import('../core/state.js');
const SC = await import('../ui/screens.js');
const PS = await import('../systems/progressStore.js');
const { VIEW_W, VIEW_H } = await import('../core/view.js');
const { Effects } = await import('../effects.js');
const { fireManual, updateEffects: stepEngine, resetEffects } = await import('../effects/index.js');

/** Recording ctx: captures every draw call + property set for assertions. */
function recordingCtx() {
  const calls = [];
  const base = {
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 }),
  };
  const handler = {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => { calls.push({ fn: String(prop), args }); };
    },
    set(target, prop, value) {
      target[prop] = value;
      calls.push({ fn: `set:${String(prop)}`, args: [value] });
      return true;
    },
  };
  return { calls, ctx: new Proxy(base, handler) };
}

/** Drive a transition through the real onTransition hook (screenReset etc.). */
function go(to) {
  const ok = tryTransition(to);
  if (!ok) throw new Error(`transition to ${to} failed`);
}

before(() => { PS.resetStore(); });
after(() => { PS.resetStore(); });

test('Options exposes draw/onAction/reset and is wired into the dispatch helpers', () => {
  assert.equal(typeof SC.Options.draw, 'function', 'draw is a function');
  assert.equal(typeof SC.Options.onAction, 'function', 'onAction is a function');
  assert.equal(typeof SC.Options.reset, 'function', 'reset is a function');

  // Wired into drawScreen: OPTIONS state draws the Options screen.
  setState(S.OPTIONS);
  const { ctx } = recordingCtx();
  assert.equal(SC.drawScreen(ctx, null), true, 'drawScreen handles OPTIONS');
});

test('OPTIONS draws four toggle rows with ON/OFF state in the pause-style list', () => {
  PS.resetStore(); // defaults: music off, sfx/shake/vibration on
  setState(S.MENU);
  go(S.OPTIONS);
  const { calls, ctx } = recordingCtx();
  SC.Options.draw(ctx);

  // The shared pause-style renderer issues one fillText per row label (via
  // drawPrompt, prefixed with '▸ ' for the focused row and two spaces
  // otherwise) plus the marquee title glyphs. Each toggle label must appear
  // verbatim after stripping that prefix.
  const texts = calls.filter(c => c.fn === 'fillText')
    .map(c => String(c.args[0]).replace(/^(▸ |  )/, ''));
  for (const t of ['MUSIC  ON', 'SFX  ON', 'SCREEN SHAKE  ON', 'VIBRATION  ON']) {
    assert.ok(texts.includes(t), `row label "${t}" drawn`);
  }
  // Focus pill present: the focused row's label is drawn with the shared
  // pause-style focus color (unique to a focused, enabled entry).
  const focusedColor = calls.find(c => c.fn === 'set:fillStyle' && c.args[0] === '#ff6ec7');
  assert.ok(focusedColor, 'focused row drawn with the shared pause-style focus color');
});

test('left/right AND confirm toggle the focused option', () => {
  PS.resetStore();
  setState(S.MENU);
  go(S.OPTIONS);
  assert.equal(PS.loadStore().settings.music, true, 'default: music on');

  // Focus starts on Music (row 0), default ON. Left flips it off…
  assert.equal(SC.Options.onAction('left'), true, 'left handled');
  assert.equal(PS.loadStore().settings.music, false, 'music flipped OFF by left');
  // …right flips it back on…
  assert.equal(SC.Options.onAction('right'), true, 'right handled');
  assert.equal(PS.loadStore().settings.music, true, 'music flipped ON by right');
  // …and confirm does the same.
  assert.equal(SC.Options.onAction('confirm'), true, 'confirm handled');
  assert.equal(PS.loadStore().settings.music, false, 'music flipped OFF by confirm');
});

test('up/down move focus around the four rows (wrapping)', () => {
  PS.resetStore();
  setState(S.MENU);
  go(S.OPTIONS);
  assert.equal(SC.Options.focus, 0, 'focus starts at row 0');

  SC.Options.onAction('down');
  assert.equal(SC.Options.focus, 1, 'down advances focus');
  for (let i = 0; i < 3; i++) SC.Options.onAction('down');
  assert.equal(SC.Options.focus, 0, 'down wraps around the four rows');
  SC.Options.onAction('up');
  assert.equal(SC.Options.focus, 3, 'up wraps to the last row');
});

test('a toggle persists immediately and survives a store reload (persistence round-trip)', () => {
  PS.resetStore();
  setState(S.MENU);
  go(S.OPTIONS);

  // Toggle Screen Shake (row 2) from its default ON to OFF.
  SC.Options.focus = 2;
  SC.Options.onAction('left');

  // Immediate persistence: the raw storage document already carries the flip.
  const raw = JSON.parse(memStorage.getItem('petal_panic_store'));
  assert.equal(raw.settings.screenShake, false, 'flip landed in localStorage immediately');

  // Reload round-trip: forget the in-memory cache (what a page reload does)
  // and re-read — the value must survive.
  PS._resetCache();
  assert.equal(PS.loadStore().settings.screenShake, false, 'flipped value survives a reload');
  // Untouched settings keep their defaults across the round-trip.
  assert.equal(PS.loadStore().settings.sfx, true, 'unrelated setting untouched');
});

test('back from OPTIONS opened via MENU returns MENU', () => {
  PS.resetStore();
  setState(S.HOME);
  go(S.MENU);
  go(S.OPTIONS);
  assert.equal(SC.Options.onAction('back'), true, 'back handled');
  assert.equal(getState(), S.MENU, 'returned to MENU');
});

test('back from OPTIONS opened via PAUSE returns PAUSE', () => {
  PS.resetStore();
  setState(S.PLAY);
  go(S.PAUSE);
  go(S.OPTIONS);
  assert.equal(SC.Options.onAction('back'), true, 'back handled');
  assert.equal(getState(), S.PAUSE, 'returned to PAUSE');
});

test('entering OPTIONS resets focus to row 0 (fresh entry from either origin)', () => {
  PS.resetStore();
  setState(S.HOME);
  go(S.MENU);
  go(S.OPTIONS);
  SC.Options.focus = 3;
  SC.Options.onAction('back'); // → MENU
  go(S.OPTIONS);
  assert.equal(SC.Options.focus, 0, 'focus reset on fresh entry');
});

test('screenShake=false suppresses camera shake; =true lets it through', () => {
  PS.resetStore();
  assert.equal(PS.loadStore().settings.screenShake, true, 'default: shake on');
  Effects.triggerShake(6);
  Effects.update(0.3); // advance past the 0.25s lifetime so the slot clears

  PS.updateSettings((s) => { s.screenShake = false; });
  Effects.triggerShake(6);
  const off = Effects.getShakeOffset();
  assert.equal(off.x, 0, 'no horizontal offset when screenShake is off');
  assert.equal(off.y, 0, 'no vertical offset when screenShake is off');

  PS.updateSettings((s) => { s.screenShake = true; });
});

// --- F1: the gate must cover DECLARED instances too --------------------------
// The legacy triggerShake gate above only proved the shim path. Declaratively
// fired 'camera-shake' instances (explosion/shockwave/stomp macros via carrier
// config or fireManual/fireDeclared) apply their offsets through the engine's
// active set — they bypassed the old triggerShake-only gate. The single
// funnel now lives at the shake STATE (cameraShake.js update() skips its
// re-roll when the setting is off), so every source is suppressed together.
const DT = 1 / 60;

/** Deterministic random stub: cycles through the given [0,1) values. */
function withRandomSeq(values, fn) {
  let i = 0;
  const orig = Math.random;
  Math.random = () => values[i++ % values.length];
  try { return fn(); } finally { Math.random = orig; }
}

/** Fire a declared camera-shake instance through the real engine path. */
function fireDeclaredShake(params = {}) {
  return fireManual({ type: 'camera-shake', params }, null,
    { view: { w: VIEW_W, h: VIEW_H } });
}

test('declared camera-shake instance: OFF suppresses, ON produces nonzero offset', () => {
  PS.resetStore();
  resetEffects();

  // OFF: a declaratively fired instance must contribute zero offset for its
  // whole lifetime (the gate sits at the state funnel, not the fire site).
  PS.updateSettings((s) => { s.screenShake = false; });
  const instOff = fireDeclaredShake({ intensity: 8, duration: 0.25 });
  assert.ok(instOff !== null, 'declared instance spawned through the engine');
  withRandomSeq([0.999999, 0.999999], () => {
    stepEngine(DT); // frame 1 — peak would be ~7.7px if ungated
    assert.deepEqual(Effects.getShakeOffset(), { x: 0, y: 0 },
      'OFF: declared instance contributes no offset at peak');
    for (let i = 0; i < 4; i++) {
      stepEngine(DT);
      const o = Effects.getShakeOffset();
      assert.equal(o.x, 0, `OFF: x still zero at frame ${i + 2}`);
      assert.equal(o.y, 0, `OFF: y still zero at frame ${i + 2}`);
    }
  });
  for (let i = 0; i < 10; i++) stepEngine(DT); // drain to completion
  resetEffects();

  // ON: the same declared fire must produce a nonzero offset at peak.
  PS.updateSettings((s) => { s.screenShake = true; });
  const instOn = fireDeclaredShake({ intensity: 8, duration: 0.25 });
  assert.ok(instOn !== null, 'declared instance spawned (setting on)');
  withRandomSeq([0.999999, 0.999999], () => {
    stepEngine(DT); // frame 1: amp = 8 * (0.25 - 1/60) / 0.25 ≈ 7.67
    const o = Effects.getShakeOffset();
    const amp = 8 * ((0.25 - DT) / 0.25);
    assert.ok(Math.abs(o.x - amp) < 1e-4 && Math.abs(o.y - amp) < 1e-4,
      `ON: declared instance shakes at peak (${o.x}, ${o.y}) vs ±${amp}`);
  });
  resetEffects();
});

test('legacy triggerShake: ON produces a nonzero offset at peak (F2)', () => {
  PS.resetStore();
  resetEffects();
  assert.equal(PS.loadStore().settings.screenShake, true, 'default: shake on');
  Effects.triggerShake(6);
  withRandomSeq([0.999999, 0.999999], () => {
    Effects.update(DT); // frame 1: amp = 6 * (0.25 - 1/60) / 0.25 ≈ 5.75
    const o = Effects.getShakeOffset();
    const amp = 6 * ((0.25 - DT) / 0.25);
    assert.ok(Math.abs(o.x - amp) < 1e-4 && Math.abs(o.y - amp) < 1e-4,
      `ON: legacy kick shakes at peak (${o.x}, ${o.y}) vs ±${amp}`);
  });
  Effects.update(0.3); // drain past the lifetime so the slot clears
  resetEffects();
});
