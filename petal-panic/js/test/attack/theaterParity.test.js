// Theater vs gameplay parity regression tests (theater-cleanup plan, step 8).
//
// The attack theater is now a pure host/staging layer: bomb family routes
// through the shared BombAttackHost, projectile hits route through a
// CollisionWorld 'hit' handler mirroring the gameplay PROJ_ALLY×ENEMY branch,
// staged victims are real Enemy instances, and hit-flash is owned by the
// damage pipeline. These tests pin that parity at the shared seams so a
// future drift between sandbox and gameplay fails loudly.
//
// Run: node js/test/attack/theaterParity.test.js

import { strict as assert } from 'node:assert';
import { AttackTheater } from '../../debug/attack-theater.js';
import { invoke } from '../../combat/attack/engine.js';
import { Enemy } from '../../enemies/enemy.js';
import { BombAttackHost } from '../../combat/attack/bombAttackHost.js';
import { stepBombTerrain } from '../../combat/attack/primitives/bomb.js';
import { Pool, Special } from '../../objects/projectile.js';
import { LAYER } from '../../consts.js';
import '../../combat/attack/primitives/projectile.js';
import '../../combat/attack/primitives/bomb.js';
import '../../combat/attack/macros/index.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
// Must track the theater's floor (level.js ZONE_GROUND_Y) — a local 400 guess
// breaks parity checks now that the theater uses the real engine floor.
import { ZONE_GROUND_Y } from '../../world/level.js';
const GROUND_Y = ZONE_GROUND_Y;

// --- Helpers -----------------------------------------------------------------

/** Drive the theater headlessly: open, select an entry by id, run N frames. */
function runTheater(id, frames) {
  const t = AttackTheater;
  t.open();
  const idx = t.entries.indexOf(id);
  assert.ok(idx >= 0, `entry ${id} exists`);
  t.index = idx;
  t._loadParams();
  t._replay();
  for (let i = 0; i < frames; i++) t.update(DT * 2); // 2 sub-steps per call
  return t;
}

/** Collect deferred fireArea zones under a set of root handles. */
function collectZones(roots) {
  const zones = [];
  const walk = (h) => { for (const c of h.handles ?? []) { if (c.zone) zones.push(c.zone); walk(c); } };
  for (const h of roots ?? []) walk(h);
  return zones;
}

/** All live attack handles in the theater (direct + bomb-host roots). */
function allHandles(t) {
  return [...(t._handles ?? []), ...(t._bombHost?.roots ?? [])];
}

// --- 1. Theater module is a pure host -----------------------------------------

ok('theater imports headlessly and exposes the sandbox', () => {
  assert.equal(typeof AttackTheater.open, 'function');
  assert.equal(typeof AttackTheater._ctx, 'function');
});

// --- 2. Projectile hit routing (sandbox 'hit' handler ≈ gameplay branch) ------

ok('projectile hit routes through takeDamage + consume (HP drops)', () => {
  const t = runTheater('projectile', 90);
  assert.ok(t._log.some((l) => l.startsWith('HIT')), `log has HIT line: ${JSON.stringify(t._log.slice(0, 3))}`);
  assert.ok(t._target.hp < 999, `target hp decreased: ${t._target.hp}`);
  t.close();
});

ok('hit-flash field driven by the damage pipeline on theater target', () => {
  const t = runTheater('projectile', 30);
  assert.equal(typeof t._target.hitFlash, 'number');
  t.close();
});

// --- 3. Molotov: fire anchored to ground via shared host ----------------------

ok('molotov fire zone sits ON the ground (shared surface context)', () => {
  const t = runTheater('molotov', 60); // mid-burn: zone still alive
  const zones = collectZones(allHandles(t));
  assert.ok(zones.length >= 1, 'fire zone promoted by the shared host');
  for (const z of zones) {
    assert.ok(Math.abs(z.y + z.h - GROUND_Y) < 1, `zone bottom ${z.y + z.h} == ground ${GROUND_Y}`);
  }
  t.close();
});

// --- 4. Stomp victims are REAL enemies (actual damage pipeline) ---------------

ok('stomp victims are real Enemy instances with the death pipeline', () => {
  const t = runTheater('stomp', 300);
  assert.ok(t._stompVics?.length > 0, 'victims staged');
  for (const v of t._stompVics) {
    assert.ok(v instanceof Enemy, 'victim is a real Enemy');
    assert.equal(typeof v.takeDamage, 'function');
  }
  const hurt = t._stompVics.filter((v) => v.hp < 999 || !v.alive);
  assert.ok(hurt.length >= 1, `a victim was hit: ${hurt.length}/${t._stompVics.length}`);
  t.close();
});

// --- 5. Dash combo shove applies through the shared knockback path ------------

ok('dashCombo shoves the target (macro-owned applyKnockback)', () => {
  const t = runTheater('dashCombo', 180);
  const startX = 140 + 60; // staged next to the attacker home
  assert.ok(Math.abs(t._target.x - startX) > 4, `target displaced: ${Math.round(startX)} → ${Math.round(t._target.x)}`);
  t.close();
});

// Exercise real effect-before-attack ordering, including each segment boundary.
for (const strikeCount of [3, 4]) {
  ok(`dashCombo ${strikeCount} strikes: first ghosts start on attacker, never at origin`, () => {
    const t = AttackTheater;
    t.open();
    try {
      t.index = t.entries.indexOf('dashCombo');
      t._loadParams();
      if (strikeCount === 4) {
        const segments = [...t._params.segments];
        segments.splice(2, 0, { ...segments[1], frame: 'extra' });
        t._tweaks.dashCombo = { segments };
        t._loadParams();
      }
      t._replay();
      const h = t._handles[0];
      const trails = new Map();
      const originGhosts = [];
      for (let frame = 0; frame < 240 && !h.state.done; frame++) {
        t.update(DT);
        const inst = h._aiInst();
        if (!inst || inst.done) continue;
        if (!trails.has(inst)) {
          trails.set(inst, { segment: h.state.segmentIndex,
            expected: { x: t._attacker.x + t._attacker.w / 2,
              y: t._attacker.y + t._attacker.h / 2 }, first: null, positions: new Set() });
        }
        const trace = trails.get(inst);
        const ghosts = inst.body.ghosts;
        if (!trace.first && ghosts.length) trace.first = { x: ghosts[0].x, y: ghosts[0].y };
        for (const g of ghosts) {
          trace.positions.add(g.x);
          if (g.x === 0 && g.y === 0) originGhosts.push(trace.segment);
        }
        // Use the actual effect renderer, not a clipped/masked theater surrogate.
        inst.render({ save() {}, restore() {}, fillRect(x, y, w, height) {
          assert.ok(y > 0, `segment ${trace.segment}: rendered rectangle at y=${y}`);
          assert.equal(w, t._attacker.w);
          assert.equal(height, t._attacker.h);
        } });
      }
      assert.equal(trails.size, strikeCount, 'every strike creates a trail');
      assert.deepEqual(originGhosts, [], 'no origin snapshots anywhere in the combo');
      for (const trace of trails.values()) {
        assert.deepEqual(trace.first, trace.expected, `segment ${trace.segment}: first snapshot`);
        assert.ok(trace.positions.size > 2, `segment ${trace.segment}: later movement trail preserved`);
      }
    } finally {
      delete t._tweaks.dashCombo;
      t.close();
    }
  });
}

// --- 6. Shared-seam parity: same molotov, gameplay-shaped vs theater ctx ------

ok('molotov parity: identical zone placement across context shapes', () => {
  const params = { direction: -0.5, arc: 800, bounce: false, ttl: 2, damage: 12,
    fireWidth: 96, fireDuration: 3, fireTickRate: 5, fireDamage: 8 };
  const attacker = { x: 140, y: GROUND_Y - 48, w: 32, h: 48, alive: true, layer: LAYER.HERO };

  const run = (targets) => {
    const pool = new Pool(Special, 16);
    const ctx = { pools: { specialPool: pool }, groundY: GROUND_Y, platforms: [],
      bombTerrainStepped: true, world: { targets } };
    const host = new BombAttackHost(() => ctx);
    const h = host.spawn('molotov', { ...params }, attacker);
    let zones = [];
    for (let i = 0; i < 180; i++) {
      pool.updateAll(DT);
      // Same external terrain stepping both hosts rely on (gameplay pattern).
      for (const s of pool.items) if (s._attackId === 'bomb' && !s._attackDone) stepBombTerrain(s, DT, GROUND_Y);
      host.step(DT);
      const z = collectZones([h]);
      if (z.length > 0) zones = z; // remember the last live zone
    }
    return zones;
  };

  // Real Enemy target (gameplay shape) vs plain dummy (theater shape).
  const enemyTarget = new Enemy({ id: 't', name: 'T', w: 32, h: 48, stats: { stamina: 999, defense: 0, fly: false } }, 560, GROUND_Y - 48);
  const dummyTarget = { x: 560, y: GROUND_Y - 48, w: 32, h: 48, alive: true, hp: 999, layer: LAYER.ENEMY, hitFlash: 0 };
  const za = run([enemyTarget]);
  const zb = run([dummyTarget]);
  assert.ok(za.length >= 1 && zb.length >= 1, `both contexts promote a fire zone (${za.length}/${zb.length})`);
  assert.equal(Math.round(za[0].y), Math.round(zb[0].y), `same zone y: ${za[0].y} vs ${zb[0].y}`);
  assert.equal(Math.round(za[0].x), Math.round(zb[0].x), 'same zone x');
});

// Lane sequences use the ordinary host path, not direct child stepping.
for (const mode of ['charge', 'beam']) {
  for (const sideMode of ['fixed_left', 'fixed_right', 'alternate']) {
    ok(`laneSequence ${mode}/${sideMode}: both rows hit, other rows safe`, () => {
      const t = AttackTheater;
      t.open();
      try {
        t.index = t.entries.indexOf('laneSequence');
        t._tweaks.laneSequence = { mode, sideMode };
        t._loadParams();
        t._replay();
        const h = t._handles[0];
        const upper = t._stompVics[0];
        const platform = t._stompPlatforms[0];
        assert.ok(upper instanceof Enemy);
        assert.equal(upper.y + upper.h, platform.y);
        assert.equal(t._ctx().platforms[0], platform);
        assert.ok(t._ctx().world.targets.includes(upper));
        const safe = new Enemy({ id: 'safe', w: 28, h: 28,
          stats: { stamina: 999, defense: 0, fly: false } },
          upper.x + 80, GROUND_Y - 240 - 28);
        t._stompVics.push(safe);
        t._stompPlatforms.push({ x: safe.x - 12, y: safe.y + safe.h, w: safe.w + 24 });
        t._world.add(safe);
        const safeHP = safe.hp;
        const hits = new Map();
        h.on('hit', ({ target }) => hits.set(target, (hits.get(target) ?? 0) + 1));
        for (let i = 0; i < 30; i++) t.update(DT);
        assert.equal(t._target.hp, 999, 'announcement cannot damage');
        assert.equal(upper.hp, 999);
        const initialX = t._attacker.x;
        for (let i = 0; i < 450; i++) t.update(DT);
        assert.equal(h.state.done, true, 'all configured rows finish');
        assert.equal(h.state.laneIdx, t._params.laneCount);
        assert.equal(hits.get(t._target), mode === 'charge' ? 1 : 6);
        assert.equal(hits.get(upper), mode === 'charge' ? 1 : 6);
        assert.equal(safe.hp, safeHP, 'outside both attack volumes');
        assert.equal(upper.y + upper.h, platform.y, 'real platform supports victim');
        if (mode === 'beam') assert.equal(t._attacker.x, initialX, 'explicit beam origin does not move attacker');
        else assert.notEqual(t._attacker.x, initialX, 'charge moves attacker');
        t._replay();
        assert.equal(t._stompVics.length, 1, 'replay rebuilds staging without duplicates');
      } finally {
        delete t._tweaks.laneSequence;
        t.close();
      }
    });
  }
}

for (const mode of ['charge', 'beam']) {
  ok(`laneSequence ${mode}: three engine rows preserve foe routing and worldBox`, () => {
    const attacker = { x: 140, y: GROUND_Y - 48, w: 32, h: 48, gravity: 1000 };
    const victim = (y, layer = LAYER.HERO) => ({
      x: 400, y, w: 28, h: 28, alive: true, layer, hp: 999,
      takeDamage(n) { this.hp -= n; return n; },
    });
    const rows = [0, 120, 240].map(offset => victim(GROUND_Y - offset - 28));
    const friendly = victim(GROUND_Y - 28, LAYER.ENEMY);
    const outside = victim(GROUND_Y - 28);
    outside.worldBox = () => ({ x: outside.x, y: GROUND_Y - 360, w: 28, h: 28 });
    const h = invoke('laneSequence', { mode }, { attacker }); // gameplay default remains foe
    const targets = [...rows, friendly, outside];
    for (let i = 0; i < 600; i++) h.step(DT, targets);
    assert.ok(h.state.done);
    for (const target of rows) assert.equal(target.hp, mode === 'charge' ? 979 : 879);
    assert.equal(friendly.hp, 999, 'same-team candidate remains safe');
    assert.equal(outside.hp, 999, 'worldBox, not sprite bounds, determines overlap');
    assert.equal(attacker.gravity, 1000, 'charge restores gravity');
    const hp = rows.map(t => t.hp);
    assert.equal(h.step(1, targets), true);
    assert.deepEqual(rows.map(t => t.hp), hp, 'completed sequence cannot damage');
  });
}

console.log(`\ntheaterParity: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
