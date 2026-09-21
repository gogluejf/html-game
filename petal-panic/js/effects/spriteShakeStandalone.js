// Petal Panic — sprite-shake-standalone effect (effects.md §15, catalog #15).
// Localized jitter on a single sprite WITHOUT moving the camera: the renderer
// adds getOffset() to that one sprite's draw position only. Combinable with
// Camera Shake for stronger impacts.
//
// This is the STANDALONE promotion of the hit-flash-driven 'sprite-shake' type
// (js/effects/spriteShake.js, which rides on carrier.hitFlash and stays as-is):
// this type owns its own timer, so it can run on any trigger (charging attacks,
// stunned enemies, machinery, impact reactions) independent of hitFlash.
//
// STATE effect, not a draw effect: render() is a no-op. The renderer consumes
// the current offset each frame through the instance's getOffset() accessor
// (same consumption pattern as cameraShake.js / spriteShake.js — the engine
// stays free of per-effect branching; the consumer reads the offset off the
// instance body).
//
// params: { hIntensity?, vIntensity?, frequency?, duration?, decay? }
//   hIntensity — max horizontal offset in px (default 3, the legacy SHAKE_AMT)
//   vIntensity — max vertical offset in px (default 3)
//   duration   — TOTAL lifetime in seconds; the effect is done exactly when
//                `duration` elapses and getOffset() returns {x:0,y:0} after
//                that (default 0.1, the legacy hitFlash shake window)
//   frequency  — how often the random offset re-rolls, in Hz (default 0 =
//                "perFrame": a fresh random offset EVERY update() call, the
//                legacy monolith behavior). A positive value f re-rolls every
//                1/f seconds and HOLDS the previous offset between rolls; the
//                first roll happens on the first update after fire.
//   decay      — decay exponent: amplitude(t) = intensity * (remaining/duration)^decay
//                applied independently per axis (default 1 = linear ease-out)
//
// Per-frame offset: while active, each axis is a fresh uniform random in
// [-hIntensity*ampX, +hIntensity*ampX] (resp. vIntensity*ampY), where ampX/ampY
// follow the decay curve above. After `duration` elapses (or complete()) the
// offset is exactly {x:0,y:0}.

const DEFAULT_H_INTENSITY = 3; // legacy SHAKE_AMT
const DEFAULT_V_INTENSITY = 3; // legacy SHAKE_AMT
const DEFAULT_DURATION = 0.1; // legacy hitFlash shake window
const DEFAULT_FREQUENCY = 0; // 0 = "perFrame": re-roll every update() (legacy)

/**
 * @param {{hIntensity?:number, vIntensity?:number, frequency?:number,
 *          duration?:number, decay?:number}} params
 * @param {object} [carrier]
 * @param {object} [ctx]
 * @returns {{getOffset:Function, update:Function, render:Function,
 *            done:boolean, complete:Function}}
 */
export function spriteShakeStandalone(params = {}) {
  const hIntensity = Math.max(0, params.hIntensity ?? DEFAULT_H_INTENSITY);
  const vIntensity = Math.max(0, params.vIntensity ?? DEFAULT_V_INTENSITY);
  const duration = Math.max(0, params.duration ?? DEFAULT_DURATION);
  // frequency: 0 (or "perFrame") → re-roll every update() call (legacy
  // monolith behavior, the documented default). Any positive value f (Hz) →
  // re-roll every 1/f seconds, holding the previous offset between rolls. No
  // minimum is clamped: §15 promises arbitrary positive f (e.g. 0.5 Hz = a
  // fresh roll every 2s), so sub-1 Hz values must work verbatim.
  const perFrame = params.frequency === 'perFrame' || (params.frequency ?? DEFAULT_FREQUENCY) === 0;
  const frequency = perFrame ? Infinity : params.frequency;
  const decayExp = params.decay ?? 1;
  const rollPeriod = 1 / frequency; // seconds between random re-rolls (0 if perFrame)

  return {
    elapsed: 0,
    remaining: duration,
    lastRoll: -Infinity, // forces a roll on the first update()
    x: 0,
    y: 0,
    /** Current sprite offset {x,y} in px; {0,0} once done. */
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
        this.x = (Math.random() * 2 - 1) * hIntensity * Math.pow(t, decayExp);
        this.y = (Math.random() * 2 - 1) * vIntensity * Math.pow(t, decayExp);
      }
    },
    render() {}, // state effect — consumed by the renderer, never drawn
    complete() {
      this.done = true;
      this.x = 0;
      this.y = 0;
    },
    done: false,
  };
}
