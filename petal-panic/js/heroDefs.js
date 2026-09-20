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
//
// Knockback (docs/architecture/knockback.md §11): committed attacks carry a
// `knockback` setting on their hitbox data; the core wiring reads it off the
// hitbox at impact (hb.knockback) and routes to applyKnockback(). Non-committed
// attacks (normal melee, thorn/special projectiles) carry NO knockback field —
// presence of the data is the only gate. Values are starting points tuned in 2.3.

export const ATTACK_MELEE = 'melee';
export const ATTACK_SPECIAL_MELEE = 'specialMelee';
export const ATTACK_SUPERMOVE = 'supermove';

/** Shared normal-melee frame table (both heroes swing identically today). */
const MELEE_HITBOX_FRAMES = [null, null, null, { ox: 20, oy: 0, bw: 40, bh: 40 }, null];

/**
 * Shared supermove dash box + knockback (thin, full body height, in front).
 * Both heroes share the same supermove launch character (knockback.md §11):
 * the strongest shove — big base heft, scales hardest with dash speed, longest
 * stun, pushed along the dash velocity.
 */
// Anchored to the active collision-box CENTER (see Hero.attackHitboxWorld).
// bh: 'body' resolves to the hero's full body height; oy: 0 centers it on the
// body center so it spans the full height symmetrically (no drift below feet).
const SUPERMOVE_HITBOX = { ox: 20, oy: 0, bw: 16, bh: 'body' };
// pop: 150 px/s upward launch (§5) — with GRAVITY 1500 a light enemy rises ~7.5px
// and hangs ~0.2s: a visible loft of roughly a body-height or two at dash speed,
// not an exaggerated rocket. The strongest of the three committed attacks.
const SUPERMOVE_KNOCKBACK = { base: 600, scaleBySpeed: 0.5, hitstun: 0.50, dirMode: 'alongVelocity', pop: 150 };

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
      // Knockback (knockback.md §11): strong escape shove AWAY from the hero —
      // pushes the enemy back to create escape space behind the retreat.
      // pop: 50 px/s upward (§5) — a small hop, weaker than the supermove loft.
      knockback: { base: 360, scaleBySpeed: 0.4, hitstun: 0.30, dirMode: 'fromAttacker', pop: 50 },
    },
    // §30 per-frame attack hitbox data (see table docs at top of file).
    attacks: {
      [ATTACK_MELEE]: { frames: MELEE_HITBOX_FRAMES },
      [ATTACK_SUPERMOVE]: { box: SUPERMOVE_HITBOX, knockback: SUPERMOVE_KNOCKBACK },
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
      hitbox: { ox: 9, oy: 8.5, bw: 36, bh: 35 },     // leg sweep: in front, ~2/3 body height at ground level, offset back over his body
      // Knockback (knockback.md §11): aggressive forward pushback along the
      // lunge velocity — clears the path ahead of the advancing sweep.
      // pop: 40 px/s upward (§5) — a small hop; v1 tuning, final feel in 2.3.
      knockback: { base: 320, scaleBySpeed: 0.4, hitstun: 0.28, dirMode: 'alongVelocity', pop: 40 },
    },
    // §30 per-frame attack hitbox data (see table docs at top of file).
    attacks: {
      [ATTACK_MELEE]: { frames: MELEE_HITBOX_FRAMES },
      [ATTACK_SUPERMOVE]: { box: SUPERMOVE_HITBOX, knockback: SUPERMOVE_KNOCKBACK },
    },
  },
};
