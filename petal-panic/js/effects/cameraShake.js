// Petal Panic — camera-shake effect (effects.md §13, catalog #13).
// Temporarily shakes the game camera: all world-space objects move together
// while HUD/UI elements remain stable. Useful for explosions, boss landings,
// heavy melee attacks, earthquakes, and major impacts.
//
// STATE effect, not a draw effect: render() is a no-op. The camera consumes
// the current offset each frame through the instance's getOffset() accessor
// (same consumption pattern as spriteShake.js — the engine stays free of any
// per-effect branching; the consumer reads the offset off the instance body).
// The pre-refactor monolith equivalent was systems/update.js `triggerShake` +
// `updateShake` + `getShakeOffset` (ease-out linear decay over 0.25s); this
// type generalizes that behavior into params so it is attachable via carrier
// config and demoable in the theater.
//
// params: { intensity?, duration?, frequency?, hStrength?, vStrength?, decay? }
//   intensity  — base shake magnitude in px (default 6, the legacy barrel /
//                bomb trigger value)
//   duration   — TOTAL lifetime in seconds; the effect is done exactly when
//                `duration` elapses and getOffset() returns {x:0,y:0} after
//                that (default 0.25, the legacy SHAKE_DURATION)
//   frequency  — how often the random offset re-rolls, in Hz (default 0 =
//                "perFrame": a fresh random offset EVERY update() call, the
//                legacy monolith behavior). A positive value f re-rolls every
//                1/f seconds and HOLDS the previous offset between rolls; the
//                first roll happens on the first update after fire. Keep 30
//                available as an explicit param choice for slower jitter.
//   hStrength  — horizontal multiplier on the effective magnitude (default 1)
//   vStrength  — vertical multiplier on the effective magnitude (default 1)
//   decay      — decay exponent: amplitude(t) = intensity * (remaining/duration)^decay
//                (default 1 = linear ease-out, the monolith's behavior)
//
// Per-frame offset: while active, each axis is a fresh uniform random in
// [-hStrength*amp, +hStrength*amp] (resp. vStrength*amp), where amp follows
// the decay curve above. With the default frequency 0 ("perFrame") the offset
// re-rolls on EVERY update() call — exactly the legacy monolith behavior;
// with a positive frequency f it re-rolls every 1/f seconds and holds constant
// between rolls, so `frequency` has an observable effect at any frame rate.
// After `duration` elapses (or complete()) the offset is exactly {x:0,y:0}.

const DEFAULT_INTENSITY = 6; // legacy triggerShake(6) for bombs / enemy deaths
const DEFAULT_DURATION = 0.25; // legacy SHAKE_DURATION
const DEFAULT_FREQUENCY = 0; // 0 = "perFrame": re-roll every update() (legacy)

/**
 * @param {{intensity?:number, duration?:number, frequency?:number,
 *         hStrength?:number, vStrength?:number, decay?:number}} params
 * @param {object} carrier
 * @param {object} [ctx]
 * @returns {{getOffset:Function, update:Function, render:Function,
 *            done:boolean, complete:Function}}
 */
export function cameraShake(params = {}) {
  const intensity = Math.max(0, params.intensity ?? DEFAULT_INTENSITY);
  const duration = Math.max(0, params.duration ?? DEFAULT_DURATION);
  // frequency: 0 (or "perFrame") → re-roll every update() call (legacy
  // monolith behavior, the documented default). Positive value f (Hz) →
  // re-roll every 1/f seconds, holding the previous offset between rolls.
  const perFrame = params.frequency === 'perFrame' || (params.frequency ?? DEFAULT_FREQUENCY) === 0;
  const frequency = perFrame ? Infinity : Math.max(1, params.frequency);
  const hMul = params.hStrength ?? 1;
  const vMul = params.vStrength ?? 1;
  const decayExp = params.decay ?? 1;
  const rollPeriod = 1 / frequency; // seconds between random re-rolls (0 if perFrame)

  return {
    intensity, // original kick magnitude — the shim's max-kick merge reads this
    elapsed: 0,
    remaining: duration,
    lastRoll: -Infinity, // forces a roll on the first update()
    x: 0,
    y: 0,
    /** Current camera offset {x,y} in px; {0,0} once done. */
    getOffset() {
      if (this.done) return { x: 0, y: 0 };
      return { x: this.x, y: this.y };
    },
    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      if (this.elapsed >= duration - 1e-9) {
        // <= (not <): floating-point accumulation lands at ~1e-16 past the
        // exact boundary, so a strict comparison would never mark done.
        this.remaining = 0;
        this.x = 0;
        this.y = 0;
        this.done = true;
        return;
      }
      this.remaining = duration - this.elapsed;
      // Re-roll when the previous roll is older than one period. With
      // perFrame mode (rollPeriod 0) every update() re-rolls — legacy parity.
      // lastRoll starts at -Infinity so the FIRST update always rolls.
      if (this.elapsed - this.lastRoll >= rollPeriod - 1e-9) {
        this.lastRoll = this.elapsed;
        const t = this.remaining / duration; // 1 → 0 over the lifetime
        const amp = intensity * Math.pow(t, decayExp);
        this.x = (Math.random() * 2 - 1) * hMul * amp;
        this.y = (Math.random() * 2 - 1) * vMul * amp;
      }
    },
    /** Reset the lifetime clock: a smaller kick keeps this instance's peak
     *  but restarts the full decay curve from now (legacy triggerShake's
     *  unconditional `shakeTimer = SHAKE_DURATION` reset). */
    resetTimer() {
      if (this.done) return;
      this.elapsed = 0;
      this.remaining = duration;
      this.lastRoll = -Infinity; // forces a fresh roll on the next update()
    },
    render() {}, // state effect — consumed by the camera, never drawn
    complete() {
      this.done = true;
      this.x = 0;
      this.y = 0;
    },
    done: false,
  };
}
