# EPIC: Unified Hit Resolution
Why: Combat effects are scattered across damage entry points and callers, causing missing rewards, silent destruction, inconsistent knockback, and fragile new attacks.
Outcomes: One validated hit contract; target-owned reactions; exactly-once destruction payloads; behavior-preserving migration with regression coverage.

## MILESTONE: 1 - Behavior Inventory
Pattern: Characterization testing / strangler migration
Objective: Capture current production behavior for every damaging or impact path before changing routing.
Success: Every listed path has file/call-site evidence and a keep, fix, or undefined decision; no theoretical matrix is invented.
Diagram: graph TD
  A[Current combat paths] --> B[Inventory damage and impact owners]
  B --> C{Behavior correct?}
  C -->|yes| D[Mark keep]
  C -->|confirmed bug| E[Mark fix]
  C -->|no evidence| F[Mark undefined]
  D --> G[Migration baseline]
  E --> G
  F --> G

### TASK: 1.1 - Record behavior baseline
Type: test
What: Add characterization tests for current damage, reward, knockback, destruction and carrier-impact behavior across the approved 14-path inventory.
Why: Freezes working behavior so migration can distinguish intended fixes from regressions.
Files: + petal-panic/js/test/hitResolution/baseline.test.js
Files: ~ petal-panic/js/combat/hitboxes.js
Files: ~ petal-panic/js/combat/collisionHandlers.js
Files: ~ petal-panic/js/combat/explosion.js
Files: ~ petal-panic/js/objects/hazardZone.js
Snippet: \n// Inventory: MELEE, SPECIAL_MELEE, SUPER_MOVE, PROJECTILE, EXPLOSION,\n// HAZARD_FIRE, HAZARD_DUST, SPIKE, CONTACT, DASH, STOMP, BEAM, SHOCKWAVE, OBJECT_IMPACT.\n// Each case records target class/team, resource loss, reactions, rewards,\n// destruction payload count and carrier impact outcome.\ndescribe('hit resolution baseline', () => {\n  test('melee on supercoin currently omits per-hit reward', () => {});\n  test('dust currently affects destructibles but should affect living targets only', () => {});\n});\n
Acceptance: Covers all 14 provenance paths that exist in production; nonexistent combinations are explicitly marked undefined rather than tested as requirements.
Acceptance: Marks each observed behavior keep, fix or undefined with source call-site evidence.
Acceptance: Records current zero-damage reward scaling without changing it.
Verification: cd petal-panic && node --test js/test/hitResolution/baseline.test.js

## MILESTONE: 2 - Hit Contract
Pattern: Domain model / port and adapter
Objective: Introduce explicit enums, context/result schemas, target hooks and a resolver boundary without changing gameplay behavior.
Success: All combat callers can construct one validated HitContext and receive one HitResult; existing paths still pass through adapters.
Diagram: classDiagram
  class HitContext {
    source
    target
    attackTeam
    targetTeam
    targetClass
    provenance
    damage
    reaction
    impactPosition
    direction
    motion
  }
  class HitResult {
    accepted
    reason
    resourceLoss
    appliedKnockback
    stun
    protectionGained
    feedback
    rewards
    destroyed
  }
  class Target {
    onHit(context,result)
    onDestroyed(context,result)
  }
  class HitResolver {
    resolve(context) HitResult
  }
  HitResolver --> HitContext : validates
  HitResolver --> HitResult : produces
  Target <.. HitResolver : invokes once


### TASK: 2.1 - Add targeting declarations
Type: feature
What: Create shared Team, TargetClass and AttackProvenance enums plus affiliation/class accessors in js/combat/targeting.js.
Why: Gives every hit path one validated vocabulary instead of layer/method heuristics.
Files: + petal-panic/js/combat/targeting.js
Snippet: \nexport const Team = Object.freeze({ ALLY:'ALLY', FOE:'FOE', NEUTRAL:'NEUTRAL' });\nexport const TargetClass = Object.freeze({ HERO:'HERO', ENEMY:'ENEMY', BOSS:'BOSS', DESTRUCTIBLE:'DESTRUCTIBLE', OTHER:'OTHER' });\nexport const AttackProvenance = Object.freeze({ MELEE:'MELEE', SPECIAL_MELEE:'SPECIAL_MELEE', SUPER_MOVE:'SUPER_MOVE', PROJECTILE:'PROJECTILE', EXPLOSION:'EXPLOSION', HAZARD_FIRE:'HAZARD_FIRE', HAZARD_DUST:'HAZARD_DUST', SPIKE:'SPIKE', CONTACT:'CONTACT', DASH:'DASH', STOMP:'STOMP', BEAM:'BEAM', SHOCKWAVE:'SHOCKWAVE', OBJECT_IMPACT:'OBJECT_IMPACT' });\n\n// Resolve target team independently from class; invalid values throw.\nexport function getTargetTeam(target) {}\nexport function getTargetClass(target) {}\nexport function canHit(attackTeam, targetTeam, source, target) {}\n
Acceptance: Preserves the confirmed 3x3 team matrix, including neutral to neutral and self exclusion.
Acceptance: Classifies hero, enemy, boss and generic GameObj/destructible targets explicitly.
Acceptance: Rejects unknown teams/classes/provenance before mutation.
Verification: cd petal-panic && node --test js/test/hitResolution/targeting.test.js

### TASK: 2.2 - Implement hit resolver and target hooks
Type: feature
What: Add applyHit() with HitContext/HitResult schemas and exactly-once onHit/onDestroyed orchestration in js/combat/damage.js.
Why: Makes one entry point own eligibility, resource changes, reactions, rewards and destruction payload dispatch.
Files: ~ petal-panic/js/combat/damage.js
Files: + petal-panic/js/combat/hitResolution.js
Snippet: \n// Validate context before mutation. Resolve team/class/provenance behavior.\nexport function applyHit(context) {\n  // return rejected result without invoking callbacks or side effects\n  // route hero/enemy/boss/destructible lifecycle\n  // apply requested reaction modified by target state\n  // invoke target.onHit once for accepted hits\n  // latch destruction before invoking target.onDestroyed once\n}\n\n// Target adapters implement only target-specific effects:\n// supercoin per-hit reward; propane molotov payload; final coin burst.\ntarget.onHit = (context, result) => {};\ntarget.onDestroyed = (context, result) => {};\n
Acceptance: Hero shield/energy, enemy/boss death pipelines and GameObj HP/latch semantics remain intact.
Acceptance: Rejected hits produce no damage, feedback, knockback, rewards or callbacks.
Acceptance: onHit runs once per accepted hit, including lethal hits; onDestroyed runs once after onHit.
Acceptance: Chain reactions cannot trigger the same target's destruction payload twice.
Acceptance: Zero-damage accepted hits preserve current actual-damage reward scaling.
Verification: cd petal-panic && node --test js/test/hitResolution/resolver.test.js

## MILESTONE: 3 - Combat Path Migration
Pattern: Strangler fig / adapter migration
Objective: Migrate every existing damaging or impact path to applyHit() while preserving current behavior except confirmed fixes.
Success: No production combat path mutates HP, grants protection, spawns destruction payloads or rewards through a separate routing decision.
Diagram: graph TD
  A[Melee and hitboxes] --> R[applyHit]
  B[Projectiles and object impacts] --> R
  C[Explosions and shockwaves] --> R
  D[Fire dust spike zones] --> R
  E[Carrier macros] --> R
  R --> T{Target lifecycle}
  T --> H[Hero reaction]
  T --> E2[Enemy death pipeline]
  T --> D2[Destructible payload once]


### TASK: 3.1 - Migrate direct hitbox and projectile paths
Type: refactor
What: Route hero/enemy melee, special melee, super move, projectile and object-impact paths through applyHit() with explicit provenance and reaction settings.
Why: Fixes missing supercoin rewards and centralizes contact/damage decisions for the most common paths.
Files: ~ petal-panic/js/combat/hitboxes.js
Files: ~ petal-panic/js/combat/collisionHandlers.js
Files: ~ petal-panic/js/combat/objectImpact.js
Snippet: \n// Build one context per candidate:\n// { source, target, attackTeam, targetTeam, targetClass,\n//   provenance: AttackProvenance.MELEE, damage, reaction, impactPosition, direction, motion }\nconst result = applyHit(context);\n// Carrier lifecycle reads result.accepted/destroyed and owns consume/detonate/retain behavior.\n
Acceptance: Melee, special melee and super move trigger configured supercoin per-hit rewards.
Acceptance: Projectile top and side object impacts remain behaviorally identical except confirmed reward/destruction fixes.
Acceptance: Existing knockback values, resistance and lethal-hit motion are preserved.
Acceptance: Carrier impact behavior remains owned by its macro/primitive; resolver does not impose a fixed contact enum.
Verification: cd petal-panic && node --test js/test/hitResolution/migrationDirect.test.js

### TASK: 3.2 - Migrate zone and area attacks
Type: bug
What: Route fire, dust, spike, beam, shockwave, stomp and dash damage through applyHit(), with dust restricted to living targets and fire allowed to damage destructibles.
Why: Prevents silent destruction and applies exactly-once payloads for area/hazard kills.
Files: ~ petal-panic/js/objects/hazardZone.js
Files: ~ petal-panic/js/combat/attack/primitives/fireArea.js
Files: ~ petal-panic/js/combat/attack/primitives/spike.js
Files: ~ petal-panic/js/combat/attack/primitives/beam.js
Files: ~ petal-panic/js/combat/attack/primitives/shockwave.js
Files: ~ petal-panic/js/combat/attack/primitives/surfaceWave.js
Files: ~ petal-panic/js/combat/attack/macros/dashCombo.js
Snippet: \n// Each zone tick is one hit attempt per eligible target.\n// Dust context: provenance HAZARD_DUST, living-target eligibility only.\n// Fire context: provenance HAZARD_FIRE, current fire eligibility including destructibles.\n// Area primitives keep geometry/timing; resolver owns damage/reaction/destruction dispatch.\n
Acceptance: Dust does not damage or destroy destructibles.
Acceptance: Fire can damage destructibles and runs their destruction payload exactly once when lethal.
Acceptance: Spike, beam, shockwave, stomp and dash preserve baseline reactions except inventory-marked fixes.
Acceptance: A propane destructible destroyed by an eligible area attack spawns its molotov payload exactly once.
Verification: cd petal-panic && node --test js/test/hitResolution/migrationZones.test.js

### TASK: 3.3 - Migrate explosions and carrier impacts
Type: refactor
What: Route explosion damage and carrier object contact through applyHit(), while carrier macros retain ownership of detonation, child spawning, bounce and delayed impact policies.
Why: Ensures blasts can resolve destructible lifecycles correctly without turning every macro into a fixed contact enum.
Files: ~ petal-panic/js/combat/explosion.js
Files: ~ petal-panic/js/combat/attack/primitives/explosion.js
Files: ~ petal-panic/js/combat/attack/carrierMacro.js
Files: ~ petal-panic/js/systems/update.js
Snippet: \n// Explosion context: provenance EXPLOSION, blast team, radial reaction, source exclusion.\n// Carrier contact: resolve target hit first; then macro decides detonate/spawn/bounce/retain.\n// Destruction payload is dispatched by resolver/target adapter, not repeated by caller.\n
Acceptance: Explosions preserve radius, self exclusion, team rules and knockback character.
Acceptance: Eligible explosion damage routes destructibles through the proper HP/destruction lifecycle.
Acceptance: Bombs, molotovs, mines and other carriers keep existing contact/delay/bounce behavior.
Acceptance: Destructible payloads triggered by chain reactions run exactly once.
Verification: cd petal-panic && node --test js/test/hitResolution/migrationExplosions.test.js

## MILESTONE: 4 - Regression Gate and Cleanup
Pattern: Test-driven cleanup / dead code removal
Objective: Prove the unified resolver preserves baseline behavior and removes duplicated routing/adapters.
Success: Full relevant test suite passes, known field bugs are fixed, and no production path bypasses applyHit() for damage or destruction effects.
Diagram: graph TD
  A[Run baseline tests] --> B{All expected keep cases pass?}
  B -->|yes| C[Verify confirmed fixes]
  B -->|no| D[Fix migration regression]
  C --> E[Remove obsolete adapters]
  E --> F[Update docs and plan status]


### TASK: 4.1 - Verify unified hit behavior matrix
Type: test
What: Add production-path regression tests for the approved inventory cases, team matrix, target hooks and exactly-once destruction.
Why: Turns today's field bugs and preserved baseline behaviors into enforceable gates.
Files: + petal-panic/js/test/hitResolution/regression.test.js
Snippet: \n// Test through real call paths, not resolver unit isolation only:\n// melee supercoin reward; dust living-only; fire destructible kill;\n// explosion chain reaction; carrier contact policy; rejected hits; zero damage.\n
Acceptance: Melee on supercoin yields configured per-hit coins.
Acceptance: Dust does not affect destructibles while fire still can.
Acceptance: Propane destroyed by any eligible attack spawns molotovs exactly once.
Acceptance: No duplicate flash, knockback, reward or destruction payload occurs under chain reactions.
Acceptance: Invalid context inputs throw before mutation and leave resources unchanged.
Verification: cd petal-panic && node --test js/test/hitResolution/

### TASK: 4.2 - Remove obsolete routing adapters
Type: chore
What: Delete duplicated team predicates, caller-owned barrel aftermath calls and temporary damage adapters once all production paths use applyHit().
Why: Prevents future bypasses and makes the resolver the single source of truth.
Files: ~ petal-panic/js/combat/damage.js
Files: ~ petal-panic/js/combat/hitbox.js
Files: ~ petal-panic/js/combat/explosion.js
Files: ~ petal-panic/js/objects/barrelSync.js
Snippet: \n// Keep specialized executors: flashTarget, applyKnockback, coin services,\n// attack spawning. Remove only duplicate routing decisions and manual\n// handleBarrelDestroyed calls that bypass the resolver.\n
Acceptance: No production combat path directly chooses takeDamage/hit/damage as a routing policy.
Acceptance: handleBarrelDestroyed or equivalent payload service is invoked only through the resolver/target adapter exactly once.
Acceptance: Existing public APIs required by unmigrated systems are explicitly documented as temporary if any remain.
Verification: cd petal-panic && rg -n "takeDamage\(|\.hit\(|damage\(" js/combat js/systems js/objects
Verification: cd petal-panic && node --test js/test/
