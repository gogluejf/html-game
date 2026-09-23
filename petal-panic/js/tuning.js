// Petal Panic — TUNING: the single home for every GLOBAL concrete
// "design-plan decision" value the docs/levels/*.md contract defers to the
// plan.
//
// Each value cites the doc section it settles (README.md: "exact score
// accounting, coin carryover/conversion bookkeeping, inventory persistence,
// and transition timings will be proposed by the design plan"). The goal is
// one place to find and review every deferred GLOBAL choice — no magic numbers
// left uncited, no competing owners.
//
// SCOPE NOTE (ownership split): this module owns the GLOBAL, cross-level
// values (transition timings, boss-intro timings, coin/inventory policy,
// camera/scroll policy, music policy). PER-LEVEL values (area lengths,
// per-stage population budgets, vertical slot, stage weights) are owned by
// levelConfigs.js — they vary by level, so they live in the level config
// with a doc citation instead of here. See levelConfigs.js's
// "DESIGN-PLAN DECISIONS SETTLED HERE" block.
//
// This module is PURE data (no DOM, no imports). Consumers (levelConfigs.js,
// gameRules.js, terrain.js, macros.js, bossZone.js, update.js, lifecycle.js)
// import the value from here rather than re-declaring a literal, so the cited
// value has exactly one owner.
//
// Convention: seconds for durations, px for distances, and plain numbers for
// counts/ratios. `Object.freeze` so a stray assignment can't silently drift a
// tuned value.

// ---------------------------------------------------------------------------
// Transition timings & presentation durations
// ---------------------------------------------------------------------------
// checkpoints.md §2 — "Exact timing and effect composition are tunable."
// checkpoints.md §4 — "After the death presentation and a short delay, fade to
//   black."
// boss-arena.md §2 — "the design plan will propose them so the sequence feels
//   thrilling rather than arbitrary."
// These are the concrete numbers those sections defer. Each is owned HERE and
// re-exported by the module that consumes it (update.js, bossZone.js).
export const TUNING = Object.freeze({
  // --- Area-clear sequence (checkpoints.md §2) -----------------------------
  // Flag flash → 'X-Y CLEAR' banner → fade out → entry screen → fade in.
  clearFlash:   0.5, // seconds of celebratory flag flash
  clearBanner:  1.2, // seconds the 'X-Y CLEAR' banner is held (checkpoints.md §2.3)
  clearFadeOut: 0.6, // seconds to fade the cleared area to black
  clearFadeIn:  0.6, // seconds to fade from black into the new zone
  // --- Ordinary death (checkpoints.md §4) ---------------------------------
  deathFade:    0.6, // the "short delay" fade to black after the death presentation
  // --- Boss introduction (boss-arena.md §2) --------------------------------
  bossIntroLocked:    0.4, // brief beat at the arena edge before the presentation
  bossIntroSweep:     1.4, // full-screen graphic sweep (rapid, pure tension)
  bossIntroBarFill:   1.6, // energy bar fill duration
  bossIntroBarFillPct: 0.7, // fraction (0..1) of the bar filled before the boss enters
  bossIntroEnter:     0.8, // boss slides in from the right and settles mid-arena
  // --- Boss approach (boss-arena.md §1) ------------------------------------
  // "Around one screen of approach is a provisional reference, not a locked
  // distance." Tied to the view width (view.js) so it stays ~1 screen if the
  // logical resolution ever changes.
  bossApproachScreens: 1,   // approach length in view-widths (VIEW_W × this)
  bossApproachStartPad: 100, // px: how far in from the zone's right edge the hero starts
  // --- Boss entrance travel (boss-arena.md §2 step 7) -----------------------
  // "The boss enters the screen from the right." How far off the arena's right
  // edge the boss begins its slide-in, in view-widths. Tied to VIEW_W so the
  // entrance travel scales with the arena rather than an arbitrary px literal.
  bossEnterTravelScreens: 0.5,
  // --- Area-entry screen (checkpoints.md §3) --------------------------------
  // "Timing and whether the screen is skippable are design-plan concerns."
  // Concrete choice: the screen is CONFIRM-DRIVEN (no auto-advance timer) and
  // ALWAYS skippable — confirm (or pause) starts the attempt immediately.
  // There is no mandatory dwell; the player controls the pace so a death
  // restart is never a long repeated pause. (Implemented as the
  // confirm-to-play flow in lifecycle.js showAreaEntry/areaEntryOnAction.)
  areaEntrySkippable: true,   // confirm starts the attempt immediately (no timer)
  areaEntryMinDwell: 0,       // seconds of mandatory dwell before confirm (0 = none)
  // --- Level reward screen (boss-arena.md §4–5) -----------------------------
  // "Its duration, skip behavior, and celebration effects are design-plan
  // concerns." Concrete choice: the screen is CONFIRM-DRIVEN and skippable
  // (same ergonomics contract as the area-entry screen), with a short
  // celebratory beat before the option list becomes focusable so the credit
  // to the global continue pool reads clearly. Celebration effects are the
  // existing full-screen marquee presentation (no new effect system).
  rewardSkippable: true,      // confirm starts the next level immediately
  rewardMinDwell: 0.8,        // seconds of celebratory beat before confirm is honored
  rewardCelebration: 'marquee', // effect composition: the existing marquee screen
});

// ---------------------------------------------------------------------------
// Horizontal backward scrolling (structure.md §3)
// ---------------------------------------------------------------------------
// structure.md §3: "Horizontal backward-scroll behavior within the current
// area is a design-plan decision." The concrete choice: the camera follows the
// hero BOTH ways inside the zone (the existing dead-zone follow in camera.js),
// clamped to the zone's left boundary. The player CAN scroll back toward the
// area's start, but the camera never reveals the previous zone (the zone's
// left edge is the clamp floor). This keeps the area explorable (reaching back
// for a missed pickup) without breaking the sealed-zone model (structure.md
// §2: "The camera stops at the area boundaries").
export const TUNING_SCROLL = Object.freeze({
  // true = the camera follows the hero leftward within the zone (clamped at
  // the zone's left edge). false = the camera only advances rightward (the
  // hero's leftmost progress becomes the floor). The concrete choice is true:
  // free backward scrolling inside the current area (structure.md §3).
  backwardScroll: true,
});

// ---------------------------------------------------------------------------
// Lives across level completion (game-rules.md §1)
// ---------------------------------------------------------------------------
// game-rules.md §1: "Whether completing a level replenishes lives or preserves
// the remaining count is a design-plan decision." Concrete choice: lives are
// PRESERVED across level completion — the remaining count carries into the
// next level (no refill). This rewards a clean run (fewer deaths → more lives
// into the next level) and keeps lives a meaningful, depletable resource.
// (Implemented in lifecycle.js rewardOnAction: h.lives is NOT reassigned when
// the next level's area -1 opens.)
export const TUNING_LIVES = Object.freeze({
  // 'preserve' = carry the remaining life count into the next level (no
  // refill). 'replenish' = restore the starting life count on level
  // completion. The concrete choice is 'preserve' (game-rules.md §1).
  onLevelComplete: 'preserve',
});

// ---------------------------------------------------------------------------
// Music policy (README.md, boss-arena.md §1)
// ---------------------------------------------------------------------------
// README.md: "Music is deferred. The design plan will propose music and timing
// parameters … these documents only require that feedback exists."
// boss-arena.md §1: "Music will be added later. The visual sequence must
// communicate tension on its own." Concrete choice: NO music or audio in the
// level engine v1. The presentation (boss intro, clear banner, reward) carries
// its tension via the existing visual/effect systems; audio is a future
// concern and is not a prerequisite for the level flow.
export const TUNING_MUSIC = Object.freeze({
  // 'deferred' = no music/audio in the level engine v1; the visual sequence
  // communicates tension on its own (README.md, boss-arena.md §1).
  policy: 'deferred',
  // The boss-intro presentation is silent (the visual sweep/title/bar fill
  // carries the tension; boss-arena.md §1).
  bossIntroSilent: true,
});

// ---------------------------------------------------------------------------
// Terrain reach (structure.md §5, generation.md §6)
// ---------------------------------------------------------------------------
// structure.md §5: "Spacing must work for both heroes with a usable margin,
// not only a perfect jump." The margin is the concrete number the doc defers:
// a fixed px reserved below the weakest hero's raw double-jump apex so a
// normal double jump clears the tier step without needing the exact apex.
export const TUNING_REACH = Object.freeze({
  // px reserved below the weakest hero's double-jump apex. Must be < the apex
  // (so a usable step remains) and > 0 (so the step is not a frame-perfect jump).
  reachMargin: 16,
});

// ---------------------------------------------------------------------------
// Barrel structures (populate.md §3)
// ---------------------------------------------------------------------------
// populate.md §3: "Super structure: a much larger set piece with many barrels.
//   Large structures should be occasional highlights, with stronger
//   opportunities especially in -3 and -4, not constant clutter. Exact
//   frequency and counts remain tuning values."
// The single/medium bounds are the doc's stated range (1 / 4-9). The SUPER
// band's upper bound was an arbitrary 99; this sets a real ceiling so a
// "super" structure is a bounded set piece (a barrel pyramid/wall), not an
// unbounded pile.
export const TUNING_BARREL = Object.freeze({
  // A super structure is 10..18 barrels: a real highlight set piece that is
  // still bounded (populate.md §3 — "occasional highlights, not constant
  // clutter"). The lower bound (10) is the doc's "much larger" threshold; the
  // upper bound (18) is the concrete ceiling this tuning pass sets.
  superMax: 18,
});

// ---------------------------------------------------------------------------
// Macro selection pacing (generation.md §5)
// ---------------------------------------------------------------------------
// generation.md §5: "Pattern repetition is allowed, but unconstrained
// repetition must not replace pacing." This sets the concrete anti-repetition
// behavior the doc defers: the composer down-weights (never removes) a macro
// that was just placed, so back-to-back repeats are discouraged while the
// follow-constraint relaxation keeps the composer total (it still always
// finds a candidate).
export const TUNING_MACRO = Object.freeze({
  // Weight multiplier applied to a macro that was just placed (the previous
  // macro's id). 1.0 = no anti-repetition (repeats equally likely); < 1.0
  // discourages them. 0.5 → a repeat is half as likely as any other candidate.
  repeatPenalty: 0.5,
});

// ---------------------------------------------------------------------------
// Coin / reward accounting (game-rules.md §2, §4)
// ---------------------------------------------------------------------------
// game-rules.md §2 lists the unresolved coin bookkeeping as design-plan
// decisions: "Are converted coins deducted from a spendable balance or only
// marked rewarded? Does a remainder below 1000 carry to the next level? Do
// coins collected on failed area attempts count toward the reward? What
// happens to the current level's coin tally after using Continue?"
// game-rules.md §4: "score and kill/coin accounting across failed attempts and
// continues … is not [settled]."
// This block settles all four. The concrete choice: coin/score accounting is
// PER-LEVEL and PER-ATTEMPT — it resets on area advance and on death/continue,
// so repeatable pickups can never be farmed across attempts.
export const TUNING_COINS = Object.freeze({
  // The remainder below 1000 does NOT carry to the next level (game-rules.md
  // §2). Each level's reward counts only the coins collected in that level;
  // the next level starts from zero. (Implemented as the per-level reset.)
  carryoverRemainder: false,
  // Coins collected during FAILED area attempts do NOT count toward the
  // reward (game-rules.md §2). A death/continue resets the current level's
  // coin tally, so only the winning attempt's coins are rewarded.
  countFailedAttempts: false,
  // After using Continue, the current level's coin tally is RESET (game-rules.md
  // §2). Continue restarts area -1 of the current level with a fresh tally.
  resetOnContinue: true,
  // Converted 1000-coin chunks are MARKED REWARDED, not deducted from a
  // spendable balance (game-rules.md §2: "Are converted coins deducted from a
  // spendable balance or only marked rewarded?"). Coins are not a spendable
  // currency in v1 — the ONLY conversion is the automatic continue credit on
  // the level reward screen (game-rules.md §2: "Continue does not charge
  // coins"). The concrete choice is 'mark': the collected coins are counted,
  // the full 1000-coin chunks are credited as continues, and the coins remain
  // in the displayed tally (they are a score/reward figure, not a wallet to
  // draw from). The remainder below 1000 is simply unconverted.
  convertedCoins: 'mark',
  // Score and kill/coin accounting ROLLS BACK to the area's entry totals on a
  // failed attempt (game-rules.md §4). Restoring enemies/barrels/pickups is
  // confirmed; their rewards do NOT accumulate repeatedly, which is what
  // prevents the extra-life / coin farming loop the doc warns about.
  accountingOnFailure: 'rollback',
});

// ---------------------------------------------------------------------------
// Inventory persistence (game-rules.md §5)
// ---------------------------------------------------------------------------
// game-rules.md §5: "Ammo, selected weapon, energy, temporary powerups, and
// super meter persistence across death, continue, and area advance are
// design-plan decisions. Respawn protection must remain consistent with hero
// mechanics."
// This block settles each. The concrete choice: an area advance is a fresh
// start (temporary state does not persist); death/continue restores the
// hero's baseline (full energy, no temporary powerups) per the existing
// respawn behavior.
export const TUNING_INVENTORY = Object.freeze({
  // Ammo (the hero's held weapon/ammo state) resets to baseline on a new
  // area, and on death/continue the hero is restored to its baseline.
  ammo: 'reset',
  // Selected weapon resets to the hero's default on a new area and on
  // death/continue.
  weapon: 'reset',
  // Energy is restored to full on death/continue (matches the existing
  // resetHeroTransient: h.energy = h.maxEnergy). It also starts full in every
  // new area (a fresh playable attempt).
  energy: 'restore',
  // Temporary powerups do NOT persist across death (game-rules.md §5). A
  // death/continue clears any active temporary powerup; the hero respawns
  // clean.
  powerups: 'reset',
  // The super meter (0..100) resets to 0 on death/continue and on a new area
  // (a fresh attempt starts with no charged super).
  superMeter: 'reset',
});
