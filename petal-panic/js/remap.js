// Petal Panic — Remap Controls Screen.
//
// A settings screen for reassigning gameplay action bindings per input source.
// Navigation is semantic and source-agnostic; input.js owns physical capture.
//
// Layout:
//   - Title: "CONTROLS"
//   - Tabs: [KEYBOARD] [GAMEPAD]
//   - (Gamepad tab only) Layout selector: PS5 / PS4 / Xbox / Generic
//   - Action rows with current binding displayed
//   - Bottom: [RESET TO DEFAULTS] ... [DONE]
//
// Rows/chips navigate directly. Confirm starts continuous capture down rows.
// Remember the preferred column across single-slot rows. Cancel stops capture;
// another Back exits Controls. Finish at the last row without wrapping.

// Persistence: localStorage('petal_panic_mapping')

import { VIEW_W, VIEW_H } from './view.js';
import { drawMarqueeTitle, drawPrompt, roundRect } from './fonts.js';
import { input, formatBinding, bindingSlots } from './input.js';

const CREAM = '#f5e6c8';
const PINK = '#ff6ec7';
const GOLD = '#d4a843';

// Actions that can be remapped (gameplay layer only).
const ACTIONS = [
  { id: 'moveUp',       label: 'Move Up' },
  { id: 'moveDown',     label: 'Down / Crouch' },
  { id: 'moveLeft',     label: 'Move Left' },
  { id: 'moveRight',    label: 'Move Right' },
  { id: 'jump',         label: 'Jump' },
  { id: 'shoot',        label: 'Shoot' },
  { id: 'melee',        label: 'Melee' },
  { id: 'supermove',    label: 'Supermove' },
  { id: 'switchWeapon', label: 'Switch Weapon' },
  { id: 'lockDir',      label: 'Lock Direction' },
  { id: 'lockMove',     label: 'Lock Movement' },
];

const LAYOUT_OPTIONS = ['Auto', 'PS5', 'PS4', 'Xbox', '8BitDo', 'Generic'];

export const Remap = {
  // State
  tab: 'keyboard',       // 'keyboard' | 'gamepad'
  focus: 0,              // focused row index
  preferredChip: 0,
  get chip() {
    return this.focus >= 0 && this.focus < ACTIONS.length
      ? Math.min(this.preferredChip, bindingSlots(this.tab, ACTIONS[this.focus].id) - 1) : 0;
  },
  _flashInvalid: 0,      // timer for "INVALID" flash
  _pulseT: 0,            // pulse timer for "PRESS ANY..." text

  get mapping() { return input.mapping; },
  get gamepadLayout() { return input.gamepadLayout; },
  get capturing() { return input.capturing; },
  save() { return input.saveMapping(); },
  reset() { input.resetMapping(); },
  resetState() {
    input.cancelCapture();
    this.focus = -1; // start on the device-tab row
    this.preferredChip = 0;
    this._flashInvalid = 0;
    this._pulseT = 0;
  },
  onCapture(result) {
    if (result?.status !== 'bound') return;
    if (!input.setBinding(result.source, ACTIONS[this.focus].id, result.binding, this.chip)) return;
    if (this.focus < ACTIONS.length - 1) {
      this.focus++;
      input.beginCapture(this.tab);
      this._pulseT = 0;
    }
  },
  onAction(action) {
    if (this.capturing) return true; // input engine owns capture and cancellation
    const count = ACTIONS.length + 3;
    if (action === 'back') { this.save(); return 'exit'; }
    if (action === 'up' || action === 'down') {
      // -1 is the device-tab row; no separate navigation mode.
      this.focus = ((this.focus + 1 + count + 1 + (action === 'up' ? -1 : 1)) % (count + 1)) - 1;
    } else if (action === 'left' || action === 'right') {
      if (this.focus === -1) this.tab = action === 'left' ? 'keyboard' : 'gamepad';
      else if (this.focus >= ACTIONS.length) {
        // Bottom buttons: left/right cycles between them (Reset, Layout, Done)
        const order = [ACTIONS.length, ACTIONS.length + 2, ACTIONS.length + 1];
        const idx = order.indexOf(this.focus);
        this.focus = order[(idx + (action === 'left' ? order.length - 1 : 1)) % order.length];
      } else if (this.focus < ACTIONS.length && bindingSlots(this.tab, ACTIONS[this.focus].id) === 2) {
        this.preferredChip = action === 'left' ? 0 : 1;
      }
    } else if (action === 'confirm') {
      if (this.focus === -1) { this.focus = 0; return true; }
      else if (this.focus === ACTIONS.length) this.reset();
      else if (this.focus === ACTIONS.length + 1) { this.save(); return 'exit'; }
      else if (this.focus === ACTIONS.length + 2) {
        input.gamepadLayout = LAYOUT_OPTIONS[(LAYOUT_OPTIONS.indexOf(input.gamepadLayout) + 1) % LAYOUT_OPTIONS.length];
        this.save();
      } else { input.beginCapture(this.tab); this._pulseT = 0; }
    }
    return true;
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
    const tabY = 72;
    const tabs = ['KEYBOARD', 'GAMEPAD'];
    const tabXs = [292, 592]; // centered above each column's chips
    for (let i = 0; i < tabs.length; i++) {
      const tx = tabXs[i];
      const active = (i === 0 && this.tab === 'keyboard') || (i === 1 && this.tab === 'gamepad');
      ctx.save();
      if (active) {
        ctx.fillStyle = 'rgba(255,110,199,0.15)';
        roundRect(ctx, tx - 45, tabY - 14, 90, 28, 6);
        ctx.fill();
        ctx.strokeStyle = PINK;
        ctx.lineWidth = this.focus === -1 ? 3 : 1;
        roundRect(ctx, tx - 45, tabY - 14, 90, 28, 6);
        ctx.stroke();
      }
      drawPrompt(ctx, tabs[i], tx, tabY + 2, 16, { color: active ? PINK : '#888' });
      ctx.restore();
    }

    let listStartY = 100;

    // Action rows
    const rowH = 28;
    const listX = 100;
    const listW = VIEW_W - 200;

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

      // Fixed slots, no extra Add chip on any row.
      const labels = Array.from({ length: bindingSlots(this.tab, action.id) }, (_, slot) =>
        this.formatBinding(this.mapping[this.tab][action.id][slot]));
      const widths = labels.map(label => Math.min(360, Math.max(52, label.length * 9 + 20)));
      const startX = listX + 200, available = listW - 220;
      const selected = focused ? this.chip : 0;
      const offsets = widths.map((_, j) => widths.slice(0, j).reduce((n, w) => n + w + 8, 0));
      const scroll = Math.max(0, offsets[selected] + widths[selected] - available);
      ctx.save();
      ctx.beginPath(); ctx.rect(startX, y - 12, available, 26); ctx.clip();
      for (let j = 0; j < labels.length; j++) {
        const chipX = startX + offsets[j] - scroll;
        const active = focused && j === this.chip;
        ctx.fillStyle = active ? (this.capturing ? 'rgba(255,110,199,0.5)' : 'rgba(255,110,199,0.15)') : '#1a1a2e';
        roundRect(ctx, chipX, y - 9, widths[j], 22, 4); ctx.fill();
        ctx.strokeStyle = active ? PINK : focused ? GOLD : '#555';
        ctx.lineWidth = active && this.capturing ? 3 : 1; ctx.stroke();
        // Symbol-friendly system font keeps PS shapes and stick arrows legible.
        drawPrompt(ctx, labels[j], chipX + widths[j] / 2, y + 2, 15,
          { color: active ? CREAM : '#bbb', font: 'sans-serif' });
      }
      ctx.restore();
      if (offsets.at(-1) + widths.at(-1) > available) {
        drawPrompt(ctx, '↔', listX + listW - 8, y + 2, 15, { color: GOLD });
      }
    }

    // Bottom bar — three styled buttons
    const botY = 455;
    const btnW = 160, btnH = 26, gap = 40;
    const btns = [
      { label: 'RESET TO DEFAULTS', x: VIEW_W/2 - btnW - gap/2, focus: this.focus === ACTIONS.length },
      { label: `LAYOUT: ${this.gamepadLayout.toUpperCase()}`, x: VIEW_W/2, focus: this.focus === ACTIONS.length + 2 },
      { label: 'DONE', x: VIEW_W/2 + btnW + gap/2, focus: this.focus === ACTIONS.length + 1 },
    ];
    for (const b of btns) {
      ctx.save();
      ctx.fillStyle = b.focus ? 'rgba(255,110,199,0.2)' : '#1a1a2e';
      roundRect(ctx, b.x - btnW/2, botY - btnH/2, btnW, btnH, 6); ctx.fill();
      ctx.strokeStyle = b.focus ? PINK : '#555';
      ctx.lineWidth = b.focus ? 2 : 1; ctx.stroke();
      drawPrompt(ctx, b.label, b.x, botY + 1, 13, { color: b.focus ? CREAM : '#aaa' });
      ctx.restore();
    }

    // Two readable hint lines, separated from actions and footer controls.
    const hint = this.capturing
      ? 'Press a binding — automatically captures the next row'
      : '↑ ↓ Row    ← → Chip    Confirm: start capture sequence';
    drawPrompt(ctx, hint, VIEW_W / 2, 482, 16, { color: this.capturing ? PINK : CREAM });
    drawPrompt(ctx, this.capturing ? 'Esc / East button: stop capture • Held inputs must be released'
      : '↑ ↓ Navigate    ← → Chip / Tab    Confirm: edit    Esc / ○: back',
      VIEW_W / 2, 511, 14, { color: '#aaa' });
  },

  formatBinding(value) {
    return formatBinding(value, this.tab, this.gamepadLayout === 'Auto' ? input.state.gamepadLayout || 'Generic' : this.gamepadLayout);
  },
};
