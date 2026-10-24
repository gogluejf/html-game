// Task 2.2 — Main menu screen tests (headless).
// Run: node --test petal-panic/js/test/menuScreen.test.js
//
// Verifies the canvas-drawn MENU hub screen against the plan's acceptance
// criteria:
//   - Menu draws all top-level options using the pause-style focus pill;
//   - Continue is disabled when no save exists;
//   - up/down moves focus and confirm routes to the selected destination;
//   - back from MENU returns HOME.
// Plus the deferred 2.1 item: REMAP opened from MENU returns to MENU.

import { strict as assert } from 'node:assert';
import { test, before, after } from 'node:test';

// --- Minimal DOM stub (must run BEFORE importing the engine modules) ---------
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, addEventListener: noop }),
};
globalThis.window = { addEventListener: noop };

// In-memory localStorage so progressStore.hasSave() works headlessly.
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
const { Remap } = await import('../core/remap.js');
const { VIEW_W } = await import('../core/view.js');

/** Write a resumable save directly (the §2.3 Save & Quit flow owns this later). */
function writeSave(meta = { level: 1, area: 2 }) {
  PS.loadStore().saveMeta = meta; // top-level field of the document
  assert.equal(PS.saveStore(PS.loadStore()), true, 'save persisted');
}

before(() => { PS.resetStore(); });
after(() => { PS.resetStore(); });

/** Drive a transition through the real onTransition hook (screenReset etc.). */
function go(to) {
  const ok = tryTransition(to);
  if (!ok) throw new Error(`transition to ${to} failed`);
}

test('Menu exposes draw/onAction/reset and lists all eight top-level options', () => {
  PS.resetStore();
  writeSave(); // with a save the labels are the canonical eight
  assert.equal(typeof SC.Menu.draw, 'function', 'draw is a function');
  assert.equal(typeof SC.Menu.onAction, 'function', 'onAction is a function');
  assert.equal(typeof SC.Menu.reset, 'function', 'reset is a function');

  const opts = SC.Menu.options();
  assert.deepEqual(
    opts.map(o => o.label),
    ['New Game', 'Continue', 'Level Select', 'Boss Rush', 'Media', 'Controls', 'Options', 'Credits'],
    'all eight top-level options in order'
  );
});

test('Continue is disabled when no save exists and enabled when one does', () => {
  PS.resetStore(); // wipe any save
  setState(S.MENU);
  let opts = SC.Menu.options();
  const contNoSave = opts.find(o => o.label === 'No Save');
  assert.ok(contNoSave, 'label switches to "No Save" without a save');
  assert.equal(opts.find(o => o.label === 'Continue'), undefined, 'no "Continue" entry without a save');
  assert.equal(contNoSave.enabled, false, 'the No Save entry is disabled');

  writeSave();
  opts = SC.Menu.options();
  const cont = opts.find(o => o.label === 'Continue');
  assert.ok(cont, 'label switches back to "Continue" with a save');
  assert.equal(cont.enabled, true, 'Continue is enabled with a save');
});

test('up/down move focus around the list (wrapping)', () => {
  PS.resetStore();
  writeSave(); // all entries enabled → pure wrap-around
  setState(S.HOME);
  go(S.MENU);
  assert.equal(SC.Menu.focus, 0, 'focus starts at 0 after entering MENU');

  SC.Menu.onAction('down');
  assert.equal(SC.Menu.focus, 1, 'down advances focus');
  for (let i = 0; i < 7; i++) SC.Menu.onAction('down');
  assert.equal(SC.Menu.focus, 0, 'down wraps around the full list');
  SC.Menu.onAction('up');
  assert.equal(SC.Menu.focus, 7, 'up wraps to the last entry');
});

test('focus skips disabled entries (No Save not selectable)', () => {
  PS.resetStore(); // no save → index 1 disabled
  setState(S.HOME);
  go(S.MENU);
  SC.Menu.focus = 0;
  SC.Menu.onAction('down');
  assert.equal(SC.Menu.focus, 2, 'down from New Game skips the disabled No Save entry');
  SC.Menu.focus = 2;
  SC.Menu.onAction('up');
  assert.equal(SC.Menu.focus, 0, 'up from Level Select skips the disabled No Save entry');
});

test('confirm routes to each selected destination', () => {
  const cases = [
    [0, S.SELECT, 'New Game → SELECT'],
    [2, S.LEVEL_SELECT, 'Level Select → LEVEL_SELECT'],
    [3, S.BOSS_RUSH, 'Boss Rush → BOSS_RUSH'],
    [4, S.MEDIA, 'Media → MEDIA'],
    [5, S.REMAP, 'Controls → REMAP'],
    [6, S.OPTIONS, 'Options → OPTIONS'],
  ];
  for (const [idx, to, name] of cases) {
    PS.resetStore();
    setState(S.HOME);
    go(S.MENU);
    SC.Menu.focus = idx;
    const handled = SC.Menu.onAction('confirm');
    assert.equal(handled, true, `${name}: action handled`);
    assert.equal(getState(), to, `${name}: state is now ${S[to]}`);
  }
});

test('confirm on Credits opens the credits overlay; any key closes it', () => {
  setState(S.HOME);
  go(S.MENU);
  SC.Menu.focus = 7;
  const handled = SC.Menu.onAction('confirm');
  assert.equal(handled, true, 'confirm handled');
  assert.equal(getState(), S.MENU, 'state stays MENU (overlay is in-screen)');
  assert.equal(SC.Menu.creditsOpen, true, 'credits overlay opened');

  // Any nav action dismisses the overlay back to the hub.
  SC.Menu.onAction('down');
  assert.equal(SC.Menu.creditsOpen, false, 'any key closes the credits overlay');
});

// --- G2: Escape emits BOTH 'back' and 'pause' in one input generation --------
// KEY_NAV maps Escape → ['back','pause']. If dismissal only ate the first
// action, the leftover 'pause' would be rewritten to 'confirm' by
// screenOnAction and immediately REOPEN the overlay. The fix: while the
// credits overlay is open, the FIRST action consumes the whole generation —
// dispatchScreenInput stops processing that batch (handled=true + unchanged
// generation), so no second action runs this frame.

/** A fake input engine with a controllable nav.pressed batch. */
function makeFakeEngine(pressed) {
  return {
    generation: 1,
    heldBindings: new Map(),
    pressedBindings: [],
    captureResult: null,
    nav: { pressed },
  };
}

test('G2: double-action generation (back+pause) ends with the credits overlay closed and focus unchanged', () => {
  PS.resetStore();
  writeSave();
  setState(S.HOME);
  go(S.MENU);
  SC.Menu.focus = 7; // Credits focused
  SC.Menu.onAction('confirm');
  assert.equal(SC.Menu.creditsOpen, true, 'overlay open before the Escape press');

  // Simulate one physical Escape press: the input engine reports both
  // actions in the same generation, exactly as KEY_NAV produces them.
  const engine = makeFakeEngine(['back', 'pause']);
  SC.dispatchScreenInput(engine, null, {});

  assert.equal(SC.Menu.creditsOpen, false, 'overlay ends CLOSED after the double-action generation');
  assert.equal(getState(), S.MENU, 'state unchanged (no transition from the leftover pause/confirm)');
  assert.equal(SC.Menu.focus, 7, 'focus unchanged — the leftover confirm did not re-fire the option');

  // Same shape for the gamepad path: btn:1 → back only, but also verify a
  // back-then-back batch cannot reopen via the second edge.
  setState(S.MENU);
  SC.Menu.creditsOpen = true;
  const engine2 = makeFakeEngine(['back', 'back']);
  SC.dispatchScreenInput(engine2, null, {});
  assert.equal(SC.Menu.creditsOpen, false, 'second identical edge is also swallowed');
});

// --- G3: dismissal exercised through the REAL dispatch path ------------------
// The input system forwards only NAV actions (KEY_NAV/PAD_NAV) to screens, so
// unmapped keys never reach onAction. Dismissal therefore works for the nav
// bindings that map to actions — Enter/Space ('confirm') and Escape
// ('back'/'pause'). These tests drive dispatchScreenInput (the real entry
// point), not onAction directly.

test('G3: Enter (confirm action) dismisses credits through the real dispatch path', () => {
  PS.resetStore();
  writeSave();
  setState(S.HOME);
  go(S.MENU);
  SC.Menu.focus = 7;
  SC.Menu.onAction('confirm');
  assert.equal(SC.Menu.creditsOpen, true, 'overlay open');

  const engine = makeFakeEngine(['confirm']); // what Enter produces
  SC.dispatchScreenInput(engine, null, {});

  assert.equal(SC.Menu.creditsOpen, false, 'Enter dismissed the overlay via dispatchScreenInput');
  assert.equal(getState(), S.MENU, 'still on MENU');
  assert.equal(SC.Menu.focus, 7, 'focus preserved after dismissal');
});

test('G3: the credits prompt names the real dismiss keys (not "any key")', () => {
  PS.resetStore();
  writeSave();
  setState(S.MENU);
  SC.Menu.creditsOpen = true;

  const texts = [];
  const proxy = new Proxy({}, {
    get(_, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (prop === 'fillText') return (t) => { texts.push(t); };
      return noop;
    },
    set() { return true; },
  });
  SC.Menu.draw(proxy);

  assert.ok(texts.some(t => t.includes('PRESS ENTER OR ESC')),
    `prompt names the real keys (got ${JSON.stringify([...new Set(texts)])})`);
  assert.ok(!texts.some(t => t.includes('PRESS ANY KEY')),
    'inaccurate "PRESS ANY KEY" prompt removed');
});

// --- Rendering acceptance (F6): Menu.draw against a recording 2D ctx --------
// drawPrompt() renders each label via THREE fillText calls (glow + drop +
// main), so every drawn option appears at least three times in the recorded
// fillText args. The focus pill is a roundRect path (beginPath/arcTo) filled
// with COLOR_PILL_FILL and stroked with COLOR_PILL_STROKE.

/**
 * Recording 2D context. Paths are recorded as complete objects — beginPath
 * starts one, moveTo/arcTo append to it, and fill()/stroke() reference the
 * CURRENT path object together with the style in effect at that moment. This
 * associates fills with their paths reliably (G5: the previous index-based
 * pairing was unreliable because other code interleaves save/restore and
 * multiple paths).
 */
function makeRecordingCtx() {
  const rec = {
    fillTexts: [],   // [text, x, y]
    fills: [],       // {style, path} — one entry per fill() call
    strokes: [],     // {style, path} — one entry per stroke() call
    paths: [],       // one entry per beginPath(): {move:[x,y], arcs:[[x,y,r],...]}
  };
  const state = { fillStyle: null, strokeStyle: null };
  let curPath = null;
  return {
    rec,
    proxy: new Proxy({}, {
      get(_, prop) {
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (prop === 'fillText') return (t, x, y) => rec.fillTexts.push([t, x, y]);
        if (prop === 'fill') return () => rec.fills.push({ style: state.fillStyle, path: curPath });
        if (prop === 'stroke') return () => rec.strokes.push({ style: state.strokeStyle, path: curPath });
        if (prop === 'beginPath') return () => { curPath = { move: null, arcs: [] }; rec.paths.push(curPath); };
        if (prop === 'moveTo') return (x, y) => { if (curPath) curPath.move = [x, y]; };
        // arcTo(x, y, x2, y2, radius) — the radius is the FIFTH argument.
        if (prop === 'arcTo') return (x, y, x2, y2, r) => { if (curPath) curPath.arcs.push([x, y, x2, y2, r]); };
        if (prop === 'set') return undefined;
        return noop;
      },
      set(_, prop, v) {
        if (prop === 'fillStyle') state.fillStyle = v;
        if (prop === 'strokeStyle') state.strokeStyle = v;
        return true;
      },
    }),
  };
}

/** Pill geometry for row i of the Menu list (constants from screens.js). */
function menuPillForRow(i) {
  const y = 150 + i * 38;
  return { x: VIEW_W / 2 - 130, top: y - 16, w: 260, h: 32, r: 6 };
}

test('Menu.draw renders all eight options with the focus pill on the focused row', () => {
  PS.resetStore();
  writeSave();
  setState(S.MENU);
  SC.Menu.creditsOpen = false; // guard against state leaked from an earlier test
  SC.Menu.focus = 3; // Boss Rush

  const { rec, proxy } = makeRecordingCtx();
  SC.Menu.draw(proxy);

  const labels = ['New Game', 'Continue', 'Level Select', 'Boss Rush',
                  'Media', 'Controls', 'Options', 'Credits'];
  for (const label of labels) {
    const hits = rec.fillTexts.filter(([t]) => t.includes(label));
    assert.ok(hits.length >= 3, `label "${label}" drawn (got ${hits.length} fillText hits)`);
  }

  // Focus pill: exactly one fill() call uses the pink pill color, and its
  // associated path is the roundRect built from four arcTo corners.
  const pillFill = 'rgba(255,110,199,0.10)';
  const pillStroke = 'rgba(255,110,199,0.4)';
  const pillFills = rec.fills.filter(f => f.style === pillFill && f.path);
  assert.equal(pillFills.length, 1, 'exactly one focus pill filled');
  const p = pillFills[0].path;
  const pill = menuPillForRow(3);
  assert.equal(p.arcs.length, 4, 'pill path has exactly four corner arcs');
  // G5: actually verify the corner RADIUS (5th arcTo argument) on all four
  // corners — the pill's rounded corners must be r=6.
  for (let c = 0; c < 4; c++) {
    assert.equal(p.arcs[c][4], pill.r, `pill corner ${c} radius is ${pill.r}`);
  }
  assert.equal(p.arcs[0][0], pill.x + pill.w, 'pill right edge');
  assert.equal(p.arcs[0][1], pill.top, 'pill top edge');
  assert.equal(p.arcs[2][0], pill.x, 'pill left edge');
  assert.equal(p.arcs[2][1], pill.top + pill.h, 'pill bottom edge');
  // The same path is also stroked with the pink outline. Because drawOptionList
  // calls roundRect() twice (once before fill, once before stroke), the
  // recording proxy captures two distinct path objects with identical geometry.
  // Match by geometry: find the stroke whose style is the pink outline and
  // whose path has the same four arcTo coordinates as the filled pill path.
  const pillStrokes = rec.strokes.filter(s => {
    if (s.style !== pillStroke || !s.path) return false;
    if (s.path.arcs.length !== p.arcs.length) return false;
    for (let c = 0; c < 4; c++) {
      for (let a = 0; a < 5; a++) {
        if (s.path.arcs[c][a] !== p.arcs[c][a]) return false;
      }
    }
    return true;
  });
  assert.equal(pillStrokes.length, 1, 'the filled pill path is stroked with the pink outline');
});

test('Menu.draw renders the disabled "No Save" entry dimmed when hasSave() is false', () => {
  PS.resetStore(); // no save → index 1 disabled ("No Save")
  setState(S.MENU);
  SC.Menu.creditsOpen = false; // guard against state leaked from an earlier test
  SC.Menu.focus = 0;

  // Record fillText calls together with the fillStyle in effect at that moment.
  const entries = [];
  let curStyle = null;
  const proxy2 = new Proxy({}, {
    get(_, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (prop === 'fillText') return (t) => entries.push({ t, style: curStyle });
      return noop;
    },
    set(_, prop, v) {
      if (prop === 'fillStyle') curStyle = v;
      return true;
    },
  });
  SC.Menu.draw(proxy2);

  const disabledColor = '#555555';
  const enabledColor = '#ff6ec7';
  const DROP_SHADOW = 'rgba(60,35,0,0.9)'; // drawPrompt's fixed drop-shadow pass
  const noSaveStyles = entries.filter(e => e.t.includes('No Save')).map(e => e.style);
  assert.ok(noSaveStyles.length > 0, 'fillStyle tracked for No Save rows');
  // drawPrompt renders each label in three passes: the option color (glow +
  // main) and a fixed dark-amber drop shadow between them. The option's own
  // color must be the dim disabled one — never the bright pink.
  assert.ok(noSaveStyles.every(s => s === disabledColor || s === DROP_SHADOW),
    `disabled entry uses the dim color (got ${JSON.stringify([...new Set(noSaveStyles)])})`);
  assert.ok(noSaveStyles.includes(disabledColor), 'dim color actually applied to No Save');
  const newGameStyles = entries.filter(e => e.t.includes('New Game')).map(e => e.style);
  assert.ok(newGameStyles.some(s => s === enabledColor),
    'focused enabled entry still uses the bright pink color');
});

test('confirm on Continue routes to AREA_ENTRY when a save exists', () => {
  PS.resetStore();
  writeSave();
  setState(S.HOME);
  go(S.MENU);
  SC.Menu.focus = 1; // Continue
  const handled = SC.Menu.onAction('confirm');
  assert.equal(handled, true, 'confirm handled');
  assert.equal(getState(), S.AREA_ENTRY, 'state is now AREA_ENTRY (resume flow)');
});

test('disabled "No Save" entry cannot be focused or confirmed', () => {
  PS.resetStore(); // no save → index 1 disabled
  setState(S.HOME);
  go(S.MENU);

  // Navigation never lands on the disabled entry.
  SC.Menu.focus = 0;
  SC.Menu.onAction('down');
  assert.notEqual(SC.Menu.focus, 1, 'down skips the disabled entry');
  SC.Menu.focus = 2;
  SC.Menu.onAction('up');
  assert.notEqual(SC.Menu.focus, 1, 'up skips the disabled entry');

  // Even if focus is forced onto it, confirm is a no-op (stays on MENU).
  SC.Menu.focus = 1;
  const before = getState();
  SC.Menu.onAction('confirm');
  assert.equal(getState(), before, 'confirm on a disabled entry does nothing');
});

test('back from MENU returns HOME', () => {
  setState(S.HOME);
  go(S.MENU);
  const handled = SC.Menu.onAction('back');
  assert.equal(handled, true, 'back handled by the menu');
  assert.equal(getState(), S.HOME, 'state returned to HOME');
});

test('REMAP opened from MENU returns to MENU (deferred 2.1 item)', () => {
  setState(S.HOME);
  go(S.MENU);
  SC.Menu.focus = 5; // Controls
  SC.Menu.onAction('confirm');
  assert.equal(getState(), S.REMAP, 'controls opens the remap screen');

  // Remap.onAction('back') returns 'exit'; screenOnAction then transitions to
  // remapParent, which must be MENU here.
  const result = Remap.onAction('back');
  assert.equal(result, 'exit', 'remap signals exit on back');
  SC.screenOnAction('back'); // already in REMAP: routes via remapParent
  assert.equal(getState(), S.MENU, 'remap parent from MENU is MENU, not PAUSE');
});

test('G1: Home confirmation routes to MENU (the hub), not directly to SELECT', () => {
  setState(S.HOME);
  SC.Home.parallaxOffset = 20; // past the intro sequence
  SC.Home._promptShown = true; // prompt already shown → next confirm transitions
  const handled = SC.screenOnAction('confirm');
  assert.equal(handled, true, 'confirm dispatched from HOME');
  assert.equal(getState(), S.MENU, 'HOME → MENU (plan §2 objective: HOME → Main Menu)');
});

test('screen dispatch: MENU actions route through screenOnAction', () => {
  PS.resetStore(); // no save → index 1 (No Save) is disabled and skipped
  setState(S.HOME);
  go(S.MENU);
  assert.equal(SC.screenOnAction('down'), true, 'down dispatched to Menu');
  assert.equal(SC.Menu.focus, 2, 'menu focus advanced via dispatcher (skipping disabled No Save)');
  assert.equal(SC.screenOnAction('back'), true, 'back dispatched to Menu');
  assert.equal(getState(), S.HOME, 'dispatcher back returns HOME');
});
