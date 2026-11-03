# Reviews — state-persistence

Reviewer policy: single `ninfer/qwen3.8-27b` review pass per task (user instruction; no OpenAI/codex reviewer). Per-task commits come from the plan-runner workflow itself.

## 1.1 Zone snapshot chain on the hero wallet
- A (qwen3.8-27b): PASS (with notes) — minors: continueRun still zeroes coin tally before snapshotting (1-1 entry polluted; removal scoped to task 2.2); "death-restart never re-records" asserted indirectly only; same-zone identity test doesn't assert energy equality
- B (qwen3.8-27b): SKIPPED — single qwen review pass per user instruction
- Resolution: All three minors deferred with rationale: (1) the resetLevelCoinTally nuke is explicitly task 2.2's scope — fixing it now would break 2.2's diff; (2)+(3) test-coverage nuances, behavior verified correct in practice. Note for 2.2: after removing the tally nuke, verify the 1-1 snapshot recorded at continue time reflects true entry state. Verify: full suite 769/745/24 — all 24 failures inside the declared pre-existing baseline areas; grep clean for wallet.snapshot/_walletSnapshotArea/recordAreaEntrySnapshot.
