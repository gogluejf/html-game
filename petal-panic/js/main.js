// Petal Panic — entry point: game loop + responsive canvas scaffold.
// All logic runs in a fixed 960x540 logical space; the render layer maps it
// to the screen (dpr-aware, 16:9 letterbox, GAME_SCALE knob).

import { VIEW_W, VIEW_H } from './core/view.js';
import { loadImages } from './ui/screens.js';
import { waitForFonts } from './ui/fonts.js';
import * as CONSTS from './consts.js';
import { loadMacros } from './world/macroLoader.js';
import { setMacros } from './world/macros.js';

// Load screen assets (Home/Select) immediately on page load.
loadImages();

// Wait for the display fonts before the first frame so titles/prompts render
// in Alfa Slab One / Lilita One / Pirata One (not a fallback). Resolves after
// ~2.5 s worst case, so a blocked network never blocks the game.
waitForFonts().then((ready) => {
  if (!ready) console.warn('[fonts] display fonts not ready; using fallback');
});

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

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
function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const aspect = VIEW_W / VIEW_H;
  const fitW = Math.min(window.innerWidth, window.innerHeight * aspect);
  const cssW = Math.floor(fitW * GAME_SCALE);
  const cssH = Math.floor(cssW / aspect);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

window.addEventListener('resize', fitCanvas);
fitCanvas();

function applyTransform() {
  const sx = canvas.width / VIEW_W;
  const sy = canvas.height / VIEW_H;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
}

// --- Boot: load macros FIRST, then start the game ---------------------------
// update.js calls buildWorld() at module scope, which requires MACROS to be
// populated. We must await loadMacros() BEFORE importing update.js.
async function boot() {
  try {
    const macros = await loadMacros();
    setMacros(macros);
    console.info(`[macros] loaded ${Object.keys(macros).length} macros from macros/levels/`);
  } catch (err) {
    console.error(`[macros] FAILED to load macros: ${err.message}`);
    throw err;
  }

  // Dynamic import AFTER macros are ready.
  const { update } = await import('./systems/update.js');
  const { render } = await import('./systems/render.js');

  function frame(t) {
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

  requestAnimationFrame(frame);
}

boot();
