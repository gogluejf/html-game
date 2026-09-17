// Petal Panic — Input Engine.
//
// Polls all active input sources every tick and exposes a single normalized
// `state` object. Every consumer (update engine, screens, HUD) reads from
// `input.state` or calls `input.consumeAction()`. No raw key/button checks
// anywhere else.
//
// Architecture:
//   - Sources are a LIST. Each source implements { id, poll(raw) → actions }.
//   - Add/remove sources without touching the merge logic.
//   - All active sources are OR'd together: if ANY source says "jump", jump is true.
//   - Axes: highest-magnitude source wins (gamepad stick beats keyboard digital).
//
// v1 sources: keyboard, gamepad (PS5/PS4/Xbox/generic auto-detect).
// Future: touch, second gamepad, etc. Just push to input.sources.

const DEADZONE = 0.2;

function dz(v) { return Math.abs(v) > DEADZONE ? v : 0; }
function dpad(val) { return Math.abs(val) > 0.5; }

// ---------------------------------------------------------------------------
// Source: Keyboard
// ---------------------------------------------------------------------------
const keyboardSource = {
  id: 'keyboard',
  active: true,

  /**
   * @param {Set<string>} keys currently held key codes
   * @returns {object} raw actions from keyboard
   */
  poll(keys) {
    const k = (code) => keys.has(code);

    let moveX = 0, moveY = 0;
    if (k('KeyA') || k('ArrowLeft')) moveX -= 1;
    if (k('KeyD') || k('ArrowRight')) moveX += 1;
    if (k('KeyW')) moveY -= 1;
    if (k('KeyS')) moveY += 1;

    let aimX = 0, aimY = 0;
    if (k('ArrowLeft')) aimX -= 1;
    if (k('ArrowRight')) aimX += 1;
    if (k('ArrowUp')) aimY -= 1;
    if (k('ArrowDown')) aimY += 1;

    return {
      moveX, moveY,
      aimX, aimY,
      shooting: k('KeyG'),
      jump: k('Space'),
      melee: k('KeyJ'),
      supermove: k('KeyB'),
      switchWeapon: k('Tab'),
      crouch: k('KeyS'),
      lockDir: k('KeyK'),
      lockMove: k('KeyL'),
      pause: k('Escape'),
      confirm: k('Enter') || k('Space'),
      back: k('Escape'),
    };
  },

  /** Display label for an action. */
  label(action) {
    const labels = {
      jump: 'SPACE', melee: 'J', supermove: 'B', shoot: 'G',
      switchWeapon: 'TAB', lockDir: 'K', lockMove: 'L',
      crouch: 'S', pause: 'ESC', move: 'WASD', aim: '←↑→↓',
      confirm: 'ENTER', back: 'ESC',
    };
    return labels[action] || '?';
  },
};

// ---------------------------------------------------------------------------
// Source: Gamepad (auto-detect layout)
// ---------------------------------------------------------------------------

/** Known layouts: button index → symbol name. */
const PAD_LAYOUTS = {
  ps5: {
    match: (pad) => pad.vendor === 0x054c && pad.product === 0x0ce6,
    name: 'PS5',
    buttons: {
      a: 0, b: 1, x: 2, y: 3,
      lb: 4, rb: 5, l2: 6, r2: 7,
      create: 8, options: 9, l3: 10, r3: 11,
      dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
    },
    symbols: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', l2: 'L2', r2: 'R2', options: 'OPTIONS', l3: 'L3', r3: 'R3' },
  },
  ps4: {
    match: (pad) => pad.vendor === 0x054c && (pad.product === 0x0908 || pad.product === 0x09cc),
    name: 'PS4',
    buttons: {
      a: 0, b: 1, x: 2, y: 3,
      lb: 4, rb: 5, l2: 6, r2: 7,
      share: 8, options: 9, l3: 10, r3: 11,
      dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
    },
    symbols: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', l2: 'L2', r2: 'R2', options: 'OPTIONS', l3: 'L3', r3: 'R3' },
  },
  xbox: {
    match: (pad) => pad.vendor === 0x045e,
    name: 'Xbox',
    buttons: {
      a: 0, b: 1, x: 2, y: 3,
      lb: 4, rb: 5, l2: 6, r2: 7,
      back: 8, start: 9, l3: 10, r3: 11,
      dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
    },
    symbols: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', l2: 'LT', r2: 'RT', start: 'START', l3: 'LS', r3: 'RS' },
  },
  generic: {
    match: () => true, // fallback
    name: 'Generic',
    buttons: {
      a: 0, b: 1, x: 2, y: 3,
      lb: 4, rb: 5, l2: 6, r2: 7,
      back: 8, start: 9, l3: 10, r3: 11,
      dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
    },
    symbols: { a: 'BTN 0', b: 'BTN 1', x: 'BTN 2', y: 'BTN 3', lb: 'BTN 4', rb: 'BTN 5', l2: 'BTN 6', r2: 'BTN 7', start: 'BTN 9', l3: 'BTN 10', r3: 'BTN 11' },
  },
};

let detectedLayout = null;

function detectLayout(pad) {
  if (!pad) return null;
  for (const layout of [PAD_LAYOUTS.ps5, PAD_LAYOUTS.ps4, PAD_LAYOUTS.xbox]) {
    if (layout.match(pad)) return layout;
  }
  return PAD_LAYOUTS.generic;
}

const gamepadSource = {
  id: 'gamepad',
  active: true,
  connected: false,
  layout: null,

  /**
   * @returns {object|null} raw actions from gamepad, or null if not connected
   */
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && pads[0] && pads[0].connected ? pads[0] : null;
    this.connected = !!pad;
    if (!pad) return null;

    this.layout = detectLayout(pad);
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const B = this.layout.buttons;

    // Sticks
    let moveX = dz(pad.axes[0] || 0);
    let moveY = dz(pad.axes[1] || 0);
    let aimX = dz(pad.axes[2] || 0);
    let aimY = dz(pad.axes[3] || 0);

    // D-pad fallback for movement
    if (moveX === 0) {
      if (btn(B.dpadLeft)) moveX = -1;
      if (btn(B.dpadRight)) moveX = 1;
    }
    if (moveY === 0) {
      if (btn(B.dpadUp)) moveY = -1;
      if (btn(B.dpadDown)) moveY = 1;
    }

    // Actions (level-triggered: true while held)
    return {
      moveX, moveY,
      aimX, aimY,
      shooting: btn(B.x) || btn(B.r2),   // Square / X / RT
      jump: btn(B.a),                     // Cross / A
      melee: btn(B.y),                    // Triangle / Y
      supermove: btn(B.b),                // Circle / B
      switchWeapon: btn(B.lb),            // L1 / LB
      crouch: btn(B.dpadDown) ? true : false, // D-pad down
      lockDir: btn(B.l3),                 // L3 / LS
      lockMove: btn(B.r3),                // R3 / RS
      pause: btn(B.options) || btn(B.start), // Options / Start
      confirm: btn(B.a),                  // Cross / A
      back: btn(B.b),                     // Circle / B
    };
  },

  /** Display label for an action based on detected layout. */
  label(action) {
    if (!this.layout) return '';
    const sym = this.layout.symbols;
    const map = {
      jump: sym.a, melee: sym.y, supermove: sym.b, shoot: sym.x,
      switchWeapon: sym.lb, lockDir: sym.l3, lockMove: sym.r3,
      crouch: '▼', pause: sym.options || sym.start,
      move: 'STICK', aim: 'STICK',
      confirm: sym.a, back: sym.b,
    };
    return map[action] || '?';
  },
};

// ---------------------------------------------------------------------------
// Input Engine (merges all active sources)
// ---------------------------------------------------------------------------

export const input = {
  // --- The source list (add/remove here) ------------------------------------
  sources: [keyboardSource, gamepadSource],

  // --- Public state ----------------------------------------------------------
  state: {
    moveX: 0, moveY: 0,
    aimX: 0, aimY: 0, aimAngle: 0,
    shooting: false,
    jump: false, melee: false, supermove: false,
    switchWeapon: false, crouch: false,
    lockDir: false, lockMove: false,
    pause: false,
    confirm: false, back: false,
    // Source info
    activeSources: [],     // which sources contributed this tick
    gamepadConnected: false,
    gamepadLayout: null,   // 'PS5' | 'PS4' | 'Xbox' | 'Generic'
  },

  // --- Internal --------------------------------------------------------------
  _lockDirAngle: 0,

  /**
   * Call once per tick. Polls all active sources, merges into state.
   * @param {Set<string>} keys current held key codes (from window listeners)
   */
  poll(keys) {
    const s = this.state;
    const results = [];

    for (const src of this.sources) {
      if (!src.active) continue;
      const raw = src.poll
        ? (src.id === 'keyboard' ? src.poll(keys) : src.poll())
        : null;
      if (raw) results.push({ src, raw });
    }

    // Track which sources are active
    s.activeSources = results.map(r => r.src.id);
    s.gamepadConnected = gamepadSource.connected;
    s.gamepadLayout = gamepadSource.layout ? gamepadSource.layout.name : null;

    // --- Merge axes: highest magnitude wins ---------------------------------
    s.moveX = 0; s.moveY = 0; s.aimX = 0; s.aimY = 0;
    for (const { raw } of results) {
      if (Math.abs(raw.moveX) > Math.abs(s.moveX)) s.moveX = raw.moveX;
      if (Math.abs(raw.moveY) > Math.abs(s.moveY)) s.moveY = raw.moveY;
      if (Math.abs(raw.aimX) > Math.abs(s.aimX)) s.aimX = raw.aimX;
      if (Math.abs(raw.aimY) > Math.abs(s.aimY)) s.aimY = raw.aimY;
    }

    // --- Merge discrete actions: OR all sources -----------------------------
    s.shooting = false; s.jump = false; s.melee = false;
    s.supermove = false; s.switchWeapon = false; s.crouch = false;
    s.lockDir = false; s.lockMove = false; s.pause = false;
    s.confirm = false; s.back = false;

    for (const { raw } of results) {
      s.shooting ||= raw.shooting;
      s.jump ||= raw.jump;
      s.melee ||= raw.melee;
      s.supermove ||= raw.supermove;
      s.switchWeapon ||= raw.switchWeapon;
      s.crouch ||= raw.crouch;
      s.lockDir ||= raw.lockDir;
      s.lockMove ||= raw.lockMove;
      s.pause ||= raw.pause;
      s.confirm ||= raw.confirm;
      s.back ||= raw.back;
    }

    // --- Lock logic ----------------------------------------------------------
    if (s.lockDir) {
      if (s.aimX !== 0 || s.aimY !== 0) {
        this._lockDirAngle = Math.atan2(s.aimY, s.aimX);
      }
      s.aimX = Math.cos(this._lockDirAngle);
      s.aimY = Math.sin(this._lockDirAngle);
      s.aimAngle = this._lockDirAngle;
    } else {
      s.aimAngle = Math.atan2(s.aimY, s.aimX);
    }

    if (s.lockMove) {
      s.moveX = 0;
      s.moveY = 0;
    }
  },

  /**
   * Get display label for an action. Prefers gamepad label if connected,
   * falls back to keyboard.
   * @param {string} action
   * @returns {string}
   */
  buttonLabel(action) {
    if (gamepadSource.connected && gamepadSource.layout) {
      return gamepadSource.label(action);
    }
    return keyboardSource.label(action);
  },

  /**
   * Reset internal state (call on game restart / hero swap).
   */
  reset() {
    this._lockDirAngle = 0;
  },
};
