// Petal Panic — SpritePlayer: the single playback engine for sheet anims.
//
// Source of truth: docs/architecture/sprites.md §5 (Timing), §6 (Modes &
// Directions), §7 (Relative timing). Replaces the legacy Anim class (constant
// speed + forward loop) with full data-driven playback:
//
//   - fps mode: default frame duration = 1/fps; a frame's explicit `duration`
//     (animData.framesMeta[i].duration, in SECONDS) overrides it (§5).
//   - relative mode: gameplay drives traversal via setProgress(p ∈ [0,1]);
//     per-frame durations are IGNORED (§7).
//   - mode 'loop': runs forever. mode 'once': completes AFTER the terminal
//     frame has fully elapsed (done flips only then — the last frame must be
//     visible for its whole duration).
//   - direction: forward | reverse | ping_pong | ping_pong_reverse. Ping-pong
//     traverses 1→2→…→N→N-1→…→2→1→2… with NO endpoint duplication (§6):
//     frames 1 and N are each visited once per turn, never held twice.
//
// PURE: no DOM, no game state — node-testable. One instance per active sprite
// anim; Entity.setAnim() builds it (sprite-engine plan T3.2). Pool respawn
// paths call reset() to rewind without reallocating.

/**
 * @param {object} animData parsed AnimData (spriteData.js):
 *   { fps, mode, direction, timing, frames: [...], framesMeta?: [{duration,...}] }
 * @param {number} [startSlot=0] traversal slot to begin at (0..order-1).
 *   Lets pooled/short-lived entities (coins) start mid-cycle so N instances
 *   don't play in lockstep. The rest of the playback math is unchanged —
 *   it's the same loop, just entered at a different point.
 */
export class SpritePlayer {
  constructor(animData, startSlot = 0) {
    if (!animData || !Array.isArray(animData.frames) || animData.frames.length === 0) {
      throw new Error('SpritePlayer: animData needs a non-empty frames array');
    }
    this._n = animData.frames.length;
    this._fps = Math.max(1, Number(animData.fps) || 12);
    this._mode = animData.mode ?? 'loop';
    this._direction = animData.direction ?? 'forward';
    this._timing = animData.timing ?? 'fps';
    // Per-frame durations in seconds; null → 1/fps default (§5).
    const meta = Array.isArray(animData.framesMeta) ? animData.framesMeta : [];
    this._dur = new Array(this._n);
    for (let i = 0; i < this._n; i++) {
      const d = meta[i]?.duration;
      this._dur[i] = d != null && Number.isFinite(d) && d > 0 ? d : 1 / this._fps;
    }
    // Traversal order as a permutation of frame indices, derived ONCE from
    // direction. Ping-pong builds the out-and-back sequence without repeating
    // the endpoints: [0,1,…,N-1,N-2,…,1] — the next cycle restarts at 1, so
    // frame 0 appears only at the very start (and, on loops, re-entered from
    // the other side as …,1,0,1,… which is correct: 0 is a turning point).
    this._order = this._buildOrder();
    // Position within _order (float: integer part = slot, fraction = time
    // spent in that slot's frame). startSlot lets the caller enter the loop
    // mid-cycle (random phase for pooled entities); clamped to a valid slot.
    this._pos = Math.max(0, Math.min(Math.floor(startSlot) || 0, this._order.length - 1));
    this.done = false;
  }

  /** Build the visit-order permutation for this direction (§6). */
  _buildOrder() {
    const n = this._n;
    if (n === 1) return [0];
    switch (this._direction) {
      case 'reverse':
        return Array.from({ length: n }, (_, i) => n - 1 - i);
      case 'ping_pong': {
        // 0→1→…→n-1→n-2→…→1  (length 2n-2; cycles by re-entering at slot 1)
        const up = Array.from({ length: n }, (_, i) => i);
        const down = Array.from({ length: n - 2 }, (_, i) => n - 2 - i);
        return [...up, ...down];
      }
      case 'ping_pong_reverse': {
        const down = Array.from({ length: n }, (_, i) => n - 1 - i);
        const up = Array.from({ length: n - 2 }, (_, i) => 1 + i);
        return [...down, ...up];
      }
      case 'forward':
      default:
        return Array.from({ length: n }, (_, i) => i);
    }
  }

  /** Duration (s) of the frame currently occupying traversal slot i. */
  _slotDuration(i) {
    return this._dur[this._order[i % this._order.length]];
  }

  /**
   * Advance playback by dt seconds (fps timing only — relative anims are
   * driven by setProgress; ticking them is a no-op).
   * @param {number} dt seconds
   */
  tick(dt) {
    if (this.done || this._timing !== 'fps' || dt <= 0) return;
    // Time-based position: convert dt to "slot-time" by stepping slot by
    // slot (each slot lasts its frame's duration). Fixed-timestep callers
    // make this 1–2 iterations in practice.
    let remaining = dt;
    while (remaining > 1e-9 && !this.done) {
      const slot = Math.floor(this._pos);
      const dur = this._slotDuration(slot);
      const leftInSlot = (1 - (this._pos - slot)) * dur;
      // Epsilon on the boundary: fixed-dt accumulation lands ~1e-16 PAST an
      // exact slot edge (project convention); without it a dt equal to the
      // slot duration would skip the frame entirely.
      if (remaining < leftInSlot - 1e-9) {
        this._pos += remaining / dur;
        remaining = 0;
      } else {
        remaining -= leftInSlot;
        this._advanceSlot(slot);
      }
    }
  }

  /** Move to the next traversal slot, applying mode/direction wrap rules. */
  _advanceSlot(fromSlot) {
    const L = this._order.length;
    const next = fromSlot + 1;
    if (this._mode === 'once') {
      // 'once' completes at the END of the first full traversal: the
      // terminal frame is the LAST slot of _order (direction decides which
      // stored frame that is — §6 "the ending frame depends on direction").
      if (next >= L) { this.done = true; this._pos = L - 1; }
      else this._pos = next;
      return;
    }
    // loop: wrap. For ping-pong orders the sequence is designed so wrapping
    // slot L-1 → 0 reproduces …,2,1,0,1,2,… with no duplicated endpoints.
    this._pos = next % L;
  }

  /**
   * Relative timing (§7): map progress p ∈ [0,1] onto the traversal,
   * ignoring per-frame durations. p=0 → first frame, p=1 → terminal frame
   * (and marks done for 'once'). Clamped; valid on both timings but only
   * MEANINGFUL for timing:'relative' (fps anims ignore clock semantics).
   * @param {number} p progress 0..1
   */
  setProgress(p) {
    const clamped = Math.min(1, Math.max(0, p));
    const L = this._order.length;
    this._pos = clamped * (L - 1);
    if (this._mode === 'once' && clamped >= 1) this.done = true;
  }

  /** Rewind to the start and clear completion (pool respawn path). */
  reset() {
    this._pos = 0;
    this.done = false;
  }

  /** Current frame index IN STORED ORDER (what spriteFrameIndex consumes). */
  get frameIndex() {
    const slot = Math.min(Math.floor(this._pos), this._order.length - 1);
    return this._order[slot];
  }

  /** True once a 'once' anim has finished its terminal frame. */
  get isDone() { return this.done; }
}
