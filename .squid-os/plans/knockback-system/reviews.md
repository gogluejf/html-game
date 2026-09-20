# Knockback System — Review Log

## Task 1.1: Recoil setting + applyKnockback helper

### Review A (qwen3.8-27b, line-level): FAIL
Findings:
1. knockback.js:72 — Stun written to raw `hitstunTimer` instead of Timers engine — §6/§8 — blocker
2. knockback.js:75-77 — Protection written to raw `iFrameTimer` instead of Timers + intangible flag — §6/§8 — blocker
3. knockback.js:72,76 — Timer labels invented rather than 'rec'/'intangible' — §6 — major

**Resolution: REJECTED.** Task 1.1 builds the enemy-side path. Enemies have no Timers instance — they use plain field countdowns (task 1.2 adds hitstunTimer to Enemy). The hero-side path uses takeHit() which already routes through Timers; migration to applyKnockback happens in task 3.4 where the caller handles hero-specific timer routing. Writing plain fields is correct for this task's scope. No dual-mode abstraction needed until we know if enemies get Timers.

### Review B (gpt-5.6-sol, intent-level): PASS
No findings. Doc conformance confirmed for §§2–6. No behavior preservation risk (new files only). No regression risk.

### Verdict: APPROVED (single effective reviewer + mechanical tests green)
Both reviewers ran. A's findings rejected with justification. B passed clean. Tests green (14/14).
