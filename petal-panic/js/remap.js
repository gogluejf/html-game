// Petal Panic — Remap Controls Screen.
//
// A settings screen for reassigning gameplay action bindings per input source.
// Navigation (confirm/back/navigate) is NOT remappable — only gameplay actions.
//
// Layout:
//   - Title: "CONTROLS"
//   - Tabs: [KEYBOARD] [GAMEPAD]
//   - (Gamepad tab only) Layout selector: PS5 / PS4 / Xbox / Generic
//   - Action rows with current binding displayed
//   - Bottom: [RESET TO DEFAULTS] ... [DONE]
//
// Remap flow:
//   1. Navigate to a row (up/down)
//   2. Confirm → "PRESS ANY KEY/BUTTON..." (pulsing)
//   3. Press a valid input → captured, auto-advance to next row
//   4. Back (○/Esc) during capture → cancel, keep old binding
//   5. Back on list → save + exit
//
// Persistence: localStorage('petal_panic_mapping')

import { VIEW_W, VIEW_H } from './view.js';
import { drawMarqueeTitle, drawPrompt, roundRect } from './fonts.js';
import { input } from './input.js';

const CREAM = '#f5e6c8';
const PINK = '#ff6ec7';
const GOLD = '#d4a843';

// Actions that can be remapped (gameplay layer only).
const ACTIONS = [
  { id: 'moveUp',       label: 'Move Up' },
  { id: 'moveDown',     label: 'Move Down' },
  { id: 'moveLeft',     label: 'Move Left' },
  { id: 'moveRight',    label: 'Move Right' },
  { id: 'jump',         label: 'Jump' },
  { id: 'shoot',        label: 'Shoot' },
  { id: 'melee',        label: 'Melee' },
  { id: 'supermove',    label: 'Supermove' },
  { id: 'switchWeapon', label: 'Switch Weapon' },
  { id: 'crouch',       label: 'Crouch' },
  { id: 'lockDir',      label: 'Lock Direction' },
  { id: 'lockMove',     label: 'Lock Movement' },
];

// Default bindings per source.
const DEFAULTS = {
  keyboard: {
    moveUp: 'KeyW', moveDown: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD',
    jump: 'Space', shoot: 'ControlLeft', melee: 'KeyX', supermove: 'KeyC',
    switchWeapon: 'KeyV', crouch: 'KeyS', lockDir: 'KeyK', lockMove: 'KeyL',
  },
  gamepad: {
    moveUp: 'axis:-1y', moveDown: 'axis:1y', moveLeft: 'axis:-1x', moveRight: 'axis:1x',
    jump: 'btn:0', shoot: 'btn:2', melee: 'btn:3', supermove: 'btn:1',
    switchWeapon: 'btn:4', crouch: 'btn:13', lockDir: 'btn:10', lockMove: 'btn:11',
  },
};

// Navigation inputs that CANNOT be assigned as gameplay bindings.
const RESERVED_KEYBOARD = new Set([
  'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);
const RESERVED_GAMEPAD_BUTTONS = new Set([0, 1, 9, 12, 13, 14, 15]);

// Gamepad layout options for the selector.
const LAYOUT_OPTIONS = ['PS5', 'PS4', 'Xbox', 'Generic'];

const STORAGE_KEY = 'petal_panic_mapping';

export const Remap = {
  // State
  tab: 'keyboard',       // 'keyboard' | 'gamepad'
  focus: 0,              // focused row index
  capturing: false,      // true while waiting for a new binding
  layoutFocus: 0,        // focused layout option (gamepad tab)
  editingLayout: false,  // true while cycling layout
  _flashInvalid: 0,      // timer for "INVALID" flash
  _pulseT: 0,            // pulse timer for "PRESS ANY..." text

  // Current mapping (loaded from storage or defaults)
  mapping: { keyboard: { ...DEFAULTS.keyboard }, gamepad: { ...DEFAULTS.gamepad } },
  gamepadLayout: 'PS5',

  /** Load mapping from localStorage or use defaults. */
  load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.keyboard) this.mapping.keyboard = { ...DEFAULTS.keyboard, ...parsed.keyboard };
        if (parsed.gamepad) this.mapping.gamepad = { ...DEFAULTS.gamepad, ...parsed.gamepad };
        if (parsed.gamepadLayout) this.gamepadLayout = parsed.gamepadLayout;
      }
    } catch (e) { /* corrupted storage, use defaults */ }
  },

  /** Save mapping to localStorage and apply to input engine. */
  save() {
    const data = {
      keyboard: this.mapping.keyboard,
      gamepad: this.mapping.gamepad,
      gamepadLayout: this.gamepadLayout,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // Apply to input engine (future: re-read source configs)
  },

  /** Reset to defaults. */
  reset() {
    this.mapping.keyboard = { ...DEFAULTS.keyboard };
    this.mapping.gamepad = { ...DEFAULTS.gamepad };
    this.gamepadLayout = 'PS5';
    this.save();
  },

  /** Reset transient state on screen entry. */
  resetState() {
    this.focus = 0;
    this.capturing = false;
    this.editingLayout = false;
    this._flashInvalid = 0;
    this._pulseT = 0;
    this.load();
  },

  /** Per-frame update (pulse timers). */
  update(dt) {
    this._pulseT += dt;
    if (this._flashInvalid > 0) this._flashInvalid -= dt;
  },

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, '#0d0d1a');
    grad.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Title
    drawMarqueeTitle(ctx, 'CONTROLS', VIEW_W / 2, 40, 36, { color: CREAM });

    // Tabs
    const tabY = 65;
    const tabs = ['KEYBOARD', 'GAMEPAD'];
    for (let i = 0; i < tabs.length; i++) {
      const tx = VIEW_W / 2 - 100 + i * 110;
      const active = (i === 0 && this.tab === 'keyboard') || (i === 1 && this.tab === 'gamepad');
      ctx.save();
      if (active) {
        ctx.fillStyle = 'rgba(255,110,199,0.15)';
        roundRect(ctx, tx - 45, tabY - 14, 90, 28, 6);
        ctx.fill();
        ctx.strokeStyle = PINK;
        ctx.lineWidth = 2;
        roundRect(ctx, tx - 45, tabY - 14, 90, 28, 6);
        ctx.stroke();
      }
      drawPrompt(ctx, tabs[i], tx, tabY + 2, 16, { color: active ? PINK : '#888' });
      ctx.restore();
    }

    // Gamepad layout selector (only on gamepad tab)
    let listStartY = 100;
    if (this.tab === 'gamepad') {
      const ly = 95;
      drawPrompt(ctx, 'Layout:', VIEW_W / 2 - 120, ly, 14, { color: '#888' });
      for (let i = 0; i < LAYOUT_OPTIONS.length; i++) {
        const lx = VIEW_W / 2 - 50 + i * 80;
        const sel = LAYOUT_OPTIONS[i] === this.gamepadLayout;
        drawPrompt(ctx, LAYOUT_OPTIONS[i], lx, ly, sel ? 16 : 13, { color: sel ? GOLD : '#666' });
      }
      listStartY = 120;
    }

    // Action rows
    const rowH = 32;
    const listX = VIEW_W / 2 - 200;
    const listW = 400;

    for (let i = 0; i < ACTIONS.length; i++) {
      const y = listStartY + i * rowH;
      const focused = i === this.focus;
      const action = ACTIONS[i];

      // Row background
      ctx.save();
      if (focused) {
        ctx.fillStyle = 'rgba(255,110,199,0.1)';
        roundRect(ctx, listX, y - 12, listW, rowH - 4, 4);
        ctx.fill();
        ctx.strokeStyle = PINK;
        ctx.lineWidth = 1.5;
        roundRect(ctx, listX, y - 12, listW, rowH - 4, 4);
        ctx.stroke();
      }
      ctx.restore();

      // Action label
      drawPrompt(ctx, action.label, listX + 10, y + 2, 14, {
        align: 'left', color: focused ? CREAM : '#aaa',
      });

      // Binding display
      const binding = this.mapping[this.tab][action.id];
      const bindLabel = this.formatBinding(binding);

      if (this.capturing && focused) {
        // Pulsing "PRESS ANY..." text
        const pulse = Math.sin(this._pulseT * 6) > 0;
        drawPrompt(ctx, pulse ? 'PRESS ANY KEY/BUTTON...' : '                    ',
          listX + listW - 10, y + 2, 13, { align: 'right', color: PINK });
      } else if (this._flashInvalid > 0 && focused) {
        drawPrompt(ctx, 'INVALID', listX + listW - 10, y + 2, 13, { align: 'right', color: '#ff4444' });
      } else {
        // Keycap chip
        const chipW = Math.max(40, bindLabel.length * 9 + 12);
        const chipX = listX + listW - chipW - 10;
        ctx.save();
        ctx.fillStyle = '#1a1a2e';
        roundRect(ctx, chipX, y - 8, chipW, 20, 4);
        ctx.fill();
        ctx.strokeStyle = focused ? GOLD : '#555';
        ctx.lineWidth = 1;
        roundRect(ctx, chipX, y - 8, chipW, 20, 4);
        ctx.stroke();
        drawPrompt(ctx, bindLabel, chipX + chipW / 2, y + 2, 12, { color: focused ? CREAM : '#999' });
        ctx.restore();
      }
    }

    // Bottom bar
    const botY = VIEW_H - 30;
    drawPrompt(ctx, 'RESET TO DEFAULTS', VIEW_W / 2 - 150, botY, 13, { color: '#888' });
    drawPrompt(ctx, 'DONE', VIEW_W / 2 + 150, botY, 13, { color: '#888' });

    // Hint
    drawPrompt(ctx, '▲▼ Navigate   ✕/ENTER Select   ○/ESC Back', VIEW_W / 2, VIEW_H - 10, 11, { color: '#555' });
  },

  /** Format a binding value for display. */
  formatBinding(val) {
    if (!val) return '?';
    if (this.tab === 'gamepad') {
      if (val.startsWith('btn:')) {
        const idx = parseInt(val.slice(4), 10);
        return this.gamepadButtonLabel(idx);
      }
      if (val.startsWith('axis:')) return 'STICK';
      return val;
    }
    // Keyboard: show friendly name
    const names = {
      Space: 'SPACE', ControlLeft: 'CTRL', ControlRight: 'CTRL R',
      ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT R',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      Enter: 'ENTER', Escape: 'ESC', Tab: 'TAB',
    };
    if (names[val]) return names[val];
    if (val.startsWith('Key')) return val.slice(3); // KeyW → W
    if (val.startsWith('Digit')) return val.slice(5);
    return val.toUpperCase();
  },

  /** Get symbol for a gamepad button index based on current layout. */
  gamepadButtonLabel(idx) {
    const layouts = {
      PS5:   ['✕','○','□','△','L1','R1','L2','R2','CREATE','OPTIONS','L3','R3','▲','▼','◀','▶'],
      PS4:   ['✕','○','□','△','L1','R1','L2','R2','SHARE','OPTIONS','L3','R3','▲','▼','◀','▶'],
      Xbox:  ['A','B','X','Y','LB','RB','LT','RT','VIEW','MENU','LS','RS','▲','▼','◀','▶'],
      Generic: Array.from({ length: 16 }, (_, i) => `BTN ${i}`),
    };
    const labels = layouts[this.gamepadLayout] || layouts.Generic;
    return labels[idx] || `BTN ${idx}`;
  },

  /**
   * Handle navigation input (from screenOnAction or screenOnKey).
   * Only accepts input from the ACTIVE TAB's source.
   * @param {string} code virtual key code
   */
  onKey(code) {
    // Tab switching (left/right on the tab row)
    if (!this.capturing) {
      switch (code) {
        case 'ArrowUp':
          this.focus = (this.focus + ACTIONS.length - 1) % ACTIONS.length;
          return true;
        case 'ArrowDown':
          this.focus = (this.focus + 1) % ACTIONS.length;
          return true;
        case 'ArrowLeft':
          this.tab = 'keyboard';
          return true;
        case 'ArrowRight':
          this.tab = 'gamepad';
          return true;
        case 'Enter':
        case 'Space':
          // Start capturing for focused row
          this.capturing = true;
          this._pulseT = 0;
          return true;
        case 'Escape':
          // Save and exit
          this.save();
          return 'exit';
      }
    }

    // While capturing: ONLY accept keyboard input if on keyboard tab.
    // Gamepad input is handled separately via onGamepadButton().
    if (this.capturing && this.tab === 'keyboard') {
      // Escape/Back always cancels capture
      if (code === 'Escape') {
        this.capturing = false;
        return true;
      }
      // Enter/confirm cancels too (can't bind confirm)
      if (code === 'Enter' || code === 'Space') {
        this._flashInvalid = 0.5;
        return true;
      }
      // Arrows are reserved
      if (RESERVED_KEYBOARD.has(code)) {
        this._flashInvalid = 0.5;
        return true;
      }
      // Valid! Assign it.
      const actionId = ACTIONS[this.focus].id;
      this.mapping.keyboard[actionId] = code;
      this.capturing = false;
      // Auto-advance
      this.focus = (this.focus + 1) % ACTIONS.length;
      this.save();
      return true;
    }

    // While capturing on gamepad tab: ignore keyboard input entirely.
    // (onGamepadButton handles it.)
    if (this.capturing && this.tab === 'gamepad') {
      return true; // consume but do nothing
    }

    return false;
  },

  /**
   * Handle a raw gamepad button press during capture.
   * Reserved buttons (nav) cancel capture instead of being assigned.
   * @param {number} btnIndex
   * @returns {boolean} true if consumed
   */
  onGamepadButton(btnIndex) {
    if (!this.capturing) return false;
    if (this.tab !== 'gamepad') return false;

    // Reserved buttons cancel capture (act as 'back')
    if (RESERVED_GAMEPAD_BUTTONS.has(btnIndex)) {
      this.capturing = false;
      // If it's the back button (1), also exit the screen
      if (btnIndex === 1) return 'exit';
      return true;
    }

    // Valid! Assign it.
    const actionId = ACTIONS[this.focus].id;
    this.mapping.gamepad[actionId] = `btn:${btnIndex}`;
    this.capturing = false;
    this.focus = (this.focus + 1) % ACTIONS.length;
    this.save();
    return true;
  },
};
