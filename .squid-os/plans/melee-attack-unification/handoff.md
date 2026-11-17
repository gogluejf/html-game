# Handoff — Melee Attack Unification (config-driven refactor)

**Project:** petal-panic (`~/src/html-game/petal-panic`)
**Branch:** master · last commit `dbb83e30` (plow shield)
**Date:** 2026-11-16
**Status:** analysis done, no code changed yet. Working tree has two unexplained asset anomalies (see §7).

## 1. Why this refactor exists

The three hero melee attacks are **three independent state machines with hardcoded per-attack special cases** scattered through the combat layer. It works, but:

- Adding a behavior to "one of them" means finding every copy-paste site.
- The user's concrete motivating question: **make super-melee work as a multi-hit parent** (several contact windows under one swing, like the supermove bursts). Today that is impossible without new hardcoding because pin/finisher logic is keyed on `method === 'super'`.
- The user asked for a **configurable pattern**: phase machine, chip vs lethal, hitstop tiers, cancel rules all data-driven per attack.

## 2. Current architecture (verified in code, 2026-11-16)

### 2.1 State machines — `js/hero/hero.js` (1925 lines)

| | Melee (jab) | Super melee (sweep) | Supermove (dash) |
|---|---|---|---|
| Start | `tryMelee()` :922 | `startSpecialMelee()` :1305 | `triggerSupermove()` :1784 |
| Tick | `updateMelee(dt,input)` :1004 | `updateSpecialMelee(dt,input)` :1446 | `updateSupermove(dt,input)` :1739 |
| End | `endNormalMelee()` :1067 | `endSpecialMelee()` :1529 | `endSupermove()` :1825 (+ `_velocityPhaseDone()` :1860) |
| Active flag | `meleeActive` | `specialMeleeActive` | `supermoveActive` |
| Frame clock | `meleeFrame` (5 logical frames) | `specialMeleeFrame` (sheet-length frames) | `supermoveTimer` + `_supermoveElapsed` (two-phase burst/decel) |
| Phase source | frame count vs `MELEE_TOTAL_FRAMES` | **derived from sheet boxes** via `_specialMeleePhaseAt(f)` :1410 | `supermovePhase` ('burst'/'decel'), duration-split by `SUPERMOVE_BURST_FRAC` |
| Duration | `MELEE_DURATION` getter (sheet cycle or 0.4s fallback) | `specialMeleeDuration` getter (sheet cycle or 11/60) | `SUPERMOVE_DUR` const |
| Cancel rule | recovery: jump-edge OR move input → end + clear buffer (§19) | same shared predicate `_meleeCancelRequested()` :1070 | only decel phase: fresh jump press; velocity ramp is NOT the move end |
| Protection | connect window `_connectProtectFrames` armed by `markMeleeConnect()` | same counter, armed by `markSpecialConnect()` | event-based: `setInvincible('supermove')` + `plow=true`, cleared in `endSupermove()` |
| Anim mapping | `_meleeAnimProgress(p)` maps progress onto sheet | same helper | NOT mapped — sheet plays at authored fps, freeze tail after end |

Shared parts already centralized (keep these):
- **Input entry:** `requestMelee(kind)` :959 — one pending slot, latest-wins (§17); fires via `executePendingMelee()` :988 on natural completion. Supermove has its own trigger path (`input.super` + meter full).
- **Recovery-cancel predicate:** `_meleeCancelRequested(input)` used identically by both swings.
- **Hitbox slots:** `js/combat/hitboxes.js` registers 3 persistent slots (melee / specialMelee / super), refreshed each frame from `hero.attackHitboxWorld(name)`; knockback tiers, `finisher`, `hitstop`, `dedupeScope` ride on the resolved box.
- **Impact side:** `js/combat/hitbox.js` `processHitboxes()` — single damage funnel, shake tiers per method (:308), blood methods set :28.

### 2.2 Data — `js/hero/heroDefs.js` (151 lines)

Already declarative per hero:
- `attacks[ATTACK_MELEE]` / `attacks[ATTACK_SUPERMOVE]`: `{ knockbackModerate, knockbackBig }` (chip vs lethal vectors) ✅
- `specialMelee`: SWEEP config — `direction`, `travelSpeed`, fallback `hitbox`, `knockbackModerate/Big`
- Damage boxes are **sheet-authored** (per-frame `attack` boxes on each hero's melee/super_melee/supermove sheets) — resolver reads them live in `attackHitboxWorld()` :1111.
- Hitstop constants exported: `SUPERMOVE_BURST_HITSTOP=4`, `SUPERMOVE_FINISHER_HITSTOP=8`, `SUPERMOVE_HIT_DUR_UNITS=3` (keyframe detection threshold).

### 2.3 Hardcoded special cases (the smell inventory)

1. **Pin eligibility keyed on method string** — `hitbox.js:259,266`: `if (MELEE_FUSABLE && hb.method === 'super' && ...)`. Only the supermove can pin; making super-melee multi-hit requires editing this gate.
2. **Finisher selection hardcoded** — `hitbox.js:236`: `kbVector = hb.finisher ? bigVec : modVec`; finisher flag itself stamped by sheet-box resolution (`box.finisher`). For a new multi-hit attack the "which frame is the finisher" rule must be re-derived.
3. **Shake tier switch on method** — `hitbox.js:308-310`: `hb.method === 'melee' ? MELEE_CONNECT_SHAKE : hb.method === 'specialMelee' ? SUPER_MELEE_CONNECT_SHAKE : ...` — a per-method if-chain, not data.
4. **Three separate end/cleanup routines** — each clears its own flags, hit-target sets, crouch flush, protection. A new attack copies the list and risks missing one.
5. **Phase derivation duplicated 3 ways** — frame-count math (melee), sheet-box scan (special melee, O(n) scan per tick in `_specialMeleePhaseAt`), two-timer split (supermove).
6. **Immunity checked in multiple places** (pre-existing smell, adjacent scope): `invincible` door in `hitResolution.js`, `collisionHandlers.js` ×2, plus `isPlowShielded` pull-based opt-in for self-detonators (`combat/plowShield.js`). Central push-based filter would be the clean fix but is a separate work item.
7. **Death vocabulary sprawl** (adjacent, out of scope here): `aiState='dead'`, `alive=false`, `pinned`, `_detonated`, `exploded`, `_explodeHandled`, `_fuse` — five latches for "is it dead".

## 3. Target design

One **config-driven attack phase machine** owned by the hero; attacks become entries in a config table.

```js
// sketch — js/hero/attackConfigs.js (new)
const ATTACKS = {
  melee: {
    phases: 'frames',            // windup/active/recovery from frame counts
    totalFrames: 5, activeFrom: 2,
    anim: h => h._meleeAirborne ? 'air_melee' : 'melee',
    progressMap: true,           // map swing progress onto sheet player
    cancelIn: 'recovery',        // which phase accepts locomotion cancel
    connectProtect: true,        // arm _connectProtectFrames on clean hit
    dedupeScope: 'swing',
    multiHit: false,             // single contact window
    finisherFrame: null,         // kill-upgrade only (no pinned-to-die)
    shake: MELEE_CONNECT_SHAKE,
  },
  specialMelee: {
    phases: 'sheetBoxes',        // derive from authored attack boxes (current behavior)
    travel: { dir: 1, speed: SWEEP.travelSpeed },
    anim: () => 'super_melee',
    progressMap: true,
    cancelIn: 'recovery',
    connectProtect: true,
    dedupeScope: 'swing',
    multiHit: true,              // ← the user's ask: several boxed frames = several contacts
    finisherFrame: 'lastBoxed',  // last boxed frame gets big-tier + pin-release payoff
    pinEligible: true,           // replace the method==='super' gate
    shake: SUPER_MELEE_CONNECT_SHAKE,
  },
  supermove: {
    phases: 'timers',            // burst + decel timers (velocity ramp ≠ move end)
    duration: SUPERMOVE_DUR, burstFrac: SUPERMOVE_BURST_FRAC,
    velocity: { start: SUPERMOVE_SPEED, residual: SUPERMOVE_RESIDUAL },
    anim: () => 'supermove',
    progressMap: false,          // sheet plays at authored fps + freeze tail
    cancelIn: 'decel',
    invincibleTag: 'supermove', plow: true,   // event-based protection
    multiHit: true, keyframeDurUnits: SUPERMOVE_HIT_DUR_UNITS,
    finisherFrame: 'lastKeyframe',
    pinEligible: true,
    hitstop: { burst: SUPERMOVE_BURST_HITSTOP, finisher: SUPERMOVE_FINISHER_HITSTOP },
    shake: SUPERMOVE_CONNECT_SHAKE,
  },
};
```

Runtime shape:
- `hero.startAttack(name)` / `hero.updateAttack(dt, input)` / `hero.endAttack()` — one generic driver reading the active config. Per-attack hooks only where genuinely different (velocity profile, protection tags) as small strategy functions inside the config, not parallel classes.
- `hitbox.js` gates become data lookups: `cfg.pinEligible`, `cfg.shake`, `cfg.multiHit` — the `method === 'super'` strings disappear.
- Finisher rule becomes one function: `isFinisher(cfg, frameIndex)` covering `'lastBoxed'` / `'lastKeyframe'` / kill-upgrade-only.

Migration order (each step independently testable, existing tests in `js/test/` cover melee + hit resolution):
1. Extract `isFinisher` + shake lookup into data (pure cleanup, zero behavior change).
2. Replace pin gate `method === 'super'` with `pinEligible` flag; give supermove `true`, others `false` (zero behavior change).
3. Build the generic phase driver behind a flag; run melee through it first (simplest clock), diff against old path in tests.
4. Migrate supermove (timers + protection tags — the trickiest), then special melee.
5. Enable `multiHit: true` + `pinEligible: true` on specialMelee → the feature the user actually wants (multi-hit sweep with pinned-to-die on the finisher).
6. Delete the three old state machines.

Risks:
- Sheet-driven phase derivation (`_specialMeleePhaseAt`) does an O(n) box scan per tick — precompute first/last boxed frame once per sheet load when migrating.
- Supermove's "velocity phase done ≠ move end" split (protection spans the whole sheet incl. freeze tail) must survive intact; the config needs `protectUntil: 'animEnd'` semantics, not just phase names.
- `_prevMeleeJumpHeld` edge-tracking quirk (shared tracker stale by the time update() reaches melee code) — keep the dedicated tracker, don't "clean it up" blindly.

## 4. What landed in the chain so far (context for why we're here)

Committed during sessions `2026-11-16_13-40-37` → `2026-11-16_14-51-44`:
- Barrel melee ghost fuse (0.6s) on lethal hits (`30c49b8a`)
- Per-method connect shake tiers + melee impact matrix doc (`8ca07420`)
- Unified lethal impact across barrels/enemies/star (`0c0b428f`)
- Enemy kill-upgrade corpse-velocity bugfix (`5615ac32`)
- Star barrel launch: pre-physics timing + forward-arc vector (`bca17804`)
- Doc: hitstop chip/lethal columns + pinned-to-die section (`e0d63884`)
- Pinned-to-die: single-owner pin module, death held until finisher (`f26b9bda`)
- Plow shield: invincible hero is a wall to foe contact-triggers (`dbb83e30`)

Related docs to read before coding: `docs/architecture/melee-impact-matrix.md`, `knockback.md` (§11 committed attacks), `hero-mechanics.md`, `attack-lifecycle.md`.

## 5. Session that died

`2026-11-16_14-51-44` — crashed with `prepared prompt exceeds Engine max_context 240000` while writing THIS file (tool call fired, file never saved). Last user message: *"do a small handoff I will start new session to clean it up"*. This document is the rewrite of that lost handoff.

## 6. Immediate next steps

1. Confirm the target design above with the user (esp. `multiHit`/`pinEligible` semantics for super-melee: does every boxed frame pin, or only non-finisher chips?).
2. Step 1 of migration (data extraction, zero behavior change) + run `js/test/` suites.
3. Decide whether immunity centralization (§2.3 item 6) rides along or stays a separate plan.

## 7. Uncommitted working-tree anomalies (not ours — decide before committing anything)

- `petal-panic/assets/levels/level1/bg_f1.png` — modified
- `petal-panic/assets/levels/level1/fg_sheet.png` — deleted (unexplained; previous session flagged it as likely needing `git checkout --` restore)
