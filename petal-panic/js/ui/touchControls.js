// Petal Panic — mobile touch overlay.
// Bottom: virtual gamepad (writes into __vpadState, polled by input.js as pad #99).
// Top: debug bar dispatching synthetic KeyboardEvents on window —
//      debugHarness listens there, so zero engine changes.
// No-op on desktop (no touch support).

import { press, release, setStick } from './virtualPad.js';
import { Debug } from '../debug/debug.js';
import { loadStore } from '../systems/progressStore.js'; // Options screen (menu-hub §4.1): settings.vibration gates haptics

const isTouchDevice = () =>
  ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

let root = null;

/* VIRTUAL GAMEPAD option (fullscreen-layout plan): default ON. On desktop the
 * overlay never builds (no touch), so this flag is inert there by design. */
let padEnabled = true;
export function setVirtualPadEnabled(on) {
  padEnabled = !!on;
  applyPadVisibility();
}
export function isVirtualPadEnabled() { return padEnabled; }

export function initTouchControls() {
  if (!isTouchDevice()) return; // desktop: nothing rendered
  if (root) return;             // already built
  buildOverlay();
  applyPadVisibility();         // respect current setting immediately
}

/** Hide/show the visual pad elements without removing their touch handlers. */
function applyPadVisibility() {
  if (!root) return;
  root.classList.toggle('pp-pad-hidden', !padEnabled);
}

// --- Synthetic keyboard events for the debug bar -----------------------------

function keyTap(code, { shift = false } = {}) {
  const opts = { code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code, shiftKey: shift };
  window.dispatchEvent(new KeyboardEvent('keydown', { ...opts, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { ...opts, cancelable: true }));
}

// Hold-capable variant for combos (Shift+E): returns a release fn.
function keyHold(code, { shift = false } = {}) {
  const opts = { code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code, shiftKey: shift };
  window.dispatchEvent(new KeyboardEvent('keydown', { ...opts, cancelable: true }));
  return () => window.dispatchEvent(new KeyboardEvent('keyup', { ...opts, cancelable: true }));
}

// --- On-screen press readout (debug: proves touch handlers fire) ---------------

let readoutEl = null;
let readoutTimer = null;

function showReadout(text) {
  if (!readoutEl) return;
  if (!Debug.enabled) return; // only surface press readout while debug is on
  readoutEl.textContent = text;
  readoutEl.classList.add('pp-show');
  clearTimeout(readoutTimer);
  readoutTimer = setTimeout(() => readoutEl.classList.remove('pp-show'), 900);
}

// --- Generic button wiring -----------------------------------------------------

// Haptic tick for virtual-pad presses (navigator.vibrate; no-op where unsupported).
// Options screen (menu-hub §4.1): the persisted Vibration setting gates haptics
// at this single funnel — every touch-control buzz flows through here.
function buzz(ms = 15) { if (!loadStore().settings.vibration) return; navigator.vibrate?.(ms); }

function bindTouch(el, down, up) {
  el.addEventListener('touchstart', (e) => { e.preventDefault(); el.classList.add('pp-pressed'); down(e); }, { passive: false });
  const end = (e) => { e.preventDefault(); el.classList.remove('pp-pressed'); up?.(); };
  el.addEventListener('touchend', end, { passive: false });
  el.addEventListener('touchcancel', end, { passive: false });
}

// A gamepad button bound to one or more touch elements (multi-touch safe).
function bindPadButton(btnIdx, els) {
  for (const el of els) {
    const active = new Set();
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      el.classList.add('pp-pressed');
      for (const t of e.changedTouches) active.add(t.identifier);
      press(btnIdx);
      buzz();
      showReadout(`btn:${btnIdx} ▼`);
      console.info(`[vpad] btn:${btnIdx} down`);
    }, { passive: false });
    const clear = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) active.delete(t.identifier);
      if (active.size === 0) { release(btnIdx); el.classList.remove('pp-pressed'); showReadout(`btn:${btnIdx} ▲`); console.info(`[vpad] btn:${btnIdx} up`); }
    };
    el.addEventListener('touchend', clear, { passive: false });
    el.addEventListener('touchcancel', clear, { passive: false });
  }
}

// --- Overlay construction -------------------------------------------------------

function buildOverlay() {
  root = document.createElement('div');
  root.className = 'pp-touch';
  root.innerHTML = `
    <div class="pp-debugbar pp-ctl" id="pp-debugbar"></div>
    <div class="pp-readout" id="pp-readout">—</div>
    <div class="pp-pad">
      <div class="pp-left">
        <div class="pp-stick pp-ctl" id="pp-stick"><div class="pp-stick-knob" id="pp-knob"></div></div>
        <div class="pp-dpad pp-ctl">
          <button class="up" data-btn="12">▲</button>
          <button class="left" data-btn="14">◀</button>
          <button class="right" data-btn="15">▶</button>
          <button class="down" data-btn="13">▼</button>
        </div>
      </div>
      <div class="pp-right pp-ctl">
        <div class="pp-face">
          <button class="x" data-btn="2">□</button>
          <button class="y" data-btn="3">△</button>
          <button class="a" data-btn="0">✕</button>
          <button class="b" data-btn="1">○</button>
        </div>
      </div>
      <div class="pp-triggers pp-ctl">
        <button class="r1" data-btn="5">R1</button>
        <button class="l1" data-btn="4">L1</button>
        <button class="l2" data-btn="6">L2</button>
        <button class="r2" data-btn="7">R2</button>
      </div>
      <button class="pp-start pp-ctl" data-btn="9">≡ PAUSE</button>
    </div>`;
  document.body.appendChild(root);

  readoutEl = root.querySelector('#pp-readout');
  buildDebugBar();
  wireStick();
  wireAllButtons(root.querySelectorAll('[data-btn]'));
}

// Every [data-btn] element → its gamepad button index.
function wireAllButtons(els) {
  for (const el of els) bindPadButton(Number(el.dataset.btn), [el]);
}

// Analog stick: multi-touch tracked by identifier; writes axes 0/1.
function wireStick() {
  const zone = root.querySelector('#pp-stick');
  const knob = root.querySelector('#pp-knob');
  const RADIUS = 38; // max knob travel from center (px)
  let touchId = null;

  const updateFrom = (cx, cy) => {
    const rect = zone.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const midY = rect.top + rect.height / 2;
    let dx = cx - midX, dy = cy - midY;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx = (dx / len) * RADIUS; dy = (dy / len) * RADIUS; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    setStick(0, dx / RADIUS, dy / RADIUS);
  };

  const reset = () => {
    touchId = null;
    knob.style.transform = 'translate(-50%, -50%)';
    setStick(0, 0, 0);
  };

  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (touchId !== null) return;
    const t = e.changedTouches[0];
    touchId = t.identifier;
    updateFrom(t.clientX, t.clientY);
  }, { passive: false });

  zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === touchId) updateFrom(t.clientX, t.clientY);
  }, { passive: false });

  const end = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === touchId) reset();
  };
  zone.addEventListener('touchend', end, { passive: false });
  zone.addEventListener('touchcancel', end, { passive: false });
}

// --- Debug bar -------------------------------------------------------------------
// Rule: every key the desktop debugger can hit, the phone can hit.
// Global: F1 debug · F2 effect theater · F3 collision view · F4 attack theater ·
//         Shift+E collision dump · E stats dump · Escape back/close
// In-debug (handleDebugKeys): F god · Z slowmo · T telemetry · U input monitor ·
//         Y hero swap · L event log · W warp area · G drop ring · arrows select

const DEBUG_KEYS = [
  { label: 'F1', tap: () => keyTap('F1') },
  { label: 'F2', tap: () => keyTap('F2') },
  { label: 'F3', tap: () => keyTap('F3') },
  { label: 'F4', tap: () => keyTap('F4') },
  { label: '⇧E', tap: () => { const rel = keyHold('KeyE', { shift: true }); setTimeout(rel, 60); } },
  { label: 'E', tap: () => keyTap('KeyE') },
  { label: 'F', tap: () => keyTap('KeyF') },   // god mode
  { label: 'Z', tap: () => keyTap('KeyZ') },   // slow-mo / freeze
  { label: 'T', tap: () => keyTap('KeyT') },   // telemetry panel
  { label: 'U', tap: () => keyTap('KeyU') },   // live input monitor
  { label: 'Y', tap: () => keyTap('KeyY') },   // hero swap
  { label: 'L', tap: () => keyTap('KeyL') },   // event log
  { label: 'W', tap: () => keyTap('KeyW') },   // warp to next area
  { label: 'G', tap: () => keyTap('KeyG') },   // inject special drops
  { label: '◀', tap: () => keyTap('ArrowLeft') },
  { label: '▶', tap: () => keyTap('ArrowRight') },
  { label: '▲', tap: () => keyTap('ArrowUp') },
  { label: '▼', tap: () => keyTap('ArrowDown') },
  { label: 'ESC', tap: () => keyTap('Escape') },
];

function buildDebugBar() {
  const bar = root.querySelector('#pp-debugbar');
  for (const k of DEBUG_KEYS) {
    const btn = document.createElement('button');
    btn.textContent = k.label;
    bindTouch(btn, k.tap);
    bar.appendChild(btn);
  }
}
