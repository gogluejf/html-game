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
  _chipPos: 0,           // absolute chip position across both columns
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
    this.focus = 0;
    this.preferredChip = 0;
    this._chipPos = 0;
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
      this.focus = (this.focus + count + (action === 'up' ? -1 : 1)) % count;
    } else if (action === 'left' || action === 'right') {
      if (this.focus >= ACTIONS.length) {
        // Bottom buttons: left/right cycles between them
        const order = [ACTIONS.length, ACTIONS.length + 2, ACTIONS.length + 1];
        const idx = order.indexOf(this.focus);
        this.focus = order[(idx + (action === 'left' ? order.length - 1 : 1)) % order.length];
      } else {
        // Navigate across ALL chips in the row (keyboard + gamepad)
        const kbSlots = bindingSlots('keyboard', ACTIONS[this.focus].id);
        const gpSlots = bindingSlots('gamepad', ACTIONS[this.focus].id);
        const total = kbSlots + gpSlots;
        this._chipPos = (this._chipPos + total + (action === 'left' ? -1 : 1)) % total;
        if (this._chipPos < kbSlots) { this.tab = 'keyboard'; this.preferredChip = this._chipPos; }
        else { this.tab = 'gamepad'; this.preferredChip = this._chipPos - kbSlots; }
      }
    } else if (action === 'confirm') {
      if (this.focus === ACTIONS.length) this.reset();
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
    drawMarqueeTitle(ctx, 'CONTROLS', VIEW_W / 2, 34, 32, { color: CREAM });

    // Layout constants
    const labelX = 70;           // action labels
    const kbX = 250;             // keyboard chips start
    const gpX = 580;             // gamepad chips start
    const chipW = 76;
    const chipGap = 8;
    const rowH = 28;
    const listTop = 95;          // first row Y
    const headerY = 70;          // column headers

    // Column headers — static labels, always visible
    drawPrompt(ctx, 'KEYBOARD', kbX + 76, headerY + 2, 15, { color: CREAM });
    drawPrompt(ctx, 'GAMEPAD', gpX + 76, headerY + 2, 15, { color: CREAM });

    // Action rows — both columns always drawn
    for (let i = 0; i < ACTIONS.length; i++) {
      const y = listTop + i * rowH;
      const focused = i === this.focus;
      const action = ACTIONS[i];

      // Full-width row highlight
      if (focused) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,110,199,0.07)';
        roundRect(ctx, labelX - 10, y - 11, VIEW_W - 2*(labelX - 10), rowH - 2, 4);
        ctx.fill();
        ctx.strokeStyle = PINK;
        ctx.lineWidth = 1.5;
        roundRect(ctx, labelX - 10, y - 11, VIEW_W - 2*(labelX - 10), rowH - 2, 4);
        ctx.stroke();
        ctx.restore();
      }

      // Action label (left side)
      drawPrompt(ctx, action.label, labelX, y + 2, 14, {
        align: 'left', color: focused ? CREAM : '#aaa',
      });

      // Draw chips for both sources simultaneously
      for (const src of ['keyboard', 'gamepad']) {
        const baseX = src === 'keyboard' ? kbX : gpX;
        const isActive = this.tab === src;
        const slots = bindingSlots(src, action.id);
        const dimmed = !isActive;

        for (let j = 0; j < slots; j++) {
          const cx = baseX + j * (chipW + chipGap);
          const label = formatBinding(this.mapping[src][action.id][j], src, this.gamepadLayout === 'Auto' ? input.state.gamepadLayout || 'Generic' : this.gamepadLayout);
          const isFocus = focused && isActive && j === this.chip;
          const isCap = isFocus && this.capturing;

          ctx.save();
          ctx.globalAlpha = dimmed ? 0.4 : 1;
          ctx.fillStyle = isCap ? 'rgba(255,110,199,0.5)'
            : isFocus ? 'rgba(255,110,199,0.15)' : '#1a1a2e';
          roundRect(ctx, cx, y - 9, chipW, 22, 4); ctx.fill();
          ctx.strokeStyle = isCap ? PINK : isFocus ? GOLD : '#555';
          ctx.lineWidth = isCap ? 3 : 1; ctx.stroke();
          drawPrompt(ctx, label, cx + chipW/2, y + 2, 14,
            { color: isFocus ? CREAM : '#bbb', font: 'sans-serif' });
          ctx.restore();
        }
      }
    }

    // Bottom bar — three styled buttons
    const botY = 455;
    const btnW = 170, btnH = 28, gap = 30;
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

    // Hint
    const hint = this.capturing
      ? `Press a ${this.tab === 'keyboard' ? 'key' : 'button'} — auto-advances`
      : '↑ ↓ Row    ← → All chips    Confirm: edit    Esc/○: back';
    drawPrompt(ctx, hint, VIEW_W / 2, 490, 15, { color: this.capturing ? PINK : CREAM });
    drawPrompt(ctx, this.capturing ? 'Esc (keyboard) / ○ (gamepad): stop capture'
      : 'Left/right on bottom bar: switch buttons',
      VIEW_W / 2, 512, 13, { color: '#999' });
  },

  formatBinding(value) {
    return formatBinding(value, this.tab, this.gamepadLayout === 'Auto' ? input.state.gamepadLayout || 'Generic' : this.gamepadLayout);
  },
};
