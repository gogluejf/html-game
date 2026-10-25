# Vibration (Haptics) — Extension Plan

Status: **proposal** · Engine core already shipped (`js/haptics.js`, shake funnel in `effects/index.js`)

## What exists today (done, committed-pending)

- `js/haptics.js` — single funnel: presets, `settings.vibration` fast-exit gate,
  gamepad `dual-rumble` first → `navigator.vibrate` pulse-pattern fallback → silent no-op.
- Presets: `nav` (18ms tick), `impactSoft/Med/Hard` (90/140/220ms).
- **Camera-shake → rumble**: every `camera-shake` instance rumbles at spawn
  (`spawnFromConfig` hook) — covers legacy kicks AND declarative attack fires
  (explosion, shockwave, surfaceStrike, theater replays).
- Virtual gamepad press → `haptic('nav')` (migrated from ad-hoc buzz()).

## Design rule

Asymmetry: **your** feedback is light + frequent; **pain/big-event** feedback is heavy + rare.
Every new event gets its OWN preset (pause+length shaped) and ONE hook at a single funnel point.
No per-call-site setting checks — the funnel owns the gate.

## New presets to add

| preset | shape | feel |
|---|---|---|
| `hitLanded` | [0.3, 0.45, 35] | quick soft tick — "connected" |
| `heroHit` | [0.7, 0.8, 140] double-pulse on touch | punchy thump — "that hurt you" |
| `beamHum` | [0.2, 0.3] constant for beam duration (start/stop) | low sustained texture |
| `pickup` | [0.4, 0.5, 40, gap 40, 40] double-tap | pleasant "good thing" |
| `bossIntro` | [0→1 ramp via 3 rising pulses, ~500ms total] | slow dramatic build |
| `stompLand` | [1.0, 1.0, 260] solid block | heavy thud at exact land frame |

## Effects & hooks (in priority order)

### T1 — do next (the triangle: you hit / they hit / boom)

1. **Hit landed (you → enemy)** — `hitLanded`
   - Hook: central `damage()` in `js/combat/damage.js`, when `source` is hero-side
     (`source.layer === LAYER.HERO` or source carries `traceStats`) and target is an enemy.
   - Covers ALL attack types at once (projectile, melee, explosion, special) — one line.
   - Skip when target is the hero (that's #2) or objects/barrels (no traceStats → naturally excluded? verify).
2. **Hero takes damage** — `heroHit`
   - Hook: same `damage()`, when `target.layer === LAYER.HERO`.
   - MUST respect i-frames: only fire when real damage actually drained energy
     (i.e. not during intangible window — verify the call path skips damage() entirely during iframes; if it still calls with 0, gate on `real > 0`).
   - Boss melee, enemy contact, foe projectiles all route through damage() → covered.

### T2 — texture

3. **Beam sustain** — `beamHum`
   - CONSTANT low rumble for the beam's full duration (start → stop), NOT
     per-damage-tick (machine-gun noisy) and NOT single start/end pulses.
     Steady hum reads as "sustained weapon is on". Needs the start/stop API
     (same mechanism as the mine-warning hum, T3) — a long-duration
     `playEffect` is cheap; touch fallback uses a repeating short-pulse
     pattern since navigator.vibrate can't do true constant intensity.
   - Weakest preset after nav — beams are frequent, must stay subtle.
   - Sweeping/targeted beams inherit automatically (they invoke the beam primitive).
4. **Stomp land (dedicated)** — `stompLand`
   - Stomp macro currently rumbles via its camera-shake kick. Add a dedicated
     full-strength thud at the exact impact frame (stomp state → 'impact' transition),
     then let the shake-derived one ride on top (layering = weight).
   - skyDiveStomp lands too — same hook point if it shares the stomp state machine.
5. **Pickup / powerup** — `pickup`
   - Hook: pickup collection site (coin/powerup consume in update or objects layer).
   - Double-tap pattern distinguishes "good" from "boom".
6. **Boss intro** — `bossIntro`
   - Hook: `bossFlow.js` intro start (one-shot per boss zone entry, not per phase).
   - Longest preset in the table; must NOT re-fire on replay of the same zone.

### T3 — later / needs stateful API

7. **Mine warning (sustained danger)** — low rumble WHILE a mine blinks, stop on detonate.
   - First start/stop haptic: needs `resetEffect()` handling + a "stop" path in the
     funnel (`hapticStop()`). Detonation's own impact rumble replaces it.
   - Only worth it if T1–T2 feel right; risk of annoyance if mines are common.
8. **Dash combo segment ticks** — micro-tick per segment freeze-frame.
   - dashCombo tracks segments; 3 tiny ticks read very fighting-game.
   - Low priority: hitLanded (#1) already covers the contact feel.
9. **Ambient loops (earthquake etc.)** — skip until start/stop API proven by #7.

## Explicitly NOT doing

- Per-projectile fire ticks (gunfire rumble) — fights the SFX lane, gets noisy.
- Rumble during hero i-frames — teaches players to ignore the signal.
- Any per-call-site `if (vibration)` checks — the funnel owns the gate.

## Coupling decision (open)

- `screenShake` OFF + `vibration` ON currently still rumbles on shake events
  (settings are independent). Decision pending: couple them
  (`hapticForShake` also reads screenShake) so shake-off = no impact feedback?
  Default proposal: **keep independent** (rumble is its own channel, like audio).

## Test plan

- Extend `js/test/haptics.test.js`: one test per new preset shape + one per hook
  (damage() hero→enemy fires hitLanded; damage() →hero fires heroHit; beam start
  starts beamHum + beam end stops it; pickup fires pickup; boss intro fires once).
- damage() tests must assert NO rumble when: vibration off, target dead (real=0),
  object targets (barrels).
- Full suite failure set must stay identical to clean HEAD.

## Rollout

Each item = one small commit (preset + hook + test). Order: 1 → 2 → 3 → 4 → 5 → 6,
then reassess T3 with real feel feedback.
