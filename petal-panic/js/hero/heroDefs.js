// Petal Panic — hero stat definitions (design §5).
// Two selectable heroes; same base struct, different stats + special.
// `stats` feed physics/feel: speed (X-units/s), jump (impulse, Y-units/s),
// stamina (energy), projectile_freq (default-weapon fire rate), attack/defense/weight.
// UNIT-NATIVE (pixel-hardcode-audit.md Tier 2): declared in logical units and
// converted to px ONCE at Hero construction via UNIT_PX_* — changing the unit
// size rescales movement/jump with no other edits.
//
// `attacks` is the declarative per-attack knockback table (design §30):
// damage BOXES are sheet-authored only (per-frame `attack` boxes on each
// hero's melee / super_melee / supermove sheets — see
// Hero.attackHitboxWorld()); this table carries the two-tier knockback
// vectors each attack applies at impact.
//   specialMelee.hitbox — legacy fallback geometry; unused by the resolver
//                       (sheet boxes win) but kept as the tuning surface for
//                       heroes whose super_melee sheet lacks authored boxes.
//
// Knockback (docs/architecture/knockback.md §11): committed attacks carry a
// `knockback` setting on their hitbox data; the core wiring reads it off the
// hitbox at impact (hb.knockback) and routes to applyKnockback(). Non-committed
// attacks (normal melee, thorn/special projectiles) carry NO knockback field —
// presence of the data is the only gate. Values are starting points tuned in 2.3.

import { UNIT_PX_X, UNIT_PX_Y } from '../consts.js';

export const ATTACK_MELEE = 'melee';
export const ATTACK_SPECIAL_MELEE = 'specialMelee';
export const ATTACK_SUPERMOVE = 'supermove';

/**
 * Convert a hero def's unit-native stats to px. Single conversion point —
 * used by Hero constructor AND debug swapHero so they can never drift.
 */
export function resolveHeroStats(def) {
  return { ...def.stats, speed: def.stats.speed * UNIT_PX_X, jump: def.stats.jump * UNIT_PX_Y };
}

/**
 * Normal-melee knockback tiers. A SURVIVING hit uses `moderate` (keeps the
 * victim in reach for follow-ups); a KILLING hit or the swing's finisher uses
 * `big` (launches them away on death). dirMode 'fromAttacker' orients per
 * impact in hitbox.js. Vector = px/s along the push direction.
 */
const MELEE_KNOCKBACK_MODERATE = { x: 450, y: -120, hitstun: 0.40, dirMode: 'fromAttacker' };
const MELEE_KNOCKBACK_BIG = { x: 750, y: -260, hitstun: 0.45, dirMode: 'fromAttacker' };

/**
 * Shared supermove knockback tiers (knockback.md §11). The damage BOX is
 * sheet-authored only (per-frame `attack` boxes on the supermove sheet).
 *   - `big`     = the finisher / killing launch: strong shove along the dash
 *                 + big loft. The strongest of the three committed attacks.
 *   - `moderate`= SUPERMOVE_BURST_KNOCKBACK (below): reposition without
 *                 clearing the next burst's box.
 */
const SUPERMOVE_KNOCKBACK_BIG = { x: 850, y: -260, hitstun: 0.30, dirMode: 'alongVelocity' };

/**
 * Supermove BURST knockback: the moderate shove carried by every keyframe
 * contact window EXCEPT the last/killer (see Hero._supermoveBurstKnockback).
 * Tuned to reposition without clearing the next burst's box — a victim shoved
 * ~50px stays inside the following keyframe's reach so the dash can connect
 * again. Small hop: enough air time to read as a clean "thwack", not a launch.
 */
export const SUPERMOVE_BURST_KNOCKBACK = { x: 300, y: -120, hitstun: 0.30, dirMode: 'fromAttacker' };

/** Hit-stop (fixed frames) per supermove contact tier — SF2-style impact
 * freeze, applied by applyHit ONLY when the hit connects (context.hitstop).
 * Bursts: a real pause that lets the fist pose land, without stuttering the
 * dash. Finisher: the heavy-hit beat — world stops, then the launch flies. */
export const SUPERMOVE_BURST_HITSTOP = 4;    // ~66ms
export const SUPERMOVE_FINISHER_HITSTOP = 8; // ~133ms

/** Sheet frames with durUnits >= this are supermove CONTACT keyframes;
 * shorter frames between them deal nothing (box visible in debug only). */
export const SUPERMOVE_HIT_DUR_UNITS = 3;

/**
 * §15 Special melee (Down+Melee): the ADVANCING LEG SWEEP — one shared attack
 * for both heroes (unified; no per-hero branches). Travels TOWARD facing; the
 * sprite plays the per-hero `super_melee` sheet while the trajectory commits.
 * Shallow-spread per hero below so runtime code can never alias/mutate a
 * shared config object.
 */
const SWEEP = {
  direction: 1,          // +1 = toward facing (advancing sweep, both heroes)
  travelSpeed: 300 / UNIT_PX_X, // X-units/s self-supplied horizontal movement (exactly 300 px/s at the current grid)
  // Timing is SHEET-OWNED: one full cycle of the per-hero `super_melee` sheet
  // at its authored fps. The active window is the set of sheet frames carrying
  // an authored `attack` box (Hero._specialMeleePhaseAt); windup/recovery are
  // the unboxed frames before/after it. Tune speed by editing the sheet's fps.
  hitbox: { ox: 9, oy: 8.5, bw: 36, bh: 35 },     // leg sweep: in front, ~2/3 body height at ground level, offset back over the body — FALLBACK for sheets without authored boxes
  // Knockback (knockback.md §11): aggressive forward pushback in the lunge
  // direction — clears the path ahead of the advancing sweep. `fixed` mode:
  // x is signed at impact toward the sweep's travel direction (hero.js), so
  // the shove always points where the sweep is going, mirrored for left-facing
  // lunges. Vector = px/s along the lunge + upward hop.
  // `moderate` = surviving hit (stays in reach); `big` = killing hit / finisher
  // (launches them away).
  knockbackModerate: { x: 550, y: -180, hitstun: 0.45, dirMode: 'fixed' },
  knockbackBig: { x: 750, y: -330, hitstun: 0.50, dirMode: 'fixed' },
};

export const HEROES = {
  scarlet: {
    id: 'scarlet',
    name: 'Scarlet Vale',
    specialName: 'Ribbon Storm',
    targetH: 1.9,                // Y-units (1.9 = 91.2px); width is sheet-owned
    stats: {
      weight: 1,
      speed: 312 / UNIT_PX_X,  // X-units/s (exactly 312 px/s at the current grid; 250 original × 1.25)
      attack: 10,
      defense: 2,
      stamina: 100,
      jump: 639 / UNIT_PX_Y,   // Y-units/s impulse (exactly 639 px/s — ~109px apex ≈ 1.2× body)
      projectile_freq: 8,   // shots per second (default weapon only)
    },
    // §15 Special melee (Down+Melee): the shared advancing leg sweep — same
    // behavior as Balthazar's (travels TOWARD facing, sprite plays her
    // `super_melee` sheet). Shallow copy: per-hero ownership, shared values.
    specialMelee: { ...SWEEP, hitbox: { ...SWEEP.hitbox }, knockbackModerate: { ...SWEEP.knockbackModerate }, knockbackBig: { ...SWEEP.knockbackBig } },
    // §30 per-frame attack hitbox data (see table docs at top of file).
    attacks: {
      [ATTACK_MELEE]: { knockbackModerate: MELEE_KNOCKBACK_MODERATE, knockbackBig: MELEE_KNOCKBACK_BIG },
      [ATTACK_SUPERMOVE]: { knockbackModerate: SUPERMOVE_BURST_KNOCKBACK, knockbackBig: SUPERMOVE_KNOCKBACK_BIG },
    },
  },
  balthazar: {
    id: 'balthazar',
    name: 'Balthazhar',
    specialName: 'Earthquake',
    targetH: 1.9,                // Y-units (1.9 = 91.2px); width is sheet-owned — same standard as scarlet
    stats: {
      weight: 1.3,
      speed: 225 / UNIT_PX_X,  // X-units/s (exactly 225 px/s at the current grid)
      attack: 20,
      defense: 5,
      stamina: 70,
      jump: 570 / UNIT_PX_Y,   // Y-units/s impulse (exactly 570 px/s — ~109px apex ≈ 1.2× body)
      projectile_freq: 10,   // shots per second (default weapon only)
    },
    // §15 Special melee (Down+Melee): the shared advancing leg sweep
    // (travels TOWARD facing; sprite plays the `super_melee` sheet).
    specialMelee: { ...SWEEP, hitbox: { ...SWEEP.hitbox }, knockbackModerate: { ...SWEEP.knockbackModerate }, knockbackBig: { ...SWEEP.knockbackBig } },
    // §30 per-frame attack hitbox data (see table docs at top of file).
    attacks: {
      [ATTACK_MELEE]: { knockbackModerate: MELEE_KNOCKBACK_MODERATE, knockbackBig: MELEE_KNOCKBACK_BIG },
      [ATTACK_SUPERMOVE]: { knockbackModerate: SUPERMOVE_BURST_KNOCKBACK, knockbackBig: SUPERMOVE_KNOCKBACK_BIG },
    },
  },
};
