// Petal Panic — Stats & Telemetry (design §4.1).
//
// A single run-scoped stats object tracks every documented telemetry field.
// It is created at game start (createStats()), incremented throughout gameplay
// by the update system / damage routing / powerup collection, and serialized
// via dumpStats() on WIN or GAMEOVER to console + downloadable JSON.
//
// This turns in-game telemetry into a balance tool: after each run you get a
// structured record of kills, damage distribution, coin economy, time, and
// distance that can be diffed across tuning passes.

/** Enemy type keys (must match def.id values used in enemy constructors). */
const ENEMY_KEYS = ['jester', 'jackolantern', 'vine_hound', 'boris_loon', 'boris_loon_baby', 'violetta_marionetta'];

/** Powerup type keys (must match POWERUP_DEFS keys in powerup.js). */
const POWERUP_KEYS = ['ammo', 'invincibility', 'special', 'rapid', 'shield', 'clear', 'energy', 'oneUp'];

/**
 * Create a fresh stats object with all §4.1 fields zeroed.
 * @returns {object} the stats object (attach to hero or keep global)
 */
export function createStats() {
  const enemiesKilled = {};
  for (const k of ENEMY_KEYS) enemiesKilled[k] = 0;

  const powerupsCollected = {};
  for (const k of POWERUP_KEYS) powerupsCollected[k] = 0;

  const byEnemy = {};
  for (const k of ENEMY_KEYS) byEnemy[k] = 0;

  return {
    enemiesKilled,
    bossKilled: false,
    powerupsCollected,
    projectilesShot: 0,
    specialsUsed: 0,
    meleeSwings: 0,
    hitsLanded: { melee: 0, projectile: 0, special: 0 },
    barrelsDestroyed: { woodBarrel: 0, explosiveBarrel: 0, coinBarrel: 0 },
    hitsTaken: { enemyContact: 0, enemyProjectile: 0, explosion: 0, total: 0 },
    damageDealt: {
      byMethod: { melee: 0, projectile: 0, special: 0 },
      byEnemy,
    },
    coinsCollected: { bronze: 0, silver: 0, gold: 0, total: 0 },
    checkpointsHit: 0,
    distanceTraveled: 0,
    timePlayed: 0,
  };
}

/**
 * Serialize the run stats to console (grouped log) and trigger a downloadable
 * JSON file. Called once on WIN or GAMEOVER.
 *
 * @param {object} stats the live stats object from createStats()
 * @param {object} hero the hero entity (for name + any extra context)
 * @returns {object} the serialized output (also logged/downloaded)
 */
export function dumpStats(stats, hero) {
  const output = {
    ...stats,
    score: calculateScore(stats, hero),
    heroName: hero.heroDef?.name ?? 'Unknown',
    timestamp: new Date().toISOString(),
  };

  // --- Console group ---------------------------------------------------------
  console.group('📊 PETAL PANIC — RUN STATS');
  console.log('Hero:', output.heroName);
  console.log('Score:', output.score);
  console.log('Time:', stats.timePlayed.toFixed(1) + 's');
  console.log('Enemies Killed:', JSON.stringify(stats.enemiesKilled));
  console.log('Boss Killed:', stats.bossKilled);
  console.log('Coins:', JSON.stringify(stats.coinsCollected));
  console.log('Damage Dealt by Method:', JSON.stringify(stats.damageDealt.byMethod));
  console.log('Damage Dealt by Enemy:', JSON.stringify(stats.damageDealt.byEnemy));
  console.log('Hits Taken:', JSON.stringify(stats.hitsTaken));
  console.log('Powerups:', JSON.stringify(stats.powerupsCollected));
  console.log('Barrels Destroyed:', JSON.stringify(stats.barrelsDestroyed));
  console.log('Checkpoints Hit:', stats.checkpointsHit);
  console.log('Distance Traveled:', Math.round(stats.distanceTraveled) + 'px');
  console.log('Projectiles Shot:', stats.projectilesShot);
  console.log('Specials Used:', stats.specialsUsed);
  console.log('Melee Swings:', stats.meleeSwings);
  console.log('Hits Landed:', JSON.stringify(stats.hitsLanded));
  console.groupEnd();

  // --- Downloadable JSON -----------------------------------------------------
  // Guard: only attempt DOM download when running in a browser context.
  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
    try {
      const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'petal-panic-stats-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('[stats] failed to create download:', e.message);
    }
  }

  return output;
}

/**
 * Calculate the run score from stats (design §4.1 scoring formula).
 *   - 100 pts per enemy killed
 *   - 1000 pts for boss kill
 *   - 10 pts per coin collected
 *   - 50 pts per explosive barrel destroyed
 *   - 75 pts per coin barrel destroyed
 *   - 25 pts per checkpoint hit
 *
 * @param {object} stats the stats object
 * @param {object} _hero the hero (reserved for future hero-specific bonuses)
 * @returns {number} total score
 */
export function calculateScore(stats, _hero) {
  let score = 0;
  score += Object.values(stats.enemiesKilled).reduce((a, b) => a + b, 0) * 100;
  if (stats.bossKilled) score += 1000;
  score += stats.coinsCollected.total * 10;
  score += (stats.barrelsDestroyed.explosiveBarrel ?? 0) * 50 + (stats.barrelsDestroyed.woodBarrel ?? 0) * 25;
  score += stats.barrelsDestroyed.coinBarrel * 75;
  score += stats.checkpointsHit * 25;
  return score;
}

/**
 * Deep-clone a stats object so a snapshot can be restored later without
 * mutating the live object. Used by the area-entry accounting snapshot
 * (game-rules.md §4 — score/kill/coin accounting rolls back to the area's
 * entry totals on a failed attempt).
 * @param {object} stats a stats object from createStats()
 * @returns {object} a deep copy
 */
export function cloneStats(stats) {
  if (!stats) return null;
  const clone = {};
  for (const [k, v] of Object.entries(stats)) {
    if (v && typeof v === 'object') {
      // Nested plain objects (enemiesKilled, coinsCollected, hitsLanded, ...).
      clone[k] = {};
      for (const [k2, v2] of Object.entries(v)) clone[k][k2] = v2;
    } else {
      clone[k] = v;
    }
  }
  return clone;
}
