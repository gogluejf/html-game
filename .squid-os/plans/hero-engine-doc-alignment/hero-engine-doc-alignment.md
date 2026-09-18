# EPIC: Hero Engine ↔ hero-mechanics.md Alignment
Why: petal-panic/docs/hero-mechanics.md is now the single source of truth for hero behavior. Code audit found 12+ divergences: no special melee, no weapon toggle (N fires specials directly), no one-way platforms or drop-through, aim not used for crouch/shoot context rules, supermove jump-cancel missing, stale 'inv' timer in tests, and a render flag that never exists (superActive vs supermoveActive). This plan sequences fixes as behavior corrections → new mechanics → polish, each with acceptance criteria tied to the doc.
Outcomes: Every mechanic in hero-mechanics.md §3–§33 is implemented and verifiable; zero duplicate code paths (single damage/knockback/timer routing); existing tested behaviors (double jump, coyote, buffer, slide, i-frames) remain green; premium engine quality — no ad-hoc state flags, explicit state composition per §31.


## TESTING CONVENTION (added during execution — binding for all remaining tasks)

1. **Mechanic tests use the direct-intent pattern** (reference: `petal-panic/js/test/jumpslide.test.js`): call `hero.update(DT, intent)` with plain intent objects. No DOM key simulation, no input.js polling, no full `update()` pipeline. Assert behavior invariants (dir index, flags, velocity sign/magnitude, phase names) — not pixel offsets or tuning constants.
2. **One small wiring test per new input surface** (readInput/input.js edge cases: lockDir freeze, lockMove zeroing, crouch mapping) may use the full pipeline with stubbed DOM listeners — few in number, full key release + `processInput()` before/after every case, poll-until-condition instead of fixed frame counts.
3. **No inline HTTP servers in tests** (freezes the host app). Real gameplay feel is verified **manually by the user at the end** via `server.py`; no automated acceptance criterion may depend on in-game observation.
4. **Executor anti-loop rule:** max 2 identical diagnostic runs; edit-first/verify-after; if a harness misbehaves, rewrite the case in direct-intent style before debugging the pipeline.

---

## MILESTONE: 1 - Behavior Corrections (Doc Compliance)
Pattern: Audit-driven fix; single source of truth = hero-mechanics.md
Objective: Fix every place where existing code contradicts the doc, without adding new features. Each task starts with a code review that classifies the item as NEW (absent) vs POLISH (present but wrong feel), and acceptance criteria verify the doc's stated behavior.
Success: All §3–§10 invariants hold: contextual Down rules, air control ramp, supermove jump-cancel phases, i-frame visual sync, timer labels match §28, no stale flags. Existing test suite stays green.
Diagram: graph TD
    A[Code vs Doc audit] --> B{Item classification}
    B -->|NEW - absent| C[Implement mechanic]
    B -->|POLISH - present but off| D[Tune / correct behavior]
    B -->|CORRECT - wrong contract| E[Refactor to doc contract]
    C --> F[Acceptance: doc invariant holds]
    D --> F
    E --> F
    F --> G[Existing tests stay green]

### TASK: 1.1 - Contextual Down: crouch vs downward aim resolution
Type: bug
What: Route the resolved aim (input.state.aimX/aimY) into hero.update and implement doc §4 context rules: grounded+Down=crouch (shoot stays horizontal toward facing), airborne+Down=straight-down aim, lockMove+Down=downward aim with zero locomotion.
Why: Today readInput() maps s.crouch to input.down and tryFire uses raw aimFromInput; a grounded crouched hero can shoot diagonally/downward via WASD which the doc forbids ('no normal grounded crouch + straight-down shooting state'). Aim must be resolved by gameplay context, not raw keys (§32).
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/hero.js
Files: + petal-panic/js/test/contextualAim.test.js
Snippet: // update.js readInput(): pass through the RESOLVED aim from the input engine\nreturn { ..., down: s.crouch, aimX: s.aimX, aimY: s.aimY };\n\n// hero.js — contextual aim resolver (single source, called by tryFire path)\n// grounded + down  -> horizontal along facing (crouch rule, doc §4)\n// airborne + down  -> straight down\n// lockMove + down  -> straight down, locomotion already zeroed\n// no direction     -> horizontal along facing (neutral shot, doc §3)\nresolveAim(input, h) -> dir8\n\n// tryFire/trySpecial consume resolveAim() instead of aimFromInput(raw)
Acceptance: Grounded hero holding Down + Shoot fires horizontally in facing direction only (no diagonal/down shots while crouched)
Acceptance: Crouched shot originates from the crouched body center (lower than standing shot origin), derived from the active box (crouchBox) not the standing height — visual and gameplay impact agree (§20/§36)
Acceptance: Airborne hero holding Down + Shoot fires straight down
Acceptance: lockMove + Down + Shoot fires straight down with vx held at 0
Acceptance: No directional input + Shoot fires horizontally toward facing (neutral shot unchanged)
Acceptance: Lock Direction still freezes the resolved aim (existing input.js behavior untouched)
Verification: node petal-panic/js/test/contextualAim.test.js
Verification: node petal-panic/js/test/projectile.test.js

### TASK: 1.2 - Air control: ramp from rest, preserve jump momentum
Type: bug
What: Replace the instant vx=speed assignment with a ground/air-aware model in hero.js: grounded input snaps to run speed immediately (doc §7), airborne input accelerates toward run speed over a short ramp when starting from near-zero horizontal velocity, and existing legitimate momentum is preserved.
Why: Doc §8 requires air acceleration instead of an instant snap ('do not instantly assign full run speed; accelerate toward normal horizontal speed over a short period'), while §7 keeps ground movement arcade-immediate. Current code sets this.vx = moveDir * speed in both states — the barrel-jump case (§8) feels like suddenly running at full speed mid-air.
Files: ~ petal-panic/js/hero.js
Files: + petal-panic/js/test/airControl.test.js
Snippet: // hero.js feel knobs (tuning values per doc §35)\nconst AIR_ACCEL = 1400;      // px/s^2 ramp when starting air movement from rest\nconst GROUND_SNAP = true;    // ground: immediate run speed (no ramp)\n\n// update() horizontal intent:\n// grounded + input   -> vx = dir * speed            (immediate, doc §7)\n// airborne + input   -> approach(vx, dir*speed, AIR_ACCEL*dt)  (ramp, doc §8)\n// no input           -> existing friction / slide-decel branches unchanged\n// opposite direction on ground -> immediate cancel (already true via vx overwrite)
Acceptance: Grounded: pressing a direction produces full run speed on the same frame (no ramp)
Acceptance: Airborne from ~0 vx: velocity approaches run speed over several frames, never snaps to full speed in one frame
Acceptance: Jumping while running preserves horizontal momentum (running jump continues naturally)
Acceptance: Opposite ground direction cancels momentum immediately (existing behavior retained)
Acceptance: Barrel case: jumping while blocked against a solid accelerates into movement once clearable, without a 1-frame full-speed snap
Verification: node petal-panic/js/test/airControl.test.js
Verification: node petal-panic/js/test/jumpslide.test.js

### TASK: 1.3 - Supermove: phase-aware jump cancellation + anim flag fix
Type: bug
What: Split the supermove dash into explicit burst (first ~60%, committed) and decel (last ~40%, jump-cancellable) phases in hero.js, allow Jump to cancel only during decel, and fix the render.js flag mismatch (h.superActive vs h.supermoveActive) so the supermove anim state is selected correctly.
Why: Doc §23 requires 'active dash = committed; recovery/deceleration = jump-cancellable' — today a jump input mid-dash is silently ignored for the whole 0.6s. Separately, heroAnimName() reads h.superActive which does not exist on Hero, so the supermove anim branch never fires (§29 animation sync).
Files: ~ petal-panic/js/hero.js
Files: ~ petal-panic/js/systems/render.js
Files: + petal-panic/js/test/supermove.test.js
Snippet: // hero.js — phase model replaces single timer countdown\n// SUPERMOVE_DUR split: BURST_FRAC = 0.6 (committed), remainder = decel\n// updateSupermove():\n//   if phase === 'burst':   no jump cancel, no gravity, vx = dir * burstSpeed(t)\n//   if phase === 'decel':   gravity resumes, vx decays, JUMP may cancel ->\n//                           end dash early, keep residual forward nudge\n// triggerSupermove(): set intangible via the shared 'intangible' timer ONLY\n//                     (no separate inv path)\n\n// render.js heroAnimName(): h.supermoveActive (correct existing field)
Acceptance: Jump pressed during the first 60% of the dash does NOT cancel it
Acceptance: Jump pressed during the last 40% ends the dash early with a small residual forward velocity
Acceptance: Intangibility window equals the actual dash duration (timer-driven, not hardcoded overlap)
Acceptance: heroAnimName returns 'supermove' while dashing (flag fixed); returns previous state after dash ends
Acceptance: No duplicate intangibility bookkeeping: supermove uses the same 'intangible' timer as i-frames/powerups (§27 common semantics)
Verification: node petal-panic/js/test/supermove.test.js
Verification: node petal-panic/js/test/heroHit.test.js

### TASK: 1.4 - Hit response: contextual knockback table + i-frame visual sync + test cleanup
Type: bug
What: Centralize hero knockback in a per-source profile table (contact / enemy melee / ordinary projectile / heavy projectile / explosion) consumed by the existing takeHit() entry point, drive the i-frame blink from the 'intangible' timer's remaining fraction instead of wall-clock performance.now(), and fix stale assertions ('inv' timer) in test/heroHit.test.js.
Why: Doc §25 forbids one universal recoil value — today contact uses 260/340 inline, projectiles a flat 220, explosions 380, all hardcoded at call sites with no source taxonomy. Doc §27 requires the i-frame flash to correspond to the actual immunity window; the render blink is decoupled from the timer. The test file still asserts timers.get('inv') which no longer exists (timers were unified to 'intangible').
Files: ~ petal-panic/js/hero.js
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/systems/render.js
Files: ~ petal-panic/js/test/heroHit.test.js
Snippet: // hero.js — knockback profiles (doc §25 taxonomy), single lookup\nKNOCKBACK_PROFILES = {\n  contact:      { strength: 260, recovery: 0.25, iFrames: 0.60 },\n  bossContact:  { strength: 340, recovery: 0.30, iFrames: 0.70 },\n  projectile:   { strength: 220, recovery: 0.25, iFrames: 0.30 },\n  heavyProj:    { strength: 300, recovery: 0.30, iFrames: 0.40 },\n  explosion:    { strength: 380, recovery: 0.30, iFrames: 0.60 },\n}\ntakeHit({ source, dirX, dirY }) -> reads profile by source key,\n  applies hero knockback-resistance modifier, sets 'rec' + 'intangible'\n\n// update.js call sites pass source key instead of raw numbers\n// render.js blink: alpha derived from h.timers.fraction('intangible')\n//                 so the flicker ends exactly when immunity ends (§27)
Acceptance: Each damage source (enemy contact, boss contact, ordinary projectile, explosion) produces its own distinct knockback magnitude via the shared profile table — no inline magic numbers left at call sites
Acceptance: Damage and knockback remain independent properties (equal-damage attacks can have different recoil)
Acceptance: I-frame blink stops on the exact frame the 'intangible' timer expires (no drift after immunity ends)
Acceptance: Knockback velocity decays over the hit-stun window and normal control resumes cleanly with no residual state lock (§26)
Acceptance: test/heroHit.test.js passes against the current 'intangible'/'rec' timer names (stale 'inv' assertion removed)
Verification: node petal-panic/js/test/heroHit.test.js
Verification: node petal-panic/js/test/timers.test.js

### TASK: 1.5 - Crouch/slide cancellation hardening + anim-state sync audit
Type: refactor
What: Guarantee crouch/slide exit transitions state, hitbox, movement restrictions, and animation atomically (jump-from-crouch included), and extend heroAnimName() to cover the full §29 list (melee, supermove, hit-stun, death) with a test that asserts no stale visual state after each transition.
Why: Doc §11 requires 'state, movement restrictions, hitbox, animation must transition together — no crouch hitbox or animation may remain after the hero is back on their feet.' Jump currently refuses while crouching (the !this.crouching gate in the jump branch), which contradicts §12 ('crouching must never force the player to stand first'). heroAnimName also lacks melee/hit/death branches beyond what exists, so visuals can drift from gameplay state (§29).
Files: ~ petal-panic/js/hero.js
Files: ~ petal-panic/js/systems/render.js
Files: + petal-panic/js/test/crouchCancel.test.js
Snippet: // hero.js — single exit path for crouch/slide (no scattered flag clears)\nexitCrouch() {\n  this.crouching = false;\n  this.sliding = false;\n  this.box = this.standBox;        // hitbox restored\n  // locomotion restrictions lifted automatically (update reads flags)\n}\n// jump branch: remove '!this.crouching' gate; jumping calls exitCrouch()\n// first, then initiates the jump (doc §12)\n\n// render.js heroAnimName() — priority order per §29:\n// dead > supermove > melee(active) > hitstun('rec') > crouch > jump/fall > run > idle
Acceptance: Jumping from crouch immediately cancels crouch and initiates the jump (no stand-first requirement)
Acceptance: Releasing Down while moving exits crouch into run with standing hitbox active the same frame
Acceptance: After slide ends, vx reaches 0 and sliding flag + slide anim stop together (no lingering slide state)
Acceptance: heroAnimName covers all §29 states and a test asserts the returned name matches authoritative state after each transition (jump-from-crouch, melee end, hit-stun end, dash end)
Verification: node petal-panic/js/test/crouchCancel.test.js
Verification: node petal-panic/js/test/jumpslide.test.js
Verification: node petal-panic/js/test/heroAnim.test.js

## MILESTONE: 2 - New Mechanics
Pattern: Vertical slices; shared core systems (damage, timers, hitbox slots) reused — no parallel code paths
Objective: Implement the mechanics the doc specifies that are entirely absent from the engine: one-way platforms with drop-through, the weapon toggle system (N), and special melee (Down+Melee) with per-hero trajectories.
Success: §13 one-way platform rules work (up-through, land, Down+Jump drop); N toggles Thorn/Special with independent ammo+cooldowns and Special fires via the same shoot path; Down+Melee triggers Balthazar's advancing sweep and Scarlet's retreating cartwheel with committed windup/active + cancellable recovery.
Diagram: graph LR
    subgraph OW [One-way platforms]
      A["Air platforms flagged oneWay in level def"] --> B["Rising: collision pass ignores them - jump up through"]
      B --> C["Falling onto top: land on it as normal ground"]
      B --> D["Down plus Jump on it: drop through for ~0.25s, no jump"]
    end
    subgraph WP [Weapon toggle]
      E["N pressed"] --> F["Toggle selectedWeapon"]
      F --> G["Shoot uses selected weapon"]
      G --> H["Thorn pool / Special pool"]
    end
    subgraph SM [Special melee]
      I["Down plus Melee"] --> J["Hero-specific trajectory"]
      J --> K["Windup committed"]
      K --> L["Active frames deal damage"]
      L --> M["Recovery cancellable"]
    end

### TASK: 2.1 - One-way platforms + Down+Jump drop-through
Type: feature
What: Add a oneWay flag to level platform definitions, make resolve() skip one-way solids while the hero moves upward or is not overlapping from above, and implement Down+Jump on a one-way platform as a temporary (~0.25s) ignore of that platform instead of a jump.
Why: Doc §13 is entirely unimplemented: all platforms are solid AABBs today (level.js platforms have no type), so the hero cannot pass up through air platforms and there is no drop-through. This is a general platforming rule the doc marks as core feel ('one-way platforms never block upward traversal').
Files: ~ petal-panic/js/level.js
Files: ~ petal-panic/js/collision.js
Files: ~ petal-panic/js/hero.js
Files: ~ petal-panic/js/systems/update.js
Files: + petal-panic/js/test/oneWayPlatform.test.js
Snippet: // level.js — platform definition gains an optional flag\n{ x: 800, y: 380, w: 150, h: 16, oneWay: true }   // air platforms; floor stays solid\n\n// collision.js resolve(entity, solids, opts)\n//   one-way rule: skip solid when entity.vy < 0 (rising) OR entity's previous\n//   bottom was below the solid top (came from underneath)\n//   landing: falling (vy >= 0) with prev bottom <= top -> land normally\n\n// hero.js — drop-through intent\n//   input.down && jumpPressed && standing on one-way platform:\n//     set _dropTimer = 0.25 (ignore one-way solids while > 0)\n//     do NOT consume as an upward jump (doc §13)\n//   solid terrain unaffected (floor / barrels always resolve)
Acceptance: Hero moving upward passes through a one-way platform without being pushed down
Acceptance: Falling onto a one-way platform from above lands it as ground (setGrounded true)
Acceptance: Down+Jump while standing on a one-way platform drops the hero through it and does NOT trigger a jump (jumpsUsed unchanged)
Acceptance: Drop-through ignore window expires and the platform becomes landable again
Acceptance: Solid terrain (floor, barrels) is never affected by drop-through
Verification: node petal-panic/js/test/oneWayPlatform.test.js
Verification: node petal-panic/js/test/jumpslide.test.js

### TASK: 2.2 - Weapon toggle system (N): Thorn / Special through one shoot path
Type: feature
What: Replace the direct N-fires-special behavior with a selectedWeapon toggle on the hero ('thorn' | 'special'); J always fires the selected weapon, each weapon keeps its own ammo pool and cooldown timer, and HUD shows the active weapon.
Why: Doc §21 says Switch Weapon 'toggles Shoot between Thorn and Special' and 'the Special weapon must route through the same weapon-selection system rather than existing as an unrelated hidden firing path.' Today readInput maps s.switchWeapon to input.special and trySpecial() fires immediately on N — a separate hidden firing path with no selection state. Also fixes specialAmmo starting at 0 in fresh runs (line 931) so the toggled weapon is actually usable.
Files: ~ petal-panic/js/hero.js
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/hud.js
Files: + petal-panic/js/test/weaponToggle.test.js
Snippet: // hero.js\nthis.selectedWeapon = 'thorn';        // persisted until toggled\ntoggleWeapon() { this.selectedWeapon = this.selectedWeapon === 'thorn' ? 'special' : 'thorn'; }\n\n// update.js — single fire path (doc: 'same weapon-selection system')\nif (input.shoot) tryFire(h, input, dt);      // dispatches on h.selectedWeapon\nif (input.switchWeapon) h.toggleWeapon();    // edge-triggered, no fire\n// tryFire: thorn -> projectilePool + 'ammo' + fireCooldown\n//          special -> specialPool + 'specialAmmo' + timers('special')\n// both consume the SAME resolved aim (task 1.1)
Acceptance: Pressing N toggles the selected weapon without firing anything
Acceptance: J fires Thorn when selected and Special when selected — one code path, no hidden second trigger
Acceptance: Each weapon has independent ammo and cooldown: depleting Thorn ammo does not block Special and vice versa
Acceptance: Selection persists across frames until toggled again; swapHero preserves/restores selection sensibly
Acceptance: HUD indicates which weapon is currently selected
Verification: node petal-panic/js/test/weaponToggle.test.js
Verification: node petal-panic/js/test/projectile.test.js

### TASK: 2.3 - Special melee: Down+Melee with per-hero trajectories
Type: feature
What: Add a special-melee action to the hero triggered by Down+Melee: Balthazar performs a forward advancing sweep, Scarlet a backward cartwheel that stays oriented toward her original facing; both use windup→active→recovery phases with animation-synchronized hitboxes routed through the central damage system.
Why: Doc §15 is entirely absent — today Down+Melee just starts the same normal swing (input.down is ignored for melee). The doc makes this a core character-contrast mechanic (§34): 'Balthazar attacks into space; Scarlet attacks while leaving space.' Trajectory must be self-supplied (no Forward required) and committed once started.
Files: ~ petal-panic/js/hero.js
Files: ~ petal-panic/js/heroDefs.js
Files: ~ petal-panic/js/systems/update.js
Files: + petal-panic/js/test/specialMelee.test.js
Snippet: // heroDefs.js — per-hero special melee config (tuning lives here, not in code)\nspecialMelee: {\n  direction: 1 | -1,      // +1 = toward facing (balthazar), -1 = away (scarlet)\n  travelSpeed: px/s,      // self-supplied trajectory\n  frames: { windup: n, active: n, recovery: n },\n  hitbox: { ox, oy, bw, bh },   // active-frame box, mirrored by facing\n}\n\n// hero.js — phase machine shared with normal melee (doc §16 same rules)\nstartSpecialMelee()  // sets phase='windup', locks committed flag\nupdateSpecialMelee(dt)\n//   windup/active: committed — no jump/run cancel; vx = dir * travelSpeed\n//   active frames: specialMeleeHitboxWorld exposed (same slot pattern as melee)\n//   recovery: jump/run cancel allowed (shared rule, task 3.1 buffer applies)\n// facing preserved throughout scarlet's cartwheel (oriented toward original facing)
Acceptance: Down+Melee triggers special melee (not normal melee); plain Melee still triggers normal melee
Acceptance: Balthazar travels toward his facing during the attack without any horizontal input held
Acceptance: Scarlet travels opposite her facing but her sprite/orientation keeps facing the original direction
Acceptance: Damage lands only on the configured active frames via the central damage system (team/stats respected); hitbox mirrors correctly when facing left
Acceptance: Windup+active are committed (jump cannot abort); recovery is cancellable by jump/movement
Acceptance: Trajectory cannot be manually reversed mid-attack (committed movement owns vx during windup/active)
Verification: node petal-panic/js/test/specialMelee.test.js
Verification: node petal-panic/js/test/melee.test.js

## MILESTONE: 3 - Combat Input Architecture (Buffer + Cancellation)
Pattern: Single pending-action slot; cancellation checked before buffer execution
Objective: Implement the shared melee input buffer (§17–§19) that normal and special melee share: one-slot latest-wins buffering, buffer never shortens recovery, and cancellation always beats and clears the buffer.
Success: Mashing melee stores at most one pending action (latest wins); a buffered attack executes only after full natural recovery; any valid recovery-cancel (jump/run) discards the buffer. Both normal and special melee route through the same slot.
Diagram: stateDiagram-v2
    [*] --> Idle
    Idle --> Windup : melee pressed
    Windup --> Active : committed
    Active --> Recovery : committed
    Recovery --> Idle : natural finish then run buffer
    Recovery --> Idle : cancel - jump or run - buffer cleared
    Idle --> Windup : buffered action fires

### TASK: 3.1 - Shared one-slot melee buffer with latest-wins replacement
Type: feature
What: Add a single pendingMelee slot ('normal' | 'special' | null) to the hero: melee input during an in-progress attack stores/replaces the request (latest valid input wins), and the buffered action executes only after the current attack's recovery finishes naturally.
Why: Doc §17–§18 are absent — today tryMelee() is flatly ignored while a swing is active, so inputs during an attack are lost rather than buffered. The doc requires exactly one pending slot with latest-wins semantics ('repeated button mashing cannot schedule several future attacks') and explicitly forbids buffering from shortening recovery.
Files: ~ petal-panic/js/hero.js
Files: ~ petal-panic/js/systems/update.js
Files: + petal-panic/js/test/meleeBuffer.test.js
Snippet: // hero.js\nthis.pendingMelee = null;   // 'normal' | 'special' | null — capacity: 1\n\nrequestMelee(kind) {        // kind from Down+Melee context resolution\n  if (attackInProgress) this.pendingMelee = kind;  // store OR replace (latest wins)\n  else startAttack(kind);\n}\n// updateMelee(): when recovery completes naturally ->\n//   if pendingMelee: fire it, clear slot, return\n//   (buffer NEVER advances the frame clock early)
Acceptance: Pressing Melee then Special Melee before the first attack finishes leaves exactly 'special' buffered (then pressing Melee again leaves 'normal') — never two queued actions
Acceptance: The buffered attack does not start until windup→active→full natural recovery of the current attack has elapsed (frame timing identical to an unbuffered sequence)
Acceptance: After natural recovery completes, the buffered action fires automatically without re-pressing
Acceptance: Normal and special melee share the same slot (a normal can be replaced by a special and vice versa)
Verification: node petal-panic/js/test/meleeBuffer.test.js
Verification: node petal-panic/js/test/melee.test.js

### TASK: 3.2 - Recovery cancellation: cancel beats buffer and clears it
Type: feature
What: Implement recovery-phase cancellation for both melee types: once recovery begins, Jump or Run immediately ends the attack, performs the locomotion action, and clears pendingMelee; cancellation is checked before buffered execution each frame.
Why: Doc §16/§19 define the core combat feel contract: 'windup + active = committed; recovery = player locomotion can regain control immediately' and 'cancellation always wins and clears the buffer.' Today there is no recovery-cancel at all — the swing runs its full 0.4s regardless of input, making movement feel sticky (exactly what §1 forbids).
Files: ~ petal-panic/js/hero.js
Files: ~ petal-panic/js/systems/update.js
Files: + petal-panic/js/test/meleeCancel.test.js
Snippet: // hero.js updateMelee(dt, input) — per-frame order matters (doc §19):\n//   1. advance frame clock\n//   2. if phase === 'recovery' AND (input.jumpPressed OR horizontal intent):\n//        end attack early; clear pendingMelee; let locomotion proceed\n//   3. else if attack finished naturally AND pendingMelee: fire buffer\n// Cancellation (step 2) is ALWAYS evaluated before buffer execution (step 3).\n// Applies identically to normal + special melee (shared phase machine).
Acceptance: Melee → buffer Special Melee → recovery → Jump results in Jump only; the buffered Special Melee is discarded
Acceptance: Special Melee → buffer Melee → recovery → Run results in Run; the buffered Melee is discarded
Acceptance: Jump during windup or active frames does NOT cancel the attack (committed)
Acceptance: Run input during recovery cancels remaining recovery and resumes locomotion the same frame with no residual attack state
Acceptance: Both normal and special melee obey identical cancel rules (no per-type divergence)
Verification: node petal-panic/js/test/meleeCancel.test.js
Verification: node petal-panic/js/test/meleeBuffer.test.js
Verification: node petal-panic/js/test/specialMelee.test.js

## MILESTONE: 4 - Polish, Validation & Premium Quality Bar
Pattern: Invariants as executable tests; single-responsibility systems; no duplicated state
Objective: Close the quality gaps: per-frame attack hitbox data-driven by hero/attack/frame (§30), explicit state composition instead of flag soup (§31), debug-overlay timer parity with §28, and a doc-invariant test suite that encodes every §33 responsiveness invariant as an executable check.
Success: Every §33 invariant has a named executable test; attack hitboxes are data (per hero/attack/frame/facing) not inline math; hero state is inspectable as composed domains (locomotion / combat / aim / effects) rather than scattered booleans; debug overlay timers match the doc table exactly.
Diagram: graph TD
    A[Doc section 33 invariants] --> B[Invariant test suite]
    C[Hero state flags] --> D[Composed domain getters]
    D --> E["Anim selection and debug overlay read same source"]
    F[Hitbox inline math] --> G[Per-hero per-frame hitbox data tables]
    G --> H[Slot system consumes tables]

### TASK: 4.1 - Data-driven per-frame attack hitboxes (§30)
Type: refactor
What: Move melee/special-melee/supermove hitbox geometry out of inline hero.js math into per-hero, per-attack, per-frame data tables (offset/size by facing), consumed by the existing hitbox-slot system in update.js.
Why: Doc §30 requires hitbox data 'capable of varying by hero, attack, animation frame/phase, facing' with visual and gameplay impact coinciding. Today each hitbox is a single static rect computed inline (meleeHitbox, supermoveHitbox) — special melee (task 2.3) would otherwise add a third copy of the same pattern, which is exactly the duplication this plan must avoid.
Files: ~ petal-panic/js/heroDefs.js
Files: ~ petal-panic/js/hero.js
Files: ~ petal-panic/js/systems/update.js
Snippet: // heroDefs.js — declarative hitbox data (tuning surface, no logic)\nattacks: {\n  melee:      { frames: [null, null, null, { ox: 20, oy: -10, bw: 40, bh: 40 }, null] },\n  specialMelee: { frames: [ ...per-frame boxes... ] },\n  supermove:  { box: { ox: 20, bw: 16 } },   // body-height derived at runtime\n}\n\n// hero.js — one resolver replaces three inline getters\nattackHitboxWorld(attackName) -> AABB | null\n//   reads current phase/frame index from the shared phase machine,\n//   looks up the table entry, mirrors by facing\n// update.js slots keep their boxGet indirection; only the source changes
Acceptance: All three attack types resolve their hitbox through the single resolver + data tables (no inline per-attack rect math remaining in hero.js)
Acceptance: Hitboxes exist only during configured active frames/windows for every attack type
Acceptance: Facing left correctly mirrors every attack hitbox (test covers both facings × all attacks)
Acceptance: Per-hero differences (balthazar vs scarlet special melee boxes) come from data, not code branches
Verification: node petal-panic/js/test/melee.test.js
Verification: node petal-panic/js/test/specialMelee.test.js
Verification: node petal-panic/js/test/supermove.test.js

### TASK: 4.2 - Explicit state composition + debug/timer parity (§27, §28, §31)
Type: refactor
What: Expose hero state as composed domain queries (locomotion / combat phase / aim mode / effects) that render, debug overlay, and anim selection all read from the same source; verify the debug timer labels match the §28 table (intangible, rapid, special) with no orphan or missing timers.
Why: Doc §31 forbids a 'mutually exclusive mega-state' and requires explicit, predictable coexistence (airborne + facing right + direction-locked downward + intangible simultaneously). Today consumers each re-derive state from scattered booleans (crouching, sliding, meleeActive, supermoveActive, intangible, hitStunned), which is how drift bugs like the superActive mismatch (task 1.3) happen. §28's timer table must be visible and synchronized in the debug overlay.
Files: ~ petal-panic/js/hero.js
Files: ~ petal-panic/js/systems/render.js
Files: ~ petal-panic/js/debug.js
Snippet: // hero.js — derived domain views (pure getters over authoritative flags)\nget locomotion() -> 'idle'|'run'|'slide'|'crouch'|'jump'|'fall'\nget combatPhase() -> null|'windup'|'active'|'recovery' (+ attack kind)\nget aimMode()    -> 'follow-input'|'locked'\nget effects()    -> { intangible: bool, rapid: bool, hitstun: bool }\n// render.js heroAnimName(), debug overlay, and tests all consume these —\n// single derivation point, no consumer-side flag re-interpretation\n\n// debug.js — timer bars rendered from h.timers directly;\n// labels/colors per §28 table (intangible, rapid, special); rec shown for hit-stun
Acceptance: A hero can be airborne + facing right + direction-locked downward + intangible simultaneously and every consumer (anim, debug, damage) reads consistent values from the composed state
Acceptance: No consumer re-derives hero state from raw boolean flags outside hero.js (render/debug/anim use the domain getters)
Acceptance: Debug overlay shows exactly the §28 timer set when active (intangible / rapid / special) with correct labels and colors; no stale 'inv' label anywhere
Acceptance: Timers remain synchronized with their effects: clearing the 'rapid' timer stops the doubled fire rate on the same frame, etc.
Verification: node petal-panic/js/test/timers.test.js
Verification: node petal-panic/js/test/heroAnim.test.js
Verification: node petal-panic/js/test/debug.test.js

### TASK: 4.3 - §33 responsiveness-invariant test suite + full regression gate
Type: test
What: Add a dedicated invariant test file that encodes every bullet of doc §33 as an executable check against the hero (driven by scripted input sequences over fixed dt steps), and wire all petal-panic js tests into a single runnable gate.
Why: The doc's final contract (§33/§36) is only trustworthy if machine-checked. Individual mechanic tests exist per feature, but there is no suite that asserts the cross-mechanic invariants (e.g. 'buffered melee never shortens recovery' AND 'cancellation always beats buffering' together, or 'animation, hitbox, physics, and gameplay state remain synchronized'). This is the premium-quality validation layer: any future tuning change that breaks a feel invariant fails the gate.
Files: + petal-panic/js/test/invariants.test.js
Snippet: // Each §33 bullet becomes one named ok() case, driven by a small harness:\n//   step(hero, inputs[], nFrames) -> final state snapshot\n// Examples (one per invariant, not exhaustive list):\n//   opposite ground direction defeats momentum immediately\n//   jump buffer (~0.12s) forgives early press; coyote forgives late press\n//   air movement from rest ramps, legitimate jump momentum preserved\n//   one-way platforms never block upward traversal; Down+Jump drops through\n//   melee windup/active committed; recovery cancellable\n//   buffer stores max 1 action; latest wins; cancel clears buffer\n//   supermove burst not jump-cancellable; decel is\n//   hitboxes exist only during intended windows\n//   anim name matches authoritative state after each transition\n// Runner: node petal-panic/js/test/run-all.mjs (executes every *.test.js)
Acceptance: Every bullet in doc §33 has at least one named passing test case in invariants.test.js
Acceptance: Cross-mechanic cases included: buffer-vs-cancel interaction, crouch+jump+anim sync, drop-through vs jump consumption
Acceptance: A single command runs the entire petal-panic js test suite (all existing + new tests) and exits non-zero on any failure
Acceptance: Tuning values (jump buffer window, slide distance, super profile) are asserted against the documented targets within tolerance, so retuning must be deliberate
Verification: node petal-panic/js/test/invariants.test.js
Verification: node petal-panic/js/test/run-all.mjs

