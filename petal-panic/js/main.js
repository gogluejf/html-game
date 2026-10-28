// Petal Panic — entry point: game loop + responsive canvas scaffold.
// All logic runs in a fixed 960x540 logical space; the render layer maps it
// to the screen (dpr-aware, 16:9 letterbox, GAME_SCALE knob).

import { VIEW_W, VIEW_H } from './core/view.js';
/** @type {(() => void) | undefined} set inside boot() once screens.js is
 * evaluated (avoids a top-level call that would run before its module body). */
let _loadImagesFn;
import { waitForFonts } from './ui/fonts.js';
import * as CONSTS from './consts.js';
import { loadMacros } from './world/macroLoader.js';
import { setMacros } from './world/macros.js';
import { initTouchControls, setVirtualPadEnabled } from './ui/touchControls.js';

/* Screen asset loading happens in boot() after screens.js is evaluated. */

// Wait for the display fonts before the first frame so titles/prompts render
// in Alfa Slab One / Lilita One / Pirata One (not a fallback). Resolves after
// ~2.5 s worst case, so a blocked network never blocks the game.
waitForFonts().then((ready) => {
  if (!ready) console.warn('[fonts] display fonts not ready; using fallback');
});

/* Canvas + context are resolved LAZILY (first real use, inside boot/fitCanvas)
 * so merely importing this module never needs a DOM — headless node tests
 * import main.js for the fit/layout helpers without a document. In the
 * browser, startGame() runs before any of these are touched. NOTE: must NOT
 * be Proxies — proxying a 2D context detaches its methods (Illegal
 * invocation on the first draw call → silent black screen). */
let canvas = null;
let ctx = null;
function resolveCanvas() {
  if (!canvas) {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
  }
  return canvas;
}

// --- Fixed-timestep config -------------------------------------------------
export const FIXED_DT = 1 / 60;      // physics step (s) — deterministic at any refresh rate

// Single global upscale knob: multiplies the whole game's on-screen size
// uniformly (sprites, UI, HUD). Set from the console or a debug menu.
let GAME_SCALE = 1;
export function setGameScale(v) { GAME_SCALE = v; fitCanvas(); }
export function getGameScale() { return GAME_SCALE; }

const MAX_FRAME = 0.25;              // clamp long frames (tab switch) to avoid spiral of death

let accumulator = 0;
let lastTime = 0;

// --- Responsive fit (render-only; logic never sees display size) -----------
// Layout modes (fullscreen-layout plan):
//   'fit'        — contain-fit the 960x540 box into the window (letterbox).
//   'fullscreen' — canvas fills the ENTIRE window; the 960x540 logical box is
//                  centered inside it. Menu/hub screens bleed their gradients
//                  into the side strips (core/layout.js surface helpers); gameplay
//                  keeps the flat world fill in both layouts. The mode is read from settings each frame
//                  (cheap object read) so toggling in Options takes effect
//                  immediately without a reload.
// Layout mode + fit state live in core/layout.js (leaf module) so render.js /
// screens.js can read them without importing this entry point. Re-exported
// here for existing consumers.
import { getLayoutMode, setLayoutMode, setFitState, setRefitCallback, getFitOffsetX, getFitOffsetY, getFitScale } from './core/layout.js';
export { getLayoutMode, setLayoutMode, getFitOffsetX, getFitScale };

let FIT_STATE = { offsetX: 0, offsetY: 0, scale: 1 }; // local mirror; pushed to core/layout via setFitState

/** Layout viewport size in CSS px. documentElement is the stable source of
 * truth on mobile — window.innerWidth/innerHeight fluctuate with the URL bar
 * and mid-rotation, which made successive fits compound their error. */
function viewportSize() {
  const de = document.documentElement;
  return {
    w: Math.max(1, de.clientWidth || window.innerWidth),
    h: Math.max(1, de.clientHeight || window.innerHeight),
  };
}

function fitCanvas() {
  resolveCanvas();
  const dpr = window.devicePixelRatio || 1;
  const vp = viewportSize();
  if (getLayoutMode() === 'fullscreen') {
    // Cover: canvas == full layout viewport, any aspect ratio.
    const cssW = Math.floor(vp.w * GAME_SCALE);
    const cssH = Math.floor(vp.h * GAME_SCALE);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  } else {
    const aspect = VIEW_W / VIEW_H;
    const fitW = Math.min(vp.w, vp.h * aspect);
    const cssW = Math.floor(fitW * GAME_SCALE);
    const cssH = Math.floor(cssW / aspect);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  // Uniform scale of the logical box; in fullscreen it is centered, which may
  // leave horizontal slack (wide windows) or vertical slack (tall windows).
  const s = Math.min(canvas.width / VIEW_W, canvas.height / VIEW_H);
  // Center the logical box on BOTH axes: wide windows get horizontal slack,
  // tall/portrait windows get vertical slack (box stays v-centered, matching
  // fit mode's position — only the background bleeds past it).
  FIT_STATE.offsetX = Math.max(0, (canvas.width - VIEW_W * s) / 2);
  FIT_STATE.offsetY = Math.max(0, (canvas.height - VIEW_H * s) / 2);
  FIT_STATE.scale = s;
  setFitState(FIT_STATE.offsetX, FIT_STATE.offsetY, s);
}

function fitScale() {
  // Reuse the scale stored by the LAST fitCanvas() — recomputing from the
  // backing store can read a stale size mid-rotation and make the transform
  // (fonts, layout) jump until several refits converge.
  return FIT_STATE.scale || Math.min(canvas.width / VIEW_W, canvas.height / VIEW_H);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById) {
  // Mobile rotation is the failure mode this whole block exists for:
  //   1. Many resize events fire mid-rotation, each reading a STALE viewport
  //      (window dims lag the compositor; URL bar show/hide lies too). Fitting
  //      on every event compounds the error — canvas shrinks/grows a step per
  //      event until the user toggles layout several times to force convergence
  //      (the "click many times / keeps shrinking" bug).
  //   2. The browser may not fire a FINAL settle event at all, so a pure
  //      trailing debounce can leave the canvas stuck at an intermediate size.
  // Fix: leading+trailing throttle (fit immediately on the first event, then
  //      at most once per 150ms while events keep coming) PLUS a settle timer
  //      that re-fits 400ms after the last event using the now-stable
  //      documentElement size. Every fit is idempotent (derived purely from
  //      current viewport + dpr), so refitting on stale values is harmless —
  //      only the SETTLE fit's result is what sticks.
  let _throttleTimer = null;
  let _settleTimer = null;
  let _lastFit = 0;
  const THROTTLE_MS = 150;
  const SETTLE_MS = 400;
  const doFit = () => {
    _lastFit = performance.now();
    fitCanvas();
  };
  const throttledFit = () => {
    if (_throttleTimer) return; // trailing fit already scheduled
    const wait = Math.max(0, THROTTLE_MS - (performance.now() - _lastFit));
    _throttleTimer = setTimeout(() => {
      _throttleTimer = null;
      doFit();
    }, wait);
  };
  const onResize = () => {
    doFit();               // immediate response (feels snappy)
    throttledFit();        // cap the rate during the event storm
    if (_settleTimer) clearTimeout(_settleTimer);
    _settleTimer = setTimeout(doFit, SETTLE_MS); // final fit on stable dims
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  setRefitCallback(onResize); // Options toggle also gets the settle pass
  // NOTE: fitCanvas is NOT called here — boot() calls it AFTER syncing the
  // layout mode from settings, so the very first fit already uses the right
  // mode (calling it now would size the canvas as 'fit' even when the user
  // has FULL SCREEN saved, and the next toggle would fight that stale size).
}

/** Re-fit when the layout mode flips (Options screen calls this on toggle). */
export function refreshLayout() { fitCanvas(); }

function applyTransform() {
  resolveCanvas();
  // The fullscreen canvas is larger than the logical gameplay box. Clear ALL
  // device pixels before drawing: clearing only 960x540 leaves old world
  // sprites/HUD pixels in the side strips, accumulating trails every frame.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const s = fitScale();
  // 'fit': canvas aspect == 960x540 so s fills exactly and offsets are 0.
  // 'fullscreen': center the logical box inside the larger canvas (both axes).
  ctx.setTransform(s, 0, 0, s, FIT_STATE.offsetX, FIT_STATE.offsetY);
}


// --- Boot: load macros FIRST, then start the game ---------------------------
// update.js calls buildWorld() at module scope, which requires MACROS to be
// populated. We must await loadMacros() BEFORE importing update.js.
async function boot() {
  const macros = await loadMacros();
  setMacros(macros);
  console.info(`[macros] loaded ${Object.keys(macros).length} macros from macros/levels/`);

  // Dynamic import AFTER macros are ready.
  const screens = await import('./ui/screens.js');
  _loadImagesFn = screens.loadImages;
  // Load screen assets (Home/Select) now that screens.js is fully evaluated.
  // Headless environments have no Image constructor — skip gracefully.
  if (typeof Image !== 'undefined') screens.loadImages();
  // Sprite sheet boot (sprites.md runtime wiring v1): fetch barrel + checkpoint
  // sheets AND frames BEFORE update.js loads. update.js builds zone 1's
  // entities at module scope; if the sprite data isn't ready by then those
  // entities are constructed with sprite=null and never rebuilt (the live
  // frame map only helps entities that HAVE a sprite block). Awaiting here
  // costs one short fetch round-trip at boot and makes every entity — in
  // every zone, on every reload — construct with real sprite data.
  const { initBarrelSprites, initCheckpointSprites } = await import('./objects/object.js');
  await Promise.all([initBarrelSprites(), initCheckpointSprites()]);
  const { update } = await import('./systems/update.js');
  const { render } = await import('./systems/render.js');
  // VIRTUAL GAMEPAD option (fullscreen-layout plan): default ON; the pad only
  // renders on touch devices anyway, so this is inert on desktop by design.
  const { loadStore } = await import('./systems/progressStore.js');
  const { syncLayoutModeFromStore } = await import('./core/layout.js');
  // LAYOUT option: cache the mode, then apply the VIRTUAL GAMEPAD setting
  // (default ON; the pad only renders on touch devices, so inert on desktop).
  syncLayoutModeFromStore();
  setVirtualPadEnabled(loadStore().settings.virtualPad);
  // Fit NOW that the layout mode is known (see module-scope note above).
  fitCanvas();
  // Mobile touch overlay (virtual gamepad + debug bar). No-op on desktop.
  initTouchControls();

  function frame(t) {
    resolveCanvas();
    if (!lastTime) lastTime = t;
    const delta = Math.min(MAX_FRAME, (t - lastTime) / 1000);
    lastTime = t;
    accumulator += delta;
    while (accumulator >= FIXED_DT) {
      update(FIXED_DT);
      accumulator -= FIXED_DT;
    }
    applyTransform();
    render(ctx);
    requestAnimationFrame(frame);
  }

  window.setGameScale = setGameScale;
  Object.defineProperty(window, 'TTL_SPEED', {
    get: () => CONSTS.TTL_SPEED,
    set: (v) => { CONSTS.TTL_SPEED = v; },
    configurable: true,
  });

  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(frame);
  }
}

// Boot is EXPORTED, not auto-run: index.html calls startGame() explicitly.
// This keeps headless node tests (which import main.js for the fit/layout
// helpers) from triggering the full game boot — and removes the last
// circular-import fragility (main -> screens -> main).
export function startGame() { return boot(); }
