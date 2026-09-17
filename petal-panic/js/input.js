// Physical input boundary. Screens consume nav actions; gameplay consumes state.
// Keyboard events are queued (including taps between ticks); pads are sampled.
// A context/capture boundary quarantines held controls until physical release.
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
    jump: ['Space'], shoot: ['ControlLeft'], melee: ['KeyX'], supermove: ['KeyC'],
    switchWeapon: ['KeyV'], lockDir: ['KeyK'], lockMove: ['KeyL'],
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
const oldDefaults = cloneDefaults();
oldDefaults.keyboard.shoot = ['ControlLeft', 'ControlRight'];
oldDefaults.keyboard.crouch = ['KeyS', 'ArrowDown'];
Object.assign(oldDefaults.gamepad, { shoot: ['btn:2', 'btn:7'], supermove: ['btn:1'],
  crouch: ['btn:13'], lockDir: ['btn:10'], lockMove: ['btn:11'] });
const oldSingletonDefaults = JSON.parse(JSON.stringify(oldDefaults));
for (const source of ['keyboard', 'gamepad']) for (const action of Object.keys(oldSingletonDefaults[source])) {
  oldSingletonDefaults[source][action] = oldSingletonDefaults[source][action].slice(0, 1);
}
const legacyAxes = { 'axis:-1x': 'axis:0:-1', 'axis:1x': 'axis:0:1', 'axis:-1y': 'axis:1:-1', 'axis:1y': 'axis:1:1' };
const validBinding = (source, b) => typeof b === 'string' && (source === 'keyboard'
  ? /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Control(Left|Right)|Shift(Left|Right)|Alt(Left|Right)|Meta(Left|Right)|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|Numpad\w+)$/.test(b)
  : /^(btn:\d+|axis:\d+:(-1|1))$/.test(b));
const blank = () => ({ moveX: 0, moveY: 0, aimX: 0, aimY: 0, aimAngle: 0,
  shooting: false, jump: false, melee: false, supermove: false, switchWeapon: false,
  crouch: false, lockDir: false, lockMove: false, pause: false });
function layoutOf(pad) {
  const id = pad.id || '';
  if (/dualsense|0ce6/i.test(id)) return 'PS5';
  if (/054c|sony|playstation|dualshock/i.test(id)) return 'PS4';
  if (/8bitdo/i.test(id)) return '8BitDo';
  if (/045e|xbox|microsoft/i.test(id)) return 'Xbox';
  return 'Generic';
}
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
    const labels = layout.startsWith('PS') ? ['✕','○','□','△','L1','R1','L2','R2','SHARE','OPTIONS','L3','R3','▲','▼','◀','▶']
      : ['A','B','X','Y','LB','RB','LT','RT','VIEW','MENU','LS','RS','▲','▼','◀','▶'];
    return layout === 'Generic' ? `BTN ${i}` : labels[i] || `BTN ${i}`;
  }
  return ({ Space: 'SPACE', ControlLeft: 'CTRL', ControlRight: 'CTRL R', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' })[binding]
    || binding.replace(/^Key|^Digit/, '').toUpperCase();
}

export function createInput({ target = globalThis.window, document = globalThis.document,
  getGamepads = () => globalThis.navigator?.getGamepads?.() || [],
  storage = () => globalThis.localStorage } = {}) {
  const keys = new Set(), queue = [], physical = new Map(), blocked = new Set();
  let previousNav = new Set(), previousGame = new Set(), capture = null;
  let lastAim = null, lockedAngle = null, suspended = false, quarantinePads = false;
  const pendingReleases = new Set();
  const listeners = [];
  const listen = (obj, name, fn) => { obj?.addEventListener?.(name, fn); listeners.push(() => obj?.removeEventListener?.(name, fn)); };
  const engine = {
    state: blank(), nav: { held: {}, pressed: [], released: [] }, captureResult: null,
    mapping: cloneDefaults(), gamepadLayout: 'Auto', source: 'keyboard', generation: 0,
    loadMapping() {
      this.mapping = cloneDefaults(); this.gamepadLayout = 'Auto';
      try {
        const data = JSON.parse(storage()?.getItem(STORAGE_KEY) || 'null');
        if (!data || typeof data !== 'object') return;
        const untouched = !data.version && [oldDefaults, oldSingletonDefaults].some(defaults =>
          ['keyboard', 'gamepad'].every(source =>
            Object.keys(data[source] || {}).length === Object.keys(defaults[source]).length &&
            Object.entries(defaults[source]).every(([action, expected]) => {
              const saved = data[source]?.[action];
              const values = (Array.isArray(saved) ? saved : [saved]).map(b => legacyAxes[b] || b);
              return JSON.stringify(values) === JSON.stringify(expected);
            })));
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
        if (['Auto','PS5','PS4','Xbox','8BitDo','Generic'].includes(data.gamepadLayout)) this.gamepadLayout = data.gamepadLayout;
      } catch { /* unavailable/corrupt storage: defaults remain usable */ }
    },
    saveMapping() {
      try { storage()?.setItem(STORAGE_KEY, JSON.stringify({ ...this.mapping, version: 3, gamepadLayout: this.gamepadLayout })); return true; }
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
    resetMapping() { this.mapping = cloneDefaults(); this.gamepadLayout = 'Auto'; this.saveMapping(); },
    buttonLabel(action, source = this.source) {
      if (action === 'crouch') action = 'moveDown';
      if (action === 'pause') return source === 'keyboard' ? 'ESC' : formatBinding('btn:9', source, this.state.gamepadLayout || 'Generic');
      if (action === 'aim' && source === 'gamepad') return 'RIGHT STICK';
      if (action === 'move' || action === 'aim') return ['moveUp','moveDown','moveLeft','moveRight'].map(a => this.buttonLabel(a, source)).join(' ');
      return formatBinding(this.mapping[source]?.[action], source, this.gamepadLayout === 'Auto' ? this.state.gamepadLayout || 'Generic' : this.gamepadLayout);
    },
    // Call on every state transition and capture boundary. No time debounce.
    barrier() {
      for (const id of physical.keys()) blocked.add(id);
      for (const key of keys) blocked.add(`k:${key}`);
      queue.length = 0; this.generation++;
      this.nav = { held: {}, pressed: [], released: [...previousNav] };
      for (const action of previousNav) pendingReleases.add(action);
      previousNav.clear(); previousGame.clear(); this.state = blank(); lockedAngle = null;
    },
    reset() { lastAim = null; this.barrier(); },
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
      for (const { code, down } of queue.splice(0)) {
        change(`k:${code}`, down ? { source: 'keyboard', binding: code, value: 1 } : null);
        observe();
      }
      const padPhysical = new Map(); let layout = null, connected = false;
      if (!suspended) for (const pad of getGamepads() || []) {
        if (!pad || pad.connected === false) continue;
        connected = true; layout ||= layoutOf(pad);
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
        // Back is universal, regardless of capture target or simultaneous binding.
        if (pressed.has('back')) this.captureResult = { status: 'cancelled' };
        else {
          const p = candidates.find(p => p.source === captureAtStart && validBinding(p.source, p.binding)
            && !(p.source === 'keyboard' ? ['Escape','KeyP'].includes(p.binding) : p.binding === 'btn:9'));
          if (p) this.captureResult = { status: 'bound', source: p.source, binding: p.binding };
        }
        if (this.captureResult) { capture = null; this.barrier(); }
        this.nav = { held: {}, pressed: [], released: [] }; this.state = blank();
        return this.state;
      }
      this.nav = { held: Object.fromEntries([...previousNav].map(a => [a, true])),
        pressed: NAV.filter(a => pressed.has(a)), released: NAV.filter(a => released.has(a)) };
      const s = blank();
      const amount = (source, action) => {
        let value = 0;
        for (const [id, p] of physical) if (!blocked.has(id) && p.source === source && this.mapping[source][action].includes(p.binding)) value = Math.max(value, p.value);
        return value;
      };
      const merge = (a, b) => Math.abs(b) > Math.abs(a) ? b : a;
      for (const source of ['keyboard','gamepad']) {
        s.crouch ||= amount(source, 'moveDown') > 0.2;
        const x = amount(source, 'moveRight') - amount(source, 'moveLeft');
        const y = amount(source, 'moveDown') - amount(source, 'moveUp');
        s.moveX = merge(s.moveX, x); s.moveY = merge(s.moveY, y);

      }
      // Movement directions aim on every device, before movement is locked.
      s.aimX = s.moveX; s.aimY = s.moveY;
      let stickAimX = 0, stickAimY = 0;
      for (const [id, p] of physical) if (!blocked.has(id) && p.source === 'gamepad') {
        const [, axis, sign] = p.binding.split(':');
        if (p.binding.startsWith('axis:') && (axis === '2' || axis === '3')) {
          if (axis === '2') stickAimX = merge(stickAimX, p.value * Number(sign));
          else stickAimY = merge(stickAimY, p.value * Number(sign));
        }
      }
      if (stickAimX || stickAimY) { s.aimX = stickAimX; s.aimY = stickAimY; }
      // Jump remains held for variable-height jumping; short taps get one tick.
      for (const a of DISCRETE) s[a === 'shoot' ? 'shooting' : a] = previousGame.has(a) || gamePressed.has(a);
      for (const a of ['melee','supermove','switchWeapon']) s[a] = gamePressed.has(a);
      if (s.lockDir) {
        if (lockedAngle === null) lockedAngle = lastAim ?? ((s.aimX || s.aimY)
          ? Math.atan2(s.aimY, s.aimX) : (facing < 0 ? Math.PI : 0));
        s.aimX = Math.cos(lockedAngle); s.aimY = Math.sin(lockedAngle); s.aimAngle = lockedAngle;
      } else {
        lockedAngle = null;
        if (s.aimX || s.aimY) lastAim = Math.atan2(s.aimY, s.aimX);
        s.aimAngle = lastAim ?? (facing < 0 ? Math.PI : 0);
      }
      if (s.lockMove) s.moveX = s.moveY = 0;
      s.pause = pressed.has('pause'); s.source = this.source;
      s.gamepadConnected = connected; s.gamepadLayout = layout;
      this.state = s; return s;
    },
    destroy() { for (const off of listeners) off(); },
  };
  listen(target, 'keydown', e => {
    if (/^F\d+$/.test(e.code)) return; // debug owns function keys
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
