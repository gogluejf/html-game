// Petal Panic — Trace Stats (telemetry / black-box recorder).
//
// TWO SEPARATE OBJECTS ON THE HERO (they never touch each other):
//   - hero.currentStats : "what do I have RIGHT NOW" (wallet: coins, lives,
//     ammo). Has { snapshot, current }. Rollback reverts current -> snapshot.
//   - hero.traceStats   : "everything that EVER happened". Only goes UP.
//     Death / rollback NEVER touches it. This file owns traceStats.
//
// GOLDEN RULE: gameplay can rewind the wallet; it can NEVER rewind the trace.
//
// SHAPE (every scope is symmetric: { total, perArea }):
//   traceStats:
//     total:        <counters>            // whole run, start -> quit
//     perArea:      { "1-1": <counters> } // whole run, by area (accumulates)
//     sessionTime / timePlayed / distanceTraveled / levelReached
//     lives:       [ { total, perArea } ] // index = 1st life, 2nd, ...
//     continues:   [ { total, perArea } ] // index = 1st continue, 2nd, ...
//     areaMap:     { "1-1": { seed, orientation, stage, budget, macros, placedUnits } }
//
// HOW IT FILLS: one event adds to FIVE buckets at once via record():
//   total, perArea[area], lives[active].total, lives[active].perArea[area],
//   continues[active].total (+ its perArea). New life/continue = push a bucket.
//
// DUMP: dumpTrace() prints whatever is in traceStats right now (win/gameover
// or the debug T key). Pure snapshot — it changes nothing.

/**
 * LEGACY compatibility shim. Returns the old flat run-stats shape so pre-existing
 * tests and any remaining flat-shape readers keep working during the migration.
 * New code should use createTrace() + record(). Do not add new callers here.
 * @returns {object}
 */
export function createStats() {
  return {
    enemiesKilled: Object.fromEntries(ENEMY_KEYS.map((k) => [k, 0])),
    bossKilled: false,
    powerupsCollected: Object.fromEntries(POWERUP_KEYS.map((k) => [k, 0])),
    projectilesShot: 0,
    specialsUsed: 0,
    meleeSwings: 0,
    hitsLanded: { melee: 0, projectile: 0, special: 0 },
    barrelsDestroyed: { woodBarrel: 0, explosiveBarrel: 0, coinBarrel: 0 },
    hitsTaken: { enemyContact: 0, enemyProjectile: 0, explosion: 0, total: 0 },
    damageDealt: {
      byMethod: { melee: 0, projectile: 0, special: 0 },
      byEnemy: Object.fromEntries(ENEMY_KEYS.map((k) => [k, 0])),
    },
    coinsCollected: { bronze: 0, silver: 0, gold: 0, total: 0 },
    checkpointsHit: 0,
    distanceTraveled: 0,
    timePlayed: 0,
  };
}

/**
 * Deep-clone a legacy flat stats object (compat for old snapshot/rollback tests).
 * @param {object} stats
 * @returns {object|null}
 */
export function cloneStats(stats) {
  if (!stats) return null;
  const clone = {};
  for (const [k, v] of Object.entries(stats)) {
    clone[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  }
  return clone;
}

/** Enemy type keys (must match def.id values used in enemy constructors). */
const ENEMY_KEYS = ['jester', 'jackolantern', 'vine_hound', 'boris_loon', 'boris_loon_baby', 'violetta_marionetta'];

/** Boss type keys (boss id values). */
const BOSS_KEYS = ['tusko_wobble'];

/** Powerup type keys (must match POWERUP_DEFS keys in powerup.js). */
const POWERUP_KEYS = ['ammo', 'invincibility', 'special', 'rapid', 'shield', 'clear', 'energy', 'oneUp'];

/** Barrel type keys. */
const BARREL_KEYS = ['woodBarrel', 'explosiveBarrel', 'coinBarrel'];

/** Coin type keys. */
const COIN_KEYS = ['bronze', 'silver', 'gold'];

/** Hit-landed method keys. */
const HIT_METHODS = ['melee', 'projectile', 'special', 'specialMelee', 'superMove', 'explosion'];

/** Projectile sub-type keys. */
const PROJECTILE_KEYS = ['thorn', 'special'];

/**
 * Build a fresh zeroed counters bucket (the leaf "<counters>" shape).
 * @returns {object}
 */
export function createCounters() {
  const enemiesKilled = {};
  for (const k of ENEMY_KEYS) enemiesKilled[k] = 0;

  const bossKilled = {};
  for (const k of BOSS_KEYS) bossKilled[k] = 0;

  const powerupsCollected = {};
  for (const k of POWERUP_KEYS) powerupsCollected[k] = 0;

  const barrelsDestroyed = {};
  for (const k of BARREL_KEYS) barrelsDestroyed[k] = 0;

  const coinsCollected = {};
  for (const k of COIN_KEYS) coinsCollected[k] = 0;
  coinsCollected.total = 0;

  const hitsLanded = {};
  for (const m of HIT_METHODS) hitsLanded[m] = 0;

  const projectilesShot = {};
  for (const p of PROJECTILE_KEYS) projectilesShot[p] = 0;

  return {
    enemiesKilled,
    bossKilled,
    powerupsCollected,
    barrelsDestroyed,
    coinsCollected,
    hitsLanded,
    projectilesShot,
    superMovesUsed: 0,
    meleeSwings: 0,
    hitsTaken: { enemyContact: 0, enemyProjectile: 0, explosion: 0, total: 0 },
  };
}

/**
 * Build a fresh scope bucket: { total, perArea }. Used for the top run scope,
 * and for each lives[] / continues[] entry.
 * @returns {object}
 */
export function createScope() {
  return { total: createCounters(), perArea: {} };
}

/**
 * Create a fresh traceStats object (a brand-new run). Called on startGame.
 * @returns {object}
 */
export function createTrace() {
  return {
    total: createCounters(),
    perArea: {},
    sessionTime: 0,
    timePlayed: 0,
    distanceTraveled: 0,
    levelReached: 1,
    lives: [createScope()],       // life #1 is active from the start
    continues: [createScope()],   // continue #0 (the original run) is active
    areaMap: {},
  };
}

/**
 * Get-or-create the per-area bucket within a scope.
 * @param {object} scope a { total, perArea } scope
 * @param {string} areaId e.g. "1-3"
 * @returns {object} the counters bucket for that area
 */
function areaBucket(scope, areaId) {
  if (!scope.perArea[areaId]) scope.perArea[areaId] = createCounters();
  return scope.perArea[areaId];
}

/**
 * Apply a single increment to ONE counters bucket.
 * @param {object} c a counters bucket
 * @param {object} ev the event descriptor (see record())
 */
function applyToBucket(c, ev) {
  switch (ev.kind) {
    case 'enemyKilled':
      c.enemiesKilled[ev.type] = (c.enemiesKilled[ev.type] ?? 0) + 1;
      break;
    case 'bossKilled':
      c.bossKilled[ev.type] = (c.bossKilled[ev.type] ?? 0) + 1;
      break;
    case 'powerup':
      c.powerupsCollected[ev.type] = (c.powerupsCollected[ev.type] ?? 0) + 1;
      break;
    case 'barrel':
      c.barrelsDestroyed[ev.type] = (c.barrelsDestroyed[ev.type] ?? 0) + 1;
      break;
    case 'coin':
      c.coinsCollected[ev.type] = (c.coinsCollected[ev.type] ?? 0) + 1;
      c.coinsCollected.total += 1;
      break;
    case 'hitLanded':
      c.hitsLanded[ev.method] = (c.hitsLanded[ev.method] ?? 0) + 1;
      break;
    case 'projectile':
      c.projectilesShot[ev.subtype] = (c.projectilesShot[ev.subtype] ?? 0) + 1;
      break;
    case 'superMove':
      c.superMovesUsed += 1;
      break;
    case 'meleeSwing':
      c.meleeSwings += 1;
      break;
    case 'hitTaken':
      c.hitsTaken[ev.source] += 1;
      c.hitsTaken.total += 1;
      break;
    default:
      break;
  }
}

/**
 * The single fan-out router. Every gameplay event calls this ONCE; it adds the
 * increment to all five live buckets at once:
 *   1. trace.total
 *   2. trace.perArea[areaId]
 *   3. trace.lives[activeLife].total
 *   4. trace.lives[activeLife].perArea[areaId]
 *   5. trace.continues[activeContinue].total (+ its perArea)
 *
 * @param {object} hero the hero (owns .traceStats)
 * @param {object} ev event descriptor:
 *   { kind, ...kind-specific fields } where kind is one of:
 *     enemyKilled{type}, bossKilled{type}, powerup{type}, barrel{type},
 *     coin{type}, hitLanded{method}, projectile{subtype}, superMove,
 *     meleeSwing, hitTaken{source}
 */
export function record(hero, ev) {
  const t = hero.traceStats;
  if (!t || !ev || !ev.kind) return;
  const areaId = hero.currentLevel != null && hero.currentArea != null
    ? `${hero.currentLevel}-${hero.currentArea}`
    : 'unknown';

  const life = t.lives[t.activeLife ?? 0] ?? t.lives[0];
  const cont = t.continues[t.activeContinue ?? 0] ?? t.continues[0];

  // Append-only trace (drives the dump): fan out to all five live buckets.
  applyToBucket(t.total, ev);
  applyToBucket(areaBucket(t, areaId), ev);
  if (life) {
    applyToBucket(life.total, ev);
    applyToBucket(areaBucket(life, areaId), ev);
  }
  if (cont) {
    applyToBucket(cont.total, ev);
    applyToBucket(areaBucket(cont, areaId), ev);
  }
}

/**
 * Open a new life bucket (death -> next attempt). Pushes an empty scope and
 * makes it active. Does NOT reset anything else (the trace only accumulates).
 * @param {object} hero
 */
export function beginLife(hero) {
  const t = hero.traceStats;
  if (!t) return;
  t.lives.push(createScope());
  t.activeLife = t.lives.length - 1;
}

/**
 * Open a new continue bucket (a continue was used). Pushes an empty scope and
 * makes it active.
 * @param {object} hero
 */
export function beginContinue(hero) {
  const t = hero.traceStats;
  if (!t) return;
  t.continues.push(createScope());
  t.activeContinue = t.continues.length - 1;
}

/**
 * Record the terrain-generation snapshot for one area (stable, once per game).
 * Stored in UNIT SPACE (width-units / tiers) — the PNG tool multiplies by
 * UNIT_PX_X / UNIT_PX_Y when drawing.
 * @param {object} hero
 * @param {string} areaId e.g. "1-3"
 * @param {object} info { seed, orientation, stage, budget, macros, placedUnits }
 */
export function recordAreaMap(hero, areaId, info) {
  const t = hero.traceStats;
  if (!t) return;
  t.areaMap[areaId] = {
    seed: info.seed ?? null,
    orientation: info.orientation ?? null,
    stage: info.stage ?? null,
    budget: info.budget ?? null,
    zoneWidthPx: info.zoneWidthPx ?? null,
    zoneHeightPx: info.zoneHeightPx ?? null,
    unitPxX: info.unitPxX ?? null,
    unitPxY: info.unitPxY ?? null,
    macros: info.macros ?? [],
    slots: info.slots ?? [],
    placedUnits: info.placedUnits ?? [],
  };
}

/**
 * Serialize the trace to console (grouped log) and trigger a downloadable JSON
 * file. Pure snapshot — reads traceStats, changes nothing.
 * @param {object} hero
 * @returns {object} the serialized output
 */
export function dumpTrace(hero) {
  const t = hero.traceStats ?? {};
  const output = {
    heroName: hero.heroDef?.name ?? 'Unknown',
    score: calculateScore(t.total, hero),
    timestamp: new Date().toISOString(),
    ...t,
  };

  console.group('📊 PETAL PANIC — TRACE');
  console.log('Hero:', output.heroName);
  console.log('Score:', output.score);
  console.log('Level reached:', t.levelReached);
  console.log('Session time:', (t.sessionTime ?? 0).toFixed(1) + 's');
  console.log('Play time:', (t.timePlayed ?? 0).toFixed(1) + 's');
  console.log('Distance:', Math.round(t.distanceTraveled ?? 0) + 'px');
  console.log('--- RUN TOTAL ---');
  console.log(countersLine(t.total));
  console.log('--- PER AREA ---');
  for (const [id, c] of Object.entries(t.perArea ?? {})) console.log(`  ${id}:`, countersLine(c));
  console.log(`--- LIVES (${t.lives?.length ?? 0}) ---`);
  (t.lives ?? []).forEach((l, i) => {
    console.log(`  life ${i + 1}:`, countersLine(l.total));
    for (const [id, c] of Object.entries(l.perArea ?? {})) console.log(`    ${id}:`, countersLine(c));
  });
  console.log(`--- CONTINUES (${t.continues?.length ?? 0}) ---`);
  (t.continues ?? []).forEach((c2, i) => {
    console.log(`  continue ${i + 1}:`, countersLine(c2.total));
    for (const [id, c] of Object.entries(c2.perArea ?? {})) console.log(`    ${id}:`, countersLine(c));
  });
  console.log('--- AREA MAP (terrain generation) ---');
  for (const [id, m] of Object.entries(t.areaMap ?? {})) {
    console.log(`  ${id}: [${m.orientation}] stage=${m.stage} budget=${m.budget} seed=${m.seed} macros=[${(m.macros ?? []).map(x => x.id).join(', ')}]`);
  }
  console.groupEnd();

  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
    try {
      const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'petal-panic-trace-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('[trace] failed to create download:', e.message);
    }
  }

  return output;
}

/** Compact one-line summary of a counters bucket (for console logs). */
function countersLine(c) {
  const kills = Object.values(c.enemiesKilled ?? {}).reduce((a, b) => a + b, 0);
  const coins = c.coinsCollected?.total ?? 0;
  const shots = Object.values(c.projectilesShot ?? {}).reduce((a, b) => a + b, 0);
  return `kills=${kills} coins=${coins} shots=${shots} barrels=${Object.values(c.barrelsDestroyed ?? {}).reduce((a, b) => a + b, 0)} hitsTaken=${c.hitsTaken?.total ?? 0}`;
}

/**
 * Deep-clone a counters bucket (for level-start snapshots).
 * @param {object} c a counters bucket
 * @returns {object|null} a deep copy, or null if c is null/undefined
 */
export function cloneCounters(c) {
  if (!c) return null;
  const out = {};
  for (const [k, v] of Object.entries(c)) {
    out[k] = (v && typeof v === 'object') ? { ...v } : v;
  }
  return out;
}

/**
 * Compute the per-level delta: current run-total minus a level-start snapshot.
 * This is what the boss reward reads so it reflects only the level just
 * cleared (boss-arena.md §4), while the global trace keeps accumulating.
 * @param {object} current the live run-total counters
 * @param {object} start the level-start snapshot (or null → returns current)
 * @returns {object} a counters-shaped delta
 */
export function diffCounters(current, start) {
  const cur = current ?? {};
  const base = start ?? {};
  const sub = (a, b) => (a ?? 0) - (b ?? 0);
  const byType = (objA, objB) => {
    const out = {};
    const keys = new Set([...Object.keys(objA ?? {}), ...Object.keys(objB ?? {})]);
    for (const k of keys) out[k] = Math.max(0, sub(objA?.[k], objB?.[k]));
    return out;
  };
  const coinsCur = cur.coinsCollected ?? {};
  const coinsBase = base.coinsCollected ?? {};
  return {
    enemiesKilled: byType(cur.enemiesKilled, base.enemiesKilled),
    bossKilled: byType(cur.bossKilled, base.bossKilled),
    powerupsCollected: byType(cur.powerupsCollected, base.powerupsCollected),
    barrelsDestroyed: byType(cur.barrelsDestroyed, base.barrelsDestroyed),
    coinsCollected: {
      bronze: Math.max(0, sub(coinsCur.bronze, coinsBase.bronze)),
      silver: Math.max(0, sub(coinsCur.silver, coinsBase.silver)),
      gold: Math.max(0, sub(coinsCur.gold, coinsBase.gold)),
      total: Math.max(0, sub(coinsCur.total, coinsBase.total)),
    },
    hitsLanded: byType(cur.hitsLanded, base.hitsLanded),
    projectilesShot: byType(cur.projectilesShot, base.projectilesShot),
    superMovesUsed: Math.max(0, sub(cur.superMovesUsed, base.superMovesUsed)),
    meleeSwings: Math.max(0, sub(cur.meleeSwings, base.meleeSwings)),
    hitsTaken: {
      enemyContact: Math.max(0, sub(cur.hitsTaken?.enemyContact, base.hitsTaken?.enemyContact)),
      enemyProjectile: Math.max(0, sub(cur.hitsTaken?.enemyProjectile, base.hitsTaken?.enemyProjectile)),
      explosion: Math.max(0, sub(cur.hitsTaken?.explosion, base.hitsTaken?.explosion)),
      total: Math.max(0, sub(cur.hitsTaken?.total, base.hitsTaken?.total)),
    },
  };
}

/**
 * Calculate the run score from the run-total counters (design §4.1 formula).
 *   - 100 pts per enemy killed
 *   - 1000 pts per boss kill
 *   - 10 pts per coin collected
 *   - 50 pts per explosive barrel, 25 per wood barrel, 75 per coin barrel
 * @param {object} total the run-total counters bucket
 * @param {object} _hero reserved for future hero-specific bonuses
 * @returns {number}
 */
export function calculateScore(total, _hero) {
  const c = total ?? {};
  let score = 0;
  score += Object.values(c.enemiesKilled ?? {}).reduce((a, b) => a + b, 0) * 100;
  // bossKilled may be an object {byType:count} (trace) or a boolean (legacy).
  const bossVal = c.bossKilled;
  const bossCount = typeof bossVal === 'boolean' ? (bossVal ? 1 : 0)
    : Object.values(bossVal ?? {}).reduce((a, b) => a + b, 0);
  score += bossCount * 1000;
  score += (c.coinsCollected?.total ?? 0) * 10;
  const b = c.barrelsDestroyed ?? {};
  score += (b.explosiveBarrel ?? 0) * 50 + (b.woodBarrel ?? 0) * 25 + (b.coinBarrel ?? 0) * 75;
  return score;
}
