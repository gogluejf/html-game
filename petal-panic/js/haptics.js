// Petal Panic — Haptics (engine-level vibration, single funnel).
//
// ONE owner of every vibration signal in the game. Replaces the ad-hoc
// navigator.vibrate call in ui/touchControls.js and adds gamepad haptics:
// when a physical pad is connected its actuator gets the SAME events with
// real 0..1 intensity (dual-rumble), while touch devices fall back to
// navigator.vibrate pulse patterns (duration-only API — intensity is faked
// with pulse cadence, the standard workaround).
//
// Delivery rules:
//   - settings.vibration off → every call returns immediately (fast path).
//   - Gamepad connected → playEffect('dual-rumble') on its actuator.
//     Mobile with a Bluetooth pad: the pad wins and the phone motor stays
//     silent — one rumble source, no double buzz.
//   - No pad / unsupported browser (Firefox has no playEffect) →
//     navigator.vibrate pattern fallback where available; silent elsewhere.
//
// Presets mirror the audio "pause + length" technique: each event is a short
// burst shaped by duration + intensity, not a long flat buzz.
//
// Pure module — safe under node tests (navigator is feature-detected).

// settings.vibration gate (menu-hub §4.1) — same store the screenShake funnel reads
import { loadStore } from './systems/progressStore.js';

/** Haptic presets: [strongMagnitude, weakMagnitude, durationMs]. */
export const HAPTIC_PRESETS = Object.freeze({
  // Navigation — virtual gamepad press tick (replaces touchControls' 15ms buzz).
  nav:        Object.freeze([0.25, 0.4, 18]),
  // Impacts — fired from the camera-shake funnel (explosions, stomps, boss
  // landings, barrel pops). Magnitude scales with the shake kick at fire time.
  impactSoft: Object.freeze([0.35, 0.5, 90]),    // light hit / small blast
  impactMed:  Object.freeze([0.6, 0.7, 140]),    // bomb / enemy death
  impactHard: Object.freeze([0.9, 1.0, 220]),    // stomp / boss slam
});

const SHAKE_TO_IMPACT_MS = 20; // px of shake intensity per ms of rumble (cap)

let _enabled = true; // test seam — production always reads the store setting

/** Test seam: force-enable/disable regardless of the persisted setting. */
export function setHapticsEnabled(v) { _enabled = !!v; }

/** Fast gate: false when the user turned Vibration off in Options. */
export function hapticsEnabled() {
  if (!_enabled) return false;
  try { return loadStore().settings.vibration !== false; } catch { return true; }
}

/**
 * Fire a haptic event through the single funnel.
 * @param {'nav'|'impactSoft'|'impactMed'|'impactHard'} preset
 * @param {{scale?:number}} [opts] scale multiplies magnitudes (clamped 0..1);
 *   used by the shake funnel to map kick magnitude onto intensity.
 */
export function haptic(preset, opts = {}) {
  if (!hapticsEnabled()) return; // fast exit — nothing else runs
  const p = HAPTIC_PRESETS[preset];
  if (!p) return;
  const s = Math.max(0, Math.min(1, opts.scale ?? 1));
  const strong = Math.min(1, p[0] * s);
  const weak = Math.min(1, p[1] * s);
  const duration = p[2];
  if (typeof navigator === 'undefined') return;

  // 1) Physical gamepad — real dual-motor intensity.
  let delivered = false;
  for (const pad of navigator.getGamepads?.() ?? []) {
    if (!pad || pad.connected === false) continue;
    const act = pad.vibrationActuator;
    if (!act?.playEffect) continue; // Firefox: interface exists, method doesn't
    try {
      act.playEffect('dual-rumble', {
        startDelay: 0, duration,
        strongMagnitude: strong, weakMagnitude: weak,
      });
      delivered = true;
    } catch { /* actuator busy/gone — fall through to device fallback */ }
    if (delivered) break;
  }
  if (delivered) return;

  // 2) Device motor (touch) — duration-only API; intensity is faked with
  //    pulse cadence: hard = solid block, medium = two pulses, soft = ticks.
  if (!navigator.vibrate) return;
  let pattern;
  if (preset === 'impactHard') pattern = duration;
  else if (preset === 'impactMed') pattern = [Math.round(duration * 0.55), 50, Math.round(duration * 0.45)];
  else if (preset === 'impactSoft') pattern = [40, 40, 40, 40, 40];
  else pattern = 15; // nav tick — exact parity with the old buzz()
  try { navigator.vibrate(pattern); } catch { /* unsupported context — ignore */ }
}

/**
 * Camera-shake → haptics mapping (the single attack-side hookup for now:
 * every explosion/stomp/shockwave that shakes the camera rumbles too).
 * @param {number} mag shake kick magnitude in px (triggerShake's argument)
 */
export function hapticForShake(mag) {
  if (mag <= 0) return;
  const preset = mag >= 12 ? 'impactHard' : mag >= 6 ? 'impactMed' : 'impactSoft';
  const scale = Math.max(0.4, Math.min(1, (mag * SHAKE_TO_IMPACT_MS) / HAPTIC_PRESETS[preset][2]));
  haptic(preset, { scale });
}
