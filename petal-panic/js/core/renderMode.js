// Petal Panic — Render mode gate (high-graphic vs primitive-graphic).
//
// Single source of truth for "which graphic layer is active." No other module
// reads Debug.viewMode for graphic decisions — they call isHighGraphic().
//
// HIGH:      sheet sprites, parallax images, full art
// PRIMITIVE: basic canvas shapes (fillRects, arcs, lines) — always available

export const GRAPHIC_MODE = Object.freeze({
  HIGH: 'high',
  PRIMITIVE: 'primitive',
});

let current = GRAPHIC_MODE.HIGH;

/** Switch the active graphic mode. Called by the F3 handler in debug.js. */
export function setGraphicMode(mode) {
  if (mode !== GRAPHIC_MODE.HIGH && mode !== GRAPHIC_MODE.PRIMITIVE) {
    throw new Error(`setGraphicMode: unknown mode "${mode}"`);
  }
  current = mode;
}

/** @returns {string} the current graphic mode ('high' | 'primitive') */
export function getGraphicMode() {
  return current;
}

/** Convenience: true when sheet sprites / image assets should render. */
export function isHighGraphic() {
  return current === GRAPHIC_MODE.HIGH;
}
