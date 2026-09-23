// Petal Panic — Boss zone flow (docs/levels/boss-arena.md §1–§3).
//
// The boss zone is the level's fifth sealed zone (kind 'boss',
// orientation 'boss'). When the hero reaches its arena the zone runs a
// tension-building introduction BEFORE combat:
//
//   APPROACH    — the hero starts beside the boss checkpoint and walks
//                 left ~1 screen toward the arena (the flag is left behind).
//   LOCKED      — both sides lock, the camera freezes on the fixed arena
//                 view. The boss is still invisible.
//   INTRO_SWEEP — a full-screen graphic sweeps left→right while the boss
//                 name/title moves right→left (opposing motion).
//   BAR_FILL    — the boss energy bar appears at the top and begins filling.
//   BOSS_ENTER  — the boss enters the arena from the right and becomes
//                 visible.
//   COMBAT      — combat is enabled: the boss is attackable and the fight
//                 begins.
//
// Constraints (boss-arena.md §2/§3):
//   - During APPROACH..BOSS_ENTER (states 1–5) the hero MAY move but MAY NOT
//     shoot, and the boss is invisible and untouchable (the presentation must
//     never imply the boss is attackable before combat starts).
//   - The arena stays locked through combat: the hero cannot scroll past the
//     boss or leave through either side.
//   - Death during intro/combat restarts the boss zone at its checkpoint:
//     the approach and the introduction repeat.
//
// This module OWNS the state machine (pure logic, no DOM — unit-testable in
// node). systems/update.js drives it each frame; screens.js paints the
// placeholder intro presentation; render.js consults the machine for boss
// visibility and the energy bar.
//
// Timings below are the concrete design-plan values (boss-arena.md §2: "the
// design plan will propose them"). Their single owner is the TUNING block
// (tuning.js); this module consumes them so the cited value has one owner.

import { VIEW_W, VIEW_H } from './view.js';
import { TUNING } from './tuning.js';

// --- State ids (documented order) -------------------------------------------
export const BZ_APPROACH = 'APPROACH';
export const BZ_LOCKED = 'LOCKED';
export const BZ_INTRO_SWEEP = 'INTRO_SWEEP';
export const BZ_BAR_FILL = 'BAR_FILL';
export const BZ_BOSS_ENTER = 'BOSS_ENTER';
export const BZ_COMBAT = 'COMBAT';

/** The documented state order (boss-arena.md §2). */
export const BOSS_ZONE_STATES = [
  BZ_APPROACH, BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT,
];

/**
 * Durations (seconds) per design plan. APPROACH is hero-driven (no timer):
 * it ends when the hero reaches the arena entry. Concrete values are owned by
 * the TUNING block (tuning.js) and cited there to boss-arena.md §2.
 */
export const BOSS_ZONE_TIMINGS = {
  LOCKED: TUNING.bossIntroLocked,      // brief beat at the arena edge before the presentation
  INTRO_SWEEP: TUNING.bossIntroSweep,  // full-screen graphic sweep (rapid, pure tension)
  BAR_FILL: TUNING.bossIntroBarFill,   // energy bar fill; the boss enters once a portion has filled
  BOSS_ENTER: TUNING.bossIntroEnter,   // boss slides in from the right and settles mid-arena
};

/**
 * How far the approach runs, in px. Roughly one screen (boss-arena.md §1:
 * "around one screen of approach is a provisional reference"). Tied to the
 * view width (VIEW_W × TUNING.bossApproachScreens) so it stays ~1 screen if
 * the logical resolution changes. The hero starts beside the boss checkpoint
 * (the zone's entry flag) and walks left until the arena entry line.
 */
export const BOSS_APPROACH_DIST = Math.round(VIEW_W * TUNING.bossApproachScreens); // ~1 view width

/**
 * Where the hero starts the approach, measured from the zone's RIGHT edge
 * (px). The hero begins beside the boss checkpoint flag (near the entry
 * flag on the right side of the zone) and walks LEFT toward the arena.
 * Keeping this small (a short margin) places the hero on the right side of
 * the zone so the leftward approach has room to run within the zone bounds.
 */
export const BOSS_APPROACH_START_PAD = TUNING.bossApproachStartPad;

/**
 * How far right of the arena the boss enters from (off-screen). Tied to the
 * view width (VIEW_W × TUNING.bossEnterTravelScreens) so the boss's entrance
 * travel scales with the arena rather than being an arbitrary px literal
 * (boss-arena.md §2 step 7: "the boss enters the screen from the right").
 */
const BOSS_ENTER_TRAVEL = Math.round(VIEW_W * TUNING.bossEnterTravelScreens); // ~half a view width, slid in from the right

/**
 * The boss zone flow state machine.
 *
 * @param {object} opts
 * @param {object} opts.zone  the boss zone from buildLevelZones()
 *   (kind 'boss', bounds, entryFlag).
 * @param {object} opts.boss  the boss entity (Elephant) — the machine moves
 *   it in/out and gates its visibility; it does NOT drive the boss AI
 *   (attack patterns are the boss/combat system's responsibility).
 * @param {object} [opts.heroRef] () => the current hero (x/y/w/h).
 * @param {function} [opts.onLock]   called once when the arena locks (both
 *   sides + camera freeze). The update system binds the camera here.
 * @param {function} [opts.onCombat] called once when combat enables. The
 *   update system activates the boss fight here.
 */
export class BossZone {
  constructor({ zone, boss, heroRef = null, onLock = null, onCombat = null }) {
    this.zone = zone;
    this.boss = boss;
    this.heroRef = heroRef;
    this.onLock = onLock;
    this.onCombat = onCombat;

    // DORMANT by default (BLOCKER 1): the machine is only active while the
    // hero is actually in the boss zone. It starts in APPROACH only once
    // begin() is called (when the hero reaches the boss zone). While dormant
    // every gate below (inIntro / heroCanShoot / bossCanTakeDamage /
    // arenaLocked) is false, so shooting, melee, and the boss damage gate all
    // behave normally in ordinary areas.
    this.state = null;
    this.timer = 0;

    // --- Arena geometry -----------------------------------------------------
    // The hero enters from the LEFT and walks RIGHT ~BOSS_APPROACH_DIST to the
    // arena entry line. The arena is centered on that entry line so the camera
    // is already positioned correctly when the arena locks (no jump). The boss
    // settles on the RIGHT portion of the arena; the hero fights from the left.
    const b = zone.bounds;
    // Approach: hero starts near the zone's left edge and walks right.
    this.approachStartX = b.x + BOSS_APPROACH_START_PAD;
    this.arenaEntryX = this.approachStartX + BOSS_APPROACH_DIST;
    // Clamp the arena entry inside the zone bounds.
    if (this.arenaEntryX > b.x + b.w - VIEW_W / 2) this.arenaEntryX = b.x + b.w - VIEW_W / 2;

    // The arena (locked camera view) is centered on the arena entry line, so
    // when the hero reaches it the camera is already showing the arena.
    this.arenaX = Math.round(this.arenaEntryX - VIEW_W / 2);
    // Keep the arena within the zone bounds.
    if (this.arenaX < b.x) this.arenaX = b.x;
    if (this.arenaX + VIEW_W > b.x + b.w) this.arenaX = b.x + b.w - VIEW_W;
    this.arenaY = Math.round(b.y + b.h / 2 - VIEW_H / 2);
    this.arenaW = VIEW_W;
    this.arenaH = VIEW_H;

    // Boss rest position: RIGHT portion of the arena (visible, not center).
    this.bossRestX = Math.round(this.arenaX + this.arenaW * 0.75 - boss.w / 2);
    this.bossRestY = Math.round(b.y + b.h - boss.h);
    // The boss enters from the right, off the arena's right edge.
    this.bossEnterFromX = this.arenaX + this.arenaW + BOSS_ENTER_TRAVEL - boss.w;

    // Energy bar fill (0..1), shown at the top during BAR_FILL/BOSS_ENTER/COMBAT.
    this.barFill = 0;

    // Latches.
    this._locked = false;
    this._combat = false;
  }

  /**
   * Is the machine running? (true once begin() has been called, i.e. the
   * hero is in the boss zone; false while dormant / before the hero arrives).
   */
  get active() { return this.state !== null; }

  /** True while the intro presentation is in progress (states 1–5). */
  get inIntro() {
    return this.state === BZ_APPROACH || this.state === BZ_LOCKED ||
      this.state === BZ_INTRO_SWEEP || this.state === BZ_BAR_FILL ||
      this.state === BZ_BOSS_ENTER;
  }

  /** True once combat has started (the boss is attackable). */
  get combat() { return this.state === BZ_COMBAT; }

  /**
   * Is the boss visible right now? Invisible during the intro (states 1–4),
   * visible from BOSS_ENTER onward (boss-arena.md §2: "keep the boss invisible
   * initially"; it enters the screen from the right during BOSS_ENTER).
   */
  bossVisible() {
    return this.state === BZ_BOSS_ENTER || this.state === BZ_COMBAT;
  }

  /**
   * May the hero shoot right now? No during the intro (states 1–5); yes in
   * COMBAT. (boss-arena.md §2: movement allowed, shooting disabled during the
   * presentation.)
   */
  heroCanShoot() { return this.state === BZ_COMBAT; }

  /**
   * May the hero damage the boss right now? Only in COMBAT — the
   * presentation must not imply the boss is attackable before combat starts.
   */
  bossCanTakeDamage() { return this.state === BZ_COMBAT; }

  /**
   * Is the arena locked (both sides + fixed camera)? From LOCKED onward,
   * including COMBAT (boss-arena.md §3: the arena remains locked during
   * combat).
   */
  arenaLocked() {
    return this.state === BZ_LOCKED || this.state === BZ_INTRO_SWEEP ||
      this.state === BZ_BAR_FILL || this.state === BZ_BOSS_ENTER ||
      this.state === BZ_COMBAT;
  }

  /**
   * Begin the boss zone encounter: place the boss off-screen (invisible),
   * start the APPROACH state. Called when the hero reaches the boss zone
   * (the shared area-entry screen is confirmed).
   */
  begin() {
    this.state = BZ_APPROACH;
    this.timer = 0;
    this.barFill = 0;
    this._locked = false;
    this._combat = false;
    // The boss stands off-screen to the right, hidden until BOSS_ENTER.
    this.boss.x = this.bossEnterFromX;
    this.boss.y = this.bossRestY;
    this.boss.vx = 0;
    this.boss.vy = 0;
  }

  /**
   * Per-frame step. Advances the state machine, moves the boss during its
   * entrance, and fills the energy bar.
   *
   * @param {number} dt seconds
   * @param {object} hero the current hero (x/y/w/h)
   */
  update(dt, hero) {
    if (this.state === null) return;

    switch (this.state) {
      case BZ_APPROACH: {
        // Hero-driven: ends when the hero reaches the arena entry line
        // (walking right ~1 screen from the checkpoint).
        if (hero.x >= this.arenaEntryX) {
          this.enterState(BZ_LOCKED);
        }
        break;
      }

      case BZ_LOCKED: {
        this.timer += dt;
        if (this.timer >= BOSS_ZONE_TIMINGS.LOCKED) {
          this.enterState(BZ_INTRO_SWEEP);
        }
        break;
      }

      case BZ_INTRO_SWEEP: {
        this.timer += dt;
        if (this.timer >= BOSS_ZONE_TIMINGS.INTRO_SWEEP) {
          this.enterState(BZ_BAR_FILL);
        }
        break;
      }

      case BZ_BAR_FILL: {
        this.timer += dt;
        // The bar begins filling as soon as it appears; the boss enters once
        // a PORTION of the bar has filled (boss-arena.md §2 step 7: "After a
        // portion of the bar has filled, the boss enters the screen from the
        // right"). The concrete threshold is TUNING.bossIntroBarFillPct — the
        // bar is not allowed to fill completely before the entrance begins,
        // so the entrance overlaps the final stretch of the fill.
        const threshold = TUNING.bossIntroBarFillPct; // fraction of the bar (0..1)
        this.barFill = Math.min(1, this.timer / BOSS_ZONE_TIMINGS.BAR_FILL);
        if (this.barFill >= threshold) {
          this.enterState(BZ_BOSS_ENTER);
        }
        break;
      }

      case BZ_BOSS_ENTER: {
        this.timer += dt;
        // The boss slides in from the right toward its mid-arena rest.
        // (BLOCKER: the previous code latched `_entered` on the first update,
        // so the boss sat at its rest position for the entire entrance and
        // "teleported" when the timer expired. Instead, interpolate boss.x
        // from its off-screen entry x to its rest x EVERY frame over the
        // BOSS_ENTER duration.)
        const t = Math.min(1, this.timer / BOSS_ZONE_TIMINGS.BOSS_ENTER);
        const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic — decelerates in
        this.boss.x = Math.round(this.bossEnterFromX +
          (this.bossRestX - this.bossEnterFromX) * ease);
        this.boss.y = this.bossRestY;
        // Bar-fill overlap (boss-arena.md §2): the "final stretch" of the bar
        // fill overlaps the boss entrance. The bar keeps filling during
        // BOSS_ENTER until it is full — it does NOT freeze at the entrance
        // threshold. The fill started at the BAR_FILL threshold (when the
        // boss entered) and continues at the same rate for the remainder of
        // the entrance, so the bar reaches 1.0 as the boss settles. This is
        // the concrete "overlap" the doc describes: the entrance and the
        // final stretch of the fill happen together.
        //
        // The bar fill elapsed time is continuous across the BAR_FILL →
        // BOSS_ENTER boundary: in BAR_FILL the fill is timer/BAR_FILL (which
        // reached the threshold when the state changed); in BOSS_ENTER we
        // continue from that threshold, advancing at the same rate
        // (dt/BAR_FILL per second) until the bar is full.
        const fillRate = 1 / BOSS_ZONE_TIMINGS.BAR_FILL; // fraction per second
        this.barFill = Math.min(1, TUNING.bossIntroBarFillPct + this.timer * fillRate);
        if (this.timer >= BOSS_ZONE_TIMINGS.BOSS_ENTER) {
          this.boss.x = this.bossRestX;
          this.boss.y = this.bossRestY;
          this.barFill = 1; // the bar is full once the boss has settled
          this.enterState(BZ_COMBAT);
        }
        break;
      }

      case BZ_COMBAT: {
        // Combat is live; the boss AI is driven by the update system
        // (attack patterns are out of scope here).
        break;
      }
    }
  }

  /** Transition to a new state, resetting its timer and firing hooks once. */
  enterState(next) {
    this.state = next;
    this.timer = 0;

    if (next === BZ_LOCKED && !this._locked) {
      this._locked = true;
      if (this.onLock) this.onLock();
    }
    if (next === BZ_COMBAT && !this._combat) {
      this._combat = true;
      if (this.onCombat) this.onCombat();
    }
  }

  /**
   * Progress of the current timed state (0..1). APPROACH returns 0 (it is
   * hero-driven, not timer-driven). Used by the presentation to drive the
   * sweep / title opposing motion and the bar fill.
   */
  progress() {
    switch (this.state) {
      case BZ_APPROACH: return 0;
      case BZ_LOCKED: return this.timer / BOSS_ZONE_TIMINGS.LOCKED;
      case BZ_INTRO_SWEEP: return this.timer / BOSS_ZONE_TIMINGS.INTRO_SWEEP;
      case BZ_BAR_FILL: return this.timer / BOSS_ZONE_TIMINGS.BAR_FILL;
      case BZ_BOSS_ENTER: return this.timer / BOSS_ZONE_TIMINGS.BOSS_ENTER;
      case BZ_COMBAT: return 1;
      default: return 0;
    }
  }

  /**
   * Reset the machine to a fresh APPROACH (death during intro/combat
   * restarts the boss zone at its checkpoint — boss-arena.md §3). The caller
   * re-places the hero beside the boss checkpoint and re-calls begin().
   */
  reset() {
    this.begin();
  }
}

/**
 * Factory: build a boss-zone flow machine for the given boss zone.
 *
 * @param {object} zone the boss zone (kind 'boss')
 * @param {object} boss the boss entity
 * @param {object} [opts] { heroRef, onLock, onCombat }
 * @returns {BossZone}
 */
export function makeBossZone(zone, boss, opts = {}) {
  return new BossZone({ zone, boss, ...opts });
}
