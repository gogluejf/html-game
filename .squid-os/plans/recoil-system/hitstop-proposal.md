# Hit-Stop Proposal (deferred)

Status: **PROPOSAL — not in the current recoil plan.** Captured so the idea is not lost.
Revisit only after the core recoil system ships and we have played it.

---

## What hit-stop is

A brief, global pause of the simulation for a few frames the instant a hit connects.
Everything freezes — hero, enemy, projectiles, particles — for roughly 4–6 frames
(~70–100ms), then resumes at normal speed. It is a hard freeze, not slow-motion.

It is **not an effect**. Effects (screen shake, flash, sparks) are presentation-only and
do not change what is happening. Hit-stop changes the simulation clock itself: during the
freeze, physics genuinely halt. It belongs to the gameplay/time layer, not the Effects
Engine.

## Why it feels good

Impact has weight. A fraction-of-a-second freeze sells that weight — the brain reads the
pause as "that hit mattered." Used constantly in fighting and action games because it
makes contact feel solid rather than like passing through.

Its unique job: make a single contact feel heavy by inserting a pause at the moment of
impact. Knockback moves the body *after* the hit; damage numbers say *how much*; a screen
shake says *something big happened*. Only the freeze says *it landed with weight*.

## Where it applies (scoped)

- **Sweep / cartwheel:** on the single connect frame only. One decisive commit = one stop.
- **Supermove:** potentially on *each* connect if the super becomes a multi-hit combo
  sequence later (multiple hitboxes over time). That is a future design direction, not v1.

## Why it is deferred (honest reasoning)

1. **Redundant for this game's combat shape.** Hit-stop shines in fast, continuous,
   multi-hit combat where you need to separate hit N from hit N+1. Petal Panic melee is
   sparse, high-commitment, single-exchange. The main reason hit-stop exists largely does
   not apply here.
2. **Not the bug fix.** The thing that fixes "I slide into the enemy and get vulnerable"
   is self-protection-on-connect (i-frames on a clean hit). Hit-stop only *delays* the
   overlap for a few frames; it does not make the hero safe.
3. **Riskier than it looks.** It requires cleanly pausing the fixed-timestep loop, all
   timers, camera shake, and particle updates, then resuming without drift. Do it wrong and
   you get stutter or timing desync.

## Decision rule

Ship the core recoil first (knockback + loft + self-protection + connect effects). Play it.
If a single supermove still feels like it "lacks weight," add a hit-stop then — scoped
narrowly (supermove connects only, ~4 frames) as a targeted juice knob, not a global system.

## Relationship to combos / multi-hit

"Several hits, several hit-stops" describes a juggling/combo system — a different design
direction than the current one-commit-one-exchange melee. If that direction is ever taken,
hit-stop becomes more valuable (it separates rapid successive hits). For now it is out of
scope and would be a design pivot, not a tweak.
