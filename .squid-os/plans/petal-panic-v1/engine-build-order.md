# Petal Panic — Engine Build Order

## Current state (done)

- ✅ Hitbox engine (per-frame boxes, team routing, hitSet, generic slots)
- ✅ Central damage routing (`damage()`)
- ✅ Animation system (frame sequencer, pickFrame, non-looping)
- ✅ Collision world (layers, AABB resolve, solid correction)
- ✅ Rogue spawner (random entity placement on fixed geometry)
- ✅ Timer system (labeled timers: intangible, rapid, rec, etc.)
- ✅ Enemy AI state machines (jester, vine hound, violetta, jack-o-lantern, boris)
- ✅ Projectile pool (basic 8-way aim)
- ✅ HUD, debug overlay, screens (title, gameover, checkpoint)
- ✅ Barrel/object system (explosive, wood, coin)
- ✅ Powerup system
- ✅ Boss placeholder (elephant)

## Build order

### 1. Input Engine (`js/input.js`)

**Why first:** Everything else you test by hand. Gamepad support + lock-dir/lock-move
changes how aiming works, which affects projectiles, boss patterns, and feel.

Scope:
- Normalized state object (update engine is source-agnostic)
- Keyboard + gamepad polling behind one API
- Mapping layer (configurable action → physical input)
- Lock direction / lock movement logic
- Gamepad layout detection (PS4/PS5, Xbox, 8BitDo, generic)
- Remap UI (settings screen, sequence flow, reset to defaults)
- Dynamic button display in HUD (shows △ or A or W based on active mapping)
- Gamepad navigation in all interfaces (menus, selection, settings)

Actions (10):
Move, Jump, Aim/Shoot, Melee, Supermove, Switch Weapon, Lock Direction, Lock Movement, Crouch/Slide, Pause

Implemented contract: see [input-engine.md](input-engine.md).

Files:
- `js/input.js` — physical adapters, semantic edges/held, lifecycle barriers,
  mapping/persistence/labels, capture, lock logic (single input boundary)
- `js/remap.js` — source-agnostic semantic UI and normalized capture results
- `js/screens.js` — one semantic action route and transition lifecycle
- `js/systems/update.js` — poll once per fixed tick, inject screen closures,
  consume normalized gameplay; debug remains separate
- `js/hud.js` — live mapping hints
- `js/main.js` — no separate gamepad navigation bridge
- `js/test/input.test.js` — deterministic keyboard/gamepad adapter regressions

Navigation is fixed, gameplay bindings are configurable. Remap records its parent;
back during capture cancels only, the next fresh back leaves one level. State and
capture barriers suppress held inputs until release rather than using debounce.

---

### 2. Hero Engine Polish (`js/hero.js`)

**Why second:** The hero is the player's avatar—every other system (combat, levels,
bosses) depends on how it feels to move, attack, and react. Right now the hero has
basic movement but lacks the polish that makes a platformer feel good: no move
cancellation, no crouch/slide transitions, no supermove animation state, no
attack hitbox timing, no drop-through-platform input. Fixing these before building
levels means you test against a hero that actually plays well.

Scope:
- **Move cancellation:** pressing opposite direction stops momentum immediately
  (no coasting), with a short friction tail for feel
- **Crouch/slide:** Down while grounded = crouch; Down while moving = slide with
  skid decel; release Down = stand up (keep existing SMB1-style logic, clean up)
- **Supermove state machine:** dash startup → active → recovery frames, invincibility
  window, camera nudge, cancelable into jump after recovery
- **Attack timing:** melee swing has windup/active/recovery frames; hitbox only
  active during "active" frames; can't re-swing until recovery ends
- **Drop-through platform:** Down + Jump on one-way platform drops through
- **Hit-stun / knockback:** brief input lock on hit, knockback velocity with decay,
  i-frame flash
- **Facing & mirror:** hero sprite flips on facing change; aim direction independent
  of facing (already partially done via lockDir)
- **Animation state sync:** ensure anim frame matches physics state (idle/run/jump/
  crouch/attack/super/death) without drift

Files:
- `js/hero.js` — refactor update loop into clear state phases
- `js/systems/update.js` — pass correct intent flags, respect new states
- `js/hitbox.js` — per-frame hitbox data from anim state (if not already wired)
- Tests: `js/test/heroAnim.test.js`, `js/test/melee.test.js`, `js/test/jumpslide.test.js`

---

### 3. Level Shape Engine (`js/level-shape.js`)

**Why second:** Bosses need arenas, enemies need varied terrain, rogue spawner needs
platforms to place things on. Right now everything is one flat line.

Scope:
- Platform/block definitions (AABB with type: ground, wall, ceiling, one-way, breakable)
- Level layout format (hand-crafted or procedural generation)
- Vertical variety (multi-level platforms, gaps, pits)
- Boss arena definition (bounded space, no exit until boss dead)
- Checkpoint placement tied to level sections
- Integration with rogue spawner (spawn entities on valid surfaces)

Files:
- `js/level-shape.js` — platform/block types + layout parser
- `js/level-gen.js` — optional procedural generation (later)
- Modify: `js/level.js` (consume shape data instead of hardcoded arrays)
- Modify: `js/collision.js` (support new block types: one-way, breakable)

---

### 4. Explosion / Radius / TTL Generic Engine (`js/blast.js`)

**Why third:** Bosses, Jack-O-Lanterns, barrels, powerups, ground attacks all need
"circle of damage for X seconds." Extract the barrel special-case into a reusable primitive.

Scope:
- `Blast` struct: { x, y, radius, duration, damage, team, method }
- Team routing (same as hitbox: ally/foe/neutral)
- Damage applied once per target per blast (same hitSet pattern)
- Visual: expanding circle, flash, particles (calls effect engine)
- Ground wave variant (semi-circle, travels along floor)
- Integration: barrels, Jack-O-Lantern, boss attacks all spawn Blasts

Files:
- `js/blast.js` — Blast struct + update + damage routing
- Modify: `js/systems/update.js` (process blasts each tick)
- Modify: `js/object.js` (barrels spawn Blast instead of inline AoE)
- Modify: `js/jackolantern.js` (use Blast)

---

### 5. Special Effects Engine (`js/effects-engine.js`)

**Why fourth:** Bosses and explosions trigger VFX through one API instead of
ad-hoc calls. Formalize what's already in `effects.js`.

Scope:
- Screen shake (magnitude, duration, decay)
- Flash (full-screen or localized, color, alpha fade)
- Sparkle/particle burst (position, count, spread, color, gravity)
- Disappear effect (shrink + fade)
- Hit-run / knockback visual (entity bounces)
- Ground wave visual
- Circle-to-action indicator (expanding ring that triggers on complete)
- Composite effects: named presets that combine primitives
  - "explosion" = shake + flash + particles + circle
  - "death" = sparkle + shrink + fade
  - "hit" = small shake + white flash on target

Files:
- `js/effects-engine.js` — effect primitives + composite presets
- Modify: `js/effects.js` (becomes a thin wrapper or gets merged)
- Modify: `js/systems/render.js` (draw active effects)

---

### 6. Projectile Engine Upgrade (`js/projectile.js`)

**Why fifth:** Bosses need missile patterns. Normalize aim, add pattern support.

Scope:
- Normalized vector aim (replace 8-way grid for aimed shots)
- Spread patterns (N projectiles at ±X degrees)
- Homing projectiles (track target, turn rate limit)
- Timed volleys (fire N shots over X seconds)
- Bouncing projectiles (reflect off walls)
- Gravity-affected projectiles (arcing shots)
- Projectile types as config objects (speed, size, damage, behavior flags)

Files:
- `js/projectile.js` — rewrite with normalized aim + pattern support
- `js/projectile-patterns.js` — pattern definitions (spread, volley, spiral, etc.)
- Modify: `js/violetta.js`, `js/jester.js` (use normalized aim)

---

### 7. Boss Pattern / Macro Engine (`js/boss-pattern.js`)

**Why last:** It composes everything above. Spawns enemies, fires projectile
patterns, triggers blasts, switches phases, uses hitboxes. Building it first
means hardcoding all the primitives.

Scope:
- Phase system (boss has N phases, each with HP threshold)
- Pattern script: timed sequence of actions
  - `spawnEnemy(type, x, y)`
  - `firePattern(patternName, target)`
  - `blast(x, y, radius, damage, team)`
  - `activateHitbox(frameData)`
  - `wait(seconds)`
  - `moveTo(x, y, speed)`
  - `changePhase(nextPhase)`
- Pattern library (reusable sequences: "missile barrage," "ground slam," "spiral")
- Boss AI state machine (idle → phase1 → phase2 → dying)
- Integration with all above systems

Files:
- `js/boss-pattern.js` — pattern interpreter + phase manager
- `js/boss-patterns.js` — named pattern definitions
- Modify: `js/boss.js` (use pattern engine instead of inline logic)

---

### 8. Sprite Engine Wiring (ongoing)

Wire per-frame hitbox data from editor into entity getters. Small change, do
whenever real sprites with painted boxes are ready.

- Export format from editor (JSON per animation: frame → box data)
- Getter reads from data instead of hardcoded constants
- Multi-layer sprite support (if needed)

---

## Dependency graph

```
input ──────────────────────────────────────────────────────┐
                                                            │
level-shape ──→ explosion/TTL ──→ effects ──→ projectiles ─┤
                                                            │
                                                            ▼
                                                      boss-patterns
                                                            ▲
sprite wiring ──────────────────────────────────────────────┘
```

Input and level-shape are independent of each other (can be done in parallel).
Everything else chains forward. Sprite wiring can happen anytime.
