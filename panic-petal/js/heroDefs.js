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
      special_freq: 30,     // saw cooldown (seconds)
      special: 'saw',
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
      special_freq: 45,
      special: 'bomb',
    },
  },
};
