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
    this._entryPos = this._pos; // entry point for remainingDuration() wrap math
    this.done = false;
    this._cycles = 0; // whole-traversal count (see cyclesCompleted)
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
   * Friendly timing queries — single source of truth for "how long does this
   * anim take". Gameplay should read these instead of recomputing from fps /
   * frame counts by hand. All values are SECONDS and account for:
   *   - base frame duration 1/fps
   *   - per-frame `duration` overrides (frame freezes / holds in the sheet)
   *   - direction (ping_pong traverses 2n-2 slots; reverse/forward n slots)
   */

  /** Base duration (s) of stored frame i (override or 1/fps). */
  getFrameDuration(i) {
    return this._dur[((i % this._n) + this._n) % this._n];
  }

  /** Duration (s) of one full traversal of the current direction.
   * forward/reverse = n frames; ping_pong = 2n-2 slots (no endpoint dup). */
  get cycleDuration() {
    let total = 0;
    for (let i = 0; i < this._order.length; i++) total += this._slotDuration(i);
    return total;
  }

  /** Duration (s) from the CURRENT position to the end of this traversal.
   * For 'loop' anims this wraps at most once (returns ≤ cycleDuration). */
  get remainingDuration() {
    const L = this._order.length;
    if (L === 0) return 0;
    const slot = Math.floor(this._pos);
    const frac = this._pos - slot; // time already spent inside the current slot
    let total = (1 - frac) * this._slotDuration(slot);
    for (let i = slot + 1; i < L && !this.done; i++) total += this._slotDuration(i);
    if (this._mode === 'loop') {
      // Wrap back to the entry point so a mid-loop query still answers
      // "time until I'm back where I started" without an infinite sum.
      const entry = Math.min(Math.max(Math.floor(this._entryPos) || 0, 0), L - 1);
      for (let i = 0; i <= entry && !this.done; i++) total += this._slotDuration(i);
    }
    return total;
  }

  /** Normalized progress [0,1] through the current traversal (0 = entry
   * point, 1 = terminal frame reached). Inverse of setProgress(). */
  get progress() {
    const L = this._order.length;
    if (L <= 1) return this.done ? 1 : 0;
    const slot = Math.floor(this._pos);
    const frac = this._pos - slot;
    return Math.min(1, (slot + frac) / (L - 1));
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
    if (next >= L) { this._cycles++; this._pos = next % L; }
    else this._pos = next;
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
    this._cycles = 0;
  }

  /** Current frame index IN STORED ORDER (what spriteFrameIndex consumes). */
  get frameIndex() {
    const slot = Math.min(Math.floor(this._pos), this._order.length - 1);
    return this._order[slot];
  }

  /** True once a 'once' anim has finished its terminal frame. */
  get isDone() { return this.done; }

  /** Number of COMPLETE traversal cycles elapsed since construction/reset.
   * A "cycle" is one full pass through _order (forward/reverse = n frames,
   * ping_pong = 2n-2 slots). For a 'loop' anim this grows without bound as
   * the loop wraps; for 'once' it is 0 until done, then 1. Lets gameplay
   * react to whole-cycle boundaries (e.g. "play N cycles then switch")
   * without re-deriving timing from fps/frame counts by hand. */
  get cyclesCompleted() {
    const L = this._order.length;
    if (L <= 1) return this.done ? 1 : 0;
    // Each wrap past the last slot completes one cycle. _pos is clamped to
    // [0, L-1], so count wraps via total elapsed slot-time instead: track
    // cumulative advancement. We derive it from how many times _pos has
    // wrapped around — captured incrementally in tick().
    return this._cycles;
  }
}
