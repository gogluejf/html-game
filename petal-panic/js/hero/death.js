// Hero death pipeline — the lethal-bottom check, the post-skull fade-to-black
// timing, and the life-consumption / restart-or-gameover completion step.
// Reads/writes shared state through ctx (world/context.js) to avoid a circular
// import back into systems/update.js.
import { ctx } from '../world/context.js';
import { S, tryTransition } from '../core/state.js';
import { TUNING } from '../tuning.js';
import { VIEW_H } from '../core/view.js';
import { resetActiveZoneContent } from '../world/zoneLifecycle.js';
import { showAreaEntry } from '../systems/lifecycle.js';

/**
 * REVISION-zones-as-data §3: one lethal-fall rule, camera-relative. The hero
 * dies when their TOP edge drops below the bottom pixel of the camera —
 * orientation-agnostic, no floor reference. Gated by zone.lethalBottom so
 * horizontal zones (floor always on-screen) never trigger it in practice,
 * while sharing the identical code path. In ratchet zones the camera won't
 * follow back down, so a fall eventually pushes the hero out of view → dead.
 * Floor holes work later with zero extra code: fall through a gap, drop out
 * of camera-bottom, die.
 *
 * @param {Hero} h the hero
 * @param {object} zone the active zone from buildLevelZones()
 * @returns {boolean} true if the hero has fallen out of the bottom of the view
 */
export function isLethalFall(h, zone) {
  if (!zone || !zone.lethalBottom) return false;
  const cam = ctx.camera;
  // Bottom pixel row of the visible screen, in world coordinates.
  const screenBottom = cam ? cam.y + cam.h : zone.bounds.y + zone.bounds.h - VIEW_H;
  // World-space collision box (consistent with the rest of the collision
  // code): the hero's TOP edge must stay above the screen bottom.
  const wb = h.worldBox ? h.worldBox() : { y: h.y, h: h.h };
  return wb.y > screenBottom;
}

/** Backward-compat alias until callers migrate to isLethalFall (PR 5). */
export const isBelowVerticalBottom = isLethalFall;

/** Length of the fade-to-black after the skull presentation (checkpoints.md §4:
 *  "After the death presentation and a short delay, fade to black"). Concrete
 *  value owned by the TUNING block (tuning.js). */
const DEATH_FADE_DURATION = TUNING.deathFade;
export { DEATH_FADE_DURATION };
/** Black overlay drawn during the post-skull fade-to-black (render.js reads it). */
export function getDeathFadeAlpha() {
  const hero = ctx.hero;
  if (!hero.dying) return 0;
  const t = (hero.deathTimer - hero.DEATH_DURATION) / DEATH_FADE_DURATION;
  return Math.max(0, Math.min(1, t));
}

/**
 * Called when the death presentation + fade-to-black completes. Consumes one
 * life exactly once; if any remain, show the SHARED area-entry screen
 * (lifecycle.md §3); if no lives remain, transition to GAME OVER (the
 * state machine then shows the continue/quit screen).
 */
export function finishHeroDeath() {
  const hero = ctx.hero;
  hero.lives -= 1;
  hero.dying = false; // stop the fade (the entry screen / OVER overlay take over)
  // Boss zone flow (boss-arena.md §3): losing a life during the intro or
  // combat restarts the BOSS ZONE at its checkpoint — the approach and the
  // introduction repeat. The shared area-entry screen is shown for the boss
  // area (as it is for any area death); when the player confirms it,
  // beginBossZoneFlow() re-runs the whole sequence.
  const inBossZone = ctx.getActiveZone(hero)?.kind === 'boss';
  if (hero.lives > 0) {
    if (inBossZone) {
      // Keep the hero's area on the boss zone so getActiveZone() keeps
      // resolving to it. The reset below (resetActiveZoneContent) tears down
      // any active battle room and restores the run phase: flag back at the
      // far right, camera re-bound to the full zone width, machine dormant,
      // hero checkpoint at the left entry. Death in the room restarts the
      // WHOLE area (boss-arena.md §3).
      hero.currentArea = ctx.AREA_BOSS;
    }
    // Ensure the active zone's content is installed in the collision world
    // before showing the entry screen. This updates the checkpoints array
    // to the active zone's flags so startLife can latch the entry flag.
    // BLOCKER 6: re-instantiate the zone's FRESH content from the stored
    // population snapshot (buildWorld) rather than reusing the mutated
    // entities — restoreArea() cannot re-add defeated enemies, destroyed
    // barrels, or collected powerups (lifecycle.md §3: "the previous
    // attempt's kills and destroyed objects do not leave the next attempt
    // partly cleared"). Shared with retryFromGameOver so a retry resets the
    // area identically to a death-restart.
    resetActiveZoneContent();
    // checkpoints.md §4: after the death presentation and the fade, consume
    // one life exactly once and show the SHARED area-entry screen with the new
    // count. The whole area is restored and the attempt starts beside the
    // area's entry flag (e.g. death in 1-3 restarts 1-3 beside its flag) when
    // the player confirms the screen.
    showAreaEntry(hero, ctx.areaContext);
  } else {
    // checkpoints.md §5: at zero lives the EXISTING Game Over screen takes
    // over instead of the area-entry screen — untouched.
    tryTransition(S.OVER);
  }
}
