// Petal Panic — layout mode + fit state (leaf module, fullscreen-layout plan).
//
// Owns the LAYOUT setting's runtime state ('fit' | 'fullscreen') and the
// device-pixel offset of the centered 960x540 logical box. Kept OUT of
// main.js so render.js / screens.js can import it without pulling the game
// entry point (and its boot sequence) into their import graph.
//
//   'fit'        — contain-fit the 960x540 box into the window (letterbox).
//   'fullscreen' — canvas fills the ENTIRE window; the logical box is centered
//                  inside it and backgrounds bleed into the side strips.

import { VIEW_W } from './view.js';
import { loadStore } from '../systems/progressStore.js';

let _layoutMode = 'fit';
/** Current layout mode ('fit' | 'fullscreen'). */
export function getLayoutMode() { return _layoutMode; }
/** Set the cached layout mode (Options toggle + boot call this). */
export function setLayoutMode(mode) {
  _layoutMode = mode === 'fullscreen' ? 'fullscreen' : 'fit';
  return _layoutMode;
}
/** Read the layout mode straight from the store (boot uses this once). */
export function syncLayoutModeFromStore() {
  return setLayoutMode(loadStore().settings.layout);
}

// Fit geometry owned by main.js's fitCanvas(); mirrored here as plain numbers
// so consumers never need the canvas element.
const FIT_STATE = { offsetX: 0, offsetY: 0, scale: 1 };
/** Update the cached fit geometry (main.js calls after every re-fit). */
export function setFitState(offsetX, offsetY, scale) {
  FIT_STATE.offsetX = Math.max(0, offsetX);
  FIT_STATE.offsetY = Math.max(0, offsetY ?? 0);
  FIT_STATE.scale = scale;
}
// Re-fit hook: main.js registers its fitCanvas() here so callers that cannot
// import main.js (screens.js — circular) can trigger a canvas re-fit after a
// layout-mode change. No-op until registered (headless tests never register).
let _refitFn = null;
/** Register the canvas re-fit callback (main.js, once at boot). */
export function setRefitCallback(fn) { _refitFn = fn ?? null; }
/** Trigger a canvas re-fit (Options screen calls this after toggling layout). */
export function requestRefit() { if (_refitFn) _refitFn(); }

/** Device-pixel x of the logical box's left edge (0 in fit mode). */
export function getFitOffsetX() { return FIT_STATE.offsetX; }
/** Device-pixel y of the logical box's top edge (0 except tall/portrait
 * fullscreen windows, where the box is vertically centered). */
export function getFitOffsetY() { return FIT_STATE.offsetY; }
/** Current uniform logical→device scale. */
export function getFitScale() { return FIT_STATE.scale; }
