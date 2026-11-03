# Reviews — state-persistence

Reviewer policy: single `ninfer/qwen3.8-27b` review pass per task (user instruction; no OpenAI/codex reviewer). Per-task commits come from the plan-runner workflow itself.

## 1.1 Zone snapshot chain on the hero wallet
- A (qwen3.8-27b): PASS (with notes) — minors: continueRun still zeroes coin tally before snapshotting (1-1 entry polluted; removal scoped to task 2.2); "death-restart never re-records" asserted indirectly only; same-zone identity test doesn't assert energy equality
- B (qwen3.8-27b): SKIPPED — single qwen review pass per user instruction
- Resolution: All three minors deferred with rationale: (1) the resetLevelCoinTally nuke is explicitly task 2.2's scope — fixing it now would break 2.2's diff; (2)+(3) test-coverage nuances, behavior verified correct in practice. Note for 2.2: after removing the tally nuke, verify the 1-1 snapshot recorded at continue time reflects true entry state. Verify: full suite 769/745/24 — all 24 failures inside the declared pre-existing baseline areas; grep clean for wallet.snapshot/_walletSnapshotArea/recordAreaEntrySnapshot.

## 2.1 Die and manual retry per the persistence doc
- A (qwen3.8-27b): FAIL — majors: bck/lives.test.js + bck/screens82.test.js still assert the OLD free-retry contract (retry from 0 lives → lives=3); no test covers the new paid-retry behavior; minors: retryFromGameOver doc comment mislabels caller (serves pause menu AND S.OVER); update.js rejection no-op when already in S.OVER unexplained
- B (qwen3.8-27b): SKIPPED — single qwen review pass per user instruction
- Resolution: Accepted all 3 majors + both minors → fix round: both stale bck tests rewritten to the paid contract (retry >0 lives costs 1 life → AREA_ENTRY; 0 lives rejected, stays OVER); 3 new lifecycle.test.js tests (life decrement, 0-lives rejection changes nothing, reset sequence ≡ death: coins/kills→zone snapshot, energy full, weapon thorn, specials/shield/super cleared); comments fixed. First fix dispatch returned empty (agent error) — re-dispatched fresh, completed. Verify: 772 tests / 25 fail; stash-diff proves the failure SET is byte-identical to baseline (the +1 count is a flaky duplicate assertion line in an already-failing file, confirmed by name-set comparison).

## 2.2 Continue rolls back to the 1-1 zone snapshot
- A (qwen3.8-27b): PASS (with notes) — minors: stale "Continue resets coin tally" comment in gameRules.js:34; obsolete continue-half of tuning.js countFailedAttempts comment; edge case: continue while already in area 1 skips zone reinstall (unreachable in practice — boss deaths restart via finishHeroDeath)
- B (qwen3.8-27b): SKIPPED — single qwen review pass per user instruction
- Resolution: Accepted the two stale-comment minors → fixed directly (gameRules.js + tuning.js now reference the §2.2 snapshot rollback). Deferred the area-1 edge case (reviewer confirmed unreachable: boss/area deaths always route through the death path which reinstalls). Executor burned budget mid-task; work was functionally complete on disk — verified + finished the review cycle without re-dispatch. resetLevelCoinTally fully deleted (function, import, no-op tests); TUNING_COINS.resetOnContinue flipped false with doc pointer. New tests prove continue from 2-3 → 2-1 entry snapshot (coins/kills), unpolluted snapshot, energy full, weapon default, lives refilled, continues −1. Verify: tuning+lifecycle 56/56; full suite failure set unchanged vs baseline.
