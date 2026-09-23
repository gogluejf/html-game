// Physical input boundary. Screens consume nav actions; gameplay consumes state.
// Keyboard events are queued (including taps between ticks); pads are sampled.
// A context/capture boundary quarantines held controls until physical release.
import { dirAngle } from './projectile.js';
const NAV = ['back', 'pause', 'up', 'down', 'left', 'right', 'confirm', 'retry', 'cont', 'quit', 'remove'];
const KEY_NAV = { Escape: ['back', 'pause'], KeyP: ['pause'], Enter: ['confirm'], Space: ['confirm'],
  ArrowUp: ['up'], KeyW: ['up'], ArrowDown: ['down'], KeyS: ['down'],
  ArrowLeft: ['left'], KeyA: ['left'], ArrowRight: ['right'], KeyD: ['right'],
  Delete: ['remove'], KeyR: ['retry'], KeyC: ['cont'], KeyQ: ['quit'] };
const PAD_NAV = { 'btn:2': ['remove'], 'btn:0': ['confirm'], 'btn:1': ['back'], 'btn:9': ['pause'],
  'btn:12': ['up'], 'btn:13': ['down'], 'btn:14': ['left'], 'btn:15': ['right'],
  'axis:0:-1': ['left'], 'axis:0:1': ['right'], 'axis:1:-1': ['up'], 'axis:1:1': ['down'] };
const DISCRETE = ['jump', 'shoot', 'melee', 'supermove', 'switchWeapon', 'lockDir', 'lockMove'];
export const DEFAULT_MAPPING = {
  keyboard: {
    moveUp: ['KeyW', 'ArrowUp'], moveDown: ['KeyS', 'ArrowDown'],
    moveLeft: ['KeyA', 'ArrowLeft'], moveRight: ['KeyD', 'ArrowRight'],
    jump: ['Space'], shoot: ['KeyJ'], melee: ['KeyH'], supermove: ['KeyK'],
    switchWeapon: ['KeyN'], lockDir: ['KeyI'], lockMove: ['KeyO'],
  },
  gamepad: {
    moveUp: ['axis:1:-1', 'btn:12'], moveDown: ['axis:1:1', 'btn:13'],
    moveLeft: ['axis:0:-1', 'btn:14'], moveRight: ['axis:0:1', 'btn:15'],
    jump: ['btn:0'], shoot: ['btn:2'], melee: ['btn:3'], supermove: ['btn:1', 'btn:5'],
    switchWeapon: ['btn:4'], lockDir: ['btn:6'], lockMove: ['btn:7'],
  },
};
export const bindingSlots = (source, action) => action.startsWith('move') || (source === 'gamepad' && action === 'supermove') ? 2 : 1;
const STORAGE_KEY = 'petal_panic_mapping';
const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULT_MAPPING));
// Only a complete exact old-default snapshot is safe to upgrade. Partial or
// customized saves (including singleton trigger locks) retain every binding.
const legacyAxes = { 'axis:-1x': 'axis:0:-1', 'axis:1x': 'axis:0:1', 'axis:-1y': 'axis:1:-1', 'axis:1y': 'axis:1:1' };
const matchesSnapshot = (data, defaults) => ['keyboard', 'gamepad'].every(source =>
  Object.keys(defaults[source]).length === Object.keys(data[source] || {}).length &&
  Object.entries(defaults[source]).every(([action, expected]) => {
    const saved = data[source]?.[action];
    const values = (Array.isArray(saved) ? saved : [saved]).map(b => legacyAxes[b] || b);
    return JSON.stringify(values) === JSON.stringify(expected);
  }));
// Pre-HJKN keyboard layout: shoot=Ctrl, melee=X, super=C, weapon=V, locks=K/L.
const legacyKeyboardDefaults = cloneDefaults();
legacyKeyboardDefaults.keyboard.shoot = ['ControlLeft', 'ControlRight'];
legacyKeyboardDefaults.keyboard.melee = ['KeyX'];
legacyKeyboardDefaults.keyboard.supermove = ['KeyC'];
legacyKeyboardDefaults.keyboard.switchWeapon = ['KeyV'];
legacyKeyboardDefaults.keyboard.lockDir = ['KeyK'];
legacyKeyboardDefaults.keyboard.lockMove = ['KeyL'];
Object.assign(legacyKeyboardDefaults.gamepad, { shoot: ['btn:2', 'btn:7'], supermove: ['btn:1'],
  crouch: ['btn:13'], lockDir: ['btn:10'], lockMove: ['btn:11'] });
// Variant the old code actually shipped to browsers (pre-lock-remap gamepad).
const legacyKeyboardDefaultsB = JSON.parse(JSON.stringify(legacyKeyboardDefaults));
Object.assign(legacyKeyboardDefaultsB.gamepad, { shoot: ['btn:2'], lockDir: ['btn:6'], lockMove: ['btn:7'] });
// Browsers saved single-slot snapshots (old bindingSlots were all 1): every
// action stored exactly one trigger. These two are those snapshots.
const legacyKeyboardSingletonA = JSON.parse(JSON.stringify(legacyKeyboardDefaults));
for (const source of ['keyboard', 'gamepad']) for (const action of Object.keys(legacyKeyboardSingletonA[source])) {
  legacyKeyboardSingletonA[source][action] = legacyKeyboardSingletonA[source][action].slice(0, 1);
}
const legacyKeyboardSingletonB = JSON.parse(JSON.stringify(legacyKeyboardDefaultsB));
for (const source of ['keyboard', 'gamepad']) for (const action of Object.keys(legacyKeyboardSingletonB[source])) {
  legacyKeyboardSingletonB[source][action] = legacyKeyboardSingletonB[source][action].slice(0, 1);
}
// The snapshot real browsers actually hold today: movement kept its two
// aliases (restored by the v3 backfill) while combat actions stayed singleton.
const legacyKeyboardSingletonC = JSON.parse(JSON.stringify(legacyKeyboardDefaultsB));
delete legacyKeyboardSingletonC.gamepad.crouch;
Object.assign(legacyKeyboardSingletonC.keyboard, {
  moveUp: ['KeyW', 'ArrowUp'], moveDown: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'], moveRight: ['KeyD', 'ArrowRight'],
  jump: ['Space'], shoot: ['ControlLeft'], melee: ['KeyX'], supermove: ['KeyC'],
  switchWeapon: ['KeyV'], lockDir: ['KeyK'], lockMove: ['KeyL'],
});
Object.assign(legacyKeyboardSingletonC.gamepad, {
  moveUp: ['axis:1:-1', 'btn:12'], moveDown: ['axis:1:1', 'btn:13'],
  moveLeft: ['axis:0:-1', 'btn:14'], moveRight: ['axis:0:1', 'btn:15'],
  jump: ['btn:0'], shoot: ['btn:2'], melee: ['btn:3'], supermove: ['btn:1', 'btn:5'],
  switchWeapon: ['btn:4'], lockDir: ['btn:6'], lockMove: ['btn:7'],
});
const validBinding = (source, b) => typeof b === 'string' && (source === 'keyboard'
  ? /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Control(Left|Right)|Shift(Left|Right)|Alt(Left|Right)|Meta(Left|Right)|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|Numpad\w+)$/.test(b)
  : /^(btn:\d+|axis:\d+:(-1|1))$/.test(b));
const blank = () => ({ moveX: 0, moveY: 0, directionX: 0, directionY: 0, aimX: 0, aimY: 0, aimAngle: 0,
  shooting: false, jump: false, melee: false, supermove: false, switchWeapon: false,
  crouch: false, lockDir: false, lockMove: false, pause: false });
export function formatBinding(binding, source = 'keyboard', layout = 'Generic') {
  if (Array.isArray(binding)) return binding.map(b => formatBinding(b, source, layout)).join(' / ');
  if (!binding) return '—';
  if (source === 'gamepad') {
    if (binding.startsWith('axis:')) {
      const [, axis, sign] = binding.split(':');
      if (Number(axis) < 4) return `${Number(axis) < 2 ? 'LS' : 'RS'} ${Number(axis) % 2 ? (sign === '-1' ? '↑' : '↓') : (sign === '-1' ? '←' : '→')}`;
      return `AXIS ${axis} ${sign === '-1' ? '−' : '+'}`;
    }
    const i = Number(binding.slice(4));
    // Per-layout symbol sets (indexed by standard Gamepad button index).
    // PS: ✕ ○ □ △ · Xbox/8BitDo: A B X Y · Switch (Pro): A B X Y + distinct
    // shoulder/home glyphs. Generic falls back to "BTN n".
    const SETS = {
      PS5:    ['✕','○','□','△','L1','R1','L2','R2','SHARE','OPTIONS','L3','R3','▲','▼','◀','▶'],
      PS4:    ['✕','○','□','△','L1','R1','L2','R2','SHARE','OPTIONS','L3','R3','▲','▼','◀','▶'],
      Xbox:   ['A','B','X','Y','LB','RB','LT','RT','VIEW','MENU','LS','RS','▲','▼','◀','▶'],
      '8BitDo':['A','B','X','Y','LB','RB','LT','RT','VIEW','MENU','LS','RS','▲','▼','◀','▶'],
      Switch: ['A','B','X','Y','L','R','ZL','ZR','CAPTURE','+','L3','R3','▲','▼','◀','▶'],
    };
    const labels = SETS[layout];
    return !labels ? `BTN ${i}` : (labels[i] || `BTN ${i}`);
  }
  return ({ Space: 'SPACE', ControlLeft: 'CTRL', ControlRight: 'CTRL R', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' })[binding]
    || binding.replace(/^Key|^Digit/, '').toUpperCase();
}

/**
 * Return all human-readable labels for a nav action across the requested sources.
 * Inverts KEY_NAV / PAD_NAV to find which physical bindings map to the action,
 * then formats each with formatBinding() using the active gamepad layout.
 * Layout is read from the input engine's own state (detected or configured).
 *
 * @param {string} action — one of NAV ('back', 'confirm', 'pause', 'up', etc.)
 * @param {{source?: 'keyboard'|'gamepad'|'all', simple?: boolean}} [opts]
 *   - simple: true → only show arrow/d-pad symbols (↑ ↓ ← →), skip W/S/A/D and LS.
 *     Useful for compact UI hints where redundant bindings clutter the line.
 * @returns {string[]} e.g. ['ENTER', 'SPACE', '✕'] or ['ESC', '○']
 */
const DIRECTIONAL = new Set(['up', 'down', 'left', 'right']);

export function navLabels(action, { source = 'all', simple = false } = {}) {
  const results = [];
  // Layout is a manual cosmetic choice (no auto-detection): which symbol set
  // to print for gamepad buttons. Defaults to Generic (BTN n).
  const layout = input.gamepadLayout || 'Generic';
  const isDir = DIRECTIONAL.has(action);
  if (source === 'keyboard' || source === 'all') {
    for (const [key, actions] of Object.entries(KEY_NAV)) {
      if (!actions.includes(action)) continue;
      // simple + directional: skip keyboard entirely (only d-pad)
      if (simple && isDir) continue;
      results.push(formatBinding(key, 'keyboard'));
    }
  }
  if (source === 'gamepad' || source === 'all') {
    for (const [btn, actions] of Object.entries(PAD_NAV)) {
      if (!actions.includes(action)) continue;
      // simple + directional: skip LS axes (keep d-pad buttons only)
      if (simple && isDir && btn.startsWith('axis:')) continue;
      results.push(formatBinding(btn, 'gamepad', layout));
    }
  }
  return results;
}

/**
 * Single compact string for UI hints: "ENTER / SPACE / ✕"
 * @param {string} action
 * @param {{source?: 'keyboard'|'gamepad'|'all', simple?: boolean}} [opts]
 * @returns {string}
 */
export function navLabelString(action, opts) {
  return navLabels(action, opts).join(' / ');
}

/**
 * Build structured entries for drawNavBar() from a list of nav actions.
 * Each entry is { icons: Icon[], label } where each Icon carries its OWN
 * highlight trigger so chips light up individually instead of all at once:
 *   - icon:  the keycap label string (e.g. 'ENTER', 'SPACE', '✕')
 *   - action: the NAV action this physical control maps to
 *   - isActive(): () => boolean — called by drawNavBar() each frame; return
 *     true to highlight THIS chip.
 *
 * HIGHLIGHTING IS MODULAR AND SELF-WIRING. Every chip lights itself from the
 * shared input engine — no per-screen code required. The check is per-PHYSICAL-
 * BINDING, not per-action: pressing ENTER only lights the ENTER chip, pressing
 * SPACE only lights SPACE, pressing gamepad A only lights A. Never all three.
 *
 *   - directional / held controls (up/down/left/right) → lit while physically
 *     HELD (reads _heldBindings), so a held arrow stays gold.
 *   - momentary controls (confirm/back/pause/retry/cont/quit) → lit for a short
 *     window after their specific binding was pressed (edge-triggered flash),
 *     so the press is visible even when the action immediately transitions.
 *
 * MODE (per-item `opts.mode`, default 'all'):
 *   - 'all'          → show every keyboard + gamepad button for the action
 *                      (the original, most-complete behavior).
 *   - 'select_layout'→ show ONLY the buttons of the currently SELECTED input
 *                      layout: if the selected layout is a gamepad layout
 *                      (Generic/Switch/Xbox/…) show just the gamepad buttons;
 *                      if it is the keyboard layout ('Keyboard') show just the
 *                      keyboard keys. This keeps compact screens from cluttering
 *                      the bar with both devices at once.
 *
 * SIMPLE (`opts.simple`, default true): for DIRECTIONAL actions only, collapse
 * to a single arrow/d-pad glyph (↑ ↓ ← →) instead of listing every alias.
 * Simple is orthogonal to mode — it decides *how many* direction glyphs, mode
 * decides *which device's* buttons appear.
 *
 * @param {Array<{action:string, label?:string, opts?:object}>} items
 *   - action: NAV action name ('up', 'confirm', 'back', etc.)
 *   - label: display word (defaults to capitalized action name)
 *   - opts: per-item overrides ({ source, simple, mode })
 * @returns {{icons:{icon:string, action:string, isActive:()=>boolean}[], label:string}[]}
 */
export function navHintEntries(items) {
  const LABELS = {
    up: 'Navigate', down: 'Navigate', left: 'Select', right: 'Select',
    confirm: 'Confirm', back: 'Close', pause: 'Pause',
    retry: 'Retry', cont: 'Continue', quit: 'Quit', remove: 'Remove',
  };
  const FLASH_MS = 180;
  // Invert KEY_NAV / PAD_NAV into binding→actions maps (built once).
  const keyToActions = Object.fromEntries(
    Object.entries(KEY_NAV).map(([k, acts]) => [k, acts]));
  const padToActions = Object.fromEntries(
    Object.entries(PAD_NAV).map(([b, acts]) => [b, acts]));

  return items.map(({ action, actions, label, opts = {} }) => {
    const o = { simple: true, source: 'all', mode: 'all', ...opts };
    const actionList = actions || [action];
    const layout = input.gamepadLayout || 'Generic';
    // Which device does the SELECTED layout point at? 'Keyboard' → keyboard;
    // any pad layout → gamepad. Used by the 'select_layout' mode.
    const selectedIsPad = layout !== 'Keyboard';
    // Resolve which sources this item actually shows buttons for.
    let showKb = o.source === 'keyboard' || o.source === 'all';
    let showPad = o.source === 'gamepad' || o.source === 'all';
    if (o.mode === 'select_layout') {
      showKb = !selectedIsPad;
      showPad = selectedIsPad;
    }

    const icons = [];
    for (const a of actionList) {
      const held = DIRECTIONAL.has(a);
      // In SIMPLE mode a directional collapses to compact glyph(s). Show the
      // glyph for EACH device the item is displaying (mode/source-resolved):
      //   keyboard shown  -> the arrow key (↑ ↓ ← →)
      //   gamepad shown   -> the d-pad button (▲ ▼ ◀ ▶ / BTN n)
      // In 'all' mode both appear; in 'select_layout' only the selected one.
      if (o.simple && held) {
        // In SIMPLE mode the arrow and d-pad normally represent ONE conceptual
        // direction, so either lighting up means the other should too (shared
        // group highlight). But on the Controls/Remap screen the arrow and
        // d-pad are two DISTINCT bindings being edited, so they must highlight
        // independently — pass opts.groupDir: false for that.
        const group = o.groupDir !== false;
        const dirActive = group ? () => _anyBindingHeld(a) : null;
        if (showKb) {
          for (const [key, acts] of Object.entries(keyToActions)) {
            if (!acts.includes(a)) continue;
            const lbl = formatBinding(key, 'keyboard');
            const bk = `k:${key}`;
            icons.push({ icon: lbl, action: a, binding: bk,
              isActive: dirActive ?? (() => !!_heldBindings.get(bk)) });
            break;
          }
        }
        if (showPad) {
          for (const [btn, acts] of Object.entries(padToActions)) {
            if (!acts.includes(a) || btn.startsWith('axis:')) continue;
            const lbl = formatBinding(btn, 'gamepad', layout);
            if (icons.some(ic => ic.icon === lbl)) continue;
            const bk = `g:${btn}`;
            icons.push({ icon: lbl, action: a, binding: bk,
              isActive: dirActive ?? (() => !!_heldBindings.get(bk)) });
            break;
          }
        }
        continue;
      }
      // Keyboard bindings for this action (non-simple or non-directional).
      if (showKb) {
        for (const [key, acts] of Object.entries(keyToActions)) {
          if (!acts.includes(a)) continue;
          const lbl = formatBinding(key, 'keyboard');
          if (icons.some(ic => ic.icon === lbl)) continue;
          const bk = `k:${key}`;
          icons.push({ icon: lbl, action: a, binding: bk, isActive: () => {
            if (held) return !!_heldBindings.get(bk); // directionals: lit while held
            const t = _flashT.get(bk) ?? 0;           // momentary: flash on press
            return performance.now() - t < FLASH_MS;
          }});
        }
      }
      // Gamepad bindings for this action (non-simple or non-directional).
      if (showPad) {
        for (const [btn, acts] of Object.entries(padToActions)) {
          if (!acts.includes(a)) continue;
          if (o.simple && btn.startsWith('axis:')) continue; // skip LS axes
          const lbl = formatBinding(btn, 'gamepad', layout);
          if (icons.some(ic => ic.icon === lbl)) continue;
          const bk = `g:${btn}`;
          icons.push({ icon: lbl, action: a, binding: bk, isActive: () => {
            if (held) return !!_heldBindings.get(bk); // directionals: lit while held
            const t = _flashT.get(bk) ?? 0;           // momentary: flash on press
            return performance.now() - t < FLASH_MS;
          }});
        }
      }
    }
    const defaultLabel = label || (actionList.length > 1 ? 'Navigate' : (LABELS[actionList[0]] || actionList[0]));
    return { icons, label: label || defaultLabel };
  });
}

// Per-BINDING state (not per-action): which physical controls are currently
// held and when they were last pressed. Updated once per input tick.
const _heldBindings = new Map();  // binding key → true
const _flashT = new Map();        // binding key → timestamp

/**
 * Record which physical bindings are held and which were pressed this tick.
 * Called once per poll from dispatchScreenInput.
 * @param {Map<string,boolean>} held — binding keys currently held
 * @param {string[]} pressed — binding keys pressed this tick
 */
export function markNavPressed(held, pressed) {
  _heldBindings.clear();
  if (held) for (const [k, v] of held) if (v) _heldBindings.set(k, true);
  if (Array.isArray(pressed)) {
    const now = performance.now();
    for (const k of pressed) _flashT.set(k, now);
  }
}

/**
 * Returns true if ANY physical binding mapped to the given directional action
 * is currently held. Used by simple-mode chips so the arrow and d-pad light up
 * together (they represent one conceptual direction).
 */
function _anyBindingHeld(action) {
  for (const [key, acts] of Object.entries(KEY_NAV)) {
    if (!acts.includes(action)) continue;
    if (_heldBindings.get(`k:${key}`)) return true;
  }
  for (const [btn, acts] of Object.entries(PAD_NAV)) {
    if (!acts.includes(action)) continue;
    if (_heldBindings.get(`g:${btn}`)) return true;
  }
  return false;
}

/**
 * Clear all flash timestamps. Called on state transitions so a new screen
 * never shows a stale highlight from the previous screen's press.
 */
export function clearNavFlash() {
  _flashT.clear();
}

export function createInput({ target = globalThis.window, document = globalThis.document,
  getGamepads = () => globalThis.navigator?.getGamepads?.() || [],
  storage = () => globalThis.localStorage } = {}) {
  const keys = new Set(), queue = [], physical = new Map(), blocked = new Set();
  let previousNav = new Set(), previousGame = new Set(), capture = null;
  let lastAim = null, lockedAngle = null, suspended = false, quarantinePads = false;
  let previousPhysical = new Map(); // binding keys held on the prior poll (for edge detection)
  // Contextual aim resolver (design §5/§32): Lock Direction must freeze the
  // RESOLVED aim, not the raw directional key. The gameplay layer installs a
  // resolver bound to the hero so the capture below applies the same context
  // rules as resolveAim (grounded crouch → horizontal toward facing, ...).
  // Without one (screens / pre-hero polls) the raw aim is captured verbatim.
  let resolveAim = null;
  const pendingReleases = new Set();
  const listeners = [];
  const listen = (obj, name, fn) => { obj?.addEventListener?.(name, fn); listeners.push(() => obj?.removeEventListener?.(name, fn)); };
  const engine = {
    state: blank(), nav: { held: {}, pressed: [], released: [] }, captureResult: null,
    mapping: cloneDefaults(), gamepadLayout: 'Generic', keyboardLayout: 'Keyboard', source: 'keyboard', generation: 0,
    loadMapping() {
      this.mapping = cloneDefaults(); this.gamepadLayout = 'Generic'; this.keyboardLayout = 'Keyboard';
      try {
        const data = JSON.parse(storage()?.getItem(STORAGE_KEY) || 'null');
        if (!data || typeof data !== 'object') return;
        // A save that exactly matches a historical default snapshot is untouched
        // → safe to replace wholesale with the current defaults. (Old writers
        // stamped version 3, so version presence alone never disqualifies.)
        const untouched = [legacyKeyboardDefaults, legacyKeyboardDefaultsB, legacyKeyboardSingletonA,
          legacyKeyboardSingletonB, legacyKeyboardSingletonC].some(d => matchesSnapshot(data, d));
        for (const source of ['keyboard', 'gamepad']) for (const action of Object.keys(DEFAULT_MAPPING[source])) {
          const saved = data[source]?.[action];
          if (untouched || saved === undefined) continue;
          const values = (Array.isArray(saved) ? saved : [saved]).map(b => legacyAxes[b] || b);
          if (values.every(b => validBinding(source, b))) {
            const slots = bindingSlots(source, action);
            this.mapping[source][action] = values.slice(0, slots);
            // Older editors replaced an entire direction with one binding.
            // Restore missing default alternatives once, keeping the first choice.
            if ((data.version || 0) < 3 && slots === 2) {
              for (const binding of DEFAULT_MAPPING[source][action]) {
                if (this.mapping[source][action].length >= slots) break;
                if (!this.mapping[source][action].includes(binding)) this.mapping[source][action].push(binding);
              }
            }
          }
        }
        if (['PS5','PS4','Xbox','8BitDo','Switch','Generic'].includes(data.gamepadLayout)) this.gamepadLayout = data.gamepadLayout;
        if (data.keyboardLayout === 'Keyboard') this.keyboardLayout = 'Keyboard';
      } catch { /* unavailable/corrupt storage: defaults remain usable */ }
    },
    saveMapping() {
      try { storage()?.setItem(STORAGE_KEY, JSON.stringify({ ...this.mapping, version: 3, gamepadLayout: this.gamepadLayout, keyboardLayout: this.keyboardLayout })); return true; }
      catch { return false; } // bindings apply in memory even when storage is blocked
    },
    // Omitted index replaces the first chip, never its siblings; length appends.
    setBinding(source, action, binding, index = 0) {
      const bindings = this.mapping[source]?.[action];
      if (!bindings || !validBinding(source, binding) || !Number.isInteger(index)
        || index < 0 || index > bindings.length || index >= bindingSlots(source, action)) return false;
      bindings[index] = binding;
      this.saveMapping(); return true;
    },
    addBinding(source, action, binding) {
      return this.setBinding(source, action, binding, this.mapping[source]?.[action]?.length);
    },
    removeBinding(source, action, index) {
      const bindings = this.mapping[source]?.[action];
      if (!bindings || !Number.isInteger(index) || index < 0 || index >= bindings.length) return false;
      bindings.splice(index, 1); this.saveMapping(); return true;
    },
    resetMapping() { this.mapping = cloneDefaults(); this.gamepadLayout = 'Generic'; this.keyboardLayout = 'Keyboard'; this.saveMapping(); },
    buttonLabel(action, source = this.source) {
      if (action === 'crouch') action = 'moveDown';
      if (action === 'pause') return source === 'keyboard' ? 'ESC' : formatBinding('btn:9', source, this.gamepadLayout || 'Generic');
      if (action === 'aim' && source === 'gamepad') return 'RIGHT STICK';
      if (action === 'move' || action === 'aim') return ['moveUp','moveDown','moveLeft','moveRight'].map(a => this.buttonLabel(a, source)).join(' ');
      return formatBinding(this.mapping[source]?.[action], source, this.gamepadLayout || 'Generic');
    },
    // Call on every state transition and capture boundary. No time debounce.
    barrier() {
      for (const id of physical.keys()) blocked.add(id);
      for (const key of keys) blocked.add(`k:${key}`);
      queue.length = 0; this.generation++;
      this.nav = { held: {}, pressed: [], released: [...previousNav] };
      for (const action of previousNav) pendingReleases.add(action);
      previousNav.clear(); previousGame.clear(); this.state = blank(); lockedAngle = null;
      // Clear per-binding state so no stale flash leaks across the boundary.
      this.heldBindings = new Map(); this.pressedBindings = [];
      previousPhysical = new Map();
    },
    reset() { lastAim = null; this.barrier(); },
    /** Install the contextual aim resolver used when Lock Direction engages. */
    setResolveAim(fn) { resolveAim = fn ?? null; },
    beginCapture(source) { this.barrier(); capture = source; this.captureResult = null; },
    cancelCapture() { capture = null; this.captureResult = null; this.barrier(); },
    get capturing() { return capture !== null; },
    poll({ facing = 1 } = {}) {
      const pressed = new Set(), released = new Set(pendingReleases), gamePressed = new Set(), candidates = [];
      pendingReleases.clear();
      const captureAtStart = capture;
      const navNow = () => {
        const values = new Set();
        for (const [id, p] of physical) if (!blocked.has(id) && p.value > 0.5) {
          for (const action of (p.source === 'keyboard' ? KEY_NAV[p.binding] : PAD_NAV[p.binding]) || []) values.add(action);
        }
        return values;
      };
      const gameNow = () => {
        const values = new Set();
        for (const [id, p] of physical) if (!blocked.has(id) && p.value > 0.2) {
          for (const action of DISCRETE) if (this.mapping[p.source][action].includes(p.binding)) values.add(action);
        }
        return values;
      };
      const observe = () => {
        const n = navNow(), g = gameNow();
        for (const a of n) if (!previousNav.has(a)) pressed.add(a);
        for (const a of previousNav) if (!n.has(a)) released.add(a);
        for (const a of g) if (!previousGame.has(a)) gamePressed.add(a);
        previousNav = n; previousGame = g;
      };
      const change = (id, p) => {
        const old = physical.get(id);
        if (!p || p.value === 0) { physical.delete(id); blocked.delete(id); }
        else {
          physical.set(id, p);
          if (p.value > 0.5 && (!old || old.value <= 0.5) && !blocked.has(id)) {
            candidates.push(p); this.source = p.source;
          }
        }
      };
      // Barrier-quarantined controls re-arm as soon as the physical source is
      // confirmed released (or gone) — a keyup for the exact id is NOT required,
      // because after a barrier the next keydown of a still-held key is filtered
      // and would otherwise leave the id blocked forever.
      for (const id of [...blocked]) {
        const code = id.startsWith('k:') ? id.slice(2) : null;
        if (code !== null ? !keys.has(code) : !physical.has(id)) blocked.delete(id);
      }
      for (const { code, down } of queue.splice(0)) {
        change(`k:${code}`, down ? { source: 'keyboard', binding: code, value: 1 } : null);
        observe();
      }
      const padPhysical = new Map(); let connected = false;
      if (!suspended) for (const pad of getGamepads() || []) {
        if (!pad || pad.connected === false) continue;
        connected = true;
        const prefix = `p:${pad.index ?? 0}:${pad.id || ''}:`;
        pad.buttons.forEach((b, i) => {
          if (b.pressed || b.value > 0.5) padPhysical.set(prefix + `btn:${i}`, { source: 'gamepad', binding: `btn:${i}`, value: 1 });
        });
        pad.axes.forEach((v, i) => {
          if (Math.abs(v) > 0.2) { const binding = `axis:${i}:${Math.sign(v)}`;
            padPhysical.set(prefix + binding, { source: 'gamepad', binding, value: Math.abs(v) }); }
        });
      }
      for (const [id, p] of physical) if (p.source === 'gamepad' && !padPhysical.has(id)) change(id, null);
      for (const [id, p] of padPhysical) {
        if (quarantinePads) blocked.add(id);
        change(id, p);
      }
      if (!suspended) quarantinePads = false;
      observe();
      this.captureResult = null;
      if (captureAtStart) {
        // Back (Escape / ○) ALWAYS cancels capture. It cannot be self-assigned.
        if (pressed.has('back')) this.captureResult = { status: 'cancelled' };
        else {
          const p = candidates.find(p => p.source === captureAtStart && validBinding(p.source, p.binding)
            && !(p.source === 'keyboard' ? ['Escape','KeyP'].includes(p.binding) : p.binding === 'btn:9'));
          if (p) this.captureResult = { status: 'bound', source: p.source, binding: p.binding };
        }
        if (this.captureResult) { capture = null; this.barrier(); }
        this.nav = { held: {}, pressed: [], released: [] }; this.state = blank();
        // No binding state during capture — prevents stale flashes leaking
        // into the next screen's instruction bar.
        this.heldBindings = new Map(); this.pressedBindings = [];
        return this.state;
      }
      this.nav = { held: Object.fromEntries([...previousNav].map(a => [a, true])),
        pressed: NAV.filter(a => pressed.has(a)), released: NAV.filter(a => released.has(a)) };
      // Per-BINDING state for the instruction bar: which physical controls are
      // currently held and which were just pressed this tick. Stored on the
      // engine (not on nav) so nav remains a plain-action shape for tests.
      const heldBindings = new Map(), pressedBindings = [];
      for (const [id, p] of physical) {
        if (blocked.has(id) || p.value <= 0.5) continue;
        const bindingKey = p.source === 'keyboard' ? `k:${p.binding}` : `g:${p.binding}`;
        heldBindings.set(bindingKey, true);
        if (!previousPhysical.has(bindingKey)) pressedBindings.push(bindingKey);
      }
      previousPhysical = heldBindings;
      this.heldBindings = heldBindings;
      this.pressedBindings = pressedBindings;
      const s = blank();
      // --- Direction: ONE source vector from all movement inputs ------------
      // WASD/arrows, dpad buttons and the LEFT stick all feed the same
      // `direction`. It is the single "which way am I pointing" value.
      const amount = (source, action) => {
        let value = 0;
        for (const [id, p] of physical) if (!blocked.has(id) && p.source === source && this.mapping[source][action].includes(p.binding)) value = Math.max(value, p.value);
        return value;
      };
      const merge = (a, b) => Math.abs(b) > Math.abs(a) ? b : a;
      let dirX = 0, dirY = 0;
      let rawDown = false;
      for (const source of ['keyboard','gamepad']) {
        rawDown ||= amount(source, 'moveDown') > 0.2;
        dirX = merge(dirX, amount(source, 'moveRight') - amount(source, 'moveLeft'));
        dirY = merge(dirY, amount(source, 'moveDown') - amount(source, 'moveUp'));
      }
      // Crouch only on PURE Down (no horizontal). Diagonal down (Down+Left/Right)
      // is a diagonal aim, not a crouch — the hero keeps running and shoots diagonally.
      s.crouch = rawDown && Math.abs(dirX) < 0.2;
      if (Math.abs(dirX) < 1e-6) dirX = 0;
      if (Math.abs(dirY) < 1e-6) dirY = 0;
      s.directionX = dirX; s.directionY = dirY;

      // --- Movement: direction, zeroed while lockMove is held ---------------
      s.moveX = dirX; s.moveY = dirY;

      // --- Aim: IS the direction. One control does both ---------------------
      // There is no separate aim device: whatever direction you point (WASD,
      // dpad, left stick) is where you move AND where you aim. lockDir is the
      // only thing that can make aim differ from direction (it freezes the
      // angle). No right-stick aim, no hidden sources.
      s.aimX = dirX; s.aimY = dirY;
      // Jump remains held for variable-height jumping; short taps get one tick.
      for (const a of DISCRETE) s[a === 'shoot' ? 'shooting' : a] = previousGame.has(a) || gamePressed.has(a);
      for (const a of ['melee','supermove','switchWeapon']) s[a] = gamePressed.has(a);
      if (s.lockDir) {
        // Lock Direction freezes the RESOLVED aim (design §5), not merely the
        // raw directional key: a grounded crouched hero locking while holding
        // Down must lock horizontal-toward-facing, never straight-down. The
        // resolver applies the same context rules as hero.resolveAim; when no
        // resolver is installed (screens / pre-hero polls) fall back to the
        // raw aim with the facing-based neutral default. Capture happens on
        // the engage frame itself (lockedAngle still null), so the frozen
        // value always reflects the state at the moment of the press.
        if (lockedAngle === null) {
          // Capture the RESOLVED aim at engage time. When a resolver is
          // installed (gameplay layer), it wins over lastAim — that is exactly
          // the §5 fix: holding Down while grounded-crouched resolves to
          // horizontal-toward-facing, not straight-down. Without a resolver
          // (screens / pre-hero polls) fall back to the raw aim with the
          // facing-based neutral default.
          let angle;
          if (resolveAim) {
            const dir = resolveAim({ down: s.crouch, lockMove: s.lockMove, aimX: dirX, aimY: dirY });
            angle = dirAngle(dir);
          } else {
            angle = lastAim ?? ((s.aimX || s.aimY) ? Math.atan2(s.aimY, s.aimX) : (facing < 0 ? Math.PI : 0));
          }
          lockedAngle = angle;
        }
        s.aimX = Math.cos(lockedAngle); s.aimY = Math.sin(lockedAngle); s.aimAngle = lockedAngle;
      } else {
        lockedAngle = null;
        if (s.aimX || s.aimY) lastAim = Math.atan2(s.aimY, s.aimX);
        s.aimAngle = lastAim ?? (facing < 0 ? Math.PI : 0);
      }
      if (s.lockMove) s.moveX = s.moveY = 0;
      s.pause = pressed.has('pause'); s.source = this.source;
      s.gamepadConnected = connected;
      this.state = s; return s;
    },
    destroy() { for (const off of listeners) off(); },
    /** Raw physical keyboard codes currently held (debug/diagnostics only). */
    get heldKeys() { return [...keys]; },
  };
  listen(target, 'keydown', e => {
    if (/^F\d+$/.test(e.code)) return; // debug owns function keys
    // Never swallow OS/browser shortcut combos (Cmd/Ctrl+letter), but a bare
    // modifier press must still reach us — dropping it here is what made held
    // shoot keys stick after any accidental two-key chord.
    const bareModifier = /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code);
    if ((e.ctrlKey || e.metaKey) && !bareModifier) return;
  if (KEY_NAV[e.code] || capture || Object.values(engine.mapping.keyboard).some(v => v.includes(e.code))) e.preventDefault?.();
    if (e.repeat || keys.has(e.code) || suspended) return;
    keys.add(e.code); queue.push({ code: e.code, down: true });
  });
  listen(target, 'keyup', e => { keys.delete(e.code); queue.push({ code: e.code, down: false }); });
  const release = () => {
    engine.barrier(); keys.clear(); physical.clear(); blocked.clear();
    if (capture) { capture = null; engine.captureResult = { status: 'cancelled' }; }
    suspended = true; quarantinePads = true;
  };
  listen(target, 'blur', release);
  listen(target, 'focus', () => { suspended = false; });
  listen(document, 'visibilitychange', () => { if (document.hidden) release(); else suspended = false; });
  listen(target, 'gamepaddisconnected', e => {
    for (const id of physical.keys()) if (id.startsWith(`p:${e.gamepad.index}:`)) { physical.delete(id); blocked.delete(id); }
  });
  engine.loadMapping(); return engine;
}
export const input = createInput();
