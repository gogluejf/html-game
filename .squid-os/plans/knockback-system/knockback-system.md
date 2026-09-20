# EPIC: Knockback System — enemy hit reaction from hero committed attacks
Why: Hitting an enemy currently produces no physical reaction (only a white flash), so melee/special/supermove feel like they pass through — most acutely the sweep, where you lunge in and get clipped by your own follow-through with no space created. We add a lean, property-driven knockback system so committed hero attacks shove, stun, and loft enemies, making connects rewarding.
Outcomes: A shared applyKnockback consumed from a knockback setting carried on the attacking object; enemies gain a hit-stun window that interrupts their AI; sweep/cartwheel/supermove carry distinct knockback values (super launches hardest); knockback is 2D so hard hits pop victims into the air under gravity; contact/bossContact merge into one velocity-scaled body-contact rule; YAML entity files document the knockback property; architecture doc knockback.md is the conceptual spec. Scope v1: knockback applies to ENEMIES only, from the three committed hero attacks.

## MILESTONE: 1 - Knockback Core Mechanic
Pattern: Property-on-attacker + single applyKnockback + victim hitstun TTL
Objective: One knockback setting, one shared applyKnockback function, and an enemy-side hit-stun window that interrupts AI. No per-attack branching at the point of impact.
Success: Applying a knockback setting to an enemy knocks it back, sets its stun window, and freezes its AI action for that duration; a source with no knockback is a no-op.
Diagram: graph TD
  A[Attacking object carries knockback] --> B[applyKnockback victim attacker knockback normal]
  B --> C{knockback present and non-zero}
  C -->|no| D[no-op pure damage]
  C -->|yes| E[compute strength base plus motion times mass resist]
  E --> F[apply 2D impulse vx vy]
  F --> G[set stun TTL and optional protection window]

### TASK: 1.1 - Knockback setting + applyKnockback helper
Type: feature
What: Add a pure applyKnockback(victim, attacker, knockback, normal) module (new js/knockback.js) implementing base strength plus a motion term (head-on relative velocity projected onto the normal, clamped non-negative), scaled by victim mass resistance, applying a 2D impulse and setting the victim stun/protection TTLs.
Why: Single consumer for all knockback; keeps the math out of call sites and unit-testable without a DOM.
Files: + petal-panic/js/knockback.js
Snippet: // knockback.js — pure, no DOM\n// knockback = { base, scaleBySpeed, hitstun, iFrames, dirMode }\nexport function applyKnockback(victim, attacker, knockback, normal) {\n  // absent or zero-strength knockback is a no-op (e.g. friendly Thorn)\n  // mag = base + headOnRelativeVelocity * scaleBySpeed   (clamped >= 0)\n  // mag *= victim.knockbackResist                            (mass divisor)\n  // victim.vx += nx*mag; victim.vy += ny*mag\n  // victim.hitstunTimer = max(existing, knockback.hitstun)\n  // victim.iFrameTimer  = max(existing, knockback.iFrames)\n}
Acceptance: base-only knockback imparts exactly base times resist along the normal
Acceptance: motion term adds only the into-victim velocity component (sliding past adds ~0)
Acceptance: absent or zero-strength knockback changes nothing
Acceptance: heavier mass resistance scales the impulse down proportionally
Verification: node petal-panic/js/test/knockback.test.js

### TASK: 1.2 - Enemy hit-stun window + AI interrupt
Type: feature
What: Give Enemy a hitstunTimer (seconds) that, while active, skips its ai() action but still integrates physics so knockback plays out; expose a stunned getter and keep the existing hitFlash visual.
Why: Mirrors the hero recovery timer so a connect interrupts the enemy's current action (a mid-whip Jester stops) instead of the attacker passing through.
Files: ~ petal-panic/js/enemy.js
Snippet: // enemy.js\n// hitstunTimer: seconds remaining (driven by unified timers or plain countdown)\nget stunned() { return this.hitstunTimer > 0; }\nupdate(dt) {\n  // integrate physics always (knockback visible during stun)\n  if (this.stunned) { this.hitstunTimer -= dt; return; } // skip ai()\n  this.ai(dt);\n}
Acceptance: setting hitstunTimer above zero makes ai() not run until it expires
Acceptance: physics vx/vy integration still runs during stun so knockback is visible
Acceptance: a stunned enemy resumes its prior AI state after the window
Verification: node petal-panic/js/test/enemyHitstun.test.js

### TASK: 1.3 - Wire applyKnockback into enemy damage path
Type: feature
What: Route enemy damage so that when the damaging source carries a knockback setting, applyKnockback is called after HP drain using a normal from attacker-to-victim (fromAttacker) or the attack travel vector (alongVelocity); sources without knockback do nothing.
Why: One integration point; adding knockback to any future attack becomes setting a property with no new wiring.
Files: ~ petal-panic/js/systems/update.js
Snippet: // update.js — where enemy damage resolves\n// after damage(source, enemy, amt):\n//   if (source.knockback) {\n//     const normal = dirMode === 'alongVelocity'\n//       ? { x: source.vx, y: source.vy }\n//       : centerDelta(source, enemy);\n//     applyKnockback(enemy, source, source.knockback, normal);\n//   }
Acceptance: a hitbox or projectile carrying knockback shoves the enemy; one without does not
Acceptance: push direction matches the declared dirMode
Verification: node petal-panic/js/test/run-all.mjs

## MILESTONE: 2 - Hero Committed Attacks Carry Knockback
Pattern: Per-attack knockback data in heroDefs, consumed by existing hitbox loop
Objective: Sweep, cartwheel, and supermove each carry a distinct knockback value applied to enemies. Super is the strongest (rewarding launch). Friendly Thorn carries none.
Success: Sweeping, cartwheeling, or superring into an enemy visibly shoves, stuns, and slightly lofts it; Thorn does not move it at all.
Diagram: graph LR
  A[Sweep aggressive pushback] --> E[enemy shoved forward path cleared]
  B[Cartwheel escape move] --> F[enemy pushed away space created]
  C[Supermove strongest] --> G[enemy launched big reward]
  D[Thorn no knockback] --> H[damage only no shove]

### TASK: 2.1 - Attach knockback to the three hero attack hitboxes
Type: feature
What: In heroDefs.js give each committed attack a distinct knockback setting: Balthazar sweep (aggressive forward pushback that clears the path), Scarlet cartwheel (strong escape shove away from the enemy), and supermove for both (the strongest, very rewarding launch). Ensure the hero attack hitbox objects expose their knockback so the core wiring reads it; Thorn carries none.
Why: Distinct feel per attack with zero new logic; tuning lives in data, and super reads as the big reward.
Files: ~ petal-panic/js/heroDefs.js
Snippet: // heroDefs.js — per-attack knockback (values are starting points, tuned in 2.3)\n// balthazar.specialMelee.knockback = { base: 320, scaleBySpeed: 0.4, hitstun: 0.28, dirMode: 'alongVelocity' }\n// scarlet.specialMelee.knockback   = { base: 360, scaleBySpeed: 0.4, hitstun: 0.30, dirMode: 'fromAttacker' }\n// attacks[ATTACK_SUPERMOVE].knockback = { base: 600, scaleBySpeed: 0.5, hitstun: 0.50, dirMode: 'alongVelocity' }\n// thorn projectile: no knockback field
Acceptance: each of the three committed attacks exposes a non-null knockback; Thorn exposes none
Acceptance: super base strength exceeds cartwheel and sweep (super is hardest)
Verification: node petal-panic/js/test/attackKnockback.test.js

### TASK: 2.2 - Vertical pop on hard hits (2D knockback)
Type: feature
What: Ensure the knockback direction for these attacks imparts a modest upward component on strong hits so victims pop off the ground and fall back under existing gravity; tune so super lofts a light enemy about one to two body-heights and sweep gives a smaller hop, with nothing exaggerated.
Why: A readable launched read that makes hard connects feel impactful, falling out of the impulse plus existing gravity with no separate bounce system.
Files: ~ petal-panic/js/knockback.js
Snippet: // knockback.js — 2D impulse already carries vertical via the normal\n// strong hits (super) impart more upward velocity -> bigger pop\n// light hits (Thorn, no knockback) leave vy unchanged\n// tuning target: super lofts ~1-2 body-heights; sweep a small hop
Acceptance: a supermove hit sets victim.vy upward proportional to strength
Acceptance: a Thorn hit (no knockback) leaves vy unchanged
Verification: node petal-panic/js/test/attackKnockback.test.js

### TASK: 2.3 - Feel pass + regression gate
Type: chore
What: Playtest the three attacks against Jester/VineHound/etc and tune base, motion scale, and stun so sweep clears the path without overshooting, cartwheel reliably creates escape space, and super feels like a big reward; confirm no double-hit melt (one hit per swing holds) and run the full suite vs baseline.
Why: Numbers must feel right in-game, not just be present, before we lock the data.
Files: ~ petal-panic/js/heroDefs.js
Acceptance: full test suite green vs baseline with no new failures
Acceptance: final tuned knockback values recorded in the task summary
Verification: node petal-panic/js/test/run-all.mjs

## MILESTONE: 3 - Body-Contact Unification and Docs
Pattern: Velocity-scaled body knockback replaces layer branch; YAML + md document it
Objective: Merge contact/bossContact into one velocity-scaled body-contact knockback carried on the entity; document knockback in YAML; confirm knockback.md is the conceptual spec.
Success: The boss-vs-regular contact special-case is gone; a charging enemy hits harder than an idle one through its motion; YAML shows the knockback property matching the mechanic.
Diagram: graph TD
  A[Enemy body carries bodyKnockback] --> B[idle contact small shove]
  A --> C[charging contact big launch via motion term]
  D[Boss heavier and faster] --> E[reads harder through mass and speed]
  F[Old contact plus bossContact split] --> G[single physical rule replaces it]

### TASK: 3.1 - Merge contact/bossContact into velocity-scaled body knockback
Type: refactor
What: Give Enemy a bodyKnockback setting (base plus a high motion scale) and, in the hero-contact handler, replace the boss-vs-regular layer lookup with applyKnockback using that setting; bosses declare a larger base so they read harder through mass and speed. Remove the now-dead contact/bossContact profile rows if fully unused.
Why: Deletes the layer special-case and makes body knockback physical — an idle enemy shoves less than the same enemy charging.
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/enemy.js
Files: ~ petal-panic/js/hero.js
Snippet: // enemy.js: bodyKnockback = { base, scaleBySpeed: ~1.0, hitstun, dirMode: 'fromAttacker' }\n// update.js contact handler: drop  source.layer === LAYER.BOSS ? 'bossContact' : 'contact'\n//   -> applyKnockback(hero, source, source.bodyKnockback, normal)\n// hero.js: remove dead KNOCKBACK_PROFILES contact/bossContact rows if unused
Acceptance: no boss-layer knockback branch remains in the contact handler
Acceptance: an idle enemy contact shoves less than the same enemy at high speed
Acceptance: hero still gets stun and i-frames on contact (behavior preserved)
Verification: node petal-panic/js/test/run-all.mjs

### TASK: 3.2 - Document knockback in entity YAML
Type: doc
What: Add a knockback block to the relevant YAML files showing the property shape and values: enemy base (bodyKnockback), jester (whip hitbox knockback), and hero (sweep/cartwheel/super knockback); note that explosion knockback is carried on the explosion subject. Match the actual field names from the implementation.
Why: YAML must reflect implementation so designers can tune knockback without reading JS.
Files: ~ petal-panic/docs/engine/base/enemy.yaml
Files: ~ petal-panic/docs/engine/entities/jester.yaml
Files: ~ petal-panic/docs/engine/base/hero.yaml
Snippet: # enemy.yaml\nbody_knockback: { base: 60, scale_by_speed: 1.0, hitstun: 0.25, dir_mode: from_attacker }\n# hero.yaml — per committed attack\nsweep_knockback:    { base: 320, scale_by_speed: 0.4, hitstun: 0.28, dir_mode: along_velocity }\ncartwheel_knockback:{ base: 360, scale_by_speed: 0.4, hitstun: 0.30, dir_mode: from_attacker }\nsuper_knockback:    { base: 600, scale_by_speed: 0.5, hitstun: 0.50, dir_mode: along_velocity }\n# note: explosion knockback lives on the explosion subject
Acceptance: YAML knockback blocks match the implemented setting field-for-field
Acceptance: a comment notes explosion knockback is carried on the explosion subject
Verification: grep -n knockback petal-panic/docs/engine

### TASK: 3.3 - Final regression + scope handoff
Type: doc
What: Run the full suite green vs baseline, confirm knockback.md matches implemented behavior, and record what is out of scope for v1 (enemy-to-hero per-attack table, friendly projectile knockback) so the next epic picks it up cleanly.
Why: Closes the epic with a clean gate and an explicit handoff of deferred work.
Files: ~ petal-panic/docs/architecture/knockback.md
Acceptance: full test suite passes at or better than baseline
Acceptance: knockback.md scope note reflects exactly what shipped in v1
Verification: node petal-panic/js/test/run-all.mjs

### TASK: 3.4 - Preserve existing enemy-to-hero knockback through the refactor
Type: refactor
What: Ensure every existing way an enemy hurts the hero (body contact, projectile, heavy projectile, explosion) routes through the new applyKnockback mechanism with identical observable behavior — same shove magnitude, same stun duration, same i-frame window — as before the refactor. Add regression tests asserting each path's hero reaction is unchanged.
Why: The knockback system already works for enemies attacking the hero (hardcoded profiles). This epic refactors that into the shared engine; we must prove the refactor is behavior-preserving so no existing hero hit reaction silently changes.
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/hero.js
Snippet: // regression: for each existing source (contact, projectile, heavyProj, explosion)//   capture pre-refactor hero vx/vy + rec timer + intangible timer//   run the refactored path, assert the same values (within epsilon)// guarantees the engine migration is behavior-preserving for heroes
Acceptance: body contact still produces the same hero knockback + stun + i-frames as before
Acceptance: enemy projectile still produces the same hero reaction as before
Acceptance: explosion still produces the same radial hero reaction as before
Acceptance: a regression test covers each of the four paths and passes
Verification: node petal-panic/js/test/knockbackRegression.test.js

## MILESTONE: 4 - Self-Protection on Connect
Pattern: Connect-gated i-frame window on committed attacks
Objective: A clean connect on sweep or cartwheel grants the hero brief self-protection for the rest of that swing so the follow-through does not clip the hero; a whiff grants nothing.
Success: Landing a sweep or cartwheel makes the hero unable to be contact-damaged for the remainder of that attack's active+recovery; missing the enemy leaves the hero fully exposed.
Diagram: graph TD
  A[Committed attack active] --> B{hitbox connects this swing}
  B -->|connect| C[grant self i-frame until swing ends]
  B -->|whiff| D[no protection stays exposed]
  C --> E[follow-through cannot clip hero]
  E --> F[swing ends protection clears]

### TASK: 4.1 - Self-protection on connect (sweep + cartwheel)
Type: feature
What: When a sweep or cartwheel hitbox lands a clean hit on an enemy, set a short self-protection window (i-frame or just-hit flag) that lasts until that swing's active+recovery phases end; clear it if the swing is cancelled or completes. A whiff (no connect) grants nothing.
Why: This is the actual fix for the original complaint — the hero sliding into the enemy and getting clipped by their own follow-through. Rewarding a clean connect while keeping a whiff exposed preserves the risk/reward.
Files: ~ petal-panic/js/hero.js
Snippet: // hero.js — special melee connect handling// on first connect during active phase://   this._connectProtectUntil = endOfActivePlusRecoveryFrame// getter: get connectProtected() { return frame < _connectProtectUntil }// contact damage handler skips the hero when connectProtected// cleared on endSpecialMelee / recovery cancel
Acceptance: a clean sweep or cartwheel connect makes the hero immune to contact damage for the rest of that swing
Acceptance: a whiffed sweep or cartwheel grants no protection (hero stays exposed)
Acceptance: protection clears when the swing ends or is cancelled
Acceptance: normal melee and projectiles are unaffected (still no self-protection)
Verification: node petal-panic/js/test/connectProtect.test.js
