# EPIC: Self-Contained Attack Invoke — Plug & Play Attack Lifecycle
Why: Firing an attack macro today requires the CALLER to know which host owns its lifecycle and to pass a fully-wired ctx. Barrel payloads, enemies, and bosses each hand-roll step/draw wiring (or silently skip it), so every new object/enemy/boss that fires a macro needs bespoke glue and can silently fail to render or tick. This is not extensible.
Outcomes: invoke() + trigger become self-contained: any caller fires any macro in one line and the engine guarantees it is stepped, drawn, and pruned automatically. No per-caller host wiring. New attacks plug in with zero lifecycle code. Latent unstepped-payload bugs (e.g. enemy explosion/shockwave) are fixed for free.

## MILESTONE: 1 - Attack Lifecycle Registry
Pattern: Registry + Self-Registering Handle
Objective: A single engine-owned registry that auto-tracks every live attack handle and drives its step/draw/prune in one place, so invoke() never abandons a handle.
Success: Any handle returned by invoke() is stepped, drawn, and pruned by the game loop with zero caller code. No double-stepping of host-owned roots.
Diagram: graph TD
  A[caller invokes macro] --> B[invoke returns handle]
  B --> C{handle has step or zone}
  C|yes| D[auto-register into AttackLifecycle]
  C|no instant| E[skip - completes synchronously]
  D --> F[game loop steps all live handles]
  F --> G{handle done}
  G|no| H[draw zones each frame]
  G|yes| I[self-prune from registry]

### TASK: 1.1 - AttackLifecycle registry module
Type: feature
What: Add js/combat/attack/lifecycle.js: a Set of live handles with register(h), stepAll(dt, targets), drawAll(ctx), and clear(). A handle is 'live' when it has a .step fn or a .zone; it self-prunes once _completed/_cancelled.
Why: This is the single engine-owned lifecycle owner that replaces every per-caller host/ad-hoc step-draw path.
Files: + petal-panic/js/combat/attack/lifecycle.js
Snippet: // Self-contained attack lifecycle. invoke() registers; the game loop drives.\nexport const AttackLifecycle = {\n  _live: new Set(),\n  // Register a handle if it needs per-frame driving (has .step or a .zone).\n  register(h) { /* skip if h._completed || !needsDriving(h) */ },\n  // Step every live handle once; prune completed/cancelled.\n  stepAll(dt, targets) { /* for h of _live: h.step?.(dt, targets); prune */ },\n  // Draw every live handle's zones (recursive over h.handles + h.zone).\n  drawAll(ctx) { /* visit(h): h.zone?.draw(ctx); recurse h.handles */ },\n  // Tear down all (level transition / teardown).\n  clear() { /* cancel each; _live.clear() */ },\n};\nfunction needsDriving(h) { return typeof h?.step === 'function' || !!h?.zone; }
Acceptance: register() ignores already-completed handles and handles with no step/zone
Acceptance: stepAll() calls h.step(dt, targets) on each live handle exactly once and prunes completed ones
Acceptance: drawAll() recursively draws h.zone for the handle and every nested h.handles entry
Acceptance: clear() cancels all live handles and empties the set
Verification: node --check petal-panic/js/combat/attack/lifecycle.js

### TASK: 1.2 - Ownership tag to prevent double-stepping
Type: feature
What: Add an opt-out so a handle already owned by a host (bombAttacks) is not double-stepped by the registry. Registering marks h._lifecycleOwned; host-owned roots either skip registration or set the flag so stepAll() skips them.
Why: bombAttacks.step() already drives hero-shot roots; if the registry also steps them, carriers get double physics and payloads fire twice. Ownership must be explicit and unambiguous.
Files: ~ petal-panic/js/combat/attack/lifecycle.js
Snippet: // A handle is driven by EXACTLY ONE owner: the registry OR a host.\n// register(h, { owned }) - owned=true means a host already steps it;\n//   the registry still DRAWS its zones but never calls h.step().\nregister(h, opts = {}) {\n  if (!needsDriving(h)) return;\n  this._live.add(h);\n  h._registryStepped = !opts.owned; // false => host owns stepping\n}\nstepAll(dt, targets) {\n  for (const h of [...this._live]) {\n    if (h._completed || h._cancelled) { this._live.delete(h); continue; }\n    if (h._registryStepped) h.step?.(dt, targets); // hosts step their own\n  }\n}
Acceptance: a host-owned root registered with owned=true is drawn but NOT stepped by stepAll
Acceptance: a registry-owned handle is both stepped and drawn
Acceptance: no handle is ever stepped twice in one frame (assert via a counting stub)
Verification: node --check petal-panic/js/combat/attack/lifecycle.js

## MILESTONE: 2 - Self-Registering Invoke
Pattern: Side-Effect-Free Registration Hook
Objective: Wire invoke() to auto-register live handles into the registry, and make the game loop drive the registry instead of the ad-hoc per-caller paths.
Success: barrelSync propane fan, toxic zones, and enemy payloads all flow through the registry. The hand-rolled setBombHostGetter / barrelAttackRoots / stepToxicZones wiring is removed.
Diagram: sequenceDiagram
  participant Caller
  participant Invoke
  participant Registry
  participant Loop
  Caller->>Invoke: invoke(id, params, ctx)
  Invoke->>Invoke: build handle
  Invoke->>Registry: register(handle) if live
  Invoke-->>Caller: handle
  Loop->>Registry: stepAll(dt)
  Registry->>Registry: h.step for each live
  Loop->>Registry: drawAll(ctx)
  Registry->>Registry: h.zone.draw for each live
  Registry->>Registry: prune completed

### TASK: 2.1 - invoke() auto-registers live handles
Type: feature
What: In engine.js invoke(), after the handle is built, call AttackLifecycle.register(handle) for any non-completed handle that needs driving. Host-spawned roots (bombAttacks.spawn) register with owned=true so they are drawn but not double-stepped.
Why: This is the plug-and-play core: from now on a bare invoke() can never silently drop a handle's lifecycle.
Files: ~ petal-panic/js/combat/attack/engine.js
Files: ~ petal-panic/js/combat/attack/bombAttackHost.js
Snippet: // engine.js invoke(): single registration point.\nconst inner = def.impl(merged, ctx);\n// ... existing adoption logic yields result handle ...\nif (!result._completed) AttackLifecycle.register(result, { owned: false });\nreturn result;\n\n// bombAttackHost.js spawn(): host owns stepping, registry only draws.\nspawn(id, params, attacker) {\n  const h = invoke(id, params, this.makeCtx(attacker));\n  if (h and not completed) h._registryStepped = false; // host steps it\n  return h;\n}
Acceptance: a bare invoke() of a duration macro (e.g. fireArea) appears in AttackLifecycle._live without caller code
Acceptance: an instant macro that completes synchronously is NOT left in the registry
Acceptance: bombAttacks.spawn roots are present for drawing but carry _registryStepped=false
Verification: node --check petal-panic/js/combat/attack/engine.js

### TASK: 2.2 - Game loop drives the registry
Type: refactor
What: In systems/update.js call AttackLifecycle.stepAll(dt, getDamageables()) once per frame (after the pool-resident stepBomb pass and bombAttacks.step). In systems/render.js call AttackLifecycle.drawAll(ctx) in world space. Remove stepToxicZones/drawToxicZones and setBombHostGetter from the loop.
Why: One step + one draw call replaces every bespoke per-caller lifecycle path, which is the whole point of self-containment.
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/systems/render.js
Snippet: // update.js - single lifecycle drive (replaces stepToxicZones + barrel roots):\nbombAttacks.step(dt);          // host-owned hero shots (unchanged)\nAttackLifecycle.stepAll(dt, getDamageables());  // everything else\n\n// render.js - single zone draw (replaces drawToxicZones + barrel root draw):\nbombAttacks.draw(ctx);\nAttackLifecycle.drawAll(ctx);
Acceptance: toxic dust zones still tick damage and expire via the registry (no stepToxicZones call remains)
Acceptance: propane molotov fire zones render with no barrelSync-specific draw code
Acceptance: setBombHostGetter is no longer referenced by the game loop
Verification: node --check petal-panic/js/systems/update.js
Verification: node --check petal-panic/js/systems/render.js

### TASK: 2.3 - barrelSync fires macros with zero lifecycle wiring
Type: refactor
What: Rewrite the propane and toxic branches in barrelSync to a bare invoke() (or ctx.bombAttacks.spawn for hero-aligned) and drop the _getBombHost/setBombHostGetter, spawnToxicDustZone, stepToxicZones, drawToxicZones helpers. The registry now owns their step/draw.
Why: This is the concrete proof of the goal: the caller that previously needed host + getter + 3 helper functions now needs one line.
Files: ~ petal-panic/js/objects/barrelSync.js
Snippet: // Propane branch - ONE line, no host/getter/helpers:\ninvoke('spawnSplit', {\n  x: cx, y: cy, count: 5, centerDirection: -Math.PI / 2, angle: Math.PI * 0.7,\n  force: 520, spawnType: 'molotov',\n  molotov: { arc: 800, bounce: false, ttl: 1.2, fireWidth: 96, team: 'neutral' },\n  groundY: getActiveFloorY(),\n}, makeBarrelContext(barrel));   // pools + collisionWorld + targets\n\n// Toxic branch - same pattern:\ninvoke('dustZone', { x: cx, y: cy, width: W, height: H, duration: 3, tickRate: 5, damage: 6, team: 'neutral' }, makeBarrelContext(barrel));\n// No register, no step, no draw - the registry handles all three.
Acceptance: propane fan spawns 5 molotov lobes that render fire on the floor with only an invoke() call
Acceptance: toxic cloud ticks damage and expires with only an invoke() call
Acceptance: no reference to setBombHostGetter, _getBombHost, spawnToxicDustZone, stepToxicZones, or drawToxicZones remains in barrelSync
Verification: node --check petal-panic/js/objects/barrelSync.js

## MILESTONE: 3 - Host Unification & Migration
Pattern: Strangler Fig
Objective: Collapse the parallel host/registry paths so there is ONE lifecycle owner. Migrate hero shots, barrel payloads, and enemy/boss payloads onto it, then delete the bespoke wiring.
Success: bombAttacks either becomes a thin adapter over the registry or is removed. No caller references setBombHostGetter, barrelAttackRoots, or stepToxicZones. Full test suite green at baseline.
Diagram: flowchart LR
  A[hero shots] --> R[registry]
  B[barrel payloads] --> R
  C[enemy payloads] --> R
  D[boss payloads] --> R
  R --> S[stepAll]
  R --> D2[drawAll]
  E[old bombAttacks host] -.replaced.- R
  F[old ad-hoc step/draw] -.deleted.- R

### TASK: 3.1 - Migrate enemy + boss payloads to bare invoke
Type: refactor
What: Change explosiveMonkey.detonate (and any boss payload that stores a _payloadHandle) to a plain invoke() with no stored handle and no manual step. The registry steps/draws the explosion/shockwave automatically.
Why: These are the latent unstepped-payload bugs: today _payloadHandle is stored but never stepped, so enemy blasts rely on side effects. The registry fixes them for free.
Files: ~ petal-panic/js/enemies/explosiveMonkey.js
Snippet: // Before: this._payloadHandle = invoke('explosion', {...}, ctx);  // never stepped\n// After:  fire-and-forget - the registry owns it.\ninvoke(this.cfg.mineType === 'shockwave' ? 'shockwave' : 'explosion', {\n  x: cx, y: cy, radius: this.cfg.radius, damage: this.cfg.damage, team: this.cfg.team, self: this, targets: cands,\n}, makeDetonateContext());\n// drop this._payloadHandle entirely
Acceptance: an exploding monkey's blast ticks damage over its duration (was previously unstepped)
Acceptance: no enemy/boss stores an attack handle solely to step it by hand
Verification: node --check petal-panic/js/enemies/explosiveMonkey.js

### TASK: 3.2 - Decide bombAttacks fate: adapter or removal
Type: refactor
What: Either reduce bombAttackHost to a thin ctx-factory + owned-root marker (registry does step/draw) OR fold its groundY/platforms/camera ctx into the shared context and delete the host. Keep hero-shot behavior identical.
Why: Two lifecycle owners is the exact smell we are removing; this task forces a single owner while preserving hero-shot correctness.
Files: ~ petal-panic/js/combat/attack/bombAttackHost.js
Files: ~ petal-panic/js/combat/shooting.js
Snippet: // Option A preferred: host becomes a ctx factory only.\n// shooting.js keeps calling spawn(), but spawn() now just builds the rich\n// ctx (groundY, platforms, camera, targets) and delegates to invoke();\n// the registry steps + draws. No roots Set, no manual step/draw in host.\nspawn(id, params, attacker) {\n  return invoke(id, params, this.makeCtx(attacker)); // registry owns lifecycle\n}
Acceptance: hero bombs/homing/explosive shots behave identically to before (existing shooting tests pass)
Acceptance: exactly one component calls h.step for any given handle per frame
Verification: node --test 'petal-panic/js/test/*.test.js' 2>&1 | grep -E '# (pass|fail)'

### TASK: 3.3 - Delete dead wiring + verify baseline
Type: chore
What: Remove now-dead exports (setBombHostGetter, spawnToxicDustZone, stepToxicZones, drawToxicZones, barrelAttackRoots if any remain) and their imports. Run the full suite and confirm the pre-existing failure count is unchanged (no new failures).
Why: Leaving dead lifecycle paths behind recreates the confusion; a clean grep proves there is one owner.
Files: ~ petal-panic/js/objects/barrelSync.js
Files: ~ petal-panic/js/systems/update.js
Snippet: // Grep gate - all of these must return ZERO hits after migration:\n#   setBombHostGetter | _getBombHost | barrelAttackRoots | stepToxicZones | drawToxicZones | spawnToxicDustZone\ngrep -rn 'setBombHostGetter\|barrelAttackRoots\|stepToxicZones' petal-panic/js --include='*.js'
Acceptance: grep for the removed symbols returns zero non-test hits
Acceptance: full test suite shows the same pass/fail counts as the pre-change baseline (6 pre-existing failures, nothing new)
Verification: grep -rn 'setBombHostGetter\|barrelAttackRoots\|stepToxicZones' petal-panic/js --include='*.js'

## MILESTONE: 4 - Guards & Regression Net
Pattern: Characterization Test + Contract Test
Objective: Make the self-contained guarantee provable: a test that any macro fired from a bare ctx renders and ticks, plus a lint-style guard against discarded live handles.
Success: A new attack added to the registry passes the plug-and-play test with no caller wiring. The suite catches any future handle that is invoked but never stepped/drawn.
Diagram: graph TD
  A[new macro fires from bare ctx] --> B[plug-and-play contract test]
  B --> C{stepped at least once}
  B --> D{zone drawn at least once}
  B --> E{pruned after completion}
  C --> F[pass]
  D --> F
  E --> F

### TASK: 4.1 - Plug-and-play contract test
Type: test
What: Add js/test/attackLifecycle.test.js: for a set of representative macros (fireArea, molotov via spawnSplit, dustZone, shockwave), fire each from a minimal bare ctx and assert the registry stepped it >=1x, drew its zone >=1x, and pruned it after completion - with NO caller wiring.
Why: This is the executable definition of 'self-contained'. Any future macro that breaks the guarantee fails here immediately instead of in gameplay.
Files: + petal-panic/js/test/attackLifecycle.test.js
Snippet: // For each { id, params } in SAMPLES:\n//   const h = invoke(id, params, bareCtx());\n//   step the world N frames (AttackLifecycle.stepAll + pool update)\n//   assert(h was stepped at least once)      // counting stub or _state\n//   assert(some zone was drawn at least once) // spy on drawAll\n//   assert(!AttackLifecycle._live.has(h))     // pruned after done\nSAMPLES = [\n  ['fireArea', { x: 0, y: 480, width: 96, duration: 0.2, tickRate: 5, damage: 2 }],\n  ['dustZone', { x: 0, y: 480, width: 120, height: 60, duration: 0.2, tickRate: 5, damage: 2 }],\n  ['shockwave',{ x: 0, y: 480, radius: 200, duration: 0.2, damage: 5 }],\n];
Acceptance: each sample macro is stepped, drawn, and pruned with zero caller lifecycle code
Acceptance: a deliberately non-driving handle (no step/zone) is not registered
Verification: node --test petal-panic/js/test/attackLifecycle.test.js

### TASK: 4.2 - Discarded-handle guard test
Type: test
What: Add a test that scans for the anti-pattern: an invoke() of a duration macro whose handle is neither registered, host-owned, nor explicitly completed. Fail with the file:line if a live handle is dropped.
Why: This catches the exact bug class that cost this session - a macro fired and abandoned - before it reaches gameplay.
Files: + petal-panic/js/test/attackLifecycleGuard.test.js
Snippet: // Instrument AttackLifecycle.register to record every registered id.\n// Fire each hero/barrel/enemy attack entry point once in a harness ctx.\n// Assert every duration-macro invocation was either:\n//   (a) present in AttackLifecycle._live, OR\n//   (b) marked host-owned (_registryStepped === false), OR\n//   (c) completed synchronously.\n// Any other case => a discarded live handle => throw with source location.
Acceptance: firing the propane fan registers its molotov children (not discarded)
Acceptance: firing an enemy explosion registers or completes the payload (not silently dropped)
Verification: node --test petal-panic/js/test/attackLifecycleGuard.test.js

### TASK: 4.3 - Document the self-contained invoke contract
Type: doc
What: Add a short section to docs/architecture (attack engine) stating the one rule: callers fire via invoke() and never wire step/draw; the registry owns lifecycle. Note the single exception (host-owned roots) and how to add a new macro.
Why: The convention only sticks if it is written down where the next person looks.
Files: + petal-panic/docs/architecture/attack-lifecycle.md
Snippet: # Attack Lifecycle - Self-Contained Invoke\n## The one rule\nCallers fire attacks with invoke(id, params, ctx). They NEVER step or draw\nthe handle. AttackLifecycle (engine-owned) steps, draws, and prunes every\nlive handle automatically.\n## Adding a new macro\n1. Register it (primitive or macro) with meta.effects.\n2. If it needs per-frame driving, give its handle a .step fn or a .zone.\n3. Done. No host, no getter, no game-loop edit.\n## Single exception\nHost-owned roots (hero shots via bombAttacks) set _registryStepped=false so\nthe registry draws them but the host steps them. One owner, always.
Acceptance: the doc states the one-rule contract and the single host-owned exception
Acceptance: a 'how to add a new macro' section exists with 3 steps and no lifecycle wiring
Verification: test -f petal-panic/docs/architecture/attack-lifecycle.md
