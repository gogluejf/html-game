# Pixel Hardcode Audit — Unit Migration Tracker

Every world-space pixel literal that must be converted to logical units so that
`UNIT_PX_X` / `UNIT_PX_Y` (`js/world/macros.js`) become the SINGLE pixel
conversion point in the codebase. After this migration, changing the unit size
rescales the whole game (entities, physics, levels) with no other edits.

**Rule:** declare in units → convert at construction/use-site via `UNIT_PX_*`.
Raw px remains ONLY for screen-space cosmetics (HUD, viewport, particles) —
those are listed in the last section as intentionally-px.

Status legend: ✅ = declared in units · ❌ = still hardcoded px

Unit reference: 1 X-unit = 72px · 1 Y-unit = 48px (current).

---

## Tier 1 — Entity collision boxes (gameplay geometry)

| # | File | Line | Item | Current (px) | In units | Status |
|---|------|------|------|--------------|----------|--------|
| 1 | js/hero/heroDefs.js | 50 | hero box (default) | w:32 h:48 | 0.44×1.0 | ❌ |
| 2 | js/hero/heroDefs.js | 81 | hero box (alt form) | w:36 h:52 | 0.50×1.08 | ❌ |
| 3 | js/enemies/jackolantern.js | 23 | jackolantern box | w:40 h:40 | 0.56×0.83 | ❌ |
| 4 | js/enemies/vine_hound.js | 21 | vine_hound box | w:40 h:44 | 0.56×0.92 | ❌ |
| 5 | js/enemies/violetta.js | 23 | violetta box | w:36 h:50 | 0.50×1.04 | ❌ |
| 6 | js/enemies/explosiveMonkey.js | 34 | explosiveMonkey box | w:28 h:36 | 0.39×0.75 | ❌ |
| 7 | js/enemies/jester.js | 18 | jester box | w:36 h:48 | 0.50×1.0 | ❌ |
| 8 | js/objects/object.js | 30 | object box A | w:32 h:48 | 0.44×1.0 | ❌ |
| 9 | js/objects/object.js | 40 | object box B | w:32 h:48 | 0.44×1.0 | ❌ |
| 10 | js/objects/object.js | 55 | object box C | w:32 h:48 | 0.44×1.0 | ❌ |
| 11 | js/objects/object.js | 269 | object box D | w:24 h:48 | 0.33×1.0 | ❌ |
| 12 | js/objects/powerup.js | 134 | powerup box | w:28 h:28 | 0.39×0.58 | ❌ |
| 13 | js/objects/projectile.js | 56 | projectile box | w:12 h:12 | 0.17×0.25 | ❌ |
| 14 | js/boss/boss.js | 41 | boss box | w:80 h:100 | 1.11×2.08 | ❌ |

## Tier 1b — Offset hitboxes (ox/oy/bw/bh)

| # | File | Line | Item | Current (px) | Status |
|---|------|------|------|--------------|--------|
| 15 | js/hero/heroDefs.js | 29 | MELEE_HITBOX_FRAMES[4] | ox:20 oy:0 bw:40 bh:40 | ❌ |
| 16 | js/hero/heroDefs.js | 40 | SUPERMOVE_HITBOX | ox:20 oy:0 bw:16 bh:'body' | ❌ |
| 17 | js/hero/heroDefs.js | 66 | cartwheel full-body hitbox | ox:0 oy:0 bw:32 bh:48 | ❌ |
| 18 | js/enemies/jester.js | 41 | whipHitbox | ox:15 oy:-10 bw:35 bh:30 | ❌ |
| 19 | js/boss/boss.js | 94 | weakPointBox | ox:10 oy:0 bw:60 bh:30 | ❌ |

## Tier 2 — Physics & movement (unit-coupled feel)

### Global constants (js/consts.js)

| # | File | Line | Item | Current (px) | In units | Status |
|---|------|------|------|--------------|----------|--------|
| 20 | js/consts.js | 8 | GRAVITY | 1500 px/s² | 31.25 u/s² | ❌ |
| 21 | js/consts.js | 11 | MAX_FALL_SPEED | 800 px/s | 16.67 u/s | ❌ |
| 22 | js/consts.js | 53 | SUPERMOVE_SPEED | 920 px/s | 12.78 u/s | ❌ |
| 23 | js/consts.js | 54 | SUPERMOVE_RESIDUAL | 80 px/s | 1.11 u/s | ❌ |

(Non-px, already dimensionless — no action: DOUBLE_JUMP_FACTOR 0.85, AIR_DRAG 0.995, TTL_SPEED, COIN_TTL 8s, SUPERMOVE_DUR 0.6s, SUPERMOVE_BURST_FRAC 0.6)

### Hero (js/hero/)

| # | File | Line | Item | Current (px) | Status |
|---|------|------|------|--------------|--------|
| 24 | js/hero/hero.js | 36 | AIR_REVERSAL_MIN_SPEED | 40 px/s | ❌ |
| 25 | js/hero/hero.js | 53 | knockback contact strength | 260 px/s | ❌ |
| 26 | js/hero/hero.js | 54 | knockback bossContact strength | 340 px/s | ❌ |
| 27 | js/hero/hero.js | 55 | knockback projectile strength | 220 px/s | ❌ |
| 28 | js/hero/hero.js | 56 | knockback heavyProj strength | 300 px/s | ❌ |
| 29 | js/hero/hero.js | 57 | knockback explosion strength | 380 px/s | ❌ |
| 30 | js/hero/heroDefs.js | 53 | hero move speed A | 250 px/s | ❌ |
| 31 | js/hero/heroDefs.js | 84 | hero move speed B | 180 px/s | ❌ |

### Enemy speeds (px/s)

| # | File | Line | Item | Current (px/s) | Status |
|---|------|------|------|----------------|--------|
| 32 | js/enemies/boris_loon.js | 26 | boris_loon speed (form A) | 80 | ❌ |
| 33 | js/enemies/boris_loon.js | 39 | boris_loon speed (form B) | 120 | ❌ |
| 34 | js/enemies/explosiveMonkey.js | 37 | explosiveMonkey speed | 90 | ❌ |
| 35 | js/enemies/jackolantern.js | 26 | jackolantern speed | 150 | ❌ |
| 36 | js/enemies/jackolantern.js | 42 | ROLL_SPEED | 150 | ❌ |
| 37 | js/enemies/jester.js | 21 | jester speed | 120 | ❌ |
| 38 | js/enemies/vine_hound.js | 24 | vine_hound speed | 180 | ❌ |
| 39 | js/enemies/vine_hound.js | 34 | LUNGE_SPEED | 420 | ❌ |
| 40 | js/enemies/violetta.js | 26 | violetta speed | 90 | ❌ |
| 41 | js/enemies/violetta.js | 33 | PACING_SPEED | 80 | ❌ |

## Tier 3 — Attack primitives & radii

| # | File | Line | Item | Current (px) | Status |
|---|------|------|------|--------------|--------|
| 42 | js/combat/attack/primitives/fireArea.js | 34 | FIRE_HEIGHT | 48 | ❌ |
| 43 | js/combat/attack/primitives/spike.js | 47 | SPIKE_HEIGHT | 16 | ❌ |
| 44 | js/objects/object.js | 43 | explosion/effect radius | 120 | ❌ |
| 45 | js/objects/specialWeapons.js | 55 | special weapon radius | 100 | ❌ |
| 46 | js/enemies/jackolantern.js | 35 | aggro/detection radius | 80 | ❌ |
| 47 | js/boss/boss.js | 166 | stomp shockwave radius | 60 (minRadius 12) | ❌ |

## Intentionally px — screen-space cosmetics (NO conversion)

These are viewport/HUD space, not world geometry. They MUST stay fixed when
the unit changes. Documented here so future audits don't "fix" them.

| Area | Notes |
|------|-------|
| js/systems/render.js (~70 literals) | HUD offsets, shake magnitudes, particle sizes, debug rects, colors |
| js/debug/* (theater scenes) | standalone debug stage coordinates |
| Viewport 960×540 | display constraint, not a game quantity |
| Sheet JSON bbox/offset/pivot values | source-art native space; scaled at runtime via uniformScale — correct as-is |

---

## Migration notes

- Conversion is exact at current unit size: value_px / 48 (Y) or / 72 (X).
  Feel does NOT change on migration day; the benefit appears when the unit
  size changes or new values are authored directly in units.
- Fractional units are legal and expected (sprites.md §1: 0.5, 1.5, 3, 4.5…).
- Single conversion point: entity construction (Tier 1/1b) and constant
  definition (Tier 2/3 use `U = UNIT_PX_Y` derivation or unit-native values).
- Floor gap decision (540px vs unit grid) is UNBLOCKED by this migration:
  once nothing else pins 48px, the unit size becomes a free parameter.
