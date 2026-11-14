// Petal Panic — new-game transition hook (extracted from systems/update.js).
//
// SELECT/HOME/WIN → PLAY rebuilds the hero with the chosen definition and
// establishes a genuinely new game (lifecycle.md §1): boss-state flush,
// transient teardown, startGame, entry placement, reference rebind, and the
// shared area-entry screen. update.js registers this at boot by importing
// this module for its side effect; all mutable state is read through ctx.
import { S, onTransition } from '../core/state.js';
import { Anim, makeTestFrame } from '../core/anim.js';
import { HEROES } from '../hero/heroDefs.js';
import { AttackLifecycle } from '../combat/attack/lifecycle.js';
import { captureAreaMap } from '../world/build.js';
import { restoreBossRunFloor } from '../boss/bossFlow.js';
import { startGame, bindAreaContext, showAreaEntry } from './lifecycle.js';
import { heroEntryPosition } from '../world/zoneLifecycle.js';
import { setHeroRef } from './heroRef.js';
import { ctx } from '../world/context.js';

onTransition((from, to) => {
  if (to === S.PLAY && from !== S.PAUSE && from !== S.OVER && from !== S.AREA_ENTRY) {
    // New run: SELECT/HOME/WIN → PLAY. Retry/continue already restore OVER.
    // PAUSE→PLAY is a resume — hero state is already correct.
    // AREA_ENTRY→PLAY is the player confirming the shared area-entry screen to
    // begin the attempt (lifecycle.md §2/§3) — the hero was already rebuilt by
    // startGame/continueRun and placed by placeHeroAtEntry, so this must NOT trigger
    // startGame (which would rebuild the hero and reroll generation).
    // lifecycle.md §1: a genuinely new game rebuilds the hero with the chosen
    // definition and establishes lives, the continue pool, fresh run stats,
    // and the area position. startGame() owns all of that; this hook only
    // rebuilds the hero instance and rebinds the reference.
    const heroId = window.__selectedHero || 'scarlet';
    const def = HEROES[heroId] || HEROES.scarlet;
    const oldHero = ctx.hero;
    // FLUSH boss state (game-beat leak): beating the game leaves the boss-zone
    // flow machine in COMBAT — the death path never calls reset() (only the
    // debug wrap and death-restart do). Without this flush, a new game starts
    // with the energy bar still drawing, roomLocked() clamping the hero to the
    // arena x-range, and the trigger line re-firing instantly at area 1's
    // entry x. A finished game must leave NO boss residue.
    if (ctx.bossZone?.active) {
      ctx.bossZone.reset();
      ctx.camera.unlock();
    }
    // The battle-room floor swap (settleIntoBossRoom) replaced the run floor
    // with the fixed 960px arena floor; restore the run-phase floor so area 1
    // gets its real terrain. loadActiveZone replaces solids anyway, but this
    // keeps the boss zone's own state consistent for a later entry into 1-B.
    restoreBossRunFloor(); // via ctx? no — direct import below
    // Attempt boundary: a genuinely new game starts with zero transients —
    // no fire zones, projectiles, particles, or effects from the previous run.
    AttackLifecycle.clearTransientWorld();
    const nh = startGame({ world: ctx.collisionWorld, oldHero, areaContext: ctx.areaContext }, def);
    // Snapshot the freshly generated terrain into the trace's areaMap (stable
    // for the whole game — rolled once per seed).
    captureAreaMap(nh);
    {
      const p = heroEntryPosition(nh, ctx.getActiveZone(nh));
      nh.x = p.x;
      nh.y = p.y;
      nh.checkpoint = { x: p.x, y: p.y };
    }
    // Zone model (task 2.1) — authoritative structure on the hero.
    nh.zones = ctx.levelZones;
    // Placeholder anims sized for the new body.
    nh.anim = new Anim(
      ['#2ecc71', '#27ae60', '#1abc9c'].map(c => makeTestFrame(nh.w, nh.h, c)),
      { speed: 200, loop: true },
    );
    nh.anims.melee = new Anim(
      ['#555555', '#888888', '#aaaaaa', '#ffffff', '#666666'].map(c => makeTestFrame(nh.w, nh.h, c)),
      { speed: 80, loop: false },
    );
    // Rebind the reference + bind the area context so restartAttempt/continueRun
    // can restore the preserved arrangement.
    setHeroRef(nh);
    bindAreaContext(nh, ctx.areaContext);
    // checkpoints.md §3: a genuinely new game opens the shared area-entry
    // screen (level name, area id, lives — no score) for the level's first
    // area. startGame() does NOT push the screen itself; the caller does so
    // AFTER the transition completes (lifecycle.md §1). The screen data is
    // supplied before the transition so the transition's screen reset cannot
    // clear it.
    showAreaEntry(nh, ctx.areaContext);
    console.log(`[lifecycle] new game: ${def.name} (${heroId})`);
  }
});

