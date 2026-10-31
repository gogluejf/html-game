# Sprite Player + Projectile (Thorn) SOTA Wiring

Continues `.squid-os/plans/sprite-engine/sprite-engine.md` — Milestone 3 (tasks 3.1/3.2)
was never implemented; this plan executes it and adds M8 (first projectile wiring).
Rules of record: sprites.md §2–§7, §13 (mirroring), §22 (transform pipeline);
entity-size contract: `(x, y, targetH)` only — no hardcoded `w/h/baseW` in entity code.

## Context (verified 2026-10-31)

- `spriteFrameIndex` is pinned to 0 with `TODO(sprite-engine 3.1)` — no playback exists.
- Thorn = pooled `Projectile` (objects/projectile.js), spawned by `fireThorn()`
  (combat/shooting.js) with hardcoded `size = 12`; constructor hardcodes `w: 12, h: 12`.
  No sprite — draws as debug rect.
- Art exists: `assets/projectiles/pea/shoot_sheet.json` — entity `pea`, anim `shoot`,
  8 frames, standalone PNGs. Sheet declares NO mode/fps (parseSheet defaults
  fps:12 / mode:loop). Frames are ~174–195 × 146–193 px.
- **Art faces UP** (peas trail downward). Base rotation = -π/2 from the
  facing-right convention (core/entity.js §trueAngle).
- Thorn collision must stay 12×12 px → `targetH = 0.25u` (12px). Width becomes
  SHEET-OWNED (collisionBox × §4 scale) — so the pea sheet's collision box must be
  authored as a SQUARE 12-equivalent (see T4). Until then, width drift is measured
  and asserted in tests (±1px).
- Pool recycling uses `Object.assign` over a fresh instance — player state must
  reset cleanly on respawn.
- Pre-existing test baseline: 653 pass / 8 fail (bombGameplay, bossRushScreen ×2,
  save/continue ×2, ride e2e, picker). Must not grow.

## Orientation model (decision)

Projectiles get an EXACT aim angle, not 8-way snapping:

```
rotation = atan2(vy, vx) - BASE_ROTATION      // BASE_ROTATION = -π/2 (art faces up)
mirrorX  = false (never for projectiles)
```

- Shooting right  → rotation = 0 + π/2… worked out: atan2(0,1)=0 → rot = 0 - (-π/2) = π/2? NO —
  see T5 for the exact constant; the invariant tested is: velocity vector always aligns
  with the art's nose for all 8 aim directions AND free angles.
- Upside-down guard: art is near-symmetric head-to-tail, but the rule stands —
  if |normalized angle| > π/2 the shot would render tail-first; for a symmetric
  projectile that is acceptable, so we do NOT mirror-flip. Documented choice,
  asserted visually in theater.
- Hero-facing cases (future melee arcs) keep mirrorX per sprites.md §13;
  projectiles use rotation only.

---

### TASK: 3.1 - SpritePlayer (mode/direction/timing)
Type: feature
What: `js/core/spritePlayer.js` — pure class per sprites.md §5–7:
  - `constructor(animData)` — frames, fps, per-frame `duration` overrides,
    mode (loop/once), direction (forward/reverse/ping_pong/ping_pong_reverse), timing.
  - `tick(dt)` — fps-mode advance; per-frame duration overrides 1/fps (§5).
  - `setProgress(p)` — relative timing maps [0,1] onto traversal, ignores durations (§7).
  - `get frameIndex()`, `get done()` — once-completion AFTER terminal frame elapsed.
  - ping_pong: 1→2→3→4→5→4→3→2→1→2 — NO endpoint duplication (§6).
  - `reset()` — back to start (pool respawn path).
Why: single playback implementation for every entity; completion flag for gameplay.
Files: + petal-panic/js/core/spritePlayer.js
Files: + petal-panic/js/test/spritePlayer.test.js
Acceptance:
  - ping_pong over 5 frames visits 1,2,3,4,5,4,3,2,1,2 (no 5,5 / 1,1)
  - reverse+once completes on frame 1; forward+once on last frame
  - explicit-duration frame holds longer than 1/fps neighbors
  - relative: p=0.5 lands mid-traversal regardless of fps
Verification: node --test js/test/spritePlayer.test.js

### TASK: 3.2 - Wire SpritePlayer into Entity
Type: refactor
What: `setAnim()` builds a SpritePlayer ONLY when the anim data has a playback
  mode (`mode !== 'none'`). `spriteFrameIndex` resolution order:
  `_tileFrame != null` → pool/pattern-owned (terrain, unchanged)
  → `this._player.frameIndex` → 0 (static single-frame).
  `tickAnim(dt)` called from Entity.update default; `get animDone` exposes done.
  `mode: 'none'` = frame POOL declaration (blocks/platforms): no player built.
  Legacy `Anim` class stays until remaining users migrate (out of scope here).
Files: ~ petal-panic/js/core/entity.js
Files: ~ petal-panic/js/test/spriteSetAnim.test.js
Acceptance:
  - loop anim advances at fps; once stops + animDone=true after terminal duration
  - mode:'none' anim → no player, _tileFrame still wins (terrain regression-free)
  - pool respawn (Object.assign) leaves no stale player state
Verification: node --test js/test/spriteSetAnim.test.js js/test/spritePlayer.test.js

### TASK: 4 - Pea sheet: declare playback + square collision box
Type: asset
What: edit `assets/projectiles/pea/shoot_sheet.json`:
  - entity `pea`: add `"fps": 14, "mode": "loop"` (data decides playback — no code)
  - add `"collision": [x, y, w, h]` — SQUARE box matching thorn's 12px collision
    intent at targetH 0.25u (i.e. w == h in source space, centered on the pea mass,
    excluding the leaf-particle spray). Author via sprite-editor if needed.
Why: §4 scale derives from collisionBox height; square box keeps thorn AABB 12×12.
Files: ~ petal-panic/assets/projectiles/pea/shoot_sheet.json
Acceptance: parseSheet yields mode 'loop', fps 14, nonzero-height square collisionBox
Verification: node --test js/test/spriteData.test.js (+ new assertion)

### TASK: 5 - Projectile on pure target model + sprite + orientation
Type: feature
What:
  - New loader `initProjectileSprites()` (objects/projectile.js or levelAssets-style):
    fetch pea sheet JSON + 8 frame PNGs at boot (main.js awaits it next to
    initBarrelSprites/initCheckpointSprites). Node-safe (empty map, rect fallback).
  - `Projectile` constructor: DROP `w: 12, h: 12` → `super({ x, y, targetH:
    PROJECTILE_TARGET_H /* 0.25 */, layer, debugColor, gravity: 0 })`.
    Attach `this.sprite = { anchor: 'center', anims }` + live frames accessor;
    `setAnimSafe(this, 'shoot')`. Width = sheet-owned (T4 square box ⇒ 12px).
  - Orientation: after velocity is set (constructor AND spawnProjectile override),
    `this.rotation = Math.atan2(vy, vx) - PROJECTILE_BASE_ROTATION` where
    PROJECTILE_BASE_ROTATION encodes art-faces-up (-π/2 convention offset).
    Single helper `aimRotation(vx, vy)` — used by both paths, unit-tested for all
    8 DIR_ANGLES + free angles: nose (art up-vector rotated) ∥ velocity.
  - `fireThorn()` (combat/shooting.js): delete hardcoded `size = 12`; spawn offset
    reads the entity's real box (`p.w / 2`) post-spawn, or a named marker later.
  - Drawer: remove — default Entity.draw pipeline renders the sheet (high-graphic)
    / debug rect (primitive). No per-shot drawer for thorn.
Files: ~ petal-panic/js/objects/projectile.js
Files: ~ petal-panic/js/combat/shooting.js
Files: ~ petal-panic/js/main.js
Files: ~ petal-panic/js/test/spriteSetAnim.test.js (or new projectileSprite.test.js)
Acceptance:
  - thorn worldBox ≈ 12×12 px (±1) at targetH 0.25 with T4 box
  - all 8 aim directions: nose ∥ velocity (numeric dot-product test ≥ 0.99)
  - primitive mode still draws rect; high-graphic draws pea frames cycling
  - pool exhaustion + respawn behavior unchanged
Verification: node --test js/test/*.test.js (baseline 653/8 must hold) + browser check

### TASK: 6 - Audit: kill remaining hardcoded sizes
Type: refactor
What: grep every `super({ ... w: N, h: N })` / `baseW:` in entity code and convert
  to `targetH` (units). Inventory (verified): objects/coin.js (def.size),
  objects/powerup.js (28×28), enemies/{explosiveMonkey 28×36, jackolantern 40×40,
  jester 36×48, vine_hound 40×44, violetta 36×50}, boss/boss.js (80×100),
  objects/projectile.js Special (meta?.size ?? 16).
  Rule: `targetH = h/48`; width sheet-owned once each gets real sheets; UNTIL then
  keep width exact via the deprecated-but-supported path ONLY inside one shared
  helper `unitSize(hPx)` so no raw numbers scatter. Terrain tile entities KEEP
  baseW (macro grid owns their width — documented exception).
Files: ~ (each file above) + one new test asserting no entity ctor passes raw w/h
  except the documented terrain exception
Acceptance: `grep -rn "w: [0-9]" js/objects js/enemies js/boss js/hero` returns only
  comments/tests; collision boxes identical before/after per entity (snapshot test)
Verification: node --test js/test/*.test.js + grep gate

---

## Order & checkpoints
1. T3.1 + T3.2 (engine) → tests green, terrain untouched
2. T4 (asset) → parse assertions
3. T5 (thorn SOTA) → browser: shoot 8 ways, watch peas fly nose-first, cycle at 14fps
4. T6 (audit) → snapshot test proves zero collision drift

Commit after each task (user confirms messages). No auto-commit.
