# EPIC: Unify Projectile + Special into Single Class
Why: Two classes (Projectile, Special) duplicate flight/rotation/render logic. Rock is awkwardly a 'typeless Special' when it should be a basic Projectile with gravity. Merging eliminates dual sprite init paths, dual pools, and the confusing typeless concept.
Outcomes: One Projectile class handles all flying entities (thorn, rock, bomb, saw). One pool. One sprite pipeline. ballistic.js becomes a param config on projectile, not a separate primitive. Rock = default arcing projectile, same as thorn is default straight projectile.

## MILESTONE: 1 - Merge Special into Projectile
Pattern: Single Responsibility, Parameterized Behavior
Objective: Collapse Special class fields (gravity, explode, fuse) into Projectile. Delete Special class + specialPool. All flying entities use one class, one pool.
Success: Special class deleted. specialPool deleted. All references updated. Tests pass. No behavior change.
Diagram: graph TD
    A[Entity] --> B[Projectile]
    B --> C[thorn: gravity=0, type=null]
    B --> D[rock: gravity=800, type=null]
    B --> E[bomb: gravity=800, type=bomb]
    B --> F[saw: gravity=0, type=saw]
    G[specialPool DELETED] -.->|removed| B
    H[projectilePool] -->|single pool| B

### TASK: 1.1 - Add gravity+bounce fields to Projectile
Type: refactor
What: Add gravityValue, bounce, explode, fuseLabel fields to Projectile class. Move the gravity integration from Special.update() into Projectile.update().
Why: Projectile needs to handle arcing motion natively so rock/bomb don't need a separate class.
Files: ~ petal-panic/js/objects/projectile.js
Snippet: // In Projectile class:\nthis.gravityValue = opts.gravity ?? 0;\nthis.bounce = opts.bounce ?? false;\nthis.explode = opts.explode ?? false;\nthis._ttlLabel = opts.explode ? 'fuse' : 'life';\n\n// In update(dt):\nif (this.gravityValue > 0) this.vy += this.gravityValue * dt;
Acceptance: Projectile can arc when gravityValue > 0
Acceptance: Bounce behavior matches current Special behavior
Verification: node --check petal-panic/js/objects/projectile.js

### TASK: 1.2 - Merge sprite pipeline into single path
Type: refactor
What: Delete initRockSprites + initSpecialSprites. Add all types (rock_medium, rock_small, bomb, saw, etc) to a single SPRITE_TARGETS map. One init function loads all sheets.
Why: Eliminates three separate sprite init paths. One call at boot loads everything.
Files: ~ petal-panic/js/objects/projectile.js
Snippet: // Single registry:\nconst SPRITE_TARGETS = Object.freeze({\n  thorn: { anim: 'shoot', dir: 'thorn' },\n  rock_medium: { anim: 'shoot', dir: 'rock_medium' },\n  rock_small: { anim: 'shoot', dir: 'rock_small' },\n  bomb: { anim: 'shoot', dir: 'bomb' },\n  saw: { anim: 'shoot', dir: 'saw' },\n  // ...\n});\n\n// Single init:\nexport function initAllProjectiles() { /* loads all SPRITE_TARGETS */ }
Acceptance: One init function replaces initProjectileSprites + initSpecialSprites + initRockSprites
Acceptance: All sprites load correctly at boot
Verification: node --check petal-panic/js/objects/projectile.js

### TASK: 1.3 - Delete Special class + specialPool
Type: refactor
What: Remove Special class, specialPool, and all references. Update collision handlers, update loop, attack theater, and tests to use Projectile/projectilePool exclusively.
Why: Eliminates the dual-class confusion. One class, one pool, one code path.
Files: ~ petal-panic/js/objects/projectile.js
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/debug/attack-theater.js
Files: ~ petal-panic/js/core/collision.js
Acceptance: grep -r 'specialPool' returns 0 results
Acceptance: grep -r 'class Special' returns 0 results
Acceptance: All existing tests pass
Verification: grep -rn 'specialPool|class Special' petal-panic/js/ --include='*.js' | wc -l

### TASK: 1.4 - Convert ballistic to projectile with gravity
Type: refactor
What: Delete ballistic.js primitive. Add gravity+bounce params to projectile primitive. Update all macros that invoke 'ballistic' to invoke 'projectile' with gravity params.
Why: One primitive for all flying entities. Gravity is a param, not a separate class.
Files: ~ petal-panic/js/combat/attack/primitives/ballistic.js
Files: ~ petal-panic/js/combat/attack/primitives/projectile.js
Files: ~ petal-panic/js/combat/attack/macros/molotov.js
Files: ~ petal-panic/js/combat/attack/macros/clusterBomb.js
Files: ~ petal-panic/js/combat/attack/macros/shockwaveBomb.js
Acceptance: ballistic.js deleted or is a thin alias to projectile
Acceptance: All macros updated to invoke projectile with gravity
Acceptance: Attack theater still works for arcing shots
Verification: node --check petal-panic/js/combat/attack/primitives/projectile.js

### TASK: 1.5 - Make rock the default arcing projectile
Type: refactor
What: Typeless Projectile with gravity > 0 renders rock_medium sprite (high-res) or rockDrawer primitive (low-res). Same as thorn is default for gravity = 0.
Why: Rock is a basic projectile, not a special. Default look for arcing typeless shots.
Files: ~ petal-panic/js/objects/projectile.js
Acceptance: Typeless Projectile with gravity shows rock sprite in high-res
Acceptance: Typeless Projectile with gravity shows rockDrawer in low-res
Acceptance: No outline on rock (thickness 0)
Verification: node --check petal-panic/js/objects/projectile.js

## MILESTONE: 2 - Per-type Outline Config
Pattern: Data-Driven Configuration
Objective: Read outline thickness from sheet JSON. Each type declares its own outline (thorn=2, bomb=2, rock=0, etc). No hardcoded values in code.
Success: Changing a sheet's outline field changes the rendered outline without code changes.
Diagram: graph LR
    A[sheet.json] --> B[parseSheet]
    B --> C[Projectile constructor]
    C --> D[spriteOutline with configured thickness]
    E[rock sheet outline 0] --> F[no outline rendered]

### TASK: 2.1 - Read outline from sheet JSON
Type: feature
What: Add outline field to parseSheet output. Projectile constructor reads animData.outline (default 2) and passes to spriteOutline. Rock sheets declare outline: 0.
Why: Per-type outline without code changes. Data-driven.
Files: ~ petal-panic/js/core/spriteData.js
Files: ~ petal-panic/js/objects/projectile.js
Acceptance: parseSheet returns outline value from sheet JSON
Acceptance: Projectile uses configured thickness for spriteOutline
Acceptance: Rock renders with no outline, thorn/bomb with thickness 2
Verification: node --check petal-panic/js/objects/projectile.js

## MILESTONE: 3 - Unified Attack Invoke List
Pattern: Single Source of Truth, Delegation
Objective: Replace blastType/spawnType/weaponType with one param (child) referencing a shared ATTACK_IDS list. Eliminate duplicated if/else invoke chains across macros.
Success: One ATTACK_IDS array. One param name. One invoke helper. All macros use the same list and same helper. Adding a new attack type requires zero macro changes.
Diagram: graph TD
    A[ATTACK_IDS list] --> B[spawnSplit: child=bomb]
    A --> C[skyMissile: child=napalm]
    A --> D[missileRain: child=mine]
    A --> E[clusterBomb: child=mine]
    B --> F[invoke child params ctx]
    C --> F
    D --> F
    E --> F
    F --> G[target primitive or macro]

### TASK: 3.1 - Define ATTACK_IDS + invokeChild helper
Type: refactor
What: Create shared ATTACK_IDS frozen array (all invocable attack ids). Create invokeChild(type, params, ctx) helper that maps type to the right invoke call. Place in engine.js or a new attacks-registry.js.
Why: Single source of truth for all invocable attacks. One helper replaces 5-6 duplicated if/else chains.
Files: + petal-panic/js/combat/attack/attackIds.js
Files: ~ petal-panic/js/combat/attack/engine.js
Snippet: // attackIds.js\nexport const ATTACK_IDS = Object.freeze([\n  'projectile', 'ballistic', 'bomb', 'mine',\n  'throwMine', 'throwEnemy', 'enemy',\n  'homing', 'explosive', 'saw', 'spread',\n  'explosion', 'shockwave', 'napalm', 'fireArea',\n]);\n\nexport function invokeChild(type, params, ctx) {\n  return invoke(type, params, ctx);\n}
Acceptance: ATTACK_IDS contains all currently invocable attack ids
Acceptance: invokeChild delegates to engine.invoke correctly
Verification: node --check petal-panic/js/combat/attack/attackIds.js

### TASK: 3.2 - Rename blastType/spawnType to child in all macros
Type: refactor
What: Replace blastType, spawnType, weaponType params with single 'child' param across spawnSplit, clusterBomb, missileRain, skyMissile, reticleShot. Update TWEAKABLE lists in attack-theater.js.
Why: One param name everywhere. No more confusion between 4 different names for the same concept.
Files: ~ petal-panic/js/combat/attack/macros/spawnSplit.js
Files: ~ petal-panic/js/combat/attack/macros/clusterBomb.js
Files: ~ petal-panic/js/combat/attack/macros/missileRain.js
Files: ~ petal-panic/js/combat/attack/macros/skyMissile.js
Files: ~ petal-panic/js/combat/attack/macros/reticleShot.js
Files: ~ petal-panic/js/debug/attack-theater.js
Acceptance: grep -r 'blastType|spawnType' returns 0 results in macros/
Acceptance: All macros use 'child' param
Acceptance: Theater param panels updated
Verification: grep -rn 'blastType|spawnType' petal-panic/js/combat/attack/macros/ | wc -l

### TASK: 3.3 - Replace if/else chains with invokeChild
Type: refactor
What: Replace all if/else if chains that map type strings to invoke calls with a single invokeChild(p.child, params, ctx) call. Remove duplicated mapping logic from each macro.
Why: Eliminates 5-6 copies of the same switch logic. Adding a new attack type requires zero macro changes.
Files: ~ petal-panic/js/combat/attack/macros/spawnSplit.js
Files: ~ petal-panic/js/combat/attack/macros/missileRain.js
Files: ~ petal-panic/js/combat/attack/macros/skyMissile.js
Files: ~ petal-panic/js/combat/attack/macros/clusterBomb.js
Acceptance: No if/else chains mapping type strings to invoke calls remain in macros
Acceptance: All child materialization goes through invokeChild()
Acceptance: Existing tests pass
Verification: grep -rn 'blastType ===|spawnType ===' petal-panic/js/combat/attack/macros/ | wc -l
