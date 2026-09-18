// Petal Panic — hero stat definitions (design §5).
// Two selectable heroes; same base struct, different stats + special.
// `stats` feed physics/feel: speed (px/s), jump (impulse px/s), stamina (energy),
// projectile_freq / special_freq (cooldowns in seconds), attack/defense/weight.

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
      hitbox: { ox: 20, oy: -10, bw: 40, bh: 40 },    // active-frame box offset from center
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
      hitbox: { ox: 20, oy: -10, bw: 40, bh: 40 },    // active-frame box offset from center
    },
  },
};
