// Petal Panic — Boss zone flow (docs/levels/boss-arena.md §1–§3).
//
// The boss zone is the level's fifth sealed zone (kind 'boss',
// orientation 'boss'). It has TWO phases, both inside this ONE zone:
//
//   RUN         — the hero enters at the left (like any area start) and walks
//                 RIGHT across the whole zone toward the boss checkpoint flag
//                 at the far right. Normal camera follow. The flow machine is
//                 DORMANT during this phase (state === null): shooting is
//                 allowed, no presentation, no clamps.
//   BATTLE ROOM — when the hero crosses the boss checkpoint, the update system
//                 re-draws a fixed-width battle room OVER the run: the flag is
//                 removed, the camera freezes at x=0 on the leftmost VIEW_W of
//                 the zone (screen x = world x), the hero is placed at the
//                 room's left entry, and the boss slides in from the right.
//                 THIS module owns that second half:
//
//   LOCKED      — both sides lock, the camera is frozen on the fixed room view
//                 (the trigger site does the freeze; the machine just holds).
//                 The boss is still invisible.
//   INTRO_SWEEP — a full-screen graphic sweeps left→right while the boss
//                 name/title moves right→left (opposing motion).
//   BAR_FILL    — the boss energy bar appears at the top and begins filling.
//   BOSS_ENTER  — the boss enters the room from the right and becomes visible.
//   COMBAT      — combat is enabled: the boss is attackable and the fight
//                 begins.
//
// Constraints (boss-arena.md §2/§3):
//   - During LOCKED..BOSS_ENTER the hero MAY move but MAY NOT shoot, and the
//     boss is invisible and untouchable (the presentation must never imply the
//     boss is attackable before combat starts).
//   - The room stays locked through combat: the hero cannot scroll past the
//     boss or leave through either side (the camera is frozen and the update
//     system clamps both combatants to the room).
//   - Death during intro/combat restarts the WHOLE zone: the flag returns,
//     the hero stands at the left entry again, and the run repeats.
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
export const BZ_LOCKED = 'LOCKED';
export const BZ_INTRO_SWEEP = 'INTRO_SWEEP';
export const BZ_BAR_FILL = 'BAR_FILL';
export const BZ_BOSS_ENTER = 'BOSS_ENTER';
export const BZ_COMBAT = 'COMBAT';

/** The documented state order (boss-arena.md §2). */
export const BOSS_ZONE_STATES = [
  BZ_LOCKED, BZ_INTRO_SWEEP, BZ_BAR_FILL, BZ_BOSS_ENTER, BZ_COMBAT,
];

/**
 * Durations (seconds) per design plan. Concrete values are owned by the
 * TUNING block (tuning.js) and cited there to boss-arena.md §2.
 */
export const BOSS_ZONE_TIMINGS = {
  LOCKED: TUNING.bossIntroLocked,      // brief beat at the room edge before the presentation
  INTRO_SWEEP: TUNING.bossIntroSweep,  // full-screen graphic sweep (rapid, pure tension)
  BAR_FILL: TUNING.bossIntroBarFill,   // energy bar fill; the boss enters once a portion has filled
  BOSS_ENTER: TUNING.bossIntroEnter,   // boss slides in from the right and settles mid-room
};

/**
 * How far right of the room the boss enters from (off-screen). Tied to the
 * view width (VIEW_W × TUNING.bossEnterTravelScreens) so the boss's entrance
 * travel scales with the room rather than being an arbitrary px literal
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
 * @param {function} [opts.heroRef] () => the current hero (x/y/w/h).
 * @param {function} [opts.onCombat] called once when combat enables. The
 *   update system activates the boss fight here.
 */
export class BossZone {
  constructor({ zone, boss, heroRef = null, onCombat = null }) {
    this.zone = zone;
    this.boss = boss;
    this.heroRef = heroRef;
    this.onCombat = onCombat;

    // DORMANT by default: the machine is only active while the battle room is
    // up (from begin() until reset()). During the RUN phase (hero walking to
    // the boss checkpoint) every gate below (inIntro / heroCanShoot /
    // bossCanTakeDamage / roomLocked) is false, so shooting, melee, and the
    // boss damage gate all behave normally.
    this.state = null;
    this.timer = 0;

    // --- Room geometry ------------------------------------------------------
    // The battle room is the LEFTMOST VIEW_W of the zone, at the origin:
    // x ∈ [0, VIEW_W]. The camera is frozen at x=0 by the trigger site
    // (update.js), so screen x = world x — no translation, no computed
    // center. The hero stands at the room's left entry; the boss enters from
    // the right and settles on the RIGHT portion of the room (~75% across) so
    // both combatants are on screen during the fight.
    const b = zone.bounds;
    this.roomX = 0;
    this.roomW = VIEW_W;

    // Boss rest position: RIGHT portion of the room (visible, not center).
    // Place it ~75% across the room width so it's clearly on the right side
    // but still fully visible when the camera is locked.
    this.bossRestX = Math.round(this.roomX + this.roomW * 0.75 - boss.w / 2);
    this.bossRestY = Math.round(b.y + b.h - boss.h);
    // The boss enters from the right, off the room's right edge.
    this.bossEnterFromX = this.roomX + this.roomW + BOSS_ENTER_TRAVEL - boss.w;

    // Energy bar fill (0..1), shown at the top during BAR_FILL/BOSS_ENTER/COMBAT.
    this.barFill = 0;

    // Latches.
    this._combat = false;
  }

  /**
   * Is the machine running? (true once begin() has been called, i.e. the
   * battle room is up; false while dormant / during the run phase).
   */
  get active() { return this.state !== null; }

  /** True while the intro presentation is in progress (LOCKED..BOSS_ENTER). */
  get inIntro() {
    return this.state === BZ_LOCKED ||
      this.state === BZ_INTRO_SWEEP || this.state === BZ_BAR_FILL ||
      this.state === BZ_BOSS_ENTER;
  }

  /** True once combat has started (the boss is attackable). */
  get combat() { return this.state === BZ_COMBAT; }

  /**
   * Is the boss visible right now? Invisible during the intro (LOCKED..BAR_FILL),
   * visible from BOSS_ENTER onward (boss-arena.md §2: "keep the boss invisible
   * initially"; it enters the screen from the right during BOSS_ENTER).
   */
  bossVisible() {
    return this.state === BZ_BOSS_ENTER || this.state === BZ_COMBAT;
  }

  /**
   * May the hero shoot right now? No during the intro (LOCKED..BOSS_ENTER);
   * yes in COMBAT. (boss-arena.md §2: movement allowed, shooting disabled
   * during the presentation.) While dormant (run phase) this is false too —
   * but the update system's shooting gate keys off the explicit state list,
   * so dormant = shooting allowed.
   */
  heroCanShoot() { return this.state === BZ_COMBAT; }

  /**
   * May the hero damage the boss right now? Only in COMBAT — the
   * presentation must not imply the boss is attackable before combat starts.
   */
  bossCanTakeDamage() { return this.state === BZ_COMBAT; }

  /**
   * Is the battle room locked (both sides + fixed camera)? From LOCKED
   * onward, including COMBAT (boss-arena.md §3: the room remains locked
   * during combat).
   */
  roomLocked() {
    return this.state === BZ_LOCKED || this.state === BZ_INTRO_SWEEP ||
      this.state === BZ_BAR_FILL || this.state === BZ_BOSS_ENTER ||
      this.state === BZ_COMBAT;
  }

  /**
   * Begin the battle room: place the boss off-screen (invisible) and start
   * the LOCKED state. Called by the update system the moment the hero
   * crosses the boss checkpoint (after the flag is removed, the camera is
   * frozen at the room's left edge, and the hero is placed at the room's
   * left entry).
   */
  begin() {
    this.state = BZ_LOCKED;
    this.timer = 0;
    this.barFill = 0;
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
        // The boss slides in from the right toward its room-side rest.
        // Interpolate boss.x from its off-screen entry x to its rest x EVERY
        // frame over the BOSS_ENTER duration (easeOutCubic — decelerates in).
        const t = Math.min(1, this.timer / BOSS_ZONE_TIMINGS.BOSS_ENTER);
        const ease = 1 - Math.pow(1 - t, 3);
        this.boss.x = Math.round(this.bossEnterFromX +
          (this.bossRestX - this.bossEnterFromX) * ease);
        this.boss.y = this.bossRestY;
        // Bar-fill overlap (boss-arena.md §2): the "final stretch" of the bar
        // fill overlaps the boss entrance. The bar keeps filling during
        // BOSS_ENTER until it is full — it does NOT freeze at the entrance
        // threshold. The fill elapsed time is continuous across the
        // BAR_FILL → BOSS_ENTER boundary: in BAR_FILL the fill was
        // timer/BAR_FILL (which reached the threshold when the state
        // changed); in BOSS_ENTER we continue from that threshold, advancing
        // at the same rate (dt/BAR_FILL per second) until the bar is full.
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

    if (next === BZ_COMBAT && !this._combat) {
      this._combat = true;
      if (this.onCombat) this.onCombat();
    }
  }

  /**
   * Progress of the current timed state (0..1). Used by the presentation to
   * drive the sweep / title opposing motion and the bar fill.
   */
  progress() {
    switch (this.state) {
      case BZ_LOCKED: return this.timer / BOSS_ZONE_TIMINGS.LOCKED;
      case BZ_INTRO_SWEEP: return this.timer / BOSS_ZONE_TIMINGS.INTRO_SWEEP;
      case BZ_BAR_FILL: return this.timer / BOSS_ZONE_TIMINGS.BAR_FILL;
      case BZ_BOSS_ENTER: return this.timer / BOSS_ZONE_TIMINGS.BOSS_ENTER;
      case BZ_COMBAT: return 1;
      default: return 0;
    }
  }

  /**
   * Reset the machine to dormant (death during intro/combat restarts the
   * WHOLE zone — boss-arena.md §3). The caller re-installs the zone content
   * (flag restored), un-freezes the camera, and re-places the hero at the
   * left entry; the run then repeats.
   */
  reset() {
    this.state = null;
    this.timer = 0;
    this.barFill = 0;
    this._combat = false;
  }
}

/**
 * Factory: build a boss-zone flow machine for the given boss zone.
 *
 * @param {object} zone the boss zone (kind 'boss')
 * @param {object} boss the boss entity
 * @param {object} [opts] { heroRef, onCombat }
 * @returns {BossZone}
 */
export function makeBossZone(zone, boss, opts = {}) {
  return new BossZone({ zone, boss, ...opts });
}
