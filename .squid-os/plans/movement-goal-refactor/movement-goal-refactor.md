# EPIC: Goal-Based Movement System
Why: Replace all scattered velocity math (friction, snaps, impulses, special cases) with a single goal-based lerp update loop. Every entity controls movement by setting vxGoal/vyGoal or direct velocity impulses. One update function does the math. Inversion of control: systems declare intent, engine executes motion.
Outcomes: Single movement API for all entities (hero, enemies, projectiles, barrels, particles). No more vx*=0.85, no more 10 special cases. Knockback/jump/explosion/homing all route through the same goal+lerp pattern. Feel identical to current tuning.

## RULES (read before any task)

1. **HARD CUTOVER.** Old code is DELETED in the same commit that replaces it. No shims. No `if (useNewSystem)`. No "deprecated" wrappers. If GROUND_FRICTION goes away in M2, it's GONE. Not commented out. Not behind a flag. Deleted.

2. **NO LEGACY ACCUMULATION.** The codebase must not grow. Every line of old velocity math that gets replaced is removed. Final state: one system, zero fallbacks. `grep 'vx \*=' js/` returns nothing.

3. **TESTS GET REWRITTEN, NOT PRESERVED.** Old tests that assert friction behavior (`expect(vx).toBe(380 * 0.85)`) are DELETED and replaced with tests that assert lerp behavior. Do NOT tweak old tests to pass against new code. Write new tests for new behavior.

4. **TWO SYSTEMS COEXIST ONLY DURING MIGRATION.** After M2, hero uses goals but enemies still use old math. This is TEMPORARY. By end of M5, everything uses goals. No permanent dual-path.

5. **FEEL MUST BE IDENTICAL.** This is a PORT, not a redesign. If playtest feels different, tune the accel number. Do NOT add special-case code to "fix" the feel. The lerp + right accel number IS the fix.

6. **NO NEW GAME BEHAVIOR.** We are not adding features. We are moving existing behavior into a cleaner structure. If something doesn't exist today, it doesn't get created here.

7. **MODULEAR TESTING.** Each milestone is independently testable. After M2: play the game, hero feels right? Continue. After M3: get hit, feels right? Continue. Stop at any milestone if feel is wrong. Fix before continuing.

## REFERENCE

- Design doc: `petal-panic/docs/architecture/movement-model.md`
- Enjfine implementation: `https://github.com/gogluejf/enjfine` → `src/enjfine/animator.py` → `updatePoint()` + `__approach()`

## MILESTONE: 1 - Core Movement API
Pattern: Single Responsibility, Inversion of Control
Objective: Create the goal-based lerp update function and entity properties (vxGoal, vyGoal, accel, gravAccel) that ALL entities use. This is the one place velocity math happens.
Success: A single updateVelocity(entity, dt) function exists. It lerps vx toward vxGoal and vy toward vyGoal at the entity's accel rate. No other file does velocity decay/approach math.
Diagram: graph TD
    A[Entity] --> B[vx, vy current]
    A --> C[vxGoal, vyGoal target]
    A --> D[accel, gravAccel rates]
    B --> E[updateVelocity]
    C --> E
    D --> E
    E --> F[vx += vxGoal - vx * accel * dt]
    E --> G[vy += vyGoal - vy * gravAccel * dt]
    F --> H[x += vx * dt]
    G --> I[y += vy * dt]

### TASK: 1.1 - Goal-based velocity update function
Type: feature
What: Create updateVelocity(entity, dt) in a new core/movement.js module. Lerps vx toward vxGoal and vy toward vyGoal using exponential approach (vx += (vxGoal - vx) * accel * dt). Integrates position (x += vx * dt). Reads entity properties: vxGoal, vyGoal, accel, gravAccel.
Why: This is the single choke point for all velocity math. Replaces friction constants, air ramps, ground snaps, and every other scattered vx mutation.
Files: + petal-panic/js/core/movement.js
Snippet: // core/movement.js — single velocity update for all entities\n// Exponential lerp: fast approach, slow settle (matches current friction feel)\nexport function updateVelocity(e, dt) {\n  // Horizontal: lerp vx toward vxGoal at e.accel rate\n  e.vx += ((e.vxGoal ?? 0) - e.vx) * (e.accel ?? 10) * dt;\n  // Snap to zero when close enough (avoid float dust)\n  if (Math.abs(e.vx) < 1 && (e.vxGoal ?? 0) === 0) e.vx = 0;\n\n  // Vertical: lerp vy toward vyGoal (gravity goal) at e.gravAccel rate\n  e.vy += ((e.vyGoal ?? 0) - e.vy) * (e.gravAccel ?? 8) * dt;\n\n  // Integrate position\n  e.x += e.vx * dt;\n  e.y += e.vy * dt;\n}\n\n// Impulse: set velocity directly (knockback, jump, explosion)\n// The goal system will naturally decay it toward the next frame's goal.\nexport function applyImpulse(e, ivx, ivy) {\n  e.vx += ivx;\n  e.vy += ivy;\n}
Acceptance: updateVelocity lerps vx toward vxGoal exponentially
Acceptance: updateVelocity lerps vy toward vyGoal exponentially
Acceptance: Position integrates from velocity each call
Acceptance: applyImpulse adds to current velocity (goal unchanged)
Acceptance: Entity with vx=800, vxGoal=0, accel=10 decays smoothly to 0 over ~0.5s
Verification: node --experimental-vm-modules petal-panic/js/test/movement.test.js

### TASK: 1.2 - Entity movement properties
Type: feature
What: Add vxGoal, vyGoal, accel, gravAccel properties to the base Entity class (core/entity.js). Defaults: vxGoal=0, vyGoal=0, accel=10, gravAccel=8. Hero gets tuned values matching current feel. Enemies/projectiles/barrels get their own tuning.
Why: Every entity needs the goal+accel data. Centralizing on Entity means every object in the game automatically gets the movement system.
Files: ~ petal-panic/js/core/entity.js
Snippet: // In Entity.initialize() or constructor:\nthis.vxGoal = 0;       // target horizontal speed (px/s)\nthis.vyGoal = 0;       // target vertical speed (gravity goal, e.g. +800 terminal)\nthis.accel = 10;       // horizontal lerp rate (higher = snappier)\nthis.gravAccel = 8;    // vertical lerp rate (higher = heavier fall)\n// Existing vx, vy stay as-is (current speed)
Acceptance: All entities have vxGoal, vyGoal, accel, gravAccel by default
Acceptance: Hero has tuned accel matching current ground friction feel
Acceptance: No existing entity breaks from new properties (defaults are safe)
Verification: node --experimental-vm-modules petal-panic/js/test/movement.test.js

## MILESTONE: 2 - Hero Movement Migration
Pattern: Strangler Fig (replace one system at a time)
Objective: Migrate the hero's movement from scattered friction/snaps/ramps to the goal-based system. Input sets vxGoal, jump sets vy impulse, gravity is vyGoal. Feel must be identical to current.
Success: Hero movement uses ONLY updateVelocity + input setting vxGoal + jump applying impulse. No more GROUND_FRICTION, no more AIR_ACCEL ramp, no more air reversal special case. Playtest feels the same.
Diagram: graph TD
    A[Input: left/right] --> B[vxGoal = -runSpeed / +runSpeed / 0]
    C[Jump press] --> D[applyImpulse: vy = -jumpSpeed]
    E[Gravity] --> F[vyGoal = +terminalVelocity]
    B --> G[updateVelocity]
    D --> G
    F --> G
    G --> H[x,y updated]

### TASK: 2.1 - Replace hero ground/air movement with goal system
Type: refactor
What: In hero.js update(): replace the entire vx block (lines ~590-680: stunned friction, lockMove zero, ground snap, air reversal, air ramp, no-input friction) with: read input → set vxGoal. Call updateVelocity(). Remove GROUND_FRICTION, AIR_ACCEL, SLIDE_DECEL constants and all branches.
Why: This is the biggest win. 10 special cases become 1 line (set vxGoal from input) + 1 call (updateVelocity). Crouch/slide becomes a vxGoal modifier, not a separate friction branch.
Files: ~ petal-panic/js/hero/hero.js
Snippet: // In hero.update(), replace the entire horizontal movement block with:\n\n// --- Horizontal goal (replaces all friction/snap/reversal/ramp branches) ---\nif (this.supermoveActive || this.specialMeleeActive) {\n  // Committed moves own vx directly (bypass goal)\n  // ... existing supermove/specialMelee vx code stays as direct write\n} else if (this.hitStunned) {\n  this.vxGoal = 0; // stunned: aim for stop, lerp decays naturally\n} else if (input.lockMove) {\n  this.vxGoal = 0; // aiming in place\n} else {\n  const moveDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);\n  this.vxGoal = moveDir * this.stats.speed * UNIT_PX_X;\n  // Crouch: reduce goal (slide feel comes from lower accel, not separate friction)\n  if (this.crouching) this.vxGoal *= 0.3;\n}\n\n// --- Vertical goal (gravity) ---\nthis.vyGoal = GRAVITY_TERMINAL; // e.g. +800 (Y-down positive)\n\n// --- Single velocity update ---\nupdateVelocity(this, dt);
Acceptance: Hero runs at full speed when input held (same as now)
Acceptance: Hero stops smoothly on release (lerp decay, same feel as friction)
Acceptance: Air control: lower accel in air gives floaty glide (tune to match current)
Acceptance: Crouch slide: reduced vxGoal + normal accel = skid feel
Acceptance: Hitstun: vxGoal=0, lerp decays knockback naturally
Acceptance: No more GROUND_FRICTION / AIR_ACCEL / SLIDE_DECEL constants in hero.js
Verification: Manual playtest: run, stop, jump, air-control, crouch-slide, get hit

### TASK: 2.2 - Replace hero gravity + jump with goal system
Type: refactor
What: Replace vy += GRAVITY * dt + MAX_FALL_SPEED clamp with vyGoal = +terminal. Jump becomes applyImpulse(this, 0, -jumpSpeed). Remove the gravity integration block and the MAX_FALL clamp from hero.update().
Why: Gravity as a goal means terminal velocity is built-in (lerp can't overshoot). No clamp needed. Jump is an impulse that the goal system naturally decays.
Files: ~ petal-panic/js/hero/hero.js
Snippet: // Replace:\n//   this.vy += GRAVITY * dt;\n//   if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;\n//   this.y += this.vy * dt;\n// With:\n//   this.vyGoal = TERMINAL_VELOCITY; // +800 (set once or per-surface)\n//   // updateVelocity handles the lerp + integration\n\n// Jump (replaces this.vy = -this.stats.jump):\napplyImpulse(this, 0, -this.stats.jump * UNIT_PX_Y);\nthis.jumpsUsed++;
Acceptance: Hero falls at terminal velocity (never exceeds vyGoal)
Acceptance: Jump launches hero upward (impulse), then gravity goal pulls back down
Acceptance: Arc shape matches current jump feel (tune gravAccel to match)
Acceptance: Double jump works (second impulse while vyGoal still pulling down)
Acceptance: No more MAX_FALL_SPEED clamp in hero.js
Verification: Manual playtest: jump arc, double jump, fall speed

## MILESTONE: 3 - Knockback + Explosion Migration
Pattern: Single Choke Point
Objective: All knockback (contact, explosion, projectile hit, stomp) becomes applyImpulse(). The goal system (vxGoal=0 during hitstun) handles the decay. No more manual friction during stun.
Success: Every damaging hit calls applyImpulse(target, kx, ky). Hitstun sets vxGoal=0. The lerp decays the impulse naturally. No special 'stunned friction' branch exists.
Diagram: graph TD
    A[Hit detected] --> B[applyImpulse: vx += kx, vy += ky]
    B --> C[Set hitstun timer]
    C --> D[vxGoal = 0 during stun]
    D --> E[updateVelocity lerps vx toward 0]
    E --> F[Natural decay arc]

### TASK: 3.1 - Route all knockback through applyImpulse
Type: refactor
What: In hitResolution.js: replace applyKnockback(target, kb) with applyImpulse(target, kb.x, kb.y). Remove the 'stunned friction' branch from hero.js (vxGoal=0 during hitstun handles decay). Explosion/contact/projectile knockback all just call applyImpulse.
Why: Knockback becomes a pure impulse. The goal system decays it. No more 'while stunned, multiply vx by 0.85' special case. One mechanism for all velocity decay.
Files: ~ petal-panic/js/combat/hitResolution.js
Files: ~ petal-panic/js/hero/hero.js
Snippet: // In hitResolution.js, replace:\n//   applyKnockback(target, context.knockback);\n// With:\napplyImpulse(target, context.knockback.x, context.knockback.y);\n// Hitstun timer still set (for input lock + anim), but NO velocity math here.\n\n// In hero.js update(), during hitstun:\n//   this.vxGoal = 0;  // lerp handles the decay, no friction branch needed
Acceptance: Explosion knockback launches hero with full impulse (no friction eating frame 1)
Acceptance: Contact knockback shoves hero, lerp decays it smoothly
Acceptance: No 'stunned' friction branch in hero.js
Acceptance: applyKnockback function removed or deprecated
Verification: Manual playtest: get hit by enemy, explosion, projectile — feel the launch + settle

## MILESTONE: 4 - Projectiles + Objects Migration
Pattern: Uniform Entity Update
Objective: All projectiles (thorns, bombs, homing missiles), barrels, and particles use updateVelocity. Launch = set vx/vy + vxGoal/vyGoal. Homing = update vxGoal per frame via normalized aim vector. No more manual vx/vy integration in projectile.update().
Success: Projectile entities call updateVelocity() in their update loop. Homing steers by setting vxGoal to normalized direction × speed. Barrels get launched via applyImpulse and settle via goal lerp. No entity does its own x += vx * dt outside updateVelocity.
Diagram: graph TD
    A[Projectile spawn] --> B[vx = dir * speed, vxGoal = dir * speed]
    B --> C[updateVelocity each frame]
    D[Homing: per-frame steer] --> E[vxGoal = normalize target - pos * speed]
    E --> C
    F[Impact / TTL] --> G[vxGoal = 0, vyGoal = terminal]
    G --> C
    C --> H[Natural decel after impact]

### TASK: 4.1 - Migrate projectile movement to goal system
Type: refactor
What: In Projectile.update(): replace manual vx/vy integration + gravity with updateVelocity(). On spawn: set vx/vy AND vxGoal/vyGoal to launch direction × speed. Homing: per-frame set vxGoal = normalize(target - pos) * speed. On impact/TTL: vxGoal=0, vyGoal=terminal (natural decel).
Why: Projectiles stop doing their own math. They declare a goal, the engine moves them. Homing becomes trivial: just update the goal vector each frame.
Files: ~ petal-panic/js/objects/projectile.js
Snippet: // In Projectile.initialize() or spawn:\nent.vx = cos * speed;\nent.vy = sin * speed;\nent.vxGoal = cos * speed;  // maintain launch speed\nent.vyGoal = sin * speed;\n\n// In Projectile.update(dt), replace manual integration:\n//   this.vy += this.gravityValue * dt;\n//   this.x += this.vx * dt;\n//   this.y += this.vy * dt;\n// With:\nif (this._homingTarget && this._homingTarget.alive) {\n  // Steer: update goal toward target (normalized aim × speed)\n  const dx = target.cx - this.cx;\n  const dy = target.cy - this.cy;\n  const len = Math.hypot(dx, dy) || 1;\n  this.vxGoal = (dx / len) * this.speed;\n  this.vyGoal = (dy / len) * this.speed;\n}\nupdateVelocity(this, dt);\n\n// On impact / TTL expiry:\nthis.vxGoal = 0;\nthis.vyGoal = TERMINAL_VELOCITY; // fall naturally
Acceptance: Thorns fly straight at constant speed (vxGoal = launch speed)
Acceptance: Bombs arc (vyGoal transitions to terminal after launch)
Acceptance: Homing missiles steer smoothly toward target (per-frame goal update)
Acceptance: No more manual x += vx * dt in Projectile.update()
Acceptance: Projectile decelerates naturally after impact (goal = 0)
Verification: Manual playtest: shoot thorns, throw bomb, fire homing missile

### TASK: 4.2 - Migrate barrels + objects to goal system
Type: refactor
What: Barrels (GameObj) use updateVelocity for their launched state. When knocked back: applyImpulse sets velocity, vxGoal/vyGoal = 0 (settle naturally). Rolling/falling barrels: vyGoal = terminal. Remove manual barrel physics integration.
Why: Barrels that get blown up by other barrels should arc and settle using the same goal system. No custom barrel friction or gravity code.
Files: ~ petal-panic/js/objects/barrelPhysics.js
Snippet: // In barrel physics step, replace manual integration with:\n// Falling / rolling:\nbarrel.vyGoal = TERMINAL_VELOCITY;\nbarrel.vxGoal = 0; // settle horizontally\nupdateVelocity(barrel, dt);\n\n// When launched by explosion (applyImpulse already set vx/vy):\n// Goal is already 0, lerp decays the launch naturally.\n// No separate 'barrel friction' constant needed.
Acceptance: Launched barrels arc up and settle (goal lerp handles it)
Acceptance: Falling barrels fall at terminal velocity
Acceptance: No more custom barrel velocity decay in barrelPhysics.js
Verification: Manual playtest: stomp barrel, explode barrel next to barrel

## MILESTONE: 5 - Cleanup + Tuning
Pattern: Strangler Fig (final cutover)
Objective: Remove all dead code: GROUND_FRICTION, AIR_ACCEL, SLIDE_DECEL, MAX_FALL_SPEED, applyKnockback, old friction branches. Tune accel/gravAccel per entity type until feel matches current. Run full test suite.
Success: Zero velocity-math constants outside core/movement.js. All tests pass. Playtest confirms identical feel. No entity does its own x += vx * dt.
Diagram: graph LR
    A[Find all vx/vy mutations] --> B{Is it updateVelocity or applyImpulse?}
    B -->|yes| C[Keep]
    B -->|no| D[Remove / migrate]

### TASK: 5.1 - Remove dead velocity code + tune feel
Type: chore
What: Delete GROUND_FRICTION, AIR_ACCEL, SLIDE_DECEL, MAX_FALL_SPEED constants. Remove applyKnockback from knockback.js (replaced by applyImpulse). Remove all 'stunned friction' and 'no-input friction' branches. Tune hero.accel, hero.gravAccel, projectile accel values until playtest matches current feel.
Why: Final cutover. No more dual systems. One way to move things. Dead code removed so nobody accidentally uses the old path.
Files: ~ petal-panic/js/hero/hero.js
Files: ~ petal-panic/js/combat/knockback.js
Files: ~ petal-panic/js/consts.js
Snippet: // Remove from consts.js:\n// export const GRAVITY = 1500;         → replaced by vyGoal per entity\n// export const MAX_FALL_SPEED = 800;   → built into lerp (can't overshoot goal)\n\n// Remove from hero.js:\n// const GROUND_FRICTION = 0.85;\n// const AIR_ACCEL = ...;\n// const SLIDE_DECEL = ...;\n// All 'stunned' / 'no-input' friction branches\n\n// Remove from knockback.js:\n// export function applyKnockback(victim, kb) { ... }  → use applyImpulse instead\n\n// Tuning (per entity type):\n// Hero:      accel = 12, gravAccel = 8   (snappy ground, floaty air via lower airAccel)\n// Enemy:     accel = 8,  gravAccel = 6\n// Projectile: accel = 20, gravAccel = 10 (fast response for homing)\n// Barrel:    accel = 6,  gravAccel = 5   (heavy, slow to settle)
Acceptance: No velocity decay/approach math exists outside core/movement.js
Acceptance: All existing tests pass
Acceptance: Playtest: run/jump/fall/get-hit/shoot feels identical to pre-refactor
Acceptance: grep for 'vx *=' in js/ returns zero hits (no manual friction)
Verification: cd petal-panic && node --experimental-vm-modules js/test/explosion.test.js
Verification: cd petal-panic && node --experimental-vm-modules js/test/knockbackRegression.test.js
Verification: grep -rn 'vx \*=' js/ --include=*.js | grep -v test | wc -l

### TASK: 5.2 - Migrate enemy movement to goal system
Type: refactor
What: In Enemy.update() / enemyUpdate.js: replace manual vx/vy integration with updateVelocity(). Enemy AI sets vxGoal (walk toward target = dir * speed, idle = 0). Gravity = vyGoal = terminal. Jumping enemies apply impulse. Stunned enemies get vxGoal=0.
Why: Enemies currently do their own x += vx * dt and gravity. They should just set a goal (walk direction × speed) and let the engine move them. Same system as hero, different accel tuning.
Files: ~ petal-panic/js/enemies/enemy.js
Files: ~ petal-panic/js/enemies/enemyUpdate.js
Snippet: // In Enemy AI (per-type ai method):\n// Walk toward target:\nthis.vxGoal = Math.sign(dx) * this.stats.speed * UNIT_PX_X;\n// Idle / stunned:\nthis.vxGoal = 0;\n\n// In Enemy base update(), replace manual integration:\n//   this.vy += GRAVITY * dt;\n//   this.x += this.vx * dt;\n//   this.y += this.vy * dt;\n// With:\nthis.vyGoal = TERMINAL_VELOCITY;\nupdateVelocity(this, dt);\n\n// Enemy jump (if any type jumps):\napplyImpulse(this, 0, -jumpSpeed);
Acceptance: Enemies walk toward target at their speed (vxGoal = dir * speed)
Acceptance: Enemies fall under gravity (vyGoal = terminal)
Acceptance: Stunned enemies stop (vxGoal = 0, lerp decays)
Acceptance: No manual x += vx * dt in enemy update
Verification: Manual playtest: enemies walk, chase, get hit, fall off platforms

### TASK: 5.3 - Migrate coins + particles to goal system
Type: refactor
What: Coin and particle entities use updateVelocity. Coin spawn: applyImpulse with scatter velocity, vxGoal=0, vyGoal=terminal (arc up then fall). Particles: applyImpulse with burst velocity, vxGoal=0, vyGoal=terminal or 0 (float). Remove manual integration from coin/particle update loops.
Why: Coins that pop out of barrels/enemies should arc and settle using the same goal system. No custom coin friction or gravity code. Particles fade out via lerp to zero velocity.
Files: ~ petal-panic/js/objects/coin.js
Files: ~ petal-panic/js/effects/particles.js
Snippet: // Coin spawn (barrel break, enemy death):\ncoin.vx = randomAngle.x * speed;\ncoin.vy = randomAngle.y * speed - popUp; // launch up\ncoin.vxGoal = 0;   // no sustained horizontal motion\ncoin.vyGoal = TERMINAL_VELOCITY; // fall under gravity\n// updateVelocity handles the arc\n\n// Particle burst:\nparticle.vx = dir.x * speed;\nparticle.vy = dir.y * speed;\nparticle.vxGoal = 0;  // decelerate to stop\nparticle.vyGoal = 0;  // float in place (or small terminal for dust)\n// Lerp naturally slows them to a halt
Acceptance: Coins arc up from barrel/enemy and fall to ground (goal lerp)
Acceptance: Coins bounce off floor (existing collision, velocity flip)
Acceptance: Particles burst outward and slow to stop (lerp to zero)
Acceptance: No manual x += vx * dt in coin or particle update
Verification: Manual playtest: break barrel (coins pop), kill enemy (coins + sparkles)

### TASK: 5.4 - Port collision + wall bounce + drop-through to goal system
Type: refactor
What: In core/collision.js resolve(): when a wall hit occurs, flip vx AND vxGoal, multiply both by bounceDamping. When landing on ground (vy snap), set vy=0 and vyGoal=terminal (gravity takes over). Drop-through: set vy directly (impulse down), gravity goal handles the rest. Must feel EXACTLY like current resolve() behavior.
Why: Collision is where velocity gets zeroed/flipped today. In the goal system, we flip both goal and speed (like enjfine BOUNCE). Landing zeros vy but gravity goal immediately starts pulling again. No behavior change — same snaps, same bounces, just expressed as goal+speed writes.
Files: ~ petal-panic/js/core/collision.js
Snippet: // In resolve(), wall hit (x-axis push-out):\n// Current: if (entity.vx > 0) entity.vx = 0;\n// New: flip both, apply damping\nconst bounce = entity.bounceDamping ?? 0; // 0 = stop, 0.7 = bouncy\nentity.vx = -entity.vx * bounce;\nentity.vxGoal = -entity.vxGoal * bounce;\n\n// In resolve(), landing snap (y-axis):\n// Current: entity.vy = 0;\n// New: zero current, gravity goal pulls again next frame\nentity.vy = 0;\n// vyGoal stays at TERMINAL_VELOCITY (set by update loop)\n\n// Drop-through (hero drops through one-way platform):\n// Current: hero.vy = dropSpeed (direct)\n// New: same — direct impulse, gravity goal takes over\napplyImpulse(hero, 0, DROP_SPEED);
Acceptance: Wall bounce feels identical (flip + damp both vx and vxGoal)
Acceptance: Landing on ground stops fall (vy=0), gravity resumes next frame
Acceptance: Drop-through: hero falls through platform at same speed as now
Acceptance: No tunneling or double-snap regressions
Verification: Manual playtest: run into walls, jump and land, drop through platforms

### TASK: 5.5 - Port boss + supermove committed trajectories to goal system
Type: refactor
What: Boss charges and hero supermove use DIRECT vx/vy writes (committed trajectory, no lerp). These bypass the goal system intentionally — set vx AND vxGoal to the same value so lerp is a no-op (already at goal). When the committed move ends, vxGoal drops to 0 and lerp decays. Same feel as current: instant full speed during charge, smooth stop after.
Why: Committed moves (supermove burst, boss charge) need instant full speed — no ramp-up. Setting vx = vxGoal = targetSpeed means the lerp does nothing (already there). When it ends, vxGoal = 0 and you get the natural decel. No special 'override' mode needed.
Files: ~ petal-panic/js/hero/hero.js
Files: ~ petal-panic/js/boss/boss.js
Snippet: // Supermove burst (committed trajectory):\n// Current: this.vx = dir * SUPERMOVE_SPEED;\n// New: set BOTH — lerp is a no-op while they match\nthis.vx = dir * SUPERMOVE_SPEED;\nthis.vxGoal = dir * SUPERMOVE_SPEED; // already at goal, no lerp\n\n// Supermove end:\nthis.vxGoal = 0; // lerp decays from SUPERMOVE_SPEED to 0 naturally\n\n// Boss charge (same pattern):\nboss.vx = chargeDir * chargeSpeed;\nboss.vxGoal = chargeDir * chargeSpeed; // committed\n\n// Boss charge end / hit wall:\nboss.vxGoal = 0; // settle
Acceptance: Supermove burst: instant full speed (no ramp), same as now
Acceptance: Supermove end: smooth decel via lerp (replaces current friction branch)
Acceptance: Boss charge: instant full speed during charge
Acceptance: Boss charge end: smooth stop
Acceptance: No 'bypass goal system' flag needed — just set both equal
Verification: Manual playtest: supermove dash, boss charge attack

### TASK: 5.6 - Port camera follow to goal system
Type: refactor
What: Camera follows hero using the same lerp pattern: cameraXGoal = hero.x + offset, camera lerps toward goal at camera.accel rate. Replaces any current manual camera smoothing/lerp code.
Why: Camera is just another entity with a position and a goal. Same math, no special case. If current camera uses a different smoothing (e.g. fixed lerp factor), match it with the right accel number.
Files: ~ petal-panic/js/core/camera.js
Snippet: // In camera update:\n// Current: this.x += (targetX - this.x) * SMOOTH_FACTOR;\n// New: same math expressed as goal system\nthis.xGoal = hero.x + OFFSET;\nthis.x += (this.xGoal - this.x) * this.accel * dt;\n// (This IS the lerp — camera just doesn't integrate y from velocity,\n//  it directly approaches the goal position. Special case: position-goal\n//  instead of velocity-goal. Still one pattern.)
Acceptance: Camera follows hero with same smoothness as current
Acceptance: No jitter or lag regression
Verification: Manual playtest: run around, jump, watch camera follow
