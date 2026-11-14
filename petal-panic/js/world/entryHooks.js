// --- Area-entry presentation hooks (extracted from systems/update.js) -------
// Every entry into the shared area-entry view starts its timed, non-interactive
// presentation: fast fade-in → hold for TUNING.areaEntryHold → fast fade-out →
// auto-start play. This fires on ALL paths that open the entry screen (new
// game, clear-sequence advance, death restart, continue, and pause retry).
// zoneLifecycle.js owns the presentation state machine, so the transition
// wiring lives here too; hero/camera are read through ctx (wired by update.js).
import { S, onTransition } from '../core/state.js';
import { Debug } from '../debug/debug.js';
import { ctx } from './context.js';
import { beginAreaEntryPresentation, areaEntrySeq, beginClearFadeIn } from './zoneLifecycle.js';

onTransition((from, to) => {
  // Carry the advance flag through the rebuild: the clear sequence sets it on
  // areaEntrySeq before showAreaEntry triggers this transition; without it the
  // presentation reset would downgrade a genuine zone arrival to a failure
  // restart (state-persistence.md §2.3).
  if (to === S.AREA_ENTRY) beginAreaEntryPresentation(areaEntrySeq.advance);
});

// AREA_ENTRY → PLAY: when the player confirms the area-entry screen, begin the
// fade-in into the new zone (checkpoints.md §2 step 6). This only fires when
// the area was reached via the clear sequence (exit flag → banner → fade-out →
// entry screen). For other entry-screen paths (new game, death restart,
// continue) the fade-in is not needed because the hero is already positioned
// by placeHeroAtEntry and the screen was opaque (no visible world to fade from).
onTransition((from, to) => {
  // Bare unit-test contexts have no camera wired yet — the hooks are a no-op
  // there (update.js wires ctx.camera at boot before any real transition).
  if (!ctx.camera || !ctx.hero) return;
  if (to === S.PLAY && from === S.AREA_ENTRY) {
    // Only start the fade-in when the entry screen was reached via the clear
    // sequence (exit flag → banner → fade-out → entry screen). For other
    // entry-screen paths (new game, death restart, continue) there is no
    // fade-in because the hero was already positioned by placeHeroAtEntry and the
    // screen was opaque (no visible world to fade from).
    beginClearFadeIn();
    // Re-clamp the camera to the zone the hero is now in (task 2.3). This runs
    // on EVERY area-entry confirmation (new game, clear-sequence advance, death
    // restart, continue), so the camera is always bound to the active zone and
    // a fresh vertical climb resets its ascent high-water mark.
    ctx.camera.setZoneBounds(ctx.getActiveZone(ctx.hero));
    // Snap the camera to the hero so they are on-screen from frame 1.
    // Without this, the camera may still be showing the previous zone's
    // position and the hero appears off-screen until the follow logic catches
    // up. For VERTICAL zones the y-snap is mandatory: the upward-only ratchet
    // owns y during play, but at area entry the camera must start at the
    // BOTTOM of the climb (where the hero spawns) — a stale y from the
    // previous zone would reveal the top of the climb instead.
    {
      const h = ctx.hero;
      const cx = h.x + h.w / 2;
      const snappedX = Math.max(ctx.camera.minX, Math.min(ctx.camera.maxX, cx - ctx.camera.w / 2));
      if (Debug.enabled) console.log(`[cam-snap] hero.x=${h.x.toFixed(0)} cx=${cx.toFixed(0)} cam.x=${ctx.camera.x.toFixed(0)}→${snappedX.toFixed(0)} minX=${ctx.camera.minX} maxX=${ctx.camera.maxX}`);
      ctx.camera.x = snappedX;
      const cy = h.y + h.h / 2;
      const snappedY = Math.max(ctx.camera.minY, Math.min(ctx.camera.maxY, cy - ctx.camera.h / 2));
      if (Debug.enabled) console.log(`[cam-snap] hero.y=${h.y.toFixed(0)} cy=${cy.toFixed(0)} cam.y=${ctx.camera.y.toFixed(0)}→${snappedY.toFixed(0)} minY=${ctx.camera.minY} maxY=${ctx.camera.maxY}`);
      ctx.camera.y = snappedY;
      // A fresh attempt starts its ascent from the spawn point — reset the
      // high-water mark to the snapped position so the ratchet can only raise
      // from here (never inherit a raised position from the previous zone).
      ctx.camera.minYReached = ctx.camera.y;
    }
    // Boss zone (boss-arena.md §1): entering 1-B behaves like any other area —
    // RUN phase. The hero is placed at the left entry by placeHeroAtEntry; the battle
    // room begins only when the hero crosses the boss checkpoint at the far
    // right (trigger line → enterBossRoom). No flow starts here.
  }
});

