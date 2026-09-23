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
import { drawMarqueeTitle, drawPrompt, roundRect, drawNavBar } from './fonts.js';
import { input, formatBinding, bindingSlots, navHintEntries } from './input.js';
import { FONT_UI } from './fonts.js';

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

// Nav actions shown as EXTRA rows below the gameplay rows. Their KEYBOARD
// binding is fixed (read-only); only the GAMEPAD side is editable. When the
// cursor lands on one of these rows it defaults to the gamepad chip.
const NAV_ROWS = [
  { id: 'confirm', label: 'Confirm' },
  { id: 'back',    label: 'Back' },
];
// Fixed keyboard bindings for nav rows, shown as individual read-only chips
// (the same two-chip layout used when a binding has two slots).
const NAV_KB_KEYS = { confirm: ['Enter', 'Space'], back: ['Escape'] };

const LAYOUT_OPTIONS = ['Keyboard', 'Generic', 'PS5', 'PS4', 'Xbox', '8BitDo', 'Switch'];

export const Remap = {
  // State
  tab: 'keyboard',       // 'keyboard' | 'gamepad'
  focus: 0,              // focused row index (rows, then bottom buttons)
  preferredChip: 0,
  _chipPos: 0,           // absolute chip position across both columns
  get ROWS() { return ACTIONS.length + NAV_ROWS.length; },   // editable/browsable rows
  get COUNT() { return this.ROWS + 3; },                     // rows + 3 bottom buttons
  /** True when the focused row is a nav row (confirm/back). */
  get isNavRow() { return this.focus >= ACTIONS.length && this.focus < this.ROWS; },
  get navRowId() { return this.isNavRow ? NAV_ROWS[this.focus - ACTIONS.length].id : null; },
  /** Total chips in the focused row across both columns (for left/right wrap). */
  _rowSlots(src) {
    if (this.focus < ACTIONS.length) return bindingSlots(src, ACTIONS[this.focus].id);
    if (this.isNavRow) return src === 'keyboard' ? 1 : bindingSlots('gamepad', this.navRowId);
    return 0;
  },
  get chip() {
    if (this.focus < ACTIONS.length)
      return Math.min(this.preferredChip, bindingSlots(this.tab, ACTIONS[this.focus].id) - 1);
    if (this.isNavRow) return 0; // nav rows have a single gamepad chip
    return 0;
  },
  _flashInvalid: 0,      // timer for "INVALID" flash
  _pulseT: 0,            // pulse timer for "PRESS ANY..." text
  _entrySnapshot: null,  // mapping + layout snapshot taken when entering Controls

  get mapping() { return input.mapping; },
  get gamepadLayout() { return input.gamepadLayout; },
  get capturing() { return input.capturing; },
  save() { return input.saveMapping(); },
  reset() { input.resetMapping(); },
  /** Take a snapshot of the current mapping + layout (called on entry). */
  _takeSnapshot() {
    this._entrySnapshot = JSON.parse(JSON.stringify({
      mapping: input.mapping,
      gamepadLayout: input.gamepadLayout,
      keyboardLayout: input.keyboardLayout,
    }));
  },
  /** Revert to the snapshot taken on entry (Cancel behavior). */
  _revertToSnapshot() {
    if (!this._entrySnapshot) return;
    input.mapping = JSON.parse(JSON.stringify(this._entrySnapshot.mapping));
    input.gamepadLayout = this._entrySnapshot.gamepadLayout;
    input.keyboardLayout = this._entrySnapshot.keyboardLayout;
    input.saveMapping();
  },
  resetState() {
    input.cancelCapture();
    this.focus = 0;
    this.preferredChip = 0;
    this._chipPos = 0;
    this.tab = 'keyboard';
    this._flashInvalid = 0;
    this._pulseT = 0;
    this._takeSnapshot();
  },
  onCapture(result) {
    // A 'cancelled' result (keyboard Escape) STOPS the capture sequence and
    // leaves focus exactly where it is — it does NOT advance to the next row.
    if (result?.status === 'cancelled') return;
    // A 'bound' result assigns the binding, then auto-advances to the next
    // editable row (or to DONE after the last row). When the user is on the
    // keyboard side of a row, we do NOT switch to the gamepad side — we go
    // straight to the next row. This keeps the flow fast: one bind per side,
    // no forced tab-switching mid-sequence.
    if (result?.status !== 'bound') return;
    const isGameplay = this.focus < ACTIONS.length;
    // Nav rows are gamepad-only; ignore any keyboard capture result there.
    if (!isGameplay && result.source !== 'gamepad') return;
    const actionId = isGameplay ? ACTIONS[this.focus].id : this.navRowId;
    if (!actionId) return;
    if (!input.setBinding(result.source, actionId, result.binding, this.chip)) return;
    // After binding, decide where to go next:
    // - If we just bound a GAMEPLAY row on the KEYBOARD side and there are
    //   still nav rows ahead, jump straight to DONE — the nav rows are
    //   gamepad-only, so continuing from keyboard would just force a tab
    //   switch with nothing useful to bind.
    // - Otherwise advance to the next row (or DONE after the last row).
    const isLastGameplay = isGameplay && this.focus === ACTIONS.length - 1;
    const fromKeyboard = result.source === 'keyboard';
    if (isLastGameplay && fromKeyboard) {
      this.focus = this.ROWS; // DONE
    } else {
      const next = this.focus + 1;
      if (next < this.ROWS) {
        this.focus = next;
        this._enterRow(next);
        input.beginCapture(this.tab);
        this._pulseT = 0;
      } else {
        this.focus = this.ROWS; // DONE
      }
    }
  },
  /** When entering a row, default the cursor: nav rows → gamepad chip. */
  _enterRow(row) {
    if (row >= ACTIONS.length && row < this.ROWS) {
      this.tab = 'gamepad'; this.preferredChip = 0; this._chipPos = 0;
    }
  },
  onAction(action) {
    if (this.capturing) return true; // input engine owns capture and cancellation
    const count = this.COUNT;
    if (action === 'back') { this._revertToSnapshot(); return 'exit'; }
    if (action === 'up' || action === 'down') {
      const prev = this.focus;
      this.focus = (this.focus + count + (action === 'up' ? -1 : 1)) % count;
      if (this.focus !== prev) this._enterRow(this.focus);
    } else if (action === 'left' || action === 'right') {
      if (this.focus >= this.ROWS) {
        // Bottom buttons: left/right cycles between them
        const order = [this.ROWS, this.ROWS + 1, this.ROWS + 2];
        const idx = order.indexOf(this.focus);
        this.focus = order[(idx + (action === 'left' ? order.length - 1 : 1)) % order.length];
      } else if (this.isNavRow) {
        // Nav rows: only the gamepad chip is editable — no left/right.
      } else {
        // Navigate across ALL chips in the row (keyboard + gamepad)
        const kbSlots = this._rowSlots('keyboard');
        const gpSlots = this._rowSlots('gamepad');
        const total = kbSlots + gpSlots;
        this._chipPos = (this._chipPos + total + (action === 'left' ? -1 : 1)) % total;
        if (this._chipPos < kbSlots) { this.tab = 'keyboard'; this.preferredChip = this._chipPos; }
        else { this.tab = 'gamepad'; this.preferredChip = this._chipPos - kbSlots; }
      }
    } else if (action === 'confirm') {
      // Bottom buttons: DONE (ROWS), LAYOUT (ROWS+1), RESET TO DEFAULTS (ROWS+2)
      if (this.focus === this.ROWS) { this.save(); return 'exit'; }
      else if (this.focus === this.ROWS + 1) {
        input.gamepadLayout = LAYOUT_OPTIONS[(LAYOUT_OPTIONS.indexOf(input.gamepadLayout) + 1) % LAYOUT_OPTIONS.length];
        this.save();
      } else if (this.focus === this.ROWS + 2) this.reset();
      else if (this.isNavRow) {
        // Nav rows: only the gamepad side is editable.
        this.tab = 'gamepad';
        input.beginCapture('gamepad'); this._pulseT = 0;
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
    const rowH = 26;
    const listTop = 90;          // first row Y
    const headerY = 66;          // column headers

    // Column headers — static labels, always visible
    drawPrompt(ctx, 'KEYBOARD', kbX + 76, headerY + 2, 15, { color: CREAM });
    drawPrompt(ctx, 'GAMEPAD', gpX + 76, headerY + 2, 15, { color: CREAM });

    // Action rows — both columns always drawn. Gameplay rows first, then the
    // nav rows (confirm/back) whose keyboard side is read-only.
    for (let i = 0; i < this.ROWS; i++) {
      const y = listTop + i * rowH;
      const focused = i === this.focus;
      const isNav = i >= ACTIONS.length;
      const action = isNav ? NAV_ROWS[i - ACTIONS.length] : ACTIONS[i];

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
        // Nav rows: keyboard shows its fixed keys as individual read-only
        // chips (like a two-slot binding); gamepad is the remappable binding.
        // Gameplay rows use normal slot counts.
        let slots, readOnlyKeys = null;
        if (isNav) {
          if (src === 'keyboard') { slots = NAV_KB_KEYS[action.id].length; readOnlyKeys = NAV_KB_KEYS[action.id]; }
          else slots = bindingSlots('gamepad', action.id);
        } else {
          slots = bindingSlots(src, action.id);
        }
        const readOnly = !!(readOnlyKeys);
        const dimmed = !isActive || readOnly;

        for (let j = 0; j < slots; j++) {
          const cx = baseX + j * (chipW + chipGap);
          let label;
          if (readOnly) label = formatBinding(readOnlyKeys[j], 'keyboard');
          else label = formatBinding(this.mapping[src][action.id][j], src, this.gamepadLayout || 'Generic');
          const isFocus = focused && isActive && !readOnly && j === this.chip;
          const isCap = isFocus && this.capturing;

          ctx.save();
          // Read-only / disabled chips draw NO box — just a dimmed label. No
          // fill, no contour, so they read as fixed info, not an editable slot.
          if (readOnly) {
            ctx.globalAlpha = 0.55;
            drawPrompt(ctx, label, cx + chipW/2, y + 2, 14,
              { color: '#7a7368', font: 'sans-serif' });
            ctx.restore();
            continue;
          }
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
      { label: 'APPLY', x: VIEW_W/2 - btnW - gap/2, focus: this.focus === this.ROWS },
      { label: `LAYOUT: ${this.gamepadLayout.toUpperCase()}`, x: VIEW_W/2, focus: this.focus === this.ROWS + 1 },
      { label: 'RESET TO DEFAULTS', x: VIEW_W/2 + btnW + gap/2, focus: this.focus === this.ROWS + 2 },
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

    // Hint — keycap chip style (single line).
    if (this.capturing) {
      // Only the keyboard Escape cancels a capture (a gamepad button always
      // binds, even the back button), so the hint points at ESC.
      drawNavBar(ctx, VIEW_W / 2, 490, navHintEntries([
        { action: 'back', label: 'Cancel', opts: { source: 'keyboard' } },
      ]));
    } else {
      drawNavBar(ctx, VIEW_W / 2, 490, navHintEntries([
        { actions: ['up', 'down'], label: 'Row', opts: { groupDir: false } },
        { actions: ['left', 'right'], label: 'Chip', opts: { groupDir: false } },
        { action: 'confirm', label: 'Edit' },
        { action: 'back', label: 'Cancel' },
      ]));
    }
  },

  formatBinding(value) {
    return formatBinding(value, this.tab, this.gamepadLayout || 'Generic');
  },
};
