// Petal Panic — hero stat definitions (design §5).
// Two selectable heroes; same base struct, different stats + special.
// `stats` feed physics/feel: speed (px/s), jump (impulse px/s), stamina (energy),
// projectile_freq / special_freq (cooldowns in seconds), attack/defense/weight.
//
// `attacks` is the declarative per-frame attack-hitbox table (design §30):
// geometry varies by hero, attack, animation frame and facing. It is DATA only
// — all resolution/mirroring logic lives in Hero.attackHitboxWorld().
//   melee.frames      — one entry per swing frame index (aligned with the
//                       shared MELEE_TOTAL_FRAMES clock); null = no box that
//                       frame, an {ox,oy,bw,bh} object = active box offset
//                       from body center (ox positive = in front of facing).
//   specialMelee.hitbox — single box exposed during every ACTIVE phase frame
//                       (per-hero differences live here, not in code branches).
//   supermove.box     — box exposed for the whole dash; bh: 'body' derives the
//                       full body height at runtime (heroes differ in h).

export const ATTACK_MELEE = 'melee';
export const ATTACK_SPECIAL_MELEE = 'specialMelee';
export const ATTACK_SUPERMOVE = 'supermove';

/** Shared normal-melee frame table (both heroes swing identically today). */
const MELEE_HITBOX_FRAMES = [null, null, null, { ox: 20, oy: 0, bw: 40, bh: 40 }, null];

/** Shared supermove dash box (thin, full body height, in front). */
// Anchored to the active collision-box CENTER (see Hero.attackHitboxWorld).
// bh: 'body' resolves to the hero's full body height; oy: 0 centers it on the
// body center so it spans the full height symmetrically (no drift below feet).
const SUPERMOVE_HITBOX = { ox: 20, oy: 0, bw: 16, bh: 'body' };

export const HEROES = {
  scarlet: {
    id: 'scarlet',
    name: 'Scarlet Vale',
    w: 32, h: 48,
    stats: {
      weight: 1,
      speed: 250,
      attack: 10,
      defense: 2,
      stamina: 100,
      jump: 500,
      projectile_freq: 8,   // shots per second
      special_freq: 2,      // saw cooldown (seconds)
      special: 'saw',
    },
    // §15 Special melee (Down+Melee): retreating cartwheel — travels AWAY from
    // facing while the sprite keeps its original orientation. Tuning lives here.
    specialMelee: {
      direction: -1,        // -1 = away from facing (scarlet's cartwheel)
      travelSpeed: 300,     // px/s self-supplied horizontal movement
      frames: { windup: 4, active: 3, recovery: 4 },  // frame counts at 60fps
      hitbox: { ox: 0, oy: 0, bw: 32, bh: 48 },       // full-body overlay (cartwheel)
    },
    // §30 per-frame attack hitbox data (see table docs at top of file).
    attacks: {
      [ATTACK_MELEE]: { frames: MELEE_HITBOX_FRAMES },
      [ATTACK_SUPERMOVE]: { box: SUPERMOVE_HITBOX },
    },
  },
  balthazar: {
    id: 'balthazar',
    name: 'Balthazhar',
    w: 36, h: 52,
    stats: {
      weight: 1.3,
      speed: 180,
      attack: 20,
      defense: 5,
      stamina: 70,
      jump: 420,
      projectile_freq: 10,
      special_freq: 3,
      special: 'bomb',
    },
    // §15 Special melee (Down+Melee): advancing sweep — travels TOWARD facing.
    specialMelee: {
      direction: 1,         // +1 = toward facing (balthazar's sweep)
      travelSpeed: 300,     // px/s self-supplied horizontal movement
      frames: { windup: 4, active: 3, recovery: 4 },  // frame counts at 60fps
      hitbox: { ox: 18, oy: 13, bw: 36, bh: 26 },     // leg sweep: in front, half-height at ground level (like his foot)
    },
    // §30 per-frame attack hitbox data (see table docs at top of file).
    attacks: {
      [ATTACK_MELEE]: { frames: MELEE_HITBOX_FRAMES },
      [ATTACK_SUPERMOVE]: { box: SUPERMOVE_HITBOX },
    },
  },
};
