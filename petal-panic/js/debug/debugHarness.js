// Debug harness — keydown/mouse handlers, god mode, entity select/force-state,
// debug spawning, JSON dumps, hero swap, and the Effect Theater gamepad step.
// All shared mutable state is read/written through ctx (world/context.js) to
// avoid a circular import back into systems/update.js.

import { input } from '../core/input.js';
import { VIEW_W, VIEW_H } from '../core/view.js';
import { LAYER } from '../consts.js';
import { Anim, makeTestFrame } from '../core/anim.js';
import { S, getState, tryTransition, STATE_NAMES } from '../core/state.js';
import { Hero } from '../hero/hero.js';
import { HEROES } from '../hero/heroDefs.js';
import { Jester } from '../enemies/jester.js';
import { VineHound } from '../enemies/vine_hound.js';
import { Violetta } from '../enemies/violetta.js';
import { JackOLantern } from '../enemies/jackolantern.js';
import { BorisLoon, BORIS_DEF, makeBorisBaby } from '../enemies/boris_loon.js';
import { makeBarrel, makeCoinBarrel, GameObj } from '../objects/object.js';
import { Powerup, POWERUP_TYPES } from '../objects/powerup.js';
import { ZONE_GROUND_Y } from '../world/level.js';
import { Effects } from '../effects.js';
import { Debug, initSpawnTable, SPAWN_KEYS } from './debug.js';
import { Theater } from './theater.js';
import { dumpTrace } from '../stats.js';
import { debugWrapToNextArea } from '../world/zoneLifecycle.js';
import { ctx } from '../world/context.js';

// Floor top y (the zone's ground level).
const FLOOR_TOP = ZONE_GROUND_Y;

/** Rebind the module-level hero reference in update.js (debug hero-swap / new game). */
let _setHeroRef = null;
export function setHeroRefSetter(fn) { _setHeroRef = fn; }

/**
 * Debug boot shortcut: reset the world to a clean state before jumping to PLAY.
 * Kills all enemies, clears projectiles/coins/particles, resets checkpoints.
 * The hero is rebuilt by the transition hook (SELECT/HOME/OVER/WIN → PLAY).
 */
export function resetWorldForDebug() {
  // Kill all real enemies (NOT the boss — killing it triggers WIN).
  for (const e of ctx.realEnemies) {
    if (e.alive) { e.alive = false; }
  }
  // Clear projectiles.
  for (const p of ctx.projectilePool.activeItems) { p.alive = false; }
  ctx.projectilePool.active.length = 0;
  // Clear coins.
  for (const c of ctx.coins.activeItems) { c.alive = false; c.collected = true; }
  ctx.coins.active.length = 0;
  // Reset checkpoint flags.
  for (const c of ctx.checkpoints) c.triggered = false;
  // Reset effects.
  Effects.reset();
  console.log('[debug] world reset for debug boot');
}

/**
 * Enable the unified debug experience: overlay + harness + log.
 * Idempotent — safe to call multiple times.
 */
function enableDebug(source) {
  if (!Debug.enabled) Debug.toggle();
  if (!Debug.showLog) {
    Debug.showLog = true;
    Debug.logEvent(`${source}: debug ON`);
  }
}

function handleDebugToggle(e, source) {
  e.preventDefault();
  const s = getState();
  if (s !== S.PLAY) {
    window.__selectedHero = 'scarlet';
    ctx.hero.x = 80;
    ctx.hero.y = FLOOR_TOP - ctx.hero.h;
    ctx.hero.vx = 0; ctx.hero.vy = 0;
    ctx.hero.alive = true;
    ctx.hero.dying = false;
    ctx.hero.deathTimer = 0;
    enableDebug(source);
    tryTransition(S.PLAY);
    console.log(`[debug] ${source}: ${STATE_NAMES[s]} → PLAY`);
    return;
  }

  if (!Debug.enabled) {
    enableDebug(source);
  } else {
    Debug.toggle();
    Debug.reset();
    // Closing debug also closes the theater (it's a debug overlay).
    if (Theater.active) Theater.close();
    Debug.logEvent(`${source}: debug OFF`);
  }
}

// --- Effect Theater gamepad stepping ------------------------------
// Tracks the previous held-direction so a step fires only on the edge (crossing
// zero), preventing hold-to-spin. `wasHeld` is -1/0/+1 for prev/left/right.
let theaterWasHeld = 0;

/**
 * Step the Effect Theater from gamepad input. Called once per frame from
 * processInput() while Theater.active. Reads input.state.moveX (d-pad +
 * left-stick, already normalized by the existing input remap) for left/right.
 * Closing is handled in processInput via nav.back (Escape / gamepad ○).
 */
export function updateTheaterGamepad() {
  const s = input.state;
  const dir = s.moveX < -0.2 ? -1 : s.moveX > 0.2 ? 1 : 0;
  // Edge-trigger: fire a step only when the held direction changes away from 0
  // into a new side (or flips side). Holding keeps the same dir → no re-step.
  if (dir !== 0 && dir !== theaterWasHeld) {
    Theater.step(dir);
    Debug.logEvent(`theater → ${Theater.current().type}`);
  }
  theaterWasHeld = dir;
}

// --- Debug & Test Harness ----------------------------------------------------
// Everything below is gated behind `if (Debug.enabled)` so normal play pays only
// a single boolean check per frame. The spawn table is populated once from the
// entity constructors that exist in this module's scope.
initSpawnTable({
  Jester, VineHound, Violetta, JackOLantern,
  BorisLoon, BORIS_DEF, makeBorisBaby,
  makeBarrel, makeCoinBarrel, Powerup, POWERUP_TYPES,
});

/**
 * Spawn a debug entity at (x, y) with an optional forced AI state, register it
 * in the collision world, and log it. Returns the created entity (or null if the
 * type is unknown). Used by the free-spawn hotkeys and the cursor-spawn click.
 * @param {string} type spawn-table key (see SPAWN_KEYS / initSpawnTable)
 * @param {number} x world x
 * @param {number} y world y
 * @param {string} [state] AI state to force after creation
 */
function debugSpawn(type, x, y, state) {
  const entry = Debug.spawnTable[type];
  if (!entry) return null;
  const ent = entry.make(x, y, state);
  // Register so it participates in collisions/rendering like level entities.
  ctx.collisionWorld.add(ent);
  // Track spawned enemies in realEnemies so the generic update loop drives their
  // AI + death pipeline exactly as level spawns do.
  if (ent.layer === LAYER.ENEMY || ent.layer === LAYER.BOSS) ctx.realEnemies.push(ent);
  else if (ent instanceof GameObj) ctx.barrels.push(ent); // barrels live in the barrel list
  else if (ent instanceof Powerup) ctx.powerups.push(ent);
  Debug.logEvent(`spawn ${type}${state ? ` @${state}` : ''} (${Math.round(x)},${Math.round(y)})`);
  return ent;
}

/**
 * Handle debug keypresses. Called from the global keydown listener while
 * Debug.enabled is true. All actions are edge-triggered (one press = one action).
 * @param {KeyboardEvent} e
 */
function handleDebugKeys(e) {
  // F3 auto-enables debug if off, then cycles view on next press.
  if (e.code === 'F3' && !Debug.enabled) {
    handleDebugToggle(e, 'debug');
    return;
  }
  if (!Debug.enabled) return;

  // Free-spawn hotkeys (1-9): spawn at hero position + small offset.
  const spawnType = SPAWN_KEYS[e.code];
  if (spawnType) {
    const ox = 40, oy = -20; // small offset so it doesn't overlap the hero
    debugSpawn(spawnType, ctx.hero.x + ctx.hero.w / 2 + ox, ctx.hero.y + ctx.hero.h / 2 + oy);
    return;
  }

  switch (e.code) {
    case 'KeyF': // God mode toggle
      Debug.god = !Debug.god;
      if (!Debug.god) ctx.hero.intangible = false;
      Debug.logEvent(`god mode ${Debug.god ? 'ON' : 'OFF'}`);
      break;
    case 'KeyZ': // Slow-mo / freeze cycle
      Debug.timeScale = Debug.cycleTimeScale();
      Debug.logEvent(`timeScale → ${Debug.timeScale}x`);
      break;
    case 'KeyT': // Toggle telemetry panel
      Debug.showStats = !Debug.showStats;
      Debug.logEvent(`telemetry ${Debug.showStats ? 'ON' : 'OFF'}`);
      break;
    case 'KeyU': // Toggle live input monitor panel
      Debug.showInput = !Debug.showInput;
      Debug.logEvent(`input monitor ${Debug.showInput ? 'ON' : 'OFF'}`);
      break;
    case 'KeyY': // Hero swap Scarlet <-> Balthazhar
      swapHero();
      break;
    case 'KeyL': // Toggle event-log display
      Debug.showLog = !Debug.showLog;
      break;
    case 'KeyW': // Wrap to next area (debug): trigger the same clear-sequence
      // advance as reaching an exit flag — flash + banner + fade → next area's
      // entry screen. Works from PLAY and from the AREA_ENTRY view (pressing W
      // again during the entry screen immediately advances to the next area).
      debugWrapToNextArea();
      break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
      // Theater stepping is handled by updateTheaterGamepad (reads input.state.moveX).
      // Don't double-step here. Only drive the anim scrubber when theater is closed.
      if (!Theater.active) {
        scrubSelectedAnim(e.code);
      }
      break;
    case 'KeyX': // Deselect current entity
      if (Debug.selected) { Debug.selected = null; Debug.logEvent('deselect'); }
      break;
    case 'KeyE': // Dump JSON to disk. Plain E = stats; Shift+E = collision world.
      if (e.shiftKey) {
        dumpCollisionWorld();
        Debug.logEvent('collision world JSON downloaded');
      } else {
        dumpTrace(ctx.hero);
        Debug.logEvent('trace JSON downloaded');
      }
      break;
    case 'F3': // Cycle collision view mode (round-robin)
      Debug.viewMode = (Debug.viewMode + 1) % 3;
      const modeNames = ['sprite+collision', 'collision-only', 'sprite-only'];
      Debug.logEvent(`view: ${modeNames[Debug.viewMode]}`);
      break;
  }
}

/**
 * Debug: serialize every entity registered in the collision world to a JSON
 * download (P key). Includes layer, alive flag, world box, and identity so a
 * stale/leaked entity from a previous zone is obvious at a glance.
 */
function dumpCollisionWorld() {
  const LAYER_NAMES = {
    1: 'HERO', 2: 'ENEMY', 4: 'BOSS', 8: 'SOLID', 16: 'PICKUP',
    32: 'PROJ_ALLY', 64: 'PROJ_FOE', 128: 'COIN', 256: 'CHECKPOINT', 512: 'HAZARD',
  };
  const layerName = (l) => l === 0 ? 'NONE' : (LAYER_NAMES[l] ?? `bits=${l}`);
  const ents = [...ctx.collisionWorld.entities].map((e) => {
    const b = e.worldBox ? e.worldBox() : { x: e.x, y: e.y, w: e.w, h: e.h };
    return {
      ctor: e.constructor?.name ?? '?',
      type: e.type ?? null,
      checkpointId: e.checkpointId ?? null,
      isEntry: e.isEntry ?? null,
      triggered: e.triggered ?? null,
      layer: e.layer,
      layerName: layerName(e.layer),
      alive: e.alive,
      intangible: e.intangible ?? null,
      collected: e.collected ?? null,
      aiState: e.aiState ?? null,
      box: {
        x: Math.round(b.x * 10) / 10,
        y: Math.round(b.y * 10) / 10,
        w: b.w, h: b.h,
        right: Math.round((b.x + b.w) * 10) / 10,
        bottom: Math.round((b.y + b.h) * 10) / 10,
      },
    };
  });
  const out = {
    at: new Date().toISOString(),
    heroArea: ctx.hero.currentArea,
    heroBox: (() => { const hb = ctx.hero.worldBox(); return { x: hb.x, y: hb.y, w: hb.w, h: hb.h }; })(),
    totalEntities: ents.length,
    entities: ents,
  };
  console.log('[debug] collision world dump:', out.totalEntities, 'entities');
  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
    try {
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'petal-panic-collision-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('[debug] failed to create download:', err.message);
    }
  }
  return out;
}

/**
 * Toggle between the two heroes (Scarlet Vale <-> Balthazhar). Rebuilds the hero
 * instance in place, preserving position/energy/lives/ammo so the A/B test is
 * about feel (jump height, speed, melee range), not a fresh start.
 */
function swapHero() {
  const hero = ctx.hero;
  const curId = hero.heroDef.id;
  const nextId = curId === 'scarlet' ? 'balthazar' : 'scarlet';
  const def = HEROES[nextId];

  // Preserve runtime resources across the swap.
  const saved = {
    x: hero.x, y: hero.y, vx: hero.vx, vy: hero.vy,
    energy: hero.energy, lives: hero.lives, coins: hero.coins,
    ammo: hero.ammo, specialAmmo: hero.specialAmmo,
    selectedWeapon: hero.selectedWeapon,
    checkpoint: hero.checkpoint, continuesUsed: hero.continuesUsed,
    stats: hero.stats,
    wallet: hero.wallet, // preserve the live wallet (current + snapshot)
    traceStats: hero.traceStats, // preserve the accumulating trace
    _levelStartWallet: hero._levelStartWallet,
    _lifeBucketArmed: hero._lifeBucketArmed,
    _levelStartTotal: hero._levelStartTotal,
    _lifeBucketArmed: hero._lifeBucketArmed,
    intangible: hero.intangible, rapidTimer: hero.rapidTimer,
    // CRITICAL: progress identity. A fresh Hero() does NOT set these, so
    // without them the swapped hero has currentArea === undefined and
    // getActiveZone() falls through to the boss zone — which instantly fires
    // the boss-card trigger whenever x >= BOSS_TRIGGER_X. Preserve them so the
    // swap keeps the hero in the area they were actually playing.
    currentLevel: hero.currentLevel,
    currentArea: hero.currentArea,
    zones: hero.zones,
    levelConfig: hero.levelConfig,
    // Death state: a fresh Hero() hard-sets dying=false. If the old hero was
    // mid-death, preserving it keeps the death/respawn pipeline intact instead
    // of silently resurrecting the hero.
    dying: hero.dying,
    deathTimer: hero.deathTimer,
  };

  const nh = new Hero(def, saved.x, saved.y);
  Object.assign(nh, saved);
  // Carry the remaining i-frame window across the swap so the new hero is not
  // immune forever (flag alone would outlive its timer). If the old flag was
  // set but the timer already expired, clear both so the flag can't linger.
  if (saved.intangible) {
    const remaining = hero.timers.get('intangible');
    if (remaining > 0) {
      nh.timers.set('intangible', remaining);
    } else {
      nh.intangible = false;
    }
  }
  // CRITICAL: restore the NEW hero's stats (Object.assign overwrote them
  // with the old hero's stats object). Stats define speed/jump/special/etc.
  nh.stats = def.stats;
  nh.vx = saved.vx; nh.vy = saved.vy;
  // Wallet + trace are preserved via Object.assign(nh, saved) above (saved
  // carries hero.wallet / hero.traceStats), so no re-aliasing is needed.
  // Reattach placeholder anims sized for the new body.
  nh.anim = new Anim(
    ['#2ecc71', '#27ae60', '#1abc9c'].map(c => makeTestFrame(nh.w, nh.h, c)),
    { speed: 200, loop: true },
  );
  nh.anims.attack = new Anim(
    ['#555555', '#888888', '#aaaaaa', '#ffffff', '#666666'].map(c => makeTestFrame(nh.w, nh.h, c)),
    { speed: 80, loop: false },
  );

  // Swap the reference inside the collision world.
  ctx.collisionWorld.remove(hero);
  ctx.collisionWorld.add(nh);
  // Rebind the module-level `hero` in update.js.
  if (_setHeroRef) _setHeroRef(nh);
  Debug.logEvent(`hero → ${def.name}`);
}

/** Step the selected entity's animation forward/back one frame. */
function scrubSelectedAnim(code) {
  const sel = Debug.selected;
  if (!sel) return;
  const anim = sel.anim ?? sel.anims?.attack;
  if (!anim || !anim.frames.length) { Debug.logEvent('no anim on selection'); return; }
  const n = anim.frames.length;
  let i = anim.frameIndex;
  if (code === 'ArrowRight') i = (i + 1) % n;
  else if (code === 'ArrowLeft') i = (i - 1 + n) % n;
  else if (code === 'ArrowUp') i = 0;
  else if (code === 'ArrowDown') i = n - 1;
  anim.pickFrame(i);
  Debug.logEvent(`scrub ${sel.type ?? sel.heroDef?.id ?? '?'} frame ${i}/${n - 1}`);
}

/** Select the topmost enemy/boss/powerup under a logical-space point. */
export function selectEntityAt(lx, ly) {
  // Prefer enemies + boss (the interesting ones), then powerups/barrels.
  const candidates = [...ctx.realEnemies, ...ctx.enemies, ctx.boss].filter(e => e && e.alive !== false);
  for (const p of ctx.powerups) if (p.alive && !p.collected) candidates.push(p);
  for (const b of [...ctx.barrels, ...ctx.woodBarrels, ...ctx.coinBarrels]) if (b.alive) candidates.push(b);
  const hero = ctx.hero;
  if (hero && !hero.dying) candidates.push(hero);
  for (const c of candidates) {
    const b = c.worldBox();
    if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) {
      Debug.selected = c;
      // Selecting an entity promotes detail to inspect level so its numeric
      // panel shows immediately (mirror icons stay on at every level).
      if (Debug.detailLevel < 2) {
        Debug.detailLevel = 2;
        Debug.logEvent('detail: inspect');
      }
      Debug.logEvent(`select ${c.type ?? c.powerType ?? '?'} @(${Math.round(lx)},${Math.round(ly)})`);
      return c;
    }
  }
  Debug.selected = null;
  return null;
}

/** Force-cycle the AI state of the entity under a logical-space point. */
export function forceStateAt(lx, ly) {
  const hit = pickEnemyAt(lx, ly);
  if (!hit) return null;
  const s = Debug.nextState(hit);
  Debug.logEvent(`force ${hit.type}: ${s ?? '(none)'}`);
  return s;
}

/** Find an enemy/boss whose box contains the point (for click-to-force-state). */
function pickEnemyAt(lx, ly) {
  const candidates = [...ctx.realEnemies, ctx.boss].filter(e => e && e.alive !== false);
  for (const c of candidates) {
    const b = c.worldBox();
    if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) return c;
  }
  return null;
}

/** Per-frame god-mode enforcement: intangible + infinite ammo. */
export function applyGodMode(dt) {
  if (!Debug.god) return;
  ctx.hero.intangible = true;
  ctx.hero.ammo = Infinity;
  ctx.hero.specialAmmo = Infinity;
}

// Debug is intentionally outside normal navigation/gameplay bindings.
window.addEventListener('keydown', (e) => {
  if (input.capturing) return;
  if (['F1', 'F2', 'F3'].includes(e.code)) e.preventDefault();
  // Shift+E: collision-world JSON dump. Handled BEFORE the F1/F2/debug gates so
  // it works whether or not debug mode is on (it IS the debug tool). Plain E
  // (stats dump) stays inside handleDebugKeys; KeyP/KeyD are unavailable —
  // input.js binds them to nav actions (pause / move-right).
  if (e.shiftKey && e.code === 'KeyE') {
    e.preventDefault();
    handleDebugKeys(e);
    return;
  }
  // F1: toggle debug mode. Opening debug from gameplay enters PLAY + harness.
  // Closing debug returns to normal gameplay (and closes theater if open).
  if (e.code === 'F1') { handleDebugToggle(e, 'debug'); return; }
  // F2: toggle Effect Theater. Works from anywhere (gameplay or debug).
  // Does NOT require debug to be on — it's a standalone overlay.
  if (e.code === 'F2') {
    if (Theater.active) {
      Theater.close();
      Debug.logEvent('theater CLOSE (F2)');
    } else {
      Theater.open();
      Debug.logEvent('theater OPEN (F2)');
    }
    return;
  }
  handleDebugKeys(e);
});

// --- Debug harness mouse input: click to select / force an enemy's state -----
// Converts a screen-space click into logical 960x540 coords (inverse of the
// main.js transform), then selects or cycles the entity under it. Only active
// while the harness is on; zero cost otherwise (early return).
window.addEventListener('mousedown', (e) => {
  if (!Debug.enabled) return;
  const canvas = document.getElementById('game');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  // Screen → logical: account for letterbox centering + dpr scaling.
  const sx = (e.clientX - rect.left) / rect.width * VIEW_W;
  const sy = (e.clientY - rect.top) / rect.height * VIEW_H;
  const cam = ctx.camera;
  const lx = sx + cam.x;
  const ly = sy + cam.y;
  // Left click = force-cycle AI state; right click = select for inspection.
  if (e.button === 2) { e.preventDefault(); selectEntityAt(lx, ly); }
  else forceStateAt(lx, ly);
});
window.addEventListener('contextmenu', (e) => { if (Debug.enabled) e.preventDefault(); });
