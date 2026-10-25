// Task 5.2 — Media screen + playback overlay tests (headless).
// Run: node --test petal-panic/js/test/mediaScreen.test.js
//
// Verifies the plan §5.2 acceptance criteria against the canvas-drawn
// MEDIA screen and its model (mediaModel.js, task 5.1):
//   - MEDIA draws all 10 media cards using the same card/focus style as
//     Level Select / Boss Rush;
//   - locked media shows no preview image and an unlock requirement on the right;
//   - unlocked media can open a playback overlay;
//   - back closes playback first, then returns to MENU.

import { strict as assert } from 'node:assert';
import { test, before, after } from 'node:test';

// --- Minimal DOM stub (must run BEFORE importing the engine modules) ---------
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, addEventListener: noop }),
};
globalThis.window = { addEventListener: noop };

// Image stub for the clip art cache (screens.js constructs `new Image()`
// lazily; node has no DOM Image — an incomplete image drives the placeholder
// path, which is what these tests assert against).
class FakeImage {
  constructor() { this.complete = false; this.naturalWidth = 0; this.src = ''; }
}
globalThis.Image = FakeImage;

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
const { buildMediaCards, levelBgPath } = await import('../ui/mediaModel.js');

/** Drive a transition through the real onTransition hook (screenReset etc.). */
function go(to) {
  const ok = tryTransition(to);
  if (!ok) throw new Error(`transition to ${to} failed`);
}

/** Record canvas draw calls so geometry can be asserted headlessly. */
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

/** fillText strings drawn by a call list (drawPrompt's drop-shadow repeats
 * each string, so callers use includes/counts rather than exact totals). */
function textsOf(calls) {
  return calls.filter(c => c.fn === 'fillText').map(c => c.args[0]);
}

before(() => { PS.resetStore(); });
after(() => { PS.resetStore(); });

// --- Screen wiring -------------------------------------------------------------

test('Media exposes draw/onAction/reset and is wired into the dispatch helpers', () => {
  assert.equal(typeof SC.Media.draw, 'function', 'draw is a function');
  assert.equal(typeof SC.Media.onAction, 'function', 'onAction is a function');
  assert.equal(typeof SC.Media.reset, 'function', 'reset is a function');

  // drawScreen routes MEDIA to Media.draw.
  setState(S.MEDIA);
  const { calls, ctx } = recordingCtx();
  assert.equal(SC.drawScreen(ctx), true, 'drawScreen handles MEDIA');
  assert.ok(calls.length > 0, 'Media.draw issued canvas calls');

  // screenOnAction routes actions to Media.onAction.
  assert.equal(SC.screenOnAction('left'), true, 'left handled');
  assert.equal(SC.screenOnAction('right'), true, 'right handled');
  assert.equal(SC.screenOnAction('up'), true, 'up handled');
  assert.equal(SC.screenOnAction('down'), true, 'down handled');

  // Fresh entry resets focus + closes any open playback overlay.
  SC.Media.focus = 3;
  SC.Media.playing = 'intro';
  SC.screenReset(S.MEDIA, S.MENU);
  assert.equal(SC.Media.focus, 0, 'focus reset on fresh entry');
  assert.equal(SC.Media.playing, null, 'playback closed on fresh entry');
});

// --- Grid drawing ----------------------------------------------------------------

test('draws all 10 media cards within the 960x540 viewport', () => {
  PS.resetStore();
  setState(S.MEDIA);
  const { calls, ctx } = recordingCtx();
  SC.Media.draw(ctx);

  // Each locked card draws a silhouette disc: arc(cx, cy, r=47, 0..2PI).
  // On fresh progress all 10 are locked, so all 10 hit.
  const discs = calls.filter(c => c.fn === 'arc' && c.args[2] === 38 && c.args[3] === 0 && Math.abs(c.args[4] - Math.PI * 2) < 1e-9);
  assert.equal(discs.length, 10, 'ten card discs drawn (fresh progress: all locked)');
  for (const c of discs) {
    const [x, y, r] = c.args;
    assert.ok(x >= 0 && x <= VIEW_W, `card x=${x} inside viewport`);
    assert.ok(y - r >= 0 && y + r <= VIEW_H, `card y=${y} inside viewport`);
  }

  // Right-side detail card present: first arcTo corner (x+230, y) = (930, 120).
  const card = calls.find(c => c.fn === 'arcTo' && c.args[0] === 930 && c.args[1] === 120);
  assert.ok(card, 'detail card drawn on the right');
  assert.ok(card.args[0] <= VIEW_W, 'detail card fits the viewport');
});

test('locked cards render dimmed silhouettes with lock icons and NO preview image', () => {
  PS.resetStore();
  setState(S.MEDIA);
  const { calls, ctx } = recordingCtx();
  SC.Media.draw(ctx);

  // Every locked card is drawn dimmed (globalAlpha 0.45 on the silhouette).
  const dimSets = calls.filter(c => c.fn === 'set:globalAlpha' && c.args[0] === 0.45);
  assert.ok(dimSets.length >= 10, 'locked cards drawn dimmed');
  // Lock shackle arcs (PI..0 span) — at least one per locked card (10) + detail card.
  const shackleArcs = calls.filter(c => c.fn === 'arc' && c.args[3] === Math.PI && c.args[4] === 0);
  assert.ok(shackleArcs.length >= 11, 'lock icons drawn on locked cards');

  // No preview image anywhere: no drawImage calls at all on fresh progress.
  const imgDraws = calls.filter(c => c.fn === 'drawImage');
  assert.equal(imgDraws.length, 0, 'no preview images drawn while everything is locked');
});

test('focused locked card surfaces the unlock requirement on the right', () => {
  PS.resetStore();
  setState(S.MEDIA);
  SC.Media.reset(); // focus 0 → intro (locked fresh)
  const { calls, ctx } = recordingCtx();
  SC.Media.draw(ctx);
  const texts = textsOf(calls);
  assert.ok(texts.includes('Start a new game to unlock'), 'intro unlock hint drawn on the right card');
  assert.ok(texts.includes('LOCKED'), 'locked status label drawn');
});

test('unlocked level clip shows its title and clip art in grid + detail panes', () => {
  PS.updateProgress((p) => { p.mediaUnlocked.push('level-1'); });
  setState(S.MEDIA);
  SC.Media.reset();
  SC.Media.focus = 1; // level-1 card (index 1)
  const { calls, ctx } = recordingCtx();
  SC.Media.draw(ctx);

  const texts = textsOf(calls);
  assert.ok(texts.includes('Big Top Clip'), 'unlocked clip title drawn (grid card + detail card)');
  // The focused unlocked detail card presents the play hint.
  assert.ok(texts.includes('Press Confirm to watch'), 'play hint drawn on the right card');
  // Unlocked cards do NOT carry the LOCKED label.
  assert.ok(!texts.includes('LOCKED'), 'no LOCKED label when the focused card is unlocked');
  // Asset path comes from the model (bg_f1.png for level 1).
  const cards = buildMediaCards(PS.loadStore().progress);
  assert.equal(cards[1].asset, levelBgPath(1));
  assert.equal(cards[1].status, 'unlocked');
});

// --- Playback overlay ------------------------------------------------------------

test('confirm on an unlocked card opens the playback overlay', () => {
  PS.updateProgress((p) => { p.mediaUnlocked.push('level-1'); });
  setState(S.MENU);
  go(S.MEDIA);
  SC.Media.reset();
  SC.Media.focus = 1; // level-1 (unlocked)

  assert.equal(SC.screenOnAction('confirm'), true, 'confirm handled');
  assert.equal(SC.Media.playing, 'level-1', 'playback opened for the focused clip');
  assert.equal(getState(), S.MEDIA, 'still in MEDIA (in-screen overlay, no new state)');

  // The overlay renders the large view + close prompt.
  const { calls, ctx } = recordingCtx();
  SC.Media.draw(ctx);
  const texts = textsOf(calls);
  assert.ok(texts.includes('PRESS ESC TO CLOSE'), 'close prompt drawn');
  assert.ok(texts.includes('BIG TOP CLIP'), 'clip title drawn over the large view');
});

test('confirm on a locked focus is a no-op (safety net)', () => {
  PS.resetStore();
  setState(S.MENU);
  go(S.MEDIA);
  SC.Media.reset(); // focus 0 → intro (locked fresh)

  assert.equal(SC.screenOnAction('confirm'), true, 'action consumed');
  assert.equal(SC.Media.playing, null, 'no playback opened for a locked card');
  assert.equal(getState(), S.MEDIA, 'stays on MEDIA');
});

test('navigation skips locked cards (wrap-around)', () => {
  PS.updateProgress((p) => { p.mediaUnlocked.push('intro'); });
  setState(S.MENU);
  go(S.MEDIA);
  SC.Media.reset(); // focus 0 → intro (the only unlocked card)

  // Right from intro must skip all 8 locked level clips AND the locked ending,
  // wrapping back to intro — focus can only rest on playable content.
  for (let i = 0; i < 10; i++) {
    assert.equal(SC.screenOnAction('right'), true, `step ${i + 1} handled`);
    assert.equal(SC.Media.focus, 0, `step ${i + 1} stays on the only unlocked card`);
  }
  assert.equal(SC.screenOnAction('left'), true, 'left also handled');
  assert.equal(SC.Media.focus, 0, 'left stays on the only unlocked card');
});

/** A fake input engine with a controllable nav.pressed batch (same shape as
 * the G2 helper in menuScreen.test.js). Drives dispatchScreenInput so the
 * consumedGeneration flag is cleared per tick exactly like real Escape
 * presses — these unit tests never call dispatchScreenInput otherwise. */
function makeFakeEngine(pressed) {
  return {
    generation: 1,
    heldBindings: new Map(),
    pressedBindings: [],
    captureResult: null,
    nav: { pressed },
  };
}

test('back closes playback first, then returns to MENU', () => {
  PS.updateProgress((p) => { p.mediaUnlocked.push('level-1'); });
  setState(S.MENU);
  go(S.MEDIA);
  SC.Media.reset();
  SC.Media.focus = 1;
  // Open playback directly — the overlay-open path is covered by the dedicated
  // test above; this test exercises the BACK sequence.
  SC.screenOnAction('confirm');
  assert.equal(SC.Media.playing, 'level-1', 'playback opened for the focused clip');
  SC._resetConsumedGenerationForTest(); // screenOnAction set the G2 flag; clear it so the next dispatch tick starts fresh

  // First back: one physical Escape press emits ['back','pause'] in the same
  // generation. The overlay-close action consumes the whole generation, so
  // dispatchScreenInput stops the batch before the leftover 'pause' (rewritten
  // to 'confirm') can REOPEN playback. This is the exact real-input sequence.
  const handled1 = SC.dispatchScreenInput(makeFakeEngine(['back', 'pause']), null, {});
  assert.equal(SC.Media.playing, null, 'playback closed by the first back');
  assert.equal(getState(), S.MEDIA, 'still on MEDIA after closing playback');
  assert.equal(SC.Media.playing, null, 'no leftover overlay reopen (generation eaten)');
  SC._resetConsumedGenerationForTest(); // unit tests bypass dispatchScreenInput's per-tick clear

  // Second back: simulated as a lone 'back' edge — the real Escape
  // double-edge case (['back','pause']) is what the FIRST back batch covers.
  // A fresh tick clears consumedGeneration, so this press exits to MENU.
  SC.dispatchScreenInput(makeFakeEngine(['back']), null, {});
  assert.equal(getState(), S.MENU, 'returned to MENU');
  assert.equal(SC.Media.playing, null, 'no overlay left open after the exit');
});
