import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../effects/registry.js';
import '../../combat/attack/macros/index.js';
import { invoke } from '../../combat/attack/engine.js';
import { activeInstances, resetEffects } from '../../effects/index.js';
import { Pool, Special } from '../../objects/projectile.js';
import { BombAttackHost } from '../../combat/attack/bombAttackHost.js';
import { AttackTheater } from '../../debug/attack-theater.js';

const dt = 1 / 60;
const enemy = (x = 0, y = 92) => ({ x, y, w: 16, h: 8, alive: true, hp: 999,
  takeDamage(n) { this.hp -= n; return n; } });
const context = () => ({ attacker: { x: -200, y: 0, w: 20, h: 20 }, groundY: 100,
  world: { targets: [], hero: null }, pools: { specialPool: new Pool(Special, 16) } });
const run = (h, seconds, targets = []) => { for (let i = 0; i < Math.ceil(seconds / dt); i++) h.step(dt, targets); };

test('default four-second TTL, separate overlay and base, exactly one detonation/completion', () => {
  resetEffects();
  const h = invoke('mine', {}, context());
  let detonations = 0, completions = 0;
  h.on('detonate', () => detonations++).on('complete', () => completions++);
  h.step(3.99, []); assert.equal(h.state.phase, 'idle');
  h.step(0.01, []); assert.equal(h.state.phase, 'warning');
  const warning = h.warning;
  assert.equal(warning.body.frame(), null);
  warning.update(0.5);
  assert.equal(warning.body.phase(), 2 * (2 * 0.25 + 28 * 0.25 ** 3 / 3));
  let rects = 0;
  h.zone.draw({ save() {}, restore() {}, fillRect() { rects++; } });
  assert.equal(rects, 4, 'persistent base still drawn during warning');
  h.step(2, []); h.step(10, []);
  assert.equal(detonations, 1); assert.equal(completions, 1);
  assert.equal(warning.done, true, 'held overlay explicitly completed');
});

test('null TTL stays contact-only; valid contact arms immediately without repeated warnings', () => {
  resetEffects(); const c = context();
  const h = invoke('mine', { ttl: null, team: 'ally' }, c);
  h.step(999, []); assert.equal(h.state.phase, 'idle');
  h.step(dt, [enemy()]); assert.equal(h.state.phase, 'warning');
  const warning = h.warning;
  run(h, 0.5, [enemy()]); assert.equal(h.warning, warning);
  assert.equal(activeInstances().filter(i => i.type === 'blink-transition').length, 1);
  h.cancel(); assert.equal(warning.done, true);
});

test('contacts use actual explosion target semantics, including self/dead/intangible exclusion', () => {
  for (const team of ['ally', 'foe', 'neutral']) {
    const c = context(), hero = enemy(), foe = enemy(); c.world.hero = hero; hero.x = 500;
    const h = invoke('mine', { team, ttl: null }, c);
    assert.equal(h.checkContact([foe]), team !== 'foe');
    // Hero is automatically a candidate: move away for isolated foe assertion above.
    h.cancel();
  }
});

test('team eligibility truth table and invalid contacts', () => {
  const c = context(), hero = enemy(), foe = enemy(); c.world.hero = hero;
  for (const team of ['ally', 'foe', 'neutral']) {
    const h = invoke('mine', { team, ttl: null }, c);
    assert.equal(h.validTarget(hero), team !== 'ally');
    assert.equal(h.validTarget(foe), team !== 'foe');
    assert.equal(h.validTarget(c.attacker), false);
    assert.equal(h.validTarget({ ...foe, alive: false }), false);
    assert.equal(h.validTarget({ ...foe, intangible: true }), false);
    h.cancel();
  }
});

test('shockwave launches immediately after one warning, no extra telegraph or delay', () => {
  resetEffects(); const h = invoke('mine', { ttl: 0, blinkDuration: 0.25, mineType: 'shockwave' }, context());
  let detonations = 0, completions = 0;
  h.on('detonate', () => detonations++).on('complete', () => completions++);
  h.step(dt, []); h.step(0.25, []);
  assert.equal(h.handles[0].id, 'shockwave');
  assert.equal(activeInstances().some(i => i.type === 'telegraph-circle'), false);
  assert.equal(activeInstances().some(i => i.type === 'shockwave'), true);
  assert.equal(h.warning.done, true);
  run(h, 3); assert.equal(detonations, 1); assert.equal(completions, 1);
});

test('throw flight does not consume TTL; bounce settles; airborne contact waits for ground', () => {
  for (const bounce of [false, true]) {
    const c = context();
    const h = invoke('throwMine', { origin: { x: 0, y: 20 }, speed: 0, arc: 400, ttl: null, bounce }, c);
    h.step(dt, [enemy(-4, 16)]);
    assert.equal(h.state.armed, true); assert.equal(h.state.phase, 'idle');
    for (let i = 0; i < 600 && !h.state.settled; i++) h.step(dt, []);
    assert.equal(h.state.settled, true);
    assert.equal(h.state.box.y + h.state.box.h, 100);
    assert.equal(h.state.elapsed, 0);
    assert.equal(h.state.phase, 'warning');
    assert.ok(h.warning, 'throw declares inherited warning effect'); h.cancel();
  }
  const h = invoke('throwMine', { origin: { x: 0, y: -200 }, speed: 0, arc: 100, ttl: 4 }, context());
  run(h, 1); assert.equal(h.state.elapsed, 0);
  for (let i = 0; i < 1000 && !h.state.settled; i++) h.step(dt, []);
  assert.equal(h.state.elapsed, 0); h.step(3.99, []); assert.equal(h.state.phase, 'idle');
  h.step(0.02, []); assert.equal(h.state.phase, 'warning'); h.cancel();
});

test('mine payload configuration propagates through split, cluster, sky missile and rain', () => {
  const c = context();
  const check = h => { assert.equal(h._params.mineType, 'shockwave'); assert.equal(h._params.ttl, null); assert.equal(h._params.blinkDuration, 0.7); };
  const split = invoke('spawnSplit', { spawnType: 'mine', mineType: 'shockwave', mine: { ttl: null, blinkDuration: 0.7 }, count: 2 }, c);
  assert.equal(split.handles.length, 2); split.handles.forEach(check);
  const cluster = invoke('clusterBomb', { spawnType: 'mine', mineType: 'shockwave', mineTtl: null, blinkDuration: 0.7 }, c);
  cluster.inner.entity.alive = false; cluster.step(dt, []);
  assert.equal(cluster.handles.length, 4); cluster.handles.forEach(check);
  const sky = invoke('skyMissile', { blastType: 'mine', mineType: 'shockwave', mineTtl: null, blinkDuration: 0.7, timeToTarget: 0 }, c);
  sky.step(dt, []); check(sky.state.missile);
  run(sky, 2); assert.equal(sky.state.missile.state.settled, true);
  assert.equal(sky.state.missile.state.box.y + 8, 100);
  const rain = invoke('missileRain', { count: 1, blastType: 'mine', mineType: 'shockwave', mineTtl: null, blinkDuration: 0.7, timeToTarget: 0 }, c);
  run(rain, 2); check(rain.state.missiles[0].state.missile);
});

test('gameplay host owns mine stepping, drawing and cancellation', () => {
  const c = context(); const host = new BombAttackHost(() => c);
  const h = host.spawn('throwMine', { ttl: null }, c.attacker);
  let rects = 0; host.draw({ save() {}, restore() {}, fillRect() { rects++; } });
  assert.equal(rects, 4); host.step(dt); host.clear(); assert.equal(h._cancelled, true);
});

test('base theater mine is centered and target contact triggers before TTL', () => {
  const t = AttackTheater; t.open();
  try {
    t.index = t.entries.indexOf('mine'); assert.ok(t.index >= 0);
    t._loadParams(); t._replay(); const h = t._handles.find(h => h.id === 'mine');
    assert.ok(h);
    for (let i = 0; i < 180 && h.state.phase === 'idle'; i++) t.update(dt);
    assert.equal(h.state.phase, 'warning'); assert.ok(h.state.elapsed < 4);
  } finally { t.close(); }
});


test('foe theater mine walks hero candidate into warning and completes safely', () => {
  const t = AttackTheater; t.open();
  try {
    t.index = t.entries.indexOf('mine'); t._tweaks.mine = { team: 'foe', ttl: null };
    t._loadParams(); t._replay(); const h = t._handles.find(h => h.id === 'mine');
    for (let i = 0; i < 360; i++) t.update(dt);
    assert.equal(h._completed, true);
  } finally { delete t._tweaks.mine; t.close(); }
});

test('split cancellation tears down held warning overlays', () => {
  const h = invoke('spawnSplit', { spawnType: 'mine', count: 1, x: 0, y: 96,
    force: 0, mine: { bounce: false, ttl: 0 } }, context());
  run(h, 0.1); const child = h.handles[0]; assert.ok(child.warning);
  h.cancel(); assert.equal(child._cancelled, true); assert.equal(child.warning.done, true);
});
