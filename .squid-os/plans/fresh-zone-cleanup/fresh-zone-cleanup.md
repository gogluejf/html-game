# EPIC: Fresh-Zone Cleanup — delete dead entity-recycling layer
Why: Every zone transition (new game, death-retry, advance, continue, post-reboot load) already rebuilds zone content fresh via instantiateZone from layout+seed. The restoreArea/rememberInitial/_initPos recycling machinery underneath is a production no-op that misleads debugging (it cost a full investigation during the ghost-hero bug) and adds ~150 lines of reset code for a bug class that fresh-build eliminates.
Outcomes: restoreArea + 4 restore fns + rememberInitial + _initPos writes deleted; enterZone becomes the single owner of fresh zone install; preserved state (energy/coins/lives/run) provably untouched; test suite green with zero behavior change

## MILESTONE: 1 - Evidence
Pattern: Characterization test
Objective: Prove restoreArea is a production no-op before deleting anything.
Success: Logged evidence shows restore fns never fire in any real transition; baseline test suite green.
Diagram: flowchart LR
    A[Playtest death-retry advance continue reboot-load] --> B[restore fns log calls]
    B --> C{Any call with live _initPos?}
    C -->|no| D[Confirmed dead - proceed]
    C -->|yes| E[Stop - investigate caller]

### TASK: 1.1 - Instrument restore fns + baseline suite
Type: test
What: Add a one-line console.warn at the top of restoreEnemy/restoreBarrel/restorePowerup/restoreCheckpoint in lifecycle.js that fires only when _initPos is present (i.e. a real restore would happen). Run full test suite as baseline.
Why: Deletion must be evidence-backed: if any production path actually restores, we stop and investigate instead of deleting live code.
Files: ~ petal-panic/js/systems/lifecycle.js
Snippet: // temporary instrumentation (deleted in M2)\nfunction restoreBarrel(b) {\n  if (!b || b._initPos === undefined) return;\n  console.warn('[evidence] restoreBarrel fired', b.type, b.x); // <- only on REAL restore\n  ...
Acceptance: Baseline: node --test over js/test/*.test.js all green, count recorded
Acceptance: Instrumentation compiles clean, no test behavior change
Verification: cd petal-panic && for f in js/test/*.test.js; do node --test $f >/dev/null || echo FAIL $f; done

### TASK: 1.2 - Playtest evidence pass
Type: chore
What: In the browser: new game, die once (retry), advance an area, save-quit, reload page and Continue. Watch console for [evidence] lines.
Why: Tests exercise restoreArea directly with hand-built _initPos; only a real playthrough proves no production transition reaches it with live snapshots.
Files: 
Acceptance: Zero [evidence] lines across death-retry, advance, in-session continue, post-reboot continue
Acceptance: Game plays normally through all four transitions (sanity: fresh-build paths unaffected)
Verification: manual - browser console inspection

## MILESTONE: 2 - Consolidate zone install
Pattern: Single owner (Strangler)
Objective: Make enterZone the one place that installs fresh zone content, in the pinned order: transients cleared -> fresh zone installed -> run/life rules -> hero placed.
Success: Death/retry/continue no longer call resetActiveZoneContent separately; enterZone does it via the transition rule; behavior identical.
Diagram: flowchart TD
    A[transition name] --> B[enterZone]
    B --> C[run rule: fresh rollback refill restore keep]
    B --> D[life rule: reset refill keep fresh]
    B --> E{rule rebuilds zone?}
    E -->|death-retry continue save-load| F[clearTransientWorld + instantiateZone fresh]
    E -->|advance new-game| G[zone already fresh-installed by caller]
    F --> H[placeHeroAtEntry + resetHitstop + showAreaEntry]

### TASK: 2.1 - enterZone owns fresh zone install
Type: refactor
What: Move the resetActiveZoneContent logic (transient teardown + instantiateZone reinstall, incl. boss-zone branch) into enterZone, gated by a new rule field (e.g. zone: 'rebuild') on death-retry/continue/save-load transitions. Callers (finishHeroDeath path, retryLevel, continueFromGameOver) drop their separate resetActiveZoneContent calls.
Why: Two owners of 'install zone content' is how the dead layer survived; one owner keyed by transition rule makes the fresh-build contract explicit and testable.
Files: ~ petal-panic/js/systems/lifecycle.js
Files: ~ petal-panic/js/world/zoneLifecycle.js
Snippet: // TRANSITIONS gains a zone dimension\n'death-retry': { run: 'rollback', life: 'reset', zone: 'rebuild' },\n'continue':    { run: 'refill-lives', life: 'reset', zone: 'rebuild' },\n'save-load':   { run: 'restore',    life: 'reset', zone: 'rebuild' },\n// advance/new-game: zone: 'keep' (caller already installed fresh content)\n\nexport function enterZone(h, zone, transition, ctx) {\n  const rule = TRANSITIONS[transition];\n  applyRunRule(rule, h);        // existing wallet/lives rollback\n  applyLifeRule(rule, h);       // existing transient resets\n  if (rule.zone === 'rebuild') rebuildZoneContent(ctx); // moved from resetActiveZoneContent\n  placeHeroAtEntry(h);          // pinned order - never reorder\n  resetHitstop();\n  showAreaEntry(h, ctx);\n}
Acceptance: Death -> retry: zone entities are fresh objects (new references), hero placed at entry, lives decremented once
Acceptance: Continue (in-session): same rebuild, lives refilled, area back to level's area 1
Acceptance: Advance: behavior unchanged (no double-install)
Acceptance: Pinned order preserved: transients cleared before install, install before hero placement
Verification: cd petal-panic && node --test js/test/levelFlow.test.js js/test/menuRunFlow.test.js js/test/lifecycle.test.js

### TASK: 2.2 - Regression: preserved state across transitions
Type: test
What: Add a test asserting the hero/run objects SURVIVE death-retry and continue by reference (same instance), while zone entities are replaced (different references), and energy/coins/lives follow the per-transition rules.
Why: This is the user's core concern - the cleanup must provably not touch preserved state; pin it as a regression net before deletion.
Files: + petal-panic/js/test/freshZone.test.js
Snippet: // same hero + run survive, zone content is swapped\nconst heroBefore = h;\nenterZone(h, zone, 'death-retry', ctx);\nassert.equal(heroBefore, h, 'hero instance survives');\nassert.notEqual(enemiesBefore[0], ctx.enemies[0], 'enemies rebuilt fresh');\nassert.equal(h.lives, livesBefore - 1); // per-rule, not per-object
Acceptance: Hero and run object identity stable across death-retry/continue
Acceptance: Zone entity references differ after rebuild transitions
Acceptance: Wallet rollback / life refill values match TRANSITIONS rules
Verification: cd petal-panic && node --test js/test/freshZone.test.js

## MILESTONE: 3 - Delete dead layer
Pattern: Strangler (cut over)
Objective: Remove the recycling machinery now that enterZone is the single owner and evidence confirms it was a no-op.
Success: restoreArea + restore fns + rememberInitial + _initPos gone from production code; suite green; playtest clean.
Diagram: flowchart LR
    A[rm restoreArea + 4 restore fns] --> B[rm rememberInitial + _initPos writes]
    B --> C[rm instrumentation from M1]
    C --> D[rewrite tests to enterZone contract]
    D --> E[full suite + playtest]

### TASK: 3.1 - Delete restore machinery + _initPos
Type: refactor
What: Remove from lifecycle.js: restoreArea, restoreEnemy, restoreBarrel, restorePowerup, restoreCheckpoint, rememberInitial, resetGeneration's entity loops, and the enterZone restoreArea call site. Remove rememberInitial calls in update.js (zone install + boss) and debugHarness.js; remove M1 instrumentation.
Why: The layer is proven dead and its presence misleads future debugging (it cost the ghost-hero investigation real time).
Files: ~ petal-panic/js/systems/lifecycle.js
Files: ~ petal-panic/js/systems/update.js
Files: ~ petal-panic/js/debug/debugHarness.js
Snippet: // gone: restoreArea(ctx), restoreEnemy(e), restoreBarrel(b),\n//        restorePowerup(p), restoreCheckpoint(c), rememberInitial(e)\n// kept:  alive/destroyed liveness flags - they still govern death\n//        WITHIN an attempt; only the reset direction is deleted
Acceptance: grep for restoreArea|rememberInitial|_initPos in js/ (non-test) returns zero hits
Acceptance: No production behavior change: full suite green except tests rewritten in 3.2
Verification: cd petal-panic && grep -rn 'restoreArea\|rememberInitial\|_initPos' js --include=*.js | grep -v test

### TASK: 3.2 - Rewrite restore-era tests to fresh-build contract
Type: test
What: Update the ~6 test files referencing restoreArea/rememberInitial (lifecycle, levelFlow, menuRunFlow, screens, populate, reward) to assert the fresh-build contract instead: transitions produce fresh entity references from layout+seed, deterministic per seed.
Why: Tests currently pin the dead API; they must pin the real contract or the suite breaks and future regressions hide behind stale assertions.
Files: ~ petal-panic/js/test/lifecycle.test.js
Files: ~ petal-panic/js/test/levelFlow.test.js
Files: ~ petal-panic/js/test/menuRunFlow.test.js
Files: ~ petal-panic/js/test/screens.test.js
Files: ~ petal-panic/js/test/populate.test.js
Files: ~ petal-panic/js/test/reward.test.js
Acceptance: Full node --test suite green across all 133 test files
Acceptance: No test references restoreArea/rememberInitial/_initPos
Verification: cd petal-panic && for f in js/test/*.test.js; do node --test $f >/dev/null || echo FAIL $f; done

### TASK: 3.3 - Update lifecycle docs + final playtest
Type: doc
What: Rewrite the restore sections of docs/levels/lifecycle.md §3 (and any state-persistence.md references) to state the fresh-build contract: every zone entry installs content via instantiateZone from layout+seed; liveness flags are one-directional. Final browser playtest: new game, death-retry, advance, save-quit, reboot continue.
Why: The docs currently describe the deleted recycling model; stale docs are how dead code gets resurrected.
Files: ~ petal-panic/docs/levels/lifecycle.md
Acceptance: Docs describe fresh-build as the only zone-entry mechanism
Acceptance: Final playtest clean through all five transitions, no console errors
Verification: manual - browser playtest + doc review
