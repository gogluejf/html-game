// Throw Enemy + Explosive Monkey tests (deterministic, no DOM).
// Run: node js/test/attack/throwEnemy.test.js

import { strict as assert } from 'node:assert';
import '../../effects/registry.js';
import '../../combat/attack/macros/index.js'; // registers throwEnemy + spawnSplit
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { Pool, Special } from '../../objects/projectile.js';
import { BombAttackHost } from '../../combat/attack/bombAttackHost.js';
import { stepBombTerrain } from '../../combat/attack/primitives/ballistic.js';
import { getMacro } from '../../combat/attack/registry.js';
import { ENEMY_TYPES, makeEnemy } from '../../world/build.js';
import { ExplosiveMonkey } from '../../enemies/explosiveMonkey.js';
import { LAYER } from '../../consts.js';

const dt = 1 / 60;
let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const GROUND_Y = 400;
const target = () => ({ x: 560, y: GROUND_Y - 24, w: 24, h: 24, layer: LAYER.ENEMY,
  alive: true, hp: 999, takeDamage(n) { this.hp -= n; return n; } });

/** Gameplay-shaped host context (same pattern as bombHost.test.js). */
function setup(targets = [target()]) {
  const pool = new Pool(Special, 16);
  const attacker = { x: 100, y: GROUND_Y - 48, w: 32, h: 48 };
  const context = { pools: { specialPool: pool }, groundY: GROUND_Y, platforms: [],
    bombTerrainStepped: true, world: { targets, hero: null } };
  const host = new BombAttackHost(() => context);
  const frame = () => {
    pool.updateAll(dt);
    for (const e of pool.items) stepBombTerrain(e, dt, GROUND_Y);
    host.step(dt);
  };
  return { pool, attacker, context, host, frame, targets };
}

ok('explosive_monkey is registered in ENEMY_FACTORIES / ENEMY_TYPES', () => {
  assert.ok(ENEMY_TYPES.includes('explosive_monkey'), `types: ${ENEMY_TYPES.join(',')}`);
  const e = makeEnemy('explosive_monkey', 0, 0);
  assert.ok(e instanceof ExplosiveMonkey);
  assert.equal(e.type, 'explosive_monkey');
});

ok('throwEnemy is a registered macro composing the bomb primitive', () => {
  const def = getMacro('throwEnemy');
  assert.ok(def, 'macro registered');
  assert.deepEqual(def.attacks.map((a) => a.id), ['ballistic', 'explosion', 'shockwave']);
  assert.equal(def.params.arc, 1000, 'default arc is 1000 (recent user preference)');
  assert.equal(def.params.enemyType, 'explosive_monkey');
  assert.equal(def.params.ttl, null, 'default TTL null = contact only');
  assert.equal(def.params.explodeOnContact, true);
});

ok('flight uses the real bomb carrier (Ballistic Arc) with retain flags', () => {
  const { host, attacker, frame } = setup();
  const h = host.spawn('throwEnemy', { origin: { x: 120, y: 300 }, direction: -0.35, speed: 420 }, attacker);
  const ent = h.entity;
  assert.equal(ent._attackId, 'ballistic', 'carrier is the ballistic primitive entity');
  assert.equal(ent._bombRetainOnSettle, true);
  assert.equal(ent._bombFuseDisabled, true, 'no flight fuse (ttl null)');
  let landed = false;
  h.on('land', () => { landed = true; });
  for (let i = 0; i < 240 && !landed; i++) frame();
  assert.ok(landed, 'carrier settled and transformed');
  assert.equal(h.state.settled, true);
});

ok('landing spawns a REAL enemy entity at the rest point', () => {
  const { host, attacker, frame } = setup();
  const h = host.spawn('throwEnemy', { origin: { x: 120, y: 300 }, direction: -0.35, speed: 420 }, attacker);
  let landed = null;
  h.on('land', (info) => { landed = info; });
  for (let i = 0; i < 240 && !landed; i++) frame();
  const e = h.state.enemy;
  assert.ok(e instanceof ExplosiveMonkey, 'landed entity is a real ExplosiveMonkey');
  assert.equal(e.layer, LAYER.ENEMY, 'enemy layer, not projectile layer');
  assert.ok(Math.abs(e.y + e.h - GROUND_Y) < 40, `near ground: bottom=${e.y + e.h}`);
  assert.ok(Math.abs(landed.x - (e.x + e.w / 2)) < 20, 'spawned at the landing point');
});

ok('TTL null = contact-only: idle monkey never auto-detonates', () => {
  const e = new ExplosiveMonkey(100, GROUND_Y - 36, { ttl: null });
  e.vy = 0; // grounded
  const t = target(); t.x = 900; // far away
  for (let i = 0; i < 60 * 30; i++) e.hostStep(dt, [t]);
  assert.equal(e._detonated, false, 'no detonation after 30s without contact');
  assert.equal(t.hp, 999);
});

ok('contact detonates exactly once through the explosion primitive', () => {
  const e = new ExplosiveMonkey(540, GROUND_Y - 36, { ttl: null, team: 'neutral' });
  e.vy = 0;
  e._heroRef = null;
  const t = target(); t.x = 545; // overlapping
  let booms = 0;
  const origDetonate = e.detonate.bind(e);
  e.detonate = (...a) => { booms++; origDetonate(...a); };
  e.hostStep(dt, [t]);
  assert.equal(e._detonated, true);
  assert.equal(e.aiState, 'dead', 'death pipeline started');
  // Keep stepping: re-entrant contacts must not double-fire.
  for (let i = 0; i < 120; i++) e.hostStep(dt, [t]);
  assert.equal(booms, 1, `exactly one blast (${booms})`);
  assert.ok(t.hp < 999, `target damaged: ${t.hp}`);
});

ok('team semantics: foe blast hits hero-ref only, ally hits enemies, neutral both', () => {
  const mk = (team) => {
    const e = new ExplosiveMonkey(0, 0, { team, ttl: null, explodeOnContact: false });
    const hero = { x: 0, y: 0, w: 10, h: 10, alive: true };
    const foe = { x: 0, y: 0, w: 10, h: 10, alive: true, bodyKnockback: {}, takeDamage() {} };
    e._heroRef = hero;
    return { heroOk: e.validBlastTarget(hero), foeOk: e.validBlastTarget(foe) };
  };
  assert.deepEqual(mk('foe'), { heroOk: true, foeOk: false });
  assert.deepEqual(mk('ally'), { heroOk: false, foeOk: true });
  assert.deepEqual(mk('neutral'), { heroOk: true, foeOk: true });
});

ok('TTL detonates after settling when configured', () => {
  const e = new ExplosiveMonkey(100, GROUND_Y - 36, { ttl: 1, mineType: 'shockwave' });
  e.vy = 0;
  const t = target(); t.x = 900;
  for (let i = 0; i < 59; i++) e.hostStep(dt, [t]);
  assert.equal(e._detonated, false, 'not yet at 0.98s');
  e.hostStep(dt, [t]);
  assert.equal(e._detonated, true, 'detonated at ~1s');
  assert.equal(e._payloadHandle?.id, 'shockwave', 'shockwave subtype honored');
});

ok('cancellation removes the entity cleanly and suppresses payload', () => {
  const { host, attacker, frame, context } = setup();
  const h = host.spawn('throwEnemy', { origin: { x: 120, y: 300 }, direction: -0.35, speed: 420 }, attacker);
  let landed = false;
  h.on('land', () => { landed = true; });
  for (let i = 0; i < 240 && !landed; i++) frame();
  const e = h.state.enemy;
  assert.ok(e && e.alive);
  h.cancel();
  assert.equal(e.alive, false, 'entity killed on cancel');
  assert.equal(h._cancelled, true);
  assert.equal(poolAliveCount(context), 0, 'no live carriers remain');
});
function poolAliveCount(context) {
  return context.pools.specialPool.items.filter((e) => e.alive).length;
}

ok('spawnSplit enemy children are THROWN (throwEnemy handles) with inherited velocity', () => {
  const { host, attacker, frame } = setup();
  const h = host.spawn('spawnSplit', {
    x: 200, y: 300, count: 3, centerDirection: 0, angle: Math.PI / 3, force: 300,
    inheritVelocity: 0.5, parentVx: 200, parentVy: 0,
    spawnType: 'enemy', enemyType: 'explosive_monkey',
  }, attacker);
  assert.equal(h.children.length, 3);
  assert.equal(h.handles.length, 3, 'each child → a live throwEnemy handle');
  assert.ok(h.handles.every((ch) => ch.id === 'throwEnemy'));
  // Inherited velocity propagates into the launch direction/speed.
  const kids = h.children;
  const center = kids.find((k) => Math.abs(k.angle) < 1e-9);
  assert.ok(Math.abs(center.vx - 400) < 1e-9, `center vx=${center.vx}`); // 300 + 200*0.5
});

ok('spawnSplit thrown enemies land as real entities and propagate to h.enemies', () => {
  const { host, attacker, frame } = setup();
  const h = host.spawn('spawnSplit', {
    x: 200, y: 250, count: 1, centerDirection: Math.PI / 2, angle: 0, force: 200,
    spawnType: 'enemy', enemyType: 'explosive_monkey',
  }, attacker);
  let landed = 0;
  for (const ch of h.handles) ch.on('land', () => landed++);
  for (let i = 0; i < 300 && landed < 1; i++) frame();
  assert.equal(landed, 1, 'child landed');
  assert.equal(h.enemies.length, 1, 'h.enemies updated on landing');
  assert.ok(h.enemies[0] instanceof ExplosiveMonkey);
});

ok('spawnSplit legacy path preserved with enemy.thrown=false', () => {
  const { host, attacker } = setup();
  const h = host.spawn('spawnSplit', {
    x: 200, y: 300, count: 2, centerDirection: 0, angle: Math.PI / 3, force: 300,
    spawnType: 'enemy', enemyType: 'jester', enemy: { thrown: false },
  }, attacker);
  assert.equal(h.enemies.length, 2, 'immediate makeEnemy path still works');
  assert.ok(h.enemies.every((e) => e.type === 'jester'));
  assert.ok(h.enemies.every((e) => e.hitstunTimer > 0));
  assert.equal(h.handles.length, 0, 'no throw handles on the legacy path');
});

console.log(`\n${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
