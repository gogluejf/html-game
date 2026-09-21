// Petal Panic — Effect Theater overlay (task 7.2).
//
// A DEBUG-ONLY preview surface that steps through every registered effect in
// catalog order (theaterList() from effects/index.js, task 7.1). When active it
// paints the whole viewport black, shows a title + the current effect's name and
// id/type, an index indicator, and runs the current effect's stateless demo each
// frame with an increasing elapsed time `t`.
//
// This module is self-contained: update.js / render.js / debug.js only CALL into
// it (open/close/step/update/draw). It never touches the effect engine's core
// lifecycle (fire/update/draw/reset) directly — it just invokes the demos, which
// internally reuse the engine's own record/render path.
//
// Pure + deterministic: no Math.random, no DOM. The demo clock (`clock`) is the
// single piece of mutable state; it advances in update(dt) while active and
// restarts at 0 on open() and step(). Node-testable without a canvas (draw takes
// a ctx stub).

import { theaterList, resetEffects, DEMO_VIEW } from './index.js';

// Built once at import: the catalog is static for the life of the process.
const list = theaterList();

export const Theater = {
  active: false,
  index: 0,
  // Elapsed time within the current effect's demo (seconds). Stateless demos
  // re-fire fresh at t=0 and advance to `t`, so this is the only clock needed.
  clock: 0,

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
    this.clock = 0;
    resetEffects(); // clean slate: no real-gameplay instances under the overlay
  },

  /** Close the theater (return to normal debug mode). Clears any demo instance
   *  left in the shared engine by the last demo so it doesn't leak into
   *  gameplay on resume (a lingering camera-shake/vignette/flash would otherwise
   *  show for one frame after the overlay lifts). */
  close() {
    this.active = false;
    resetEffects(); // drop the last demo's instances before gameplay resumes
  },

  /**
   * Step to the previous (-1) or next (+1) effect, wrapping around at both ends.
   * Restarts the demo clock so the new effect plays from t=0.
   * @param {-1|1} dir -1 = prev, +1 = next
   */
  step(dir) {
    if (!this.active) return;
    this.index = (this.index + dir + list.length) % list.length;
    this.clock = 0;
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
    ctx.save();

    // 1. Fill the entire viewport black.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // 2. Title at top center.
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('EFFECT THEATER', w / 2, 44);

    // 3. Current effect name (large) + id/type (smaller) centered near the top.
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#7df';
    ctx.fillText(entry.name, w / 2, 96);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#aaa';
    ctx.fillText(`type: ${entry.type}`, w / 2, 118);

    // 4. Index indicator.
    ctx.font = '14px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText(`${this.index + 1} / ${list.length}`, w / 2, h - 40);

    // 5. Run the current demo. Demos draw in world coords around a ~160,90 stage
    //    origin on the DEMO_VIEW (320x180) neutral stage; translate so that stage
    //    sits roughly centered in the full logical viewport. Keep it simple — a
    //    single optional translate, no per-effect special-casing.
    ctx.save();
    ctx.translate((w - DEMO_VIEW.w) / 2, (h - DEMO_VIEW.h) / 2);
    entry.demo(ctx, this.clock);
    ctx.restore();

    // 6. Hint text at bottom.
    ctx.fillStyle = '#666';
    ctx.font = '12px monospace';
    ctx.fillText('←/→ step   Esc close   F1/F2 exit', w / 2, h - 16);

    ctx.restore();
  },
};
