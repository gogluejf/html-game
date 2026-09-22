// Petal Panic — Effect Theater overlay ().
// A DEBUG-ONLY preview surface that steps through every registered effect in
// catalog order (theaterList() from effects/index.js, ). When active it
// paints the whole viewport black, shows a title + the current effect's name and
// id/type, an index indicator, and runs the current effect's stateless demo each
// frame with an increasing elapsed time `t`.
// This module is self-contained: update.js / render.js / debug.js only CALL into
// it (open/close/step/update/draw). It never touches the effect engine's core
// lifecycle (fire/update/draw/reset) directly — it just invokes the demos, which
// internally reuse the engine's own record/render path.
// Pure + deterministic: no Math.random, no DOM. The demo clock (`clock`) is the
// single piece of mutable state; it advances in update(dt) while active and
// restarts at 0 on open() and step(). Node-testable without a canvas (draw takes
// a ctx stub).

import { theaterList } from './theater-scenes.js';
import { resetEffects, DEMO_VIEW } from './index.js';
import { particles } from '../particles.js';
import { navLabelString, navLabels } from '../input.js';
import { EFFECT_META } from './theater-meta.js';

// Built once at import: the catalog is static for the life of the process.
const list = theaterList();

export const Theater = {
  active: false,
  index: 0,
  // Elapsed time within the current effect's demo (seconds). Stateless demos
  // re-fire fresh at t=0 and advance to `t`, so this is the only clock needed.
  // Negative = pre-roll delay before the demo starts (gives the eye a beat).
  clock: -0.5,

  /** Number of previewable effects (== theaterList().length). */
  get count() { return list.length; },

  /** The currently-selected entry ({ type, name, demo }). */
  current() { return list[this.index]; },

  /** Open the theater: activate, reset to the first effect, restart the clock.
   *  Also clears any in-flight engine instances so a mid-flight gameplay effect
   *  (e.g. a live camera-shake) doesn't linger behind the black overlay. */
  open() {
    this.active = true;
    this.index = 0;
    this.clock = -0.5;
    resetEffects(); // clean slate: no real-gameplay instances under the overlay
  },

  /** Close the theater (return to normal debug mode). Clears any demo instance
   *  left in the shared engine by the last demo so it doesn't leak into
   *  gameplay on resume (a lingering camera-shake/vignette/flash would otherwise
   *  show for one frame after the overlay lifts). */
  close() {
    this.active = false;
    resetEffects(); // drop the last demo's instances before gameplay resumes
    particles.reset(); // clear any demo particles so they don't leak into gameplay
  },

  /**
   * Step to the previous (-1) or next (+1) effect, wrapping around at both ends.
   * Restarts the demo clock so the new effect plays from t=0.
   * @param {-1|1} dir -1 = prev, +1 = next
   */
  step(dir) {
    if (!this.active) return;
    this.index = (this.index + dir + list.length) % list.length;
    this.clock = -0.5;
  },

  /** Advance the demo clock by dt seconds. No-op when inactive. */
  update(dt) {
    if (this.active) this.clock += dt;
  },

  /**
   * Draw the black-screen theater overlay. Must be called LAST (on top of all
   * game + debug HUD rendering) so the black fill covers everything. No-op when
   * inactive.
   * @param {object} ctx CanvasRenderingContext2D
   * @param {number} w viewport width (VIEW_W)
   * @param {number} h viewport height (VIEW_H)
   */
  draw(ctx, w, h) {
    if (!this.active) return;
    const entry = list[this.index];
    const meta = EFFECT_META[entry.type];
    ctx.save();

    // 1. Fill the entire viewport black.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // Layout: demo area on left/center, info panel on right (~240px)
    const panelW = 240;
    const panelX = w - panelW;
    const demoW = panelX - 20;

    // 2. Title at top center of demo area.
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('EFFECT THEATER', demoW / 2, 44);

    // 3. Current effect name (large) + section number.
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#7df';
    ctx.fillText(`${entry.section}. ${entry.name}`, demoW / 2, 96);

    // 4. Index indicator.
    ctx.font = '14px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText(`${this.index + 1} / ${list.length}`, demoW / 2, h - 40);

    // 5. Run the current demo (centered in demo area).
    ctx.save();
    ctx.translate((demoW - DEMO_VIEW.w) / 2, (h - DEMO_VIEW.h) / 2);
    entry.demo(ctx, this.clock);
    ctx.restore();

    // 6. Right info panel.
    if (meta) {
      ctx.save();
      // Panel background
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(panelX, 60, panelW - 10, h - 100);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.strokeRect(panelX, 60, panelW - 10, h - 100);

      let py = 80;
      ctx.textAlign = 'left';

      // Description
      ctx.font = '12px monospace';
      ctx.fillStyle = '#aaa';
      const words = meta.desc.split(' ');
      let line = '';
      for (const word of words) {
        if ((line + word).length > 32) {
          ctx.fillText(line, panelX + 12, py);
          py += 16;
          line = word + ' ';
        } else {
          line += word + ' ';
        }
      }
      if (line) { ctx.fillText(line.trim(), panelX + 12, py); py += 16; }
      py += 12;

      // Params header
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#7df';
      ctx.fillText('PARAMS', panelX + 12, py);
      py += 18;

      // Param list
      ctx.font = '11px monospace';
      for (const p of meta.params) {
        const icon = p.config ? '✅' : '❌';
        ctx.fillStyle = p.config ? '#ccc' : '#666';
        ctx.fillText(`${icon} ${p.key}`, panelX + 12, py);
        ctx.fillStyle = '#666';
        ctx.fillText(`   ${p.desc}`, panelX + 12, py + 12);
        py += 26;
        if (py > h - 60) break; // don't overflow into hint bar
      }
      ctx.restore();
    }

    // 7. Hint text at bottom (dynamic labels from input API).
    const stepIcons = [...navLabels('left', { simple: true }), ...navLabels('right', { simple: true })].join('/');
    const confirmLabel = navLabelString('confirm');
    const backLabel = navLabelString('back');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#666';
    ctx.font = '12px monospace';
    ctx.fillText(`${stepIcons} step   [${confirmLabel}] replay   [${backLabel}] close   F2 toggle`, demoW / 2, h - 16);

    ctx.restore();
  },
};
