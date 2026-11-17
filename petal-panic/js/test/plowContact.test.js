import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePlowHero, resolvePlowEnemy } from '../combat/plowContact.js';

const body = (x, extra = {}) => ({ x, y: 0, w: 20, h: 60, vx: 0, vy: 0, alive: true, ...extra });

for (const direction of [1, -1]) {
  test(`plow contact stops each mover, direction ${direction}`, () => {
    const h = body(direction === 1 ? 0 : 40, { plow: true });
    const e = body(20);
    for (let frame = 0; frame < 60; frame++) {
      h.vx = direction * 900;
      h.x += direction * 10;
      resolvePlowHero(h, [e]);
      assert.equal(h.x, direction === 1 ? 0 : 40);
      assert.equal(h.vx, 0);
      assert.equal(e.x, 20, 'hero must not carry enemy forward');
      e.vx = -direction * 100;
      e.x -= direction * 2;
      resolvePlowEnemy(e, h);
      assert.equal(e.x, 20);
      assert.equal(e.vx, 0);
    }
  });
}

test('normal contact is unchanged outside plow', () => {
  const h = body(5), e = body(20);
  resolvePlowHero(h, [e]);
  resolvePlowEnemy(e, h);
  assert.equal(h.x, 5);
  assert.equal(e.x, 20);
});

test('pinned bodies block; released ghosts do not', () => {
  const h = body(5, { plow: true });
  const e = body(20, { pinned: true });
  resolvePlowHero(h, [e]);
  assert.equal(h.x, 0);
  h.x = 5;
  e.intangible = true;
  resolvePlowHero(h, [e]);
  assert.equal(h.x, 5);
});

test('flyer contact blocks without inventing ground or changing hitstun', () => {
  const h = body(0, { plow: true });
  const e = body(18, { gravity: 0, _grounded: false, hitstunTimer: 0.3 });
  resolvePlowEnemy(e, h);
  assert.equal(e.x, 20);
  assert.equal(e._grounded, false);
  assert.equal(e.hitstunTimer, 0.3);
});

test('game loop resolves hero movement before attacks and enemy movement', () => {
  const source = readFileSync(new URL('../systems/update.js', import.meta.url), 'utf8');
  const move = source.indexOf('  hero.update(dt, intent);');
  const contact = source.indexOf('  resolvePlowHero(hero, realEnemies);');
  const attack = source.indexOf('  processAllHitboxes();');
  const enemy = source.indexOf('  updateRealEnemies(dt);');
  assert.ok(move < contact && contact < attack && attack < enemy);
  assert.ok(!source.includes('_plowBlockWeight'));
  assert.ok(!source.includes('plowPushEnemies'));
});
