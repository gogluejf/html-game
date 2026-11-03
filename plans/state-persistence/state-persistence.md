# EPIC: State Persistence Rules
Why: The agreed persistence design (docs/levels/state-persistence.md) is not implemented: zone snapshots are single-slot, Continue nukes the loadout and coin tally instead of rolling back to the 1-1 zone snapshot, Save&Quit stores only {level,area,score,seed} so a reload loses wallet/weapon/lives/continues, and level clear does not refill energy. Coins/score/lives/continues are money — this must be exact.
Outcomes: Per-zone snapshot chain (coins+score) as the rollback anchor / die-retry and continue reset exactly per the doc (full energy, weapon gone, zone-snapshot rollback) / Save&Quit persists full player state + snapshot chain + seed and restores it on reload / level clear refills energy / regression tests per transition

## MILESTONE: 1 - Zone Snapshot Chain
Pattern: Event Sourcing / Append-Only Log
Objective: Replace the single-slot wallet.snapshot with an append-only per-zone chain {zoneId -> {coins, score}} so any zone (not just the last) can be restored — the foundation for Continue-to-1-1 and Save&Quit.
Success: recordZoneSnapshot(h) appends one entry per genuine zone entry; restoreZoneState(h, zoneId) rolls coins+score back to that zone's entry; the old single-slot path is gone or delegates to the chain; existing die/retry rollback behavior is unchanged (same-zone restore still works).
Diagram: graph LR
  A[zone entry] --> B[append snapshot to chain]
  C[die in 1-3] --> D[lookup 1-3 in chain]
  E[continue] --> F[lookup 1-1 in chain]
  G[save and quit] --> H[persist whole chain]

### TASK: 1.1 - Zone snapshot chain on the hero wallet
Type: refactor
What: Replace single-slot wallet.snapshot/_walletSnapshotArea in lifecycle.js with an append-only chain: h.wallet.snapshots = { '1-1': {coins, score}, ... }. recordZoneSnapshot appends (genuine entries only), restoreZoneState(h, zoneId) rolls coins+score back to a named zone. Source of truth: docs/levels/state-persistence.md §1.
Why: Continue-to-1-1 and Save&Quit need to restore ANY zone's entry state, not just the last one; the chain is the rollback anchor for all failure transitions.
Files: ~ petal-panic/js/systems/lifecycle.js
Files: ~ petal-panic/js/hero/hero.js
Snippet: // hero.js wallet gains the chain (snapshot kept as alias for the active zone):\nh.wallet = { current: {coins, energy, kills}, snapshots: {} };\n\n// lifecycle.js:\nexport function recordZoneSnapshot(h) {\n  const id = `${h.currentLevel}:${h.currentArea}`;\n  h.wallet.snapshots[id] = { coins: h.wallet.current.coins, score: /* current computed score */ };\n}\nexport function restoreZoneState(h, zoneId) {\n  const s = h.wallet.snapshots[zoneId];\n  if (!s) return;\n  h.wallet.current.coins = s.coins; // score derives from trace — see doc §1\n}
Acceptance: recordZoneSnapshot appends exactly once per genuine zone entry (startGame, area advance, continue, reward next-level) and never on death-restart
Acceptance: restoreZoneState(h, '1-1') rolls coins back to the 1-1 entry value even when the hero is currently in 1-3
Acceptance: same-zone death-retry rollback produces the identical result as today's restoreAreaEntryStats
Acceptance: no other module reads wallet.snapshot directly (grep clean or delegates)
Verification: node --test petal-panic/js/test/

## MILESTONE: 2 - Failure Transitions
Pattern: Transactional Rollback
Objective: Make die/retry and continue reset exactly per docs/levels/state-persistence.md §2.1–2.2: zone-snapshot rollback for coins+score, full energy, weapon gone, lives −1 or refill.
Success: Dying in 1-3 restores the 1-3 entry state; a manual retry costs 1 life with identical resets; Continue from Game Over lands in 1-1 with the 1-1 entry state, full energy, default weapon, refilled lives, continues −1 — all asserted by tests.
Diagram: stateDiagram-v2
  Playing --> Dead : lose last hit
  Dead --> ZoneEntry : spend 1 life
  ZoneEntry --> Playing : restore zone snapshot + full energy + no weapon
  Dead --> GameOver : zero lives
  GameOver --> ZoneEntry : spend 1 continue, target 1-1, refill lives

### TASK: 2.1 - Die and manual retry per the persistence doc
Type: feature
What: Align startLife/death-retry in lifecycle.js with state-persistence.md §2.1: restoreZoneState to the CURRENT zone, energy full, weapon+specials+shield+super cleared (resetHeroInventory already does this — verify), lives −1. Wire a manual retry path that costs exactly 1 life with identical resets.
Why: Failure must cost a life and roll back to zone-entry state; today's rollback is single-zone only and a manual retry either doesn't exist or is free.
Files: ~ petal-panic/js/systems/lifecycle.js
Files: ~ petal-panic/js/systems/gameRules.js
Snippet: // death restart (startLife):\nrestoreZoneState(h, currentZoneId(h)); // was restoreAreaEntryStats\nresetHeroInventory(h);                 // energy full + weapon gone (existing)\n\n// manual retry (pause menu) — same price as dying:\nexport function manualRetry(h) {\n  if (!canSpend(livesPool(h))) return false;\n  spend one life;\n  // identical reset sequence to a death restart\n}
Acceptance: dying in zone N restores coins to N's entry snapshot while keeping energy-full/weapon-default
Acceptance: manual retry consumes exactly 1 life and applies the same resets as death
Acceptance: manual retry with 0 usable lives is rejected (no free restarts)
Acceptance: failed-attempt kills/coins do not accumulate into the fresh attempt (anti-farming preserved)
Verification: node --test petal-panic/js/test/

### TASK: 2.2 - Continue rolls back to the 1-1 zone snapshot
Type: feature
What: Rework continueRun in lifecycle.js per state-persistence.md §2.2: target zone 1-1 of the current level, restoreZoneState(h, 'level:1'), full energy + weapon gone (same reset sequence as die), lives refilled, continues −1. Remove the legacy resetLevelCoinTally coin-tally nuke.
Why: Today Continue zeroes the level coin tally and nukes inventory via a different path; the doc says it is exactly a die-style reset aimed at 1-1.
Files: ~ petal-panic/js/systems/lifecycle.js
Files: ~ petal-panic/js/systems/gameRules.js
Snippet: // continueRun:\nspend(h.continues);\nh.lives = GAME_RULES.startingLives;\nh.currentArea = ENTRY_AREA;\nrestoreZoneState(h, `${h.currentLevel}:1`); // replaces resetLevelCoinTally\nresetHeroInventory(h);                        // same as die\nbeginContinue(h); h._lifeBucketArmed = true;
Acceptance: continue after defeat in 2-3 lands in 2-1 with coins equal to the 2-1 entry snapshot
Acceptance: energy is full and selectedWeapon is the hero default after continue
Acceptance: lives equal GAME_RULES.startingLives and the continue pool decreased by exactly one
Acceptance: the world arrangement for 2-1 is unchanged (no reroll)
Verification: node --test petal-panic/js/test/

## MILESTONE: 3 - Progress Transitions and Save State
Pattern: Save Slot / Full-State Serialization
Objective: Progress never resets: zone advance keeps everything, level clear refills energy only; Save&Quit persists the full player state + snapshot chain + seed and Continue after reload restores it.
Success: Passing a zone changes nothing in wallet/inventory; clearing a boss refills energy and keeps lives; saveMeta round-trips {zone, snapshot chain, coins, score, energy, weapon, specials, lives, continues, seed} and reload-Continue resumes with exactly the saved on-screen state.
Diagram: graph TD
  A[zone advance] --> B[keep all + new snapshot]
  C[boss defeated] --> D[keep all + energy full]
  E[save and quit] --> F[serialize zone + chain + player state + seed]
  G[reload continue] --> H[restore world from seed]
  H --> I[restore player state + snapshots]
  I --> J[area entry at saved zone]

### TASK: 3.1 - Level clear refills energy, keeps everything else
Type: feature
What: In the boss-defeat/reward path (lifecycle.js rewardOnAction + showLevelReward), set hero energy to maxEnergy when advancing to the next level; verify lives/continues/wallet/weapon are untouched by the transition. Source: state-persistence.md §2.4.
Why: Level clear is the only progress transition that touches energy; lives must NOT refill (agreed design).
Files: ~ petal-panic/js/systems/lifecycle.js
Snippet: // on level advance (reward confirmed):\nh.energy = h.maxEnergy; // ONLY energy changes\n// lives, continues, wallet, weapon, specials: untouched
Acceptance: after boss defeat + reward confirm, energy === maxEnergy
Acceptance: lives and continues are unchanged by the level transition
Acceptance: coins/score/weapon/specials carry into the next level's area 1
Verification: node --test petal-panic/js/test/

### TASK: 3.2 - Save&Quit persists full state, reload-Continue restores it
Type: feature
What: Extend saveMeta in lifecycle.js saveCurrentRun with the full player state: {coins, score, energy, weapon, specialSlots, lives, continues, snapshots (zone chain)} alongside the existing {level, area, seed}. On MENU->AREA_ENTRY continue after a reload, restore that state onto the hero before the zone installs. Source: state-persistence.md §2.5–2.6.
Why: Today a reload loses wallet/weapon/lives/continues — quitting punishes the player; the save must be a true resume.
Files: ~ petal-panic/js/systems/lifecycle.js
Files: ~ petal-panic/js/systems/update.js
Snippet: // saveCurrentRun meta gains:\nstate: { coins, score, energy, weapon, specialSlots, lives, continues },\nsnapshots: h.wallet.snapshots, // the whole zone chain\n\n// update.js MENU->AREA_ENTRY hook (after seed rebuild):\nif (sm.state) applySavedState(hero, sm); // wallet, inventory, lives, continues, snapshots\nisValidSaveMeta tolerates legacy saves without state (fallback = today's behavior)
Acceptance: save then reload then Continue resumes with the exact saved coins/score/energy/weapon/lives/continues
Acceptance: the snapshot chain round-trips: dying after a reload-continue rolls back to the pre-quit zone entry values
Acceptance: legacy saves without a state block still load with today's behavior (no crash)
Acceptance: New Game after a saved run clears the saved state (fresh start)
Verification: node --test petal-panic/js/test/

## MILESTONE: 4 - Regression Gate
Pattern: Property-Based Transition Tests
Objective: Prove every transition in the doc's table behaves exactly as specified, and that nothing else regressed.
Success: A dedicated test file walks each transition (die, manual retry, continue, zone advance, level clear, save/reload-continue, new game) and asserts the full keep/reset row from state-persistence.md §3; full suite at baseline or better.
Diagram: graph LR
  T[transition table rows] --> D[die / retry]
  T --> C[continue]
  T --> Z[zone advance]
  T --> L[level clear]
  T --> S[save and reload]
  D --> V[assert keep-reset row]
  C --> V
  Z --> V
  L --> V
  S --> V
  V --> G[full suite at baseline]

### TASK: 4.1 - Per-transition persistence tests
Type: test
What: Add petal-panic/js/test/statePersistence.test.js: one test per row of the state-persistence.md §3 table asserting the full keep/reset outcome (coins, score, energy, weapon, lives, continues) using a scripted hero + zone chain. Update any existing tests that assert the OLD continue/die behavior.
Why: Coins/lives/continues are money — the transition table must be mechanically enforced, not vibes; old-behavior assertions would silently encode the wrong design.
Files: + petal-panic/js/test/statePersistence.test.js
Snippet: // helper: script a run to zone 1-3 with known coin/score deltas, then:\n// die()        -> expect 1-3 snapshot coins, full energy, default weapon, lives-1\n// manualRetry()-> same as die, lives-1\n// continue()   -> expect 1-1 snapshot coins, full energy, default weapon, lives refilled, continues-1\n// advanceZone()-> everything kept\n// clearLevel() -> energy full, lives kept\n// save/reload  -> full state round-trip
Acceptance: each of the 7 table rows has a test asserting every column it defines
Acceptance: no existing test asserts the removed coin-tally-nuke or free-manual-retry behavior
Acceptance: full node --test run shows zero new failures vs baseline
Verification: node --test petal-panic/js/test/
