// Petal Panic — Attack Theater (Wave 1 cut; full spec lands in Wave 5).
// A DEBUG-ONLY sandbox that lists every registered attack primitive, lets you
// pick one (arrows / d-pad), and fires it at a dummy target with live-tweakable
// params. Same UX pattern as the Effect Theater (F2): black overlay, demo arena
// left, info/params panel right, arrows navigate, confirm replays, back closes.
//
// Unlike the Effect Theater this runs a LIVE mini-simulation: real pools,
// real collision world, real damage routing, REAL effect engine VFX. The
// attacker is a placeholder box on the left; the dummy target stands on the
// right and flashes + loses HP. Per-primitive choreography stages each attack
// so it's actually watchable (charge dashes AT the target, body contact walks
// into it, melee throws a visible punch). Explosions fire directly — the real
// Effect-Engine burst is the visual (a proper telegraph primitive lands in Wave 2).
//
// Keys:  F4 toggle · ←/→ (A/D) select · ↑/↓ (W/S) select param · I/O adjust
//        (the user's mapped lockDir/lockMove keys — remappable in Controls) ·
//        Enter/Space replay · Esc close.
// Pad:   ◀▶ select · ▲▼ param · L2/R2 adjust · A replay · B close.

import { listPrimitives, listMacros, getPrimitive, getMacro } from '../combat/attack/registry.js';
import { invoke } from '../combat/attack/engine.js';
import { makeContext } from '../combat/attack/context.js';
import { BombAttackHost } from '../combat/attack/bombAttackHost.js';
import { resolveEffects, resolveInvokes } from '../combat/attack/effectsMeta.js';
import { stepProjectile } from '../combat/attack/primitives/projectile.js';
import { stepBomb, stepBombTerrain } from '../combat/attack/primitives/bomb.js';
import { Pool, Projectile, Special } from '../objects/projectile.js';
import { CollisionWorld, resolve } from '../core/collision.js';
import { LAYER } from '../consts.js';
import { ENEMY_TYPES } from '../world/build.js';
import { VIEW_W, VIEW_H } from '../core/view.js';
import { navLabelString, navLabels, input } from '../core/input.js';
import { Effects } from '../effects.js';
import { Debug } from '../debug/debug.js';
import { updateEffects, drawEffects, resetEffects, fireManual, CATALOG } from '../effects/index.js';
import { particles } from '../effects/particles.js';
import { damage, flashTarget } from '../combat/damage.js';
import { entryImpactPoint } from '../combat/entryImpact.js';
import { explodeSpecial } from '../combat/shooting.js';
import { isSpecialType } from '../objects/specialWeapons.js';
import { ctx as gameCtx } from '../world/context.js';
import { STAGING } from './attack-theater-staging.js';

// Import every primitive module for its registration side effect.
import '../combat/attack/primitives/projectile.js';
import '../combat/attack/primitives/bomb.js';
import '../combat/attack/primitives/explosion.js';
import '../combat/attack/primitives/meleeHitbox.js';
import '../combat/attack/primitives/movement.js';
import '../combat/attack/primitives/bodyContact.js';
import '../combat/attack/macros/index.js'; // macro barrel — all macros register here
import '../combat/attack/primitives/beam.js';
import '../combat/attack/primitives/fireArea.js';
import '../combat/attack/primitives/dustZone.js';
import '../combat/attack/primitives/spike.js';
import '../combat/attack/primitives/orbit.js';
import '../combat/attack/primitives/boomerang.js';
import '../combat/attack/primitives/surfaceWave.js';
import '../combat/attack/primitives/shockwave.js';

// --- Sandbox constants --------------------------------------------------------
const GROUND_Y = 400;
const ATTACKER_HOME = { x: 140, y: GROUND_Y - 48, w: 32, h: 48 };
const TARGET_POS = { x: 560, y: GROUND_Y - 48, w: 32, h: 48 }; // clear of the side panel
const DT = 1 / 60;
const DEG = Math.PI / 180;
// Held-control repeat cadence, in FIXED STEPS (60Hz): first press fires
// immediately, then a short pause, then a steady tick — standard menu feel.
const REPEAT_DELAY_FRAMES = 13; // ~217ms before the first auto-repeat
const REPEAT_FRAMES = 5;        // ~83ms between repeats while held

// Bomb-derived attacks route through the shared BombAttackHost (same as
// gameplay) instead of raw invoke(): the host owns root lifecycle + child
// payload promotion (carrier → fireArea / split bombs). Everything else stays
// on the theater's direct handle path.
const BOMB_FAMILY = new Set(['bomb', 'explosiveBomb', 'molotov', 'clusterBomb', 'bombSpread', 'spawnSplit']);

/** Angle display helper: radians → "−45° ↗" style string. */
function angleLabel(rad) {
  const oct = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  const idx = ((Math.round(-rad / (Math.PI / 4)) % 8) + 8) % 8;
  return `${round2(rad)} ${oct[idx]}`;
}

// Per-primitive default param presets for the sandbox.
const SANDBOX_PRESETS = {
  projectile: { direction: 0, speed: 600, ttl: 2, damage: 10, solidBehavior: 'phase', gravity: 0 },
  bomb: { direction: -0.5, arc: 800, bounce: true, explodeOnContact: true, ttl: 2, damage: 40, radius: 70 }, // speed from registry default (500)
  explosiveBomb: { direction: -0.5, arc: 800, bounce: true, explodeOnContact: true, ttl: 2, damage: 40, radius: 70 }, // speed from registry default (500)
  explosiveProjectile: { direction: 0, speed: 700, ttl: 2, damage: 15, radius: 70, gravity: 0 },
  explosion: { x: TARGET_POS.x + 16, y: GROUND_Y - 24, radius: 70, damage: 40, team: 'neutral' },
  meleeHitbox: { activeFrames: 10, w: 48, h: 44, offset: { x: 44, y: 0 }, damage: 12 },
  charge: { direction: 0, speed: 700, distanceType: 'fixed', distance: 300, acceleration: 1000, announceMarker: false, announceDelay: 1.0 },
  bodyContact: { damage: 20, enabled: true, temporaryOverride: true },
  // --- Wave 2 -----------------------------------------------------------------
  reticleShot: { duration: 1.3, lockTime: 1.1, color: '#ff5555', radius: 30, tracking: true, speed: 500, ttl: 2, damage: 10, blastType: 'plain', blast: { explosionRadius: 70, shockRadius: 150, fireWidth: 96 } },
  homingMissile: { direction: -0.3, turnRate: 3, speed: 400, ttl: 2, damage: 10 },
  predictiveShot: { speed: 300, ttl: 3, damage: 10 },
  beam: { direction: 0, length: 1000, width: 24, duration: 0.6, damage: 15, tickRate: 8, team: 'ally' },
  fireArea: { x: TARGET_POS.x + 16, y: GROUND_Y - 24, width: 96, duration: 2, tickRate: 5, damage: 8, team: 'ally' },
  dustZone: { x: ATTACKER_HOME.x + 80, y: GROUND_Y - 32, width: 140, height: 64, duration: 3, tickRate: 5, damage: 6, team: 'ally', palette: 'hazard' },
  spike: { x: TARGET_POS.x + 16, y: GROUND_Y - 8, width: 144, warningTime: 0.5, visibleTTL: 0.8, hiddenTTL: 0.5, repeatCount: 2, damage: 15, tickRate: 10, team: 'ally' },
  orbit: { count: 3, minRadius: 40, maxRadius: 90, pulseSpeed: 1.5, speed: 1.5, ttl: null, damage: 10, ejectable: true, ejectTtl: 2 },
  boomerang: { direction: 0, speed: 500, returnSpeed: 700, outboundDuration: 0.7, outboundDistance: null, ttl: 4, damage: 12, count: 3 },
  spawnSplit: { x: TARGET_POS.x + 16, y: GROUND_Y - 100, count: 4, centerDirection: -Math.PI / 2, angle: 120 * DEG, force: 300, inheritVelocity: 0, delay: 0, spawnType: 'bomb', enemyType: 'jester' },
  spreadShot: { count: 3, direction: 0, angle: 60 * DEG, speed: 500, ttl: 2, damage: 10 },
  radialShot: { count: 24, startAngle: -Math.PI / 2, speed: 400, ttl: 2.5, damage: 10, sequenceInterval: 0.15 },
  burstShot: { count: 3, interval: 0.12, direction: 0.5, speed: 600, ttl: 2, damage: 10 },
  bodyExplosion: { deathBehavior: 'kill', triggerPayloadFirst: true, payloadDelay: 0.1 },
  bombSpread: { count: 3, direction: -75 * DEG, angle: 15 * DEG, speed: 700, arc: 800, bounce: true, ttl: 2, damage: 40, radius: 60 },
  molotov: { direction: -0.5, arc: 800, bounce: false, ttl: 2, damage: 12, fireWidth: 96, fireDuration: 3, fireTickRate: 5, fireDamage: 8 },
  clusterBomb: { direction: -0.5, arc: 800, bounce: false, ttl: 3, damage: 20, radius: 40, count: 4, childAngle: 120 * DEG, childDirection: -Math.PI / 2, childForce: 300, childArc: 700, childTtl: 2, childDamage: 15, childRadius: 30 },
  targetedBeam: { duration: 1.2, lockTime: 0.5, color: '#ff5555', radius: 30, tracking: true, beamDuration: 1.0, beamWidth: 24, beamLength: 1000, damage: 15, tickRate: 8, team: 'ally' },
  sweepingBeam: { direction: 0, sweepAngle: 67.5 * DEG, length: 1000, width: 24, speed: 0, holdDuration: 0.4, sweepDuration: 1.0, endHoldDuration: 0.3, fadeOut: 0.5, damage: 20, tickRate: 8, team: 'ally', shimmerLow: 0.1, shimmerHigh: 0.35, announceMarker: true, announceDelay: 1.0 },
  laneSequence: { mode: 'charge', lanes: [150, 270, 390], laneOrder: 'bottom_to_top', sideMode: 'fixed_left', alternateStartSide: 'left', announceDelay: 0.5, dashSpeed: 1200, damage: 20, knockback: null, beamDuration: 0.8, beamWidth: 24, tickRate: 8, interval: 0.15, team: 'foe', style: null },
  surfaceWave: { x: ATTACKER_HOME.x + 16, y: GROUND_Y, direction: 'right', speed: 300, height: 24, width: 28, damage: 15, ttl: null, team: 'foe' },
  shockwave: { x: (ATTACKER_HOME.x + TARGET_POS.x) / 2 + 16, y: GROUND_Y - 24, radius: 300, damage: 70, duration: 1.2, easing: 'easeIn', knockbackIntensity: 8, shakeIntensity: 5, team: 'neutral' },
  shockwaveBomb: { direction: -0.5, arc: 800, bounce: false, explodeOnContact: true, ttl: 2, radius: 300, damage: 70, duration: 1.2, easing: 'easeIn', knockbackIntensity: 8, blastTeam: 'neutral' },
  shockwaveProjectile: { direction: 0, speed: 700, ttl: 2, radius: 300, damage: 70, duration: 1.2, easing: 'easeIn', knockbackIntensity: 8, solidBehavior: 'stop', blastTeam: 'neutral' },
  stomp: { buildTime: 1.2, gapTime: 0.4, blinkTime: 0.5, impactDelay: 0.1, count: 1, interval: 0.5, hopHeight: 10, radius: 90, damage: 30, team: 'foe', shakeStrength: 5 },
  stompWave: { buildTime: 1.2, gapTime: 0.4, blinkTime: 0.5, impactDelay: 0.1, sides: 'both', hopHeight: 10, waveSpeed: 300, waveHeight: 24, waveWidth: 28, damage: 20, ttl: null, team: 'foe', shakeStrength: 5 },
  skyMissile: { x: TARGET_POS.x + 16, timeToTarget: 1.0, dropHeight: 260, fallSpeed: 500, damage: 30, team: 'foe', blastTeam: 'neutral', blastType: 'explosion', blast: { explosionRadius: 60, shockRadius: 150, fireWidth: 96 } },
  missileRain: { count: 5, distanceType: 'relative', distance: 90, pattern: 'simultaneous', interval: 0.15, coordination: 'from_left', launchInterval: 0.12, ascentOscillation: 6, fallDelay: 0.5, timeToTarget: 0.9, descentSpeed: 500, damage: 30, team: 'foe', blastTeam: 'neutral', blastType: 'explosion', blast: { explosionRadius: 60, shockRadius: 150, fireWidth: 96 } },
  dashCombo: {
    direction: 0,
    startup: 0.2,
    recovery: 0.4,
    team: 'ally',
    segments: [
      { frame: 'a', speed: 380, duration: 0.18, freezeFrames: 0.12, hitbox: { w: 48, h: 40, offset: { x: 30, y: 0 } }, damage: 8, knockback: null, shove: 0.6 },
      { frame: 'b', speed: 460, duration: 0.18, freezeFrames: 0.12, hitbox: { w: 52, h: 44, offset: { x: 34, y: 0 } }, damage: 10, knockback: null, shove: 0.6 },
      { frame: 'c', speed: 520, duration: 0.16, freezeFrames: 0.14, hitbox: { w: 56, h: 48, offset: { x: 38, y: 0 } }, damage: 18, knockback: { scaleBySpeed: 0.25, hitstun: 0.3, dirMode: 'fromAttacker' }, shove: 0.6 },
    ],
  },
};

/** Tweakable params per primitive: [key, kind, step]. kind: num | angle | int. */
export const TWEAKABLE = {
  projectile: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['ttl', 'num', 0.25], ['damage', 'num', 2]],
  spreadShot: [['count', 'int', 1], ['angle', 'angle', 15 * DEG], ['sequenceInterval', 'num', 0.05]],
  radialShot: [['count', 'int', 1], ['startAngle', 'angle', 15 * DEG], ['speed', 'num', 50], ['sequenceInterval', 'num', 0.05]],
  burstShot: [['count', 'int', 1], ['interval', 'num', 0.02], ['direction', 'angle', 15 * DEG], ['speed', 'num', 50]],
  bomb: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['arc', 'num', 100], ['ttl', 'num', 0.5], ['damage', 'num', 5], ['radius', 'num', 10]],
  explosiveBomb: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['arc', 'num', 100], ['ttl', 'num', 0.5], ['damage', 'num', 5], ['radius', 'num', 10]],
  explosiveProjectile: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['ttl', 'num', 0.2], ['damage', 'num', 5], ['radius', 'num', 10]],
  explosion: [['x', 'num', 20], ['y', 'num', 20], ['radius', 'num', 10], ['damage', 'num', 5]],
  meleeHitbox: [['activeFrames', 'int', 2], ['w', 'num', 8], ['h', 'num', 8], ['damage', 'num', 2]],
  charge: [['speed', 'num', 100], ['distanceType', 'enum', ['fixed', 'infinit']], ['distance', 'num', 50], ['acceleration', 'num', 500], ['direction', 'angle', 15 * DEG], ['announceMarker', 'enum', [false, true]], ['announceDelay', 'num', 0.1]],
  bodyContact: [['damage', 'num', 5]],
  // --- Wave 2 -----------------------------------------------------------------
  reticleShot: [['duration', 'num', 0.1], ['lockTime', 'num', 0.1], ['speed', 'num', 50], ['blastType', 'enum', ['plain', 'explosion', 'shockwave', 'napalm']], ['blast.explosionRadius', 'num', 10], ['blast.shockRadius', 'num', 10], ['blast.fireWidth', 'num', 8]],
  homingMissile: [['turnRate', 'num', 0.5], ['direction', 'angle', 15 * DEG], ['ttl', 'num', 0.25]],
  predictiveShot: [['speed', 'num', 50]],
  beam: [['direction', 'angle', 15 * DEG], ['length', 'num', 20], ['width', 'num', 4], ['duration', 'num', 0.1], ['damage', 'num', 2], ['tickRate', 'int', 1], ['announceMarker', 'enum', [false, true]], ['announceDelay', 'num', 0.1]],
  fireArea: [['x', 'num', 20], ['width', 'num', 16], ['duration', 'num', 0.25], ['damage', 'num', 2], ['tickRate', 'int', 1]],
  dustZone: [['x', 'num', 20], ['width', 'num', 16], ['height', 'num', 8], ['duration', 'num', 0.25], ['damage', 'num', 2], ['tickRate', 'int', 1]],
  spike: [['x', 'num', 16], ['width', 'num', 8], ['warningTime', 'num', 0.1], ['visibleTTL', 'num', 0.1], ['hiddenTTL', 'num', 0.1], ['repeatCount', 'int', 1], ['damage', 'num', 2]],
  orbit: [['count', 'int', 1], ['minRadius', 'num', 10], ['maxRadius', 'num', 10], ['pulseSpeed', 'num', 0.25], ['speed', 'num', 0.25]],
  boomerang: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['returnSpeed', 'num', 50], ['outboundDuration', 'num', 0.1], ['count', 'int', 1]],
  spawnSplit: [['count', 'int', 1], ['centerDirection', 'angle', 15 * DEG], ['angle', 'angle', 15 * DEG], ['force', 'num', 50], ['spawnType', 'enum', ['projectile', 'bomb', 'enemy']], ['enemyType', 'enum', ENEMY_TYPES]],
  bodyExplosion: [['payloadDelay', 'num', 0.05]],
  bombSpread: [['count', 'int', 1], ['direction', 'angle', 15 * DEG], ['angle', 'angle', 15 * DEG], ['speed', 'num', 50], ['ttl', 'num', 0.5], ['damage', 'num', 5], ['radius', 'num', 10]],
  molotov: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['fireWidth', 'num', 16], ['fireDuration', 'num', 0.5], ['fireDamage', 'num', 2]],
  clusterBomb: [['count', 'int', 1], ['childAngle', 'angle', 15 * DEG], ['childDirection', 'angle', 15 * DEG], ['childForce', 'num', 50], ['childArc', 'num', 50], ['childTtl', 'num', 0.3], ['childDamage', 'num', 3], ['childRadius', 'num', 8]],
  targetedBeam: [['duration', 'num', 0.1], ['lockTime', 'num', 0.1], ['beamDuration', 'num', 0.1], ['damage', 'num', 2], ['tickRate', 'int', 1]],
  sweepingBeam: [['direction', 'angle', 15 * DEG], ['sweepAngle', 'angle', 10 * DEG], ['speed', 'num', 20], ['holdDuration', 'num', 0.1], ['sweepDuration', 'num', 0.1], ['endHoldDuration', 'num', 0.05], ['fadeOut', 'num', 0.05], ['damage', 'num', 2], ['announceMarker', 'enum', [false, true]], ['announceDelay', 'num', 0.1]],
  laneSequence: [['mode', 'enum', ['charge', 'beam']], ['laneOrder', 'enum', ['bottom_to_top', 'top_to_bottom', 'random']], ['sideMode', 'enum', ['fixed_left', 'fixed_right', 'alternate', 'random']], ['announceDelay', 'num', 0.1], ['dashSpeed', 'num', 100], ['beamDuration', 'num', 0.1], ['damage', 'num', 5], ['tickRate', 'int', 1], ['interval', 'num', 0.05]],
  surfaceWave: [['speed', 'num', 50], ['height', 'num', 4], ['width', 'num', 4], ['ttl', 'num', 0.25], ['damage', 'num', 5]],
  stomp: [['buildTime', 'num', 0.1], ['gapTime', 'num', 0.1], ['blinkTime', 'num', 0.1], ['impactDelay', 'num', 0.1], ['count', 'int', 1], ['interval', 'num', 0.1], ['radius', 'num', 10], ['damage', 'num', 5], ['shakeStrength', 'num', 1]],
  stompWave: [['buildTime', 'num', 0.1], ['gapTime', 'num', 0.1], ['blinkTime', 'num', 0.1], ['impactDelay', 'num', 0.1], ['waveSpeed', 'num', 50], ['waveHeight', 'num', 4], ['ttl', 'num', 0.25], ['damage', 'num', 5], ['shakeStrength', 'num', 1]],
  skyMissile: [['x', 'num', 20], ['timeToTarget', 'num', 0.1], ['dropHeight', 'num', 20], ['fallSpeed', 'num', 50], ['damage', 'num', 5], ['blastType', 'enum', ['explosion', 'shockwave', 'napalm']], ['blast.explosionRadius', 'num', 10], ['blast.shockRadius', 'num', 10], ['blast.fireWidth', 'num', 8]],
  missileRain: [['count', 'int', 1], ['distanceType', 'enum', ['fixed', 'relative']], ['distance', 'num', 20], ['pattern', 'enum', ['simultaneous', 'sequential']], ['interval', 'num', 0.05], ['coordination', 'enum', ['from_left', 'from_right', 'random']], ['launchInterval', 'num', 0.02], ['fallDelay', 'num', 0.05], ['timeToTarget', 'num', 0.1], ['descentSpeed', 'num', 50], ['damage', 'num', 5], ['blastType', 'enum', ['explosion', 'shockwave', 'napalm']], ['blast.explosionRadius', 'num', 10], ['blast.shockRadius', 'num', 10], ['blast.fireWidth', 'num', 8]],
  dashCombo: [['startup', 'num', 0.05], ['recovery', 'num', 0.05], ['seg0.speed', 'num', 20], ['seg1.speed', 'num', 20], ['seg2.speed', 'num', 20], ['seg0.damage', 'num', 2], ['seg1.damage', 'num', 2], ['seg2.damage', 'num', 2]],
  shockwave: [['radius', 'num', 10], ['damage', 'num', 5], ['duration', 'num', 0.1], ['easing', 'enum', ['linear', 'easeIn', 'easeInCubic']], ['knockbackIntensity', 'num', 1]],
  shockwaveBomb: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['arc', 'num', 100], ['ttl', 'num', 0.5], ['radius', 'num', 10], ['damage', 'num', 5], ['duration', 'num', 0.1]],
  shockwaveProjectile: [['direction', 'angle', 15 * DEG], ['speed', 'num', 50], ['ttl', 'num', 0.2], ['radius', 'num', 10], ['damage', 'num', 5], ['duration', 'num', 0.1]],
};

export const AttackTheater = {
  active: false,
  index: 0,
  paramIndex: 0,
  // Live sandbox state (rebuilt on open/replay).
  _pools: null,
  _world: null,
  _attacker: null,
  _target: null,
  _handles: [],
  _bombHost: null,   // BombAttackHost — owns bomb-family roots (same as gameplay)
  _params: {},
  _log: [],
  _choreo: null,      // per-run choreography state
  _padWasHeld: 0,     // gamepad edge-trigger memory (entry selection)
  _padConfirmHeld: false, // gamepad A edge-trigger memory (replay)
  _rep: {},           // held-control repeater state per channel
  _repeatDir: {},     // current direction per repeat channel
  _tweaks: {},        // per-id user param tweaks (survive per-replay reload)

  get entries() { return [...listPrimitives(), ...listMacros()]; },
  currentId() { return this.entries[this.index] ?? null; },

  _tweakList() { return TWEAKABLE[this.currentId()] ?? []; },

  open() {
    this.active = true;
    // The declaration guard throws on undeclared effect fires while debug is
    // enabled — and the attack theater IS a debug tool. Enable it here so
    // declaration bugs surface as loud errors (the whole point of the guard)
    // instead of silent warn+skip, which reads as "effects not rendering".
    if (!Debug.enabled) Debug.toggle();
    this.index = 0;
    this.paramIndex = 0;
    this._padWasHeld = 0;
    this._rep = {};
    this._repeatDir = {};
    this._resetSandbox();
  },

  close() {
    this.active = false;
    this._teardown();
    resetEffects(); // drop in-flight effect instances (beams, flashes...)
    particles.reset(); // clear demo sparkles/explosion particles so they don't
                       // leak into gameplay — same guard the Effect Theater uses
  },

  step(dir) {
    if (!this.active) return;
    const n = this.entries.length;
    this.index = (this.index + dir + n) % n;
    this.paramIndex = 0;
    this._loadParams();
    this._replay();
  },

  stepParam(dir) {
    const keys = this._tweakList();
    if (!keys.length) return;
    this.paramIndex = (this.paramIndex + dir + keys.length) % keys.length;
  },

  adjustParam(deltaSign) {
    const list = this._tweakList();
    if (!list.length) return;
    const [key, kind, stepSize] = list[this.paramIndex];
    // Record the tweak per-id so it survives the per-replay param rebuild.
    const id = this.currentId();
    if (!this._tweaks[id]) this._tweaks[id] = {};
    // Dotted keys (e.g. 'seg0.damage') target nested params: read/write through
    // the path and store the tweak under the same dotted key.
    const isDotted = key.includes('.');
    const getVal = () => isDotted ? key.split('.').reduce((o, k) => o?.[k], this._params) : this._params[key];
    const setVal = (v) => {
      if (isDotted) {
        const parts = key.split('.');
        let obj = this._params;
        for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
        obj[parts[parts.length - 1]] = v;
      } else this._params[key] = v;
      this._tweaks[id][key] = v;
    };
    // Enum params: cycle through the allowed values instead of numeric stepping.
    if (kind === 'enum' && Array.isArray(stepSize)) {
      const cur = getVal();
      const idx = stepSize.indexOf(cur);
      const next = stepSize[(idx + deltaSign + stepSize.length) % stepSize.length];
      setVal(next);
      return;
    }
    const nextNum = round2((getVal() ?? 0) + deltaSign * stepSize);
    setVal(nextNum);
  },

  replay() {
    if (!this.active) return;
    this._replay();
  },

  /**
   * Orbit eject (Space): if a live orbit handle exists and is ejectable,
   * release its satellites as real projectiles along their tangents.
   * Returns true when an eject happened (caller skips the replay action).
   */
  tryEjectOrbit() {
    if (!this.active || this.currentId() !== 'orbit') return false;
    const h = this._handles.find((x) => x.id === 'orbit' && typeof x.eject === 'function');
    if (!h || h.state?.ejected) return false;
    const launches = h.eject(420);
    if (!launches.length) return false;
    for (const l of launches) {
      const shot = invoke('projectile', {
        origin: { x: l.x, y: l.y }, direction: l.angle,
        speed: Math.hypot(l.vx, l.vy), ttl: l.ttl ?? 2, damage: this._params.damage ?? 10,
      }, this._ctx());
      if (shot?.entity) this._handles.push(shot);
    }
    this._log.unshift(`EJECT → ${launches.length} shots`);
    return true;
  },

  // --- Gamepad (called from update loop while active) --------------------------

  /**
   * Edge-triggered gamepad routing, same convention as the Effect Theater:
   * d-pad/stick X = select entry, Y = select param, L2/R2 = adjust value,
   * A (confirm) = replay, B (back) = close.
   */
  updateGamepad() {
    if (!this.active) return;
    const s = inputState();
    // Merge pad + keyboard direction so BOTH devices feed the same repeat
    // system (keyboard edges from keydown are ignored — heldKeys polling is
    // the single source of truth, which is what makes debouncing work).
    const kb = keyboardDir();
    const dirX = s.moveX < -0.2 ? -1 : s.moveX > 0.2 ? 1 : 0;
    const dirY = s.moveY < -0.2 ? -1 : s.moveY > 0.2 ? 1 : 0;
    const x = dirX !== 0 ? dirX : kb.x;
    const y = dirY !== 0 ? dirY : kb.y;
    // --- Entry selection (←/→): edge-triggered, one step per press ----------
    if (x !== 0 && x !== this._padWasHeld) {
      this.step(x);
    }
    this._padWasHeld = x;
    // --- Param selection (↑/↓): repeat with a fixed interval -----------------
    this._repeat('param', y, () => {
      if (this._repeatDir.param !== 0) this.stepParam(this._repeatDir.param);
    });
    // --- Value adjust (I/O + L2/R2): same repeat cadence --------------------
    const adj = mappingAdjust();
    const adjDir = adj.down && !adj.up ? -1 : adj.up && !adj.down ? 1 : 0;
    this._repeat('adjust', adjDir, () => {
      if (this._repeatDir.adjust !== 0) this.adjustParam(this._repeatDir.adjust);
    });
    // Keyboard confirm comes from the RAW DOM keydown listener in debugHarness
    // (one event per physical press — never merged), so fast taps can't be
    // collapsed by the per-frame poll. Only the GAMEPAD side is polled here,
    // edge-triggered (a held A button replays once, not every frame).
    if (s.padConfirm && !this._padConfirmHeld) this.replay();
    this._padConfirmHeld = s.padConfirm;
    // Gamepad B (back) close: keyboard Escape AND gamepad B are both consumed
    // in processInput() (systems/update.js shared theater path) — the SAME code
    // path as Effect Theater. No duplicate close here: the shared path sets
    // active=false before _stepOnce runs, so this guard is just a safety net
    // for the rare case where the pad edge arrives on a fixed-step tick between
    // processInput polls.
    if (s.navPressed.includes('back') && this.active) { this.close(); input.clearGameEdges(); }
  },

  /**
   * Fixed-interval repeater for held controls, driven by the sandbox's FIXED
   * step (called once per _stepOnce, i.e. exactly 60Hz). First press fires
   * immediately (edge); holding then re-fires every REPEAT_FRAMES after an
   * initial REPEAT_DELAY_FRAMES pause. Frame-counting (not timestamps) keeps
   * the cadence perfectly even under the fixed-step accumulator — no jitter.
   * Two independent channels ('param', 'adjust') so ↑+I held both work.
   */
  _repeat(channel, dirNow, fire) {
    const st = this._rep[channel] ?? (this._rep[channel] = { dir: 0, count: 0 });
    if (dirNow === 0) {
      st.dir = 0; st.count = 0;
      return;
    }
    if (st.dir !== dirNow) {
      // Fresh press or direction flip: fire once immediately, arm the delay.
      st.dir = dirNow;
      st.count = REPEAT_DELAY_FRAMES;
      this._repeatDir[channel] = dirNow;
      fire();
      return;
    }
    // Still held: count down, then tick on a steady cadence.
    st.count--;
    if (st.count <= 0) {
      st.count = REPEAT_FRAMES;
      this._repeatDir[channel] = dirNow;
      fire();
    }
  },

  // --- Sandbox lifecycle ------------------------------------------------------

  _resetSandbox() {
    this._teardown();
    this._pools = { projectilePool: new Pool(Projectile, 64), specialPool: new Pool(Special, 16) };
    this._world = new CollisionWorld({ cellSize: 64 });
    // Flat floor solid so spawned enemies land and stick (resolve() against it),
    // mirroring the real engine's ctx.solids. Bombs use stepBombTerrain(GROUND_Y);
    // enemies use resolve() against this box — same shared collision path.
    this._floorSolid = { x: -200, y: GROUND_Y, w: VIEW_W + 400, h: 400 };
    this._attacker = { ...ATTACKER_HOME, alive: true, layer: LAYER.HERO, facing: 1, bodyKnockback: null };
    // The dummy is an ENEMY-side target (isEnemy() recognizes it via takeDamage)
    // but must NOT be the hero reference — otherwise foe-aligned blasts resolve
    // "target === hero" and skip it entirely. ctxHero() reads world.hero.
    this._target = { ...TARGET_POS, alive: true, hp: 999, layer: LAYER.ENEMY, hitFlash: 0 };
    // REAL damage pipeline (same as Enemy.takeDamage): central damage() +
    // white hit-flash. Blood sparkles are NOT spawned here — they belong to
    // the attack side (hitbox onHit / collision handlers), so the theater sees
    // them via the real path, not a theater-local hack.
    this._target.takeDamage = (amt, source, method = 'melee') => {
      const dealt = damage(source ?? this._attacker, this._target, amt, method);
      if (dealt > 0) flashTarget(this._target);
      return dealt;
    };
    this._world.add(this._attacker);
    this._world.add(this._target);
    // Sandbox hit routing: the real game registers gameplay handlers on its
    // CollisionWorld (combat/collisionHandlers.js) — but those need the live
    // hero/boss/zone. The sandbox mirrors ONLY the PROJ_ALLY×ENEMY branch on
    // its OWN world instance: damage via the target's takeDamage() (real Enemy
    // pipeline or the placeholder shim above), _attackHit flag for lifecycle
    // bridging, sparkles, consume + special detonation. Primitives register
    // their shots with ctx.collisionWorld (this world) at spawn, so update()
    // below dispatches every pair through this handler instead of a manual
    // aabbOverlap loop.
    this._world.on('hit', (a, b) => {
      const proj = a.layer === LAYER.PROJ_ALLY ? a : (b.layer === LAYER.PROJ_ALLY ? b : null);
      if (!proj || !proj.friendly || !proj.alive) return;
      const target = proj === a ? b : a;
      if (target.layer !== LAYER.ENEMY && target.layer !== LAYER.BOSS) return;
      if (!target.alive || target.hp == null) return;
      // Entry-edge impact point for engine carriers (tunneling correction):
      // rewind the shot to where its leading face first touched the target,
      // and snap its rendered position there so it dies TOUCHING the face.
      proj._impactPoint = entryImpactPoint(proj, target.worldBox ? target.worldBox() : target);
      const dealt = typeof target.takeDamage === 'function'
        ? target.takeDamage(proj.damage ?? 10, this._attacker, 'projectile')
        : damage(this._attacker, target, proj.damage ?? 10, 'projectile');
      if (dealt > 0) {
        proj._attackHit = true; // stepBomb/stepProjectile read this to emit terminal events
        proj._dealt = dealt;    // transient bodies (boomerang/orbit) log it
        Effects.spawnHitSparkles(proj.x + proj.w / 2, proj.y + proj.h / 2, 6);
        this._log.unshift(`HIT ${dealt} dmg`);
      }
      proj.alive = false; // consumed on impact (matches gameplay behavior)
      if (isSpecialType(proj.type)) explodeSpecial(proj);
      if (typeof target.takeDamage !== 'function' && !target.alive) this._world.remove(target);
    });
    this._handles = [];
    // Bomb-family attacks (bomb, explosiveBomb, molotov, clusterBomb,
    // bombSpread, spawnSplit) run through the SAME host gameplay uses: it owns
    // root lifecycle + child-payload promotion. The context fn returns the
    // sandbox's LIVE context each frame (pools/targets change as staging runs),
    // mirroring systems/update.js's bombAttacks wiring.
    this._bombHost = new BombAttackHost(() => this._ctx());
    this._log = [];
    this._choreo = null;
    this._aimPoint = null;
    this._kamikaze = null;
    this._attackerVisible = true;
    // Spawned enemies (spawnSplit spawnType='enemy'): removed from the world
    // on replay/teardown so they don't leak into the next run.
    for (const e of this._spawnedEnemies ?? []) { try { this._world?.remove(e); } catch { /* noop */ } }
    this._spawnedEnemies = [];
    for (const v of this._stompVics ?? []) { try { this._world?.remove(v); } catch { /* noop */ } }
    this._stompVics = null;
    this._stompPlatforms = [];
    this._loadParams();
  },

  _teardown() {
    for (const h of this._handles) { try { h.cancel?.(); } catch { /* already done */ } }
    this._handles = [];
    // Bomb-family roots live in the host, not _handles — cancel them too so
    // their carrier entities die with the sandbox.
    if (this._bombHost) { try { this._bombHost.clear(); } catch { /* noop */ } }
    this._bombHost = null;
    if (this._pools) {
      for (const p of this._pools.projectilePool.activeItems) p.alive = false;
      for (const s of this._pools.specialPool.activeItems) s.alive = false;
      this._pools.projectilePool.active.length = 0;
      this._pools.specialPool.active.length = 0;
    }
    this._pools = null;
    this._world = null;
    this._attacker = null;
    this._target = null;
    this._stompVics = null;
    this._stompPlatforms = [];
    this._choreo = null;
  },

  _loadParams() {
    const id = this.currentId();
    const def = getPrimitive(id)?.params ?? getMacro(id)?.params ?? {};
    const preset = SANDBOX_PRESETS[id] ?? {};
    // User tweaks (adjustParam) are stored per-id in _tweaks and merged on top,
    // so they survive the per-replay rebuild without leaking demo mutations.
    this._params = { ...def, ...preset };
    // Dotted tweak keys (e.g. 'seg0.damage') apply to nested params; flat keys
    // spread as before.
    for (const [key, val] of Object.entries(this._tweaks?.[id] ?? {})) {
      if (key.includes('.')) {
        const parts = key.split('.');
        let obj = this._params;
        for (let i = 0; i < parts.length - 1; i++) obj = obj?.[parts[i]];
        if (obj) obj[parts[parts.length - 1]] = val;
      } else {
        this._params[key] = val;
      }
    }
  },

  // Sandbox context — same shape as gameplay's bombAttacks context
  // (systems/update.js): pools, collisionWorld, bombTerrainStepped, groundY,
  // platforms (tops only), world.targets. Differences are sandbox-specific:
  //   • hero: null — no live hero in the sandbox; foe-aligned blasts must NOT
  //     resolve "target === hero" against the dummy.
  //   • solids — flat floor box for enemy resolve(); gameplay derives its
  //     terrain from zone content instead of a single slab.
  //   • effects — spread copy + fireManual so telegraph demos can fire manual
  //     effect instances without touching the real facade's state.
  _ctx() {
    return makeContext(this._attacker, {
      world: { targets: [this._target, ...(this._stompVics ?? [])], hero: null },
      pools: this._pools,
      collisionWorld: this._world,
      effects: { ...Effects, fireManual },
      groundY: GROUND_Y,
      bombTerrainStepped: true,
      platforms: this._stompPlatforms ?? [],
      solids: [this._floorSolid],
    });
  },

  _replay() {
    // Additive attacks declare themselves via h.rearm (boomerang, orbit):
    // replaying with a live rearm-capable handle skips the full reset so the
    // new throw/ring joins the live one. Switching FROM another primitive
    // always gets a full reset — the check is "live handle of THIS id with
    // rearm()", never "which id is selected" (the index already moved by the
    // time we're here).
    const id0 = this.currentId();
    const additive = this._handles.some((h) => h.id === id0 && typeof h.rearm === 'function');
    if (!additive) {
      // Cancel handles BEFORE killing pool entities: a cancelled handle skips
      // stepping entirely, so a mid-flight carrier never gets the one extra
      // step where stepBomb() would see its corpse and fire a stray 'detonate'
      // (the "premature explosion on demo switch" wart — bombSpread's children
      // used to boom at their death points while roots vanished cleanly).
      for (const h of this._handles) { try { h.cancel?.(); } catch { /* already done */ } }
      this._handles = [];
      if (this._bombHost) { try { this._bombHost.clear(); } catch { /* noop */ } }
      for (const p of this._pools?.projectilePool.activeItems ?? []) p.alive = false;
      for (const s of this._pools?.specialPool.activeItems ?? []) s.alive = false;
      if (this._pools) {
        this._pools.projectilePool.active.length = 0;
        this._pools.specialPool.active.length = 0;
      }
      // Fresh VFX slate: drop the previous run's leftover sparkles/particles so
      // replays don't stack. (resetEffects only clears effect instances, not the
      // particle system — same distinction as close().)
      resetEffects();
      particles.reset();
      this._target.hp = 999;
      this._target.alive = true;
      // BOTH opponents reset home each replay — otherwise the target stays
      // stuck at wherever the last movement demo left it.
      this._target.x = TARGET_POS.x;
      this._target.y = TARGET_POS.y;
      // Dash Combo stages the attacker near the target (see _replay); every
      // OTHER demo starts from home — restore it here so switching back from
      // dashCombo doesn't leave the attacker parked mid-arena.
      if (id0 !== 'dashCombo') {
        this._attacker.x = ATTACKER_HOME.x;
        this._attacker.y = ATTACKER_HOME.y;
      }
      // Face the target again (charge/punch/kamikaze choreos flip facing).
      this._attacker.facing = 1;
      // Respawn the attacker body: vanish (spawnSplit) and kamikaze (bodyExplosion)
      // demos hide it for the whole run — every new run starts visible again.
      this._attackerVisible = true;
      this._kamikaze = null;
      // Drop stomp-demo victims + platform from the previous run.
      for (const v of this._stompVics ?? []) { try { this._world?.remove(v); } catch { /* noop */ } }
      this._stompVics = null;
      this._stompPlatforms = [];
      // Drop enemies spawned by the previous spawnSplit run (real world entities).
      for (const e of this._spawnedEnemies ?? []) { try { this._world?.remove(e); } catch { /* noop */ } }
      this._spawnedEnemies = [];
    }
    this._log = [];
    this._choreo = null;

    // --- Choreography: stage the scene so the attack is watchable -------------
    // Per-attack STAGING lives declaratively in theater-staging.js (STAGING):
    // each entry's setup() owns param overrides, entity positioning, and
    // victim/platform staging, and returns the choreo state object (or null).
    // All COMBAT behavior comes from the engine — the theater only stages.
    const id = this.currentId();
    if (!id) return;
    const stage = STAGING[id];
    this._choreo = stage?.setup(this) ?? null;
    // exists and supports rearm(), replay RE-ARMS it instead of re-invoking.
    // The primitive owns the semantics (cap, extra ring) — the host just asks.
    const live = this._handles.find((x) => x.id === id && typeof x.rearm === 'function');
    if (live) {
      const r = live.rearm();
      if (r?.spawned) this._log.unshift(`${id.toUpperCase()} +1 (alive ${r.alive ?? r.rings})`);
      else this._log.unshift(`${id.toUpperCase()} AT CAP`);
      return;
    }

    let h;
    try {
      // Choreographed attacks gate the actual invoke:
      //  - punch (melee): starts once the attacker is beside the target
      const gated = this._choreo?.kind === 'punch' || this._choreo?.kind === 'kamikaze';
      if (!gated) {
        // Bomb-family attacks spawn through the shared BombAttackHost (same as
        // gameplay): it owns root lifecycle + child-payload promotion. Every
        // OTHER attack is a single raw invoke — macros own their composition
        // (homingMissile = projectile + steering, predictiveShot = aim math +
        // projectile, spreadShot = fan + projectiles, bodyExplosion = payload
        // + death); the theater only stages the scene and passes params.
        h = BOMB_FAMILY.has(id)
          ? this._bombHost.spawn(id, { ...this._params, target: this._target }, this._attacker)
          : invoke(id, { ...this._params, target: this._target }, this._ctx());
        if (id === 'spawnSplit') {
          // Dumb host follow-up: the spawnSplit MACRO owns all materialization
          // (fan → live projectiles/bombs/enemies + launch velocity + hitstun).
          // The theater only registers the returned enemy entities with its
          // sandbox world and steps their AI each frame — that per-frame enemy
          // AI is the game loop's job, never the engine's.
          for (const e of h.enemies ?? []) {
            this._spawnedEnemies.push(e);
            this._world.add(e);
          }
          const st = this._params.spawnType;
          this._log.unshift(`split → ${h.children?.length ?? 0} ${st === 'bomb' ? 'bombs' : st === 'enemy' ? 'enemies' : 'shots'}`);
        } else if (id === 'predictiveShot') {
          this._log.unshift(`intercept → flight ${h.flightTime != null ? Math.round(h.flightTime * 1000) + 'ms' : '∅'}`);
        }
      }
    } catch (err) {
      this._log.push(`ERROR: ${err.message}`);
      return;
    }
    if (!h) return;
    h.on('hit', (info) => {
      this._log.unshift(`HIT ${info.dealt ?? ''} dmg`.trim());
    });
    h.on('detonate', () => this._log.unshift('DETONATE'));
    h.on('expire', () => this._log.unshift('EXPIRE'));
    h.on('complete', () => this._log.unshift('COMPLETE'));
    this._handles.push(h);
    if (h.entity == null && !h.step && h.state == null) {
      this._log.unshift(`${id} finished (synchronous)`);
    }
  },

  /** Advance the sandbox one fixed step. Called from update() while active. */
  update(dt) {
    if (!this.active || !this._pools) return;
    this._acc = (this._acc ?? 0) + dt;
    let steps = 0;
    while (this._acc >= DT && steps < 4) {
      this._acc -= DT;
      steps++;
      this._stepOnce();
    }
  },

  _stepOnce() {
    const { projectilePool, specialPool } = this._pools;
    // Input repeat ticks at FIXED-step rate (exactly 60Hz) so the debounce
    // cadence is even — calling it here, not in update(), keeps it locked to
    // the simulation clock instead of the variable rAF delta.
    this.updateGamepad();
    if (!this._target) return; // close() was called — stop stepping
    updateEffects(DT);   // advance effect instances (beams, flashes...)
    particles.updateAll(DT); // advance hit-sparkles / explosion debris —
                             // WITHOUT this they spawn frozen at full alpha
                             // and never fly/fade (main loop does this in barrelSync)

    // --- Choreography (moves the attacker to stage the attack) ----------------
    // Per-attack movement demos + gated invokes live in theater-staging.js.
    // The choreo state carries its own stage entry (c.stage), so dispatch is a
    // single lookup — returning true completes the choreo and clears it.
    const c = this._choreo;
    if (c?.stage?.update && c.stage.update(this, c, DT)) {
      this._choreo = null;
    }

    // Collision pass BEFORE pool cleanup: the 'hit' handler marks shots dead +
    // _attackHit; updateAll() then drops them from active, and the handle step
    // below reads _attackHit to emit terminal events. (Gameplay orders it the
    // same way — integrate → world.update() → pool cleanup.)
    this._world?.update();

    projectilePool.updateAll(DT);
    specialPool.updateAll(DT);

    // Spawned enemies (spawnSplit spawnType='enemy'): run their real update each
    // frame. Enemy.update() drives ai() + gravity + integration internally and
    // honors hit-stun (skips ai() while stunned), so a launched enemy's fan
    // velocity integrates freely during its arc — same as knockback in gameplay.
    // Do NOT call e.ai() separately: it bypasses the stun guard and stomps vx.
    for (const e of this._spawnedEnemies ?? []) {
      if (!e.alive) continue;
      // The attacker fires the split, so its spawned minions hunt the TARGET
      // (the opposing side), not the attacker. Enemy AI takes the hero/chase
      // reference as a param — the caller (us) decides who they chase.
      e.update?.(DT, this._target, this._world);
      // Ground resolution: same shared resolve() the real engine uses. Gravity
      // is integrated inside e.update(); this snaps the body onto the floor so
      // it lands and sticks instead of falling off-screen. Flyers skip.
      if (e.gravity > 0) resolve(e, [this._floorSolid]);
    }
    // Off-screen cull (sandbox bounds instead of level zone).
    for (const p of [...projectilePool.activeItems, ...specialPool.activeItems]) {
      if (p.x + p.w < -40 || p.x > VIEW_W + 40 || p.y + p.h < -40 || p.y > VIEW_H + 40) p.alive = false;
    }
    // Projectile terrain stop: solidBehavior 'stop' shots die on floor/platform
    // contact (same rule as collisionHandlers.js in gameplay). The sandbox has
    // a flat floor + optional stomp platforms; check both.
    const solids = [this._floorSolid, ...(this._stompPlatforms ?? [])];
    for (const p of [...projectilePool.activeItems, ...specialPool.activeItems]) {
      if (!p.alive || p.solidBehavior !== 'stop') continue;
      for (const s of solids) {
        if (p.x + p.w > s.x && p.x < s.x + s.w &&
            p.y + p.h > s.y && p.y + p.h < s.y + 12) {
          p._attackHit = true;
          p._impactPoint = { x: p.x + p.w / 2, y: s.y };
          p.alive = false;
          break;
        }
      }
    }

    // --- Sandbox hit detection -------------------------------------------------
    // Routed through the CollisionWorld above: primitives register their shots
    // with ctx.collisionWorld at spawn, and the 'hit' handler registered in
    // _resetSandbox() mirrors the gameplay PROJ_ALLY×ENEMY branch (damage via
    // the target's takeDamage(), _attackHit flag for lifecycle bridging,
    // sparkles, consume + special detonation). update() below dispatches every
    // pair — no theater-local aabbOverlap loop.
    //
    // Explosive carriers are NOT excluded from this check: they detonate ON
    // CONTACT with the target (real hitbox behavior). The _attackHit flag makes
    // stepBomb/stepProjectile emit their terminal event, which fires the blast
    // at the impact point via the explosion primitive — same as gameplay.

    // Bomb terrain: the ENGINE owns bounce/settle/detonate (stepBombTerrain) —
    // same rules + numbers as gameplay. The sandbox just supplies the flat
    // ground line; the host's step() below detonates settled bombs and promotes
    // child payloads. This IS the gameplay external-stepping pattern
    // (systems/update.js): pool.updateAll → stepBombTerrain per entity →
    // bombAttacks.step(dt).
    for (const s of specialPool.items) {
      if (s._attackId !== 'bomb' || s._attackDone) continue;
      stepBombTerrain(s, DT, GROUND_Y);
    }

    // Bomb-family roots: stepped through the shared host (same as gameplay).
    // The host steps root lifecycle + deferred children (fireArea zones, split
    // bombs) and drops completed roots from its own set — no theater branches.
    this._bombHost?.step(DT);

    // Step each live handle's entity.
    for (let i = this._handles.length - 1; i >= 0; i--) {
      const h = this._handles[i];
      let finished = false;
      if (h.id === 'meleeHitbox' && typeof h.step === 'function') {
        finished = h.step([this._target]);
      } else if (h.id === 'reticleShot') {
        // Dumb host: the macro owns track → lock → fire. The shot handle may
        // be a plain projectile (blastType=plain) OR a carrier macro
        // (explosiveProjectile/napalm/shockwaveProjectile). For carrier
        // macros the entity lives at h.shot.inner.entity and the macro's
        // .step() drives the carrier + payload. Step both correctly.
        finished = h.step(DT);
        const shot = h.shot;
        if (shot) {
          // Carrier macros (explosiveProjectile, napalm, shockwaveProjectile)
          // own their sequence via .step() — this drives the carrier flight
          // AND the detonation payload.
          if (typeof shot.step === 'function' && shot.id !== 'projectile') {
            finished = shot.step(DT, [this._target]) || finished;
          } else if (shot.entity) {
            // Plain projectile: step the entity directly.
            finished = stepProjectile(shot.entity, shot) || finished;
          }
        }
      } else if (h.id === 'targetedBeam' || h.id === 'sweepingBeam') {
        // Beam macros: step the macro which internally steps its beam phase(s).
        finished = h.step(DT, [this._target]);
      } else if (h.entity) {
        if (h.id === 'projectile') finished = stepProjectile(h.entity, h);
        else if (typeof h.step === 'function') {
          // Step-based primitives (homingMissile, beam, fireArea, spike, etc.)
          // all expose a unified .step(dt, targets).
          finished = h.step(DT, [this._target]);
        }
      } else if (typeof h.step === 'function') {
        // Multi-shot macros (spreadShot/radialShot/burstShot): the macro's
        // step() drives its launch cadence AND owns completion (true only
        // when all shots are launched AND dead). Child flights are stepped
        // for TTL/cull/hit resolution, but their return value is IGNORED —
        // a dying bullet while later shots are pending must not end the macro.
        if (h.id === 'spreadShot' || h.id === 'radialShot' || h.id === 'burstShot') {
          finished = h.step(DT);
          for (const ch of h.handles ?? []) {
            if (ch.entity) stepProjectile(ch.entity, ch);
          }
        } else if (h.id === 'beam' || h.id === 'fireArea' || h.id === 'spike' || h.id === 'dustZone') {
          finished = h.step(DT, [this._target]);
        } else if (h.id === 'stomp' || h.id === 'stompWave' || h.id === 'surfaceWave' || h.id === 'shockwaveProjectile' || h.id === 'shockwaveBomb') {
          // Stomp family + shockwave projectile: the macro owns its sequence
          // (telegraph → beat → ring); pass every live victim as candidates.
          // The macro's _complete guard holds it open during the pending beat
          // so the host keeps stepping it (the ring fires mid-sequence).
          const vics = [this._target, ...(this._stompVics ?? [])].filter((v) => v?.alive);
          finished = h.step(DT, vics);
        } else if (h.id === 'skyMissile') {
          // Sky Missile: the macro owns warning → drop; its payload macro
          // (explosiveProjectile/napalm/shockwaveProjectile) is stepped
          // INTERNALLY and also promoted into h.handles for zone drawing.
          // Do NOT step h.handles here — that would double-step the carrier.
          finished = h.step(DT, [this._target]);
        } else if (h.id === 'missileRain') {
          // Missile Rain: the macro owns launch burst → per-missile activation;
          // each child skyMissile is stepped internally.
          finished = h.step(DT, [this._target]);
        } else if (h.id === 'dashCombo') {
          // Dash Combo: the macro owns the whole timeline (move/freeze per
          // segment, shove, afterimage) AND applies its freeze-hitbox knockback
          // through the shared applyKnockback() path inside its own processHitboxes
          // onHit callback — same routing gameplay uses. Nothing to do here.
          finished = h.step(DT, [this._target]);
        } else if (h.id === 'boomerang') {
          finished = h.step(DT);
          // Contact via the sandbox CollisionWorld: each live boomerang body is
          // a transient PROJ_ALLY entity, so the shared 'hit' handler (same as
          // gameplay's PROJ_ALLY×ENEMY branch) resolves damage + flash. The
          // handler kills the transient on impact; we clear it here and log the
          // melee hit. No theater-local AABB math.
          for (const s of h.states ?? []) {
            if (!s || s.done || !this._target?.alive) continue;
            const body = { x: s.x - 8, y: s.y - 8, w: 16, h: 16, alive: true,
              layer: LAYER.PROJ_ALLY, friendly: true, damage: this._params.damage ?? 12 };
            this._world.add(body);
            this._world.update();
            this._world.remove(body);
            if (body._attackHit) this._log.unshift(`BOOMERANG HIT ${body._dealt ?? ''} dmg`.trim());
          }
        } else if (h.id === 'orbit') {
          finished = h.step(DT);
          // Contact via the sandbox CollisionWorld: each live satellite is a
          // transient PROJ_ALLY entity resolved by the shared 'hit' handler.
          // One hit per ring per frame is enough for the sandbox.
          for (const st of h._rings ?? [h.state]) {
            if (st.done || !this._target?.alive) continue;
            let ringHit = false;
            for (const e of st.entities ?? []) {
              if (ringHit) break;
              const body = { x: e.x - 6, y: e.y - 6, w: 12, h: 12, alive: true,
                layer: LAYER.PROJ_ALLY, friendly: true, damage: this._params.damage ?? 10 };
              this._world.add(body);
              this._world.update();
              this._world.remove(body);
              if (body._attackHit) { ringHit = true; this._log.unshift(`ORBIT HIT ${body._dealt ?? ''} dmg`.trim()); }
            }
          }
        } else if (h.id === 'charge') {
          finished = h.step(DT);
        } else {
          finished = h.step(DT);
        }
      }
      if (finished) this._handles.splice(i, 1);
    }

    // Target bookkeeping.
    if (this._target.hitFlash > 0) this._target.hitFlash -= DT;
    // Dash Combo: the macro seeds/shoves the dummy's vx but the sandbox has no
    // physics integrator — integrate it here so the shove + finisher launch
    // are VISIBLE (the target slides during move phases, flies on the last
    // freeze). Friction keeps it from drifting forever after the run.
    let dashLive = null;
    for (const h of this._handles) {
      if (h.id === 'dashCombo') { dashLive = h; break; }
    }
    if (dashLive) {
      // Integrate BOTH bodies while the combo runs AND briefly after (the
      // finisher launch velocity is seeded on release — let it play out).
      const t = this._target;
      t.x += (t.vx ?? 0) * DT;
      if ((t.vx ?? 0) !== 0) t.vx *= 0.9;
      const a = this._attacker;
      // Attacker: only integrate when NOT mid-move-phase (the macro owns a.x
      // directly during move/freeze; integrating would double-step it).
      if (dashLive.state?.done || dashLive.state?.phase === 'recovery') {
        a.x += (a.vx ?? 0) * DT;
        if ((a.vx ?? 0) !== 0) a.vx *= 0.85;
      }
      // Keep both bodies in view so the launch is watchable, not a fly-off.
      t.x = Math.max(-40, Math.min(VIEW_W - t.w + 40, t.x));
      a.x = Math.max(-40, Math.min(VIEW_W - a.w + 40, a.x));
    }
    for (const v of this._stompVics ?? []) {
      // Real Enemy: update() owns hitFlash decay + the death pipeline
      // (aiState='dead' → shrink/fade over 0.75s → alive=false). The base
      // ai() is a no-op, so passing null as the chase reference is safe.
      v.update(DT, null, this._world);
      // Staged victims stand on their own surface (floor or platform) — snap
      // them back after gravity integration, same resolve() pattern the
      // spawned-enemy block uses. Without this they'd sink through the floor.
      // Platforms are one-way tops with a THICKNESS: resolve()'s spawn-inside
      // rule (stuckInside) needs prevBottom within [top, top+h] to snap a
      // victim that tunneled past the face in one frame. A zero-height box
      // makes stuckInside impossible → fast falls tunnel through. h: 8 matches
      // the drawn platform thickness.
      if (v.gravity > 0 && v.alive) {
        const solids = [this._floorSolid];
        for (const p of this._stompPlatforms ?? []) solids.push({ ...p, h: 8, oneWay: true });
        resolve(v, solids);
      }
      if (!v.alive && !v._downLogged) { v._downLogged = true; this._log.unshift('VICTIM DOWN'); }
    }
    if (this._target.hp <= 0) {
      this._target.alive = false;
      this._log.unshift('TARGET DOWN');
    }
  },

  // --- Rendering ----------------------------------------------------------------

  draw(ctx, w, h) {
    if (!this.active) return;
    ctx.save();
    // Camera shake: gameplay applies getShakeOffset() to the camera translate
    // (render.js). The theater's arena is static, so apply it here as a canvas
    // offset around the whole demo pass — same engine read, no duplicate math.
    const sh = Effects.getShakeOffset();
    if (sh.x !== 0 || sh.y !== 0) ctx.translate(sh.x, sh.y);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    const panelW = 280;
    const panelX = w - panelW;
    const demoW = panelX - 20;

    // Title.
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('ATTACK THEATER', demoW / 2, 44);

    const id = this.currentId();
    const meta = getPrimitive(id)?.meta ?? getMacro(id)?.meta;
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#f7d';
    ctx.fillText(meta?.name ?? id ?? '(none)', demoW / 2, 92);

    // --- Arena ------------------------------------------------------------------
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, GROUND_Y);
    ctx.lineTo(demoW - 40, GROUND_Y);
    ctx.stroke();

        const c = this._choreo;

    // Melee punch: a visible swing bar that sweeps out from the fist in sync
    // with the live hitbox frames (ease-out extension, quick retract). This is
    // what makes the invisible hitbox readable — imagine a fist extending.
    if (c?.kind === 'punch' && c.done && c.swingFrame < c.swingTotal) {
      const total = c.swingTotal || 10;
      const t = c.swingFrame / total;            // 0 → 1 across the swing
      const ext = t < 0.7 ? (t / 0.7) : (1 - (t - 0.7) / 0.3); // out then back
      const eased = 1 - Math.pow(1 - ext, 3);    // easeOutCubic
      const dir = this._attacker.facing >= 0 ? 1 : -1;
      const ax = this._attacker.x + this._attacker.w / 2;
      const ay = this._attacker.y + this._attacker.h * 0.45;
      const len = (this._params.w ?? 48) * eased;
      const thick = 10;
      // Swing trail (faded wedge behind the bar).
      ctx.fillStyle = `rgba(255,220,120,${0.18 * ext})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + dir * len, ay - 14);
      ctx.lineTo(ax + dir * len, ay + 14);
      ctx.closePath();
      ctx.fill();
      // The "fist" bar itself.
      ctx.fillStyle = `rgba(255,240,180,${0.5 + 0.5 * ext})`;
      ctx.fillRect(dir > 0 ? ax : ax - len, ay - thick / 2, len, thick);
      // Fist cap.
      ctx.fillStyle = '#fff';
      ctx.fillRect(ax + dir * len - 5, ay - 8, 10, 16);
    }

    // Elevated-shooter demos (reticleShot, targetedBeam, sweepingBeam,
    // predictiveShot, radialShot, burstShot): the attacker hovers on a small
    // platform — draw it so the staging reads as intentional. The choreo state
    // carries a FLAG (walkLeft/strafe) set by elevatedShooter(), not a kind.
    if ((c?.walkLeft || c?.strafe) && this._attacker) {
      ctx.fillStyle = '#445';
      ctx.fillRect(this._attacker.x - 16, this._attacker.y + this._attacker.h, this._attacker.w + 32, 8);
      ctx.fillStyle = '#667';
      ctx.fillRect(this._attacker.x - 16, this._attacker.y + this._attacker.h, this._attacker.w + 32, 3);
    }

    // Attacker (hidden during vanish/kamikaze demos — the body IS the attack).
    // Stomp-family handles lift the sprite by their visual hop offset.
    if (this._attacker && this._attackerVisible !== false) {
      let hopOff = 0;
      for (const h of this._handles) {
        if ((h.id === 'stomp' || h.id === 'stompWave') && h.state?.hopOffset > 0) hopOff = Math.max(hopOff, h.state.hopOffset);
      }
      const ay = this._attacker.y - hopOff;
      ctx.fillStyle = '#ff6ec7';
      ctx.fillRect(this._attacker.x, ay, this._attacker.w, this._attacker.h);
      // Facing wedge.
      ctx.fillStyle = '#fff';
      const fx = this._attacker.facing >= 0 ? this._attacker.x + this._attacker.w : this._attacker.x - 8;
      ctx.fillRect(fx, ay + this._attacker.h / 2 - 3, 8, 6);
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ATTACKER', this._attacker.x + this._attacker.w / 2, ay - 8);
    }

    // Stomp demo staging: every victim's platform (mid-air + high), drawn so
    // the staging reads as intentional — no enemy floats in empty sky.
    for (const plat of this._stompPlatforms ?? []) {
      ctx.fillStyle = '#445';
      ctx.fillRect(plat.x, plat.y, plat.w, 8);
      ctx.fillStyle = '#667';
      ctx.fillRect(plat.x, plat.y, plat.w, 3);
    }
    for (const v of this._stompVics ?? []) {
      if (!v.alive) continue;
      ctx.fillStyle = v.hitFlash > 0 ? '#fff' : (v.hp < 999 ? '#9f9' : '#6d6');
      ctx.fillRect(v.x, v.y, v.w, v.h);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`HP ${Math.max(0, Math.round(v.hp))}`, v.x + v.w / 2, v.y - 6);
    }

    // Orbit satellites (2D pulsing ring) — drawn after the attacker box.
    for (const h of this._handles) {
      if (h.id !== 'orbit') continue;
      for (const st of h._rings ?? [h.state]) {
        if (st.done) continue;
        for (const e of st.entities ?? []) {
          const sc = 1 + 0.3 * ((e.radius - (this._params.minRadius ?? 40)) / Math.max(1, (this._params.maxRadius ?? 90) - (this._params.minRadius ?? 40)));
          ctx.fillStyle = '#9feaff';
          ctx.save();
          ctx.translate(e.x, e.y);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-5 * sc, -5 * sc, 10 * sc, 10 * sc);
          ctx.restore();
        }
      }
    }

    // Boomerang bodies (spinning squares, phase-colored).
    for (const h of this._handles) {
      if (h.id !== 'boomerang' || h.states?.every((s) => s.done)) continue;
      for (const st of h.states ?? [h.state]) {
        if (st?.done) continue;
        ctx.fillStyle = st.phase === 'outbound' ? '#7fd' : '#fd7';
        ctx.save();
        ctx.translate(st.x, st.y);
        ctx.rotate(st.t * 10);
        ctx.fillRect(-7, -7, 14, 14);
        ctx.restore();
        ctx.fillStyle = '#fff';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(st.phase, st.x, st.y - 12);
      }
    }

    // Dummy target. A dead dummy (walkLeft one-shot hit) shows only a small
    // impact X where it died — the body is GONE until the run respawns it.
    if (this._target) {
      if (this._target.alive) {
        ctx.fillStyle = this._target.hitFlash > 0 ? '#fff' : '#6d6';
        ctx.fillRect(this._target.x, this._target.y, this._target.w, this._target.h);
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`HP ${Math.max(0, Math.round(this._target.hp))}`,
          this._target.x + this._target.w / 2, this._target.y - 8);
      } else {
        const dx = this._target.x + this._target.w / 2, dy = this._target.y + this._target.h / 2;
        ctx.strokeStyle = 'rgba(255,90,90,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(dx - 8, dy - 8); ctx.lineTo(dx + 8, dy + 8);
        ctx.moveTo(dx + 8, dy - 8); ctx.lineTo(dx - 8, dy + 8);
        ctx.stroke();
      }
    }

    // Live projectiles/specials.
    if (this._pools) {
      for (const p of this._pools.projectilePool.activeItems) {
        ctx.fillStyle = '#ff6ec7';
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
      for (const s of this._pools.specialPool.activeItems) {
        ctx.fillStyle = '#fa4';
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }
    }

    // Spawned enemies (spawnSplit spawnType='enemy').
    for (const e of this._spawnedEnemies ?? []) {
      if (!e.alive) continue;
      ctx.fillStyle = e.hitFlash > 0 ? '#fff' : '#e74c3c';
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = '#fff';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.max(0, Math.round(e.hp))}`, e.x + e.w / 2, e.y - 6);
    }

    // Deferred zones stay owned/stepped by their root macro, but draw here.
    // Bomb-family roots live in _bombHost; projectile-family carrier macros
    // (explosiveProjectile, napalm, shockwaveProjectile...) live in _handles —
    // both can own deferred zone children (napalm → fireArea).
    const drawChildren = (h) => {
      for (const child of h.handles ?? []) {
        if (child._completed || child._cancelled) continue;
        child.zone?.draw(ctx);
        drawChildren(child);
      }
    };
    for (const h of this._handles) drawChildren(h);
    for (const h of this._bombHost?.roots ?? []) drawChildren(h);

    // --- Wave-2 state visuals ---------------------------------------------------
    for (const h of this._handles) {
      const st = h.state;
      if (!st) continue;
      if (h.id === 'orbit' && (h._rings ?? [st]).some((r) => !r.done)) {
        // 2D pulsing ring: guide circle at the CURRENT pulse radius + one
        // satellite marker per entity.
        const ocx = this._attacker.x + this._attacker.w / 2, ocy = this._attacker.y + this._attacker.h / 2;
        for (const ring of h._rings ?? [st]) {
          if (ring.done) continue;
          const r = ring.entities?.[0]?.radius ?? (this._params.maxRadius ?? 90);
          ctx.strokeStyle = 'rgba(120,220,255,0.18)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(ocx, ocy, r, 0, Math.PI * 2);
          ctx.stroke();
          for (const e of ring.entities ?? []) {
            ctx.fillStyle = '#9feaff';
            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.rotate(Math.PI / 4);
            ctx.fillRect(-5, -5, 10, 10);
            ctx.restore();
          }
        }
      } else if (h.id === 'boomerang' && !(h.states?.every((s) => s.done))) {
        // Boomerang bodies are drawn in the arena pass above (spinning squares).
      } else if (h.id === 'stomp' && !st.done) {
        // Stomp: telegraph + impact juice are REAL effects fired by the macro.
        // Nothing to draw here — no theater-side circles or boxes.
      } else if ((h.id === 'stompWave' || h.id === 'surfaceWave') && !st.done) {
        // Surface wave: crest is the primitive's ground-wave effect. Nothing
        // to draw here either.
      } else if (h.id === 'dashCombo' && !st.done && st.phase === 'freeze' && st.hb?.box) {
        // Dash Combo debug aid: outline the CURRENT segment's hitbox during
        // its freeze window — makes the invisible active frames readable.
        const box = st.hb.box;
        ctx.strokeStyle = 'rgba(255,110,199,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.fillStyle = 'rgba(255,110,199,0.18)';
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.fillStyle = '#fff';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`seg${st.segmentIndex + 1} · ${st.frame ?? ''}`, box.x + box.w / 2, box.y - 6);
      } else if ((h.id === 'fireArea' || h.id === 'spike' || h.id === 'dustZone') && !st.done) {
        // HazardZone-backed primitives: delegate to the zone's own draw().
        if (h.zone) { h.zone.draw(ctx); }
        else if (h.id === 'spike' && st.phase === 'visible') {
          const sw = this._params.width;
          const box = { x: this._params.x - sw / 2, y: this._params.y - 8, w: sw, h: 16 };
          ctx.fillStyle = 'rgba(255,220,80,0.7)';
          ctx.fillRect(box.x, box.y, box.w, box.h);
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.strokeRect(box.x, box.y, box.w, box.h);
        }
      }
    }
    // (No aim-point marker for predictiveShot: the demo is pure "shoot where it
    // will be" — a crosshair would turn it into a reticle demo.)
    // Missile Rain launch burst: draw the rising rocket bodies (the macro's
    // trails are real effect instances; the rockets themselves are macro state).
    for (const h of this._handles) {
      if (h.id !== 'missileRain' || h.state?.done) continue;
      for (const r of h.state.rockets ?? []) {
        if (r.done) continue;
        ctx.fillStyle = '#fa4';
        ctx.fillRect(r.x - 3, r.y - 10, 6, 12);
        ctx.fillStyle = '#ff8';
        ctx.fillRect(r.x - 2, r.y + 2, 4, 5);
      }
    }

    // Kamikaze dummy (bodyExplosion demo victim at home position).
    if (this._kamikaze && this._kamikaze.alive !== false) {
      ctx.fillStyle = this._kamikaze?.alive ? '#c96' : '#444';
      ctx.fillRect(this._kamikaze.x, this._kamikaze.y, this._kamikaze.w, this._kamikaze.h);
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('KAMIKAZE', this._kamikaze.x + this._kamikaze.w / 2, this._kamikaze.y - 8);
    }

    // Event log.
    ctx.textAlign = 'left';
    ctx.font = '11px monospace';
    this._log.slice(0, 5).forEach((line, i) => {
      ctx.fillStyle = i === 0 ? '#fd6' : '#777';
      ctx.fillText(line, 48, GROUND_Y + 20 + i * 14);
    });

    // Index indicator.
    ctx.textAlign = 'center';
    ctx.fillStyle = '#888';
    ctx.font = '14px monospace';
    ctx.fillText(`${this.index + 1} / ${this.entries.length}`, demoW / 2, h - 40);

    // --- Right panel (full height) --------------------------------------------------
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(panelX, 8, panelW - 10, h - 16);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX, 8, panelW - 10, h - 16);

    let py = 30;
    ctx.textAlign = 'left';
    const bottomLimit = () => h - 36; // hint bar lives at h-16

    if (meta?.desc) {
      ctx.font = '12px monospace';
      ctx.fillStyle = '#aaa';
      let line = '';
      for (const word of meta.desc.split(' ')) {
        if ((line + word).length > 36) {
          ctx.fillText(line, panelX + 12, py); py += 15; line = word + ' ';
        } else line += word + ' ';
      }
      if (line) { ctx.fillText(line.trim(), panelX + 12, py); py += 15; }
    }
    py += 10;

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#f7d';
    ctx.fillText('PARAMS (▲▼ select · L2/R2 adjust)', panelX + 12, py);
    py += 18;
    ctx.font = '11px monospace';
    const tweakList = this._tweakList();
    // Render in NAVIGATION order (the TWEAKABLE array) so ↑/↓ matches what you
    // see. Non-tweakable params follow below, dimmed + read-only.
    const shown = new Set();
    const rows = [];
    for (const [key] of tweakList) { rows.push({ key, tweak: true }); shown.add(key); }
    // Collect the top-level parents of any dotted tweak keys (e.g. 'blast'
    // from 'blast.explosionRadius') so we don't ALSO render the whole object
    // as a redundant read-only row.
    const dottedParents = new Set(
      tweakList.map(([k]) => k.split('.')[0]).filter((p) => p !== undefined),
    );
    for (const key of Object.keys(this._params ?? {})) {
      if (!shown.has(key) && !dottedParents.has(key)) rows.push({ key, tweak: false });
    }
    for (const { key, tweak } of rows) {
      if (py > bottomLimit()) break;
      const tIdx = tweak ? tweakList.findIndex(([k]) => k === key) : -1;
      const selected = tIdx === this.paramIndex && tweakList.length > 0;
      ctx.fillStyle = selected ? '#fd6' : (tweak ? '#ccc' : '#666');
      // Dotted keys (e.g. 'blast.explosionRadius') resolve through the path —
      // same read as adjustParam's getVal(). A flat this._params[key] would
      // read undefined for nested params.
      const val = key.includes('.')
        ? key.split('.').reduce((o, k) => o?.[k], this._params)
        : this._params[key];
      const valStr = typeof val === 'number'
        ? ((key.includes('direction') || key.includes('angle')) ? angleLabel(val) : String(round2(val)))
        : (val && typeof val === 'object' ? JSON.stringify(val) : String(val));
      ctx.fillText(`${selected ? '▶' : '·'} ${key} = ${valStr}${tweak ? '' : '  (fixed)'}`, panelX + 12, py);
      py += 15;
    }

    // Invokes section (macros only): what this macro composes, straight from
    // its registration meta — no theater-side knowledge of compositions.
    // Invokes section (macros only): what this macro composes, resolved via
    // resolveInvokes() — the single source of truth; the theater renders
    // rows and knows nothing about registry internals.
    const invokes = resolveInvokes(id);
    if (invokes.length > 0) {
      py += 8;
      if (py <= bottomLimit()) {
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#f7d';
        ctx.fillText('INVOKES', panelX + 12, py);
        py += 15;
        ctx.font = '11px monospace';
        for (const inv of invokes) {
          if (py > bottomLimit()) break;
          ctx.fillStyle = '#9feaff';
          ctx.fillText(`→ ${inv.name}${inv.via ? ` (${inv.via})` : ''}`, panelX + 12, py);
          py += 14;
        }
      }
    }

    // Effects section: VFX this attack fires, resolved from registration meta
    // via resolveEffects() — macros list their native effects PLUS everything
    // their invoked attacks declare (dynamic composition, no duplication).
    // Effect display names resolve through the Effect Engine catalog.
    const effectRows = resolveEffects(id);
    if (effectRows.length > 0) {
      py += 8;
      if (py <= bottomLimit()) {
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#f7d';
        ctx.fillText('EFFECTS', panelX + 12, py);
        py += 15;
        ctx.font = '11px monospace';
        for (const fx of effectRows) {
          if (py > bottomLimit()) break;
          const catName = CATALOG.find((c) => c.type === fx.type)?.name ?? fx.type;
          ctx.fillStyle = '#b9f6ca';
          ctx.fillText(`✦ ${catName}${fx.via ? ` (${fx.via})` : ''}`, panelX + 12, py);
          py += 14;
        }
      }
    }

    // Hint bar — same nav-label lib as the menus (keyboard + pad glyphs).
    const leftR = [...navLabels('left', { simple: true }), ...navLabels('right', { simple: true })].join('/');
    const upDn = [...navLabels('up', { simple: true }), ...navLabels('down', { simple: true })].join('/');
    const confirmLabel = navLabelString('confirm');
    const backLabel = navLabelString('back');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#666';
    ctx.font = '12px monospace';
    const adjLbl = adjustLabels();
    ctx.fillText(`${leftR} select   ${upDn} param   ${adjLbl.down}/${adjLbl.up} adjust (L2/R2)   [${confirmLabel}] replay   [${backLabel}] close   F4`, demoW / 2, h - 16);

    ctx.restore();

    // Real effect-engine pass, mirroring the main render loop's three draws:
    // 1. particles (hit-sparkles, explosion debris) — world space
    // 2. effect instances (beams, flashes) — world space
    // 3. screen-space overlays (flash/vignette/shake)
    for (const p of particles.activeItems) p.draw(ctx);
    drawEffects(ctx, undefined, { space: 'world' });
    Effects.drawOverlay(ctx, VIEW_W, VIEW_H);
  },
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Read raw gamepad state for theater controls (L2/R2 have no nav mapping, so
 * we read the standard button indices directly — 6 = L2/LT/ZL, 7 = R2/RT/ZR
 * across PS/Xbox/Switch layouts). Returns zeros when no pad is connected.
 */
function padShoulders() {
  let l2 = false, r2 = false;
  try {
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      if (pad.buttons[6]?.pressed || (pad.buttons[6]?.value ?? 0) > 0.5) l2 = true;
      if (pad.buttons[7]?.pressed || (pad.buttons[7]?.value ?? 0) > 0.5) r2 = true;
    }
  } catch { /* no gamepad API (node tests) */ }
  return { l2, r2 };
}

/**
 * PURE INPUT-MAPPING controls: the adjust buttons are the user's OWN mapped
 * keys — lockDir (default I) decreases, lockMove (default O) increases — plus
 * L2/R2 on the pad. No hardcoded letters: if the user remaps I/O in Controls,
 * the theater follows automatically. Reads input.pressedBindings / heldBindings
 * (per-binding edge/held state) against input.mapping.
 */
function mappingAdjust() {
  const inp = typeof input !== 'undefined' ? input : null;
  const shoulders = typeof navigator !== 'undefined' ? padShoulders() : { l2: false, r2: false };
  let down = shoulders.l2, up = shoulders.r2;
  if (inp) {
    const pressed = new Set(inp.pressedBindings ?? []);
    const held = inp.heldBindings ?? new Map();
    const kb = inp.mapping?.keyboard ?? {};
    for (const b of kb.lockDir ?? []) {
      const k = `k:${b}`;
      if (pressed.has(k) || held.get(k)) down = true;
    }
    for (const b of kb.lockMove ?? []) {
      const k = `k:${b}`;
      if (pressed.has(k) || held.get(k)) up = true;
    }
    // Gamepad side of those actions too (if the user bound a pad button).
    const gp = inp.mapping?.gamepad ?? {};
    for (const b of gp.lockDir ?? []) if (pressed.has(`g:${b}`) || held.get(`g:${b}`)) down = true;
    for (const b of gp.lockMove ?? []) if (pressed.has(`g:${b}`) || held.get(`g:${b}`)) up = true;
  }
  return { down, up };
}

/**
 * Keyboard arrow state for the theater's repeat system. The keydown handler
 * (debugHarness) only reports EDGES (press/release); this polls input.heldKeys
 * each frame so held arrows feed the same _repeat() cadence as the pad — no
 * browser auto-repeat racing through the list.
 */
function keyboardDir() {
  const inp = typeof input !== 'undefined' ? input : null;
  if (!inp) return { x: 0, y: 0 };
  const held = new Set(inp.heldKeys ?? []);
  const left = held.has('ArrowLeft') || held.has('KeyA');
  const right = held.has('ArrowRight') || held.has('KeyD');
  const up = held.has('ArrowUp') || held.has('KeyW');
  const down = held.has('ArrowDown') || held.has('KeyS');
  return {
    x: left && !right ? -1 : right && !left ? 1 : 0,
    y: up && !down ? -1 : down && !up ? 1 : 0,
  };
}

/** Labels for the hint bar from the live mapping (e.g. "I/O"). */
function adjustLabels() {
  const kb = input?.mapping?.keyboard ?? {};
  const fmt = (list) => (list ?? []).map((b) => b.replace(/^Key/, '')).join('/') || '?';
  return { down: fmt(kb.lockDir), up: fmt(kb.lockMove) };
}
/** Raw gamepad confirm (btn 0) — polled per frame for the REPLAY action. */
function padConfirm() {
  try {
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      if (pad.buttons[0]?.pressed || (pad.buttons[0]?.value ?? 0) > 0.5) return true;
    }
  } catch { /* no gamepad API (node tests) */ }
  return false;
}

/** Thin indirection so the gamepad code reads cleanly + stays testable. */
function inputState() {
  // Imported lazily to avoid a module-load cycle (input.js ← debugHarness).
  if (!inputState._ref) {
    import('../core/input.js').then((m) => { inputState._ref = m.input; });
  }
  const inp = inputState._ref;
  const shoulders = typeof navigator !== 'undefined' ? padShoulders() : { l2: false, r2: false };
  if (!inp) return { moveX: 0, moveY: 0, ...shoulders, navPressed: [], padConfirm: false };
  return {
    moveX: inp.state.moveX ?? 0,
    moveY: inp.state.moveY ?? 0,
    ...shoulders,
    navPressed: inp.nav.pressed ?? [],
    padConfirm: padConfirm(),
  };
}
