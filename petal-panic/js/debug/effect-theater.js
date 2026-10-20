// Petal Panic — Effect Theater (F2).
// Content provider for the shared theater engine (theater-engine.js).
// Steps through every registered effect in catalog order, runs each demo with
// live params, and supports param tweaking via the standard controls.

import { theaterList, makeDemo } from './effect-theater-scenes.js';
import { resetEffects, DEMO_VIEW } from '../effects/index.js';
import { particles } from '../effects/particles.js';
import { EFFECT_META } from './effect-theater-meta.js';
import { createTheater } from './theater-engine.js';

const list = theaterList();
export const THEATER_V = 5;

/** Per-param nudge step for numeric values. */
const STEP_BY_KEY = {
  duration: 0.1, buildTime: 0.1, gapTime: 0.1, blinkTime: 0.1, timeToTarget: 0.1,
  radius: 4, minRadius: 4, maxRadius: 4, size: 2, width: 4, length: 20, height: 4,
  x: 8, y: 8, offset: 4, count: 1, fragmentCount: 2, particleCount: 2, explosionCount: 1,
  speed: 20, velocity: 20, expansionSpeed: 20, fallSpeed: 20, descentSpeed: 20,
  intensity: 0.5, strength: 0.1, opacity: 0.05, amount: 0.5, scale: 0.05,
  pulseRate: 0.5, rotationSpeed: 0.5, sweepSpeed: 0.5, spinSpeed: 0.5,
  tickRate: 1, spawnInterval: 0.05, lifetime: 0.1, fadeIn: 0.05, fadeOut: 0.05,
  holdTime: 0.05, flashInTime: 0.05, fadeOutTime: 0.05, angle: 5 * Math.PI / 180,
};

// Internal state not owned by the engine.
let clock = -0.5;
const tweaks = {};

function liveParams(index) {
  const entry = list[index];
  if (!entry) return null;
  return { ...entry.params, ...(tweaks[entry.type] ?? {}) };
}

export const Theater = createTheater({
  id: 'effect',
  title: 'EFFECT THEATER',
  stamp: `v${THEATER_V}`,
  toggleKey: 'F2',
  panelW: 240,
  stepByKey: STEP_BY_KEY,

  entries: () => list,

  currentMeta(index) {
    const entry = list[index];
    const meta = EFFECT_META[entry?.type];
    if (!meta) return null;
    return { name: `${entry.section}. ${entry.name}`, desc: meta.desc, params: meta.params };
  },

  liveParams,

  setParam(index, key, value) {
    const entry = list[index];
    if (!entry) return;
    tweaks[entry.type] = { ...(tweaks[entry.type] ?? {}), [key]: value };
    // No auto-replay: the user triggers the demo explicitly via confirm/replay.
  },

  drawDemo(ctx, demoW, h, theater) {
    ctx.save();
    ctx.translate((demoW - DEMO_VIEW.w) / 2, (h - DEMO_VIEW.h) / 2);
    const entry = list[theater.index];
    const live = { ...entry, params: liveParams(theater.index) };
    makeDemo(live)(ctx, clock);
    ctx.restore();
  },

  onOpen() {
    clock = -0.5;
    resetEffects();
  },

  onClose() {
    resetEffects();
    particles.reset();
  },

  onStep() {
    clock = -0.5; // pre-roll delay when switching effects
  },

  onReplay() {
    clock = 0; // instant restart — no delay when hitting replay
  },

  onTick(dt) {
    clock += dt;
  },
});

// Expose internal state for tests + external access.
Object.defineProperties(Theater, {
  clock: { get: () => clock, set: (v) => { clock = v; } },
  tweaks: { get: () => tweaks },
  current: { value: function() { return list[this.index]; } },
});
