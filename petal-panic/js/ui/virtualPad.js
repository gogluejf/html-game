// Virtual gamepad — writes into window.__vpadState, which index.html injects
// into navigator.getGamepads() BEFORE any module loads (input.js captures that
// function at module scope, so the pad must exist first). This file only holds
// the touch-UI helpers. The pad itself: index 99, id 'squid-virtual-pad'.

const N = 17; // W3C standard mapping

// Lazily grab the shared state (index.html creates it before modules run).
export const vpadState = () => globalThis.__vpadState ??
  (globalThis.__vpadState = {
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: N }, () => ({ pressed: false, touched: false, value: 0 })),
  });

// --- Helpers used by the touch UI -------------------------------------------

export function press(btn, value = 1) {
  if (btn < 0 || btn >= N) return;
  const b = vpadState().buttons[btn];
  b.pressed = true;
  b.touched = true;
  b.value = Math.min(1, Math.max(0, value));
}

export function release(btn) {
  if (btn < 0 || btn >= N) return;
  const b = vpadState().buttons[btn];
  b.pressed = false;
  b.touched = false;
  b.value = 0;
}

// Set an analog stick. axisPair: 0 = left (axes 0/1), 1 = right (axes 2/3).
// Clamps to the unit circle.
export function setStick(axisPair, x, y) {
  const s = vpadState();
  const i = axisPair * 2;
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  s.axes[i] = x;
  s.axes[i + 1] = y;
}
