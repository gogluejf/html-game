// Petal Panic — explosion-burst effect (migrated from the pre-refactor
// monolith, js/effects.js `Effects.spawnExplosion`; reference:
// .squid-os/plans/effect-engine/effect-reference.txt). Barrel/bomb blast VFX
// (design §12 "multiple random bomb-explosion frames scaled to the collision-box
// area"): warm-colored particles scaled to the AoE radius. Pair with the
// screen-flash type for the white overlay.
//
// One-shot burst: all particles spawned at fire time into the shared pool;
// done immediately.
//
// params: { x, y, radius? } — radius defaults to 60px.
// Count formula (unchanged): min(24, 12 + round(radius * 0.15));
// speeds 120..(120 + radius * 1.5) px/s; colors cycle FIRE_COLORS by index.

import { particles } from '../particles.js';
import { FIRE_COLORS } from './palettes.js';

const EXPLOSION_MIN = 12;        // min particles for an explosion blast
const EXPLOSION_PER_PX = 0.15;   // extra particles per px of radius
const EXPLOSION_BASE_SPEED = 120;   // base particle speed (px/s) at zero radius
const EXPLOSION_SPEED_PER_PX = 1.5; // added speed spread per px of radius

/**
 * @param {{x:number, y:number, radius?:number}} params
 * @returns {{update:Function, render:Function, done:boolean}}
 */
export function explosion(params = {}) {
  const { x, y, radius = 60 } = params;
  const count = Math.min(24, EXPLOSION_MIN + Math.round(radius * EXPLOSION_PER_PX));
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = EXPLOSION_BASE_SPEED + Math.random() * (radius * EXPLOSION_SPEED_PER_PX);
    const color = FIRE_COLORS[i % FIRE_COLORS.length];
    particles.spawnOne(x, y, color, speed, angle);
  }
  return { update() {}, render() {}, done: true };
}
