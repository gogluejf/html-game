import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MELEE_IMPACTS, meleeImpact } from '../combat/meleeImpact.js';

for (const [id, impact] of Object.entries(MELEE_IMPACTS)) {
  test(`${id}: effects follow outcome, not last-window status`, () => {
    const hb = { impact, damage: 10, multiHit: true, lastHit: false };
    const target = { alive: true, hp: 5, defense: 0 };
    const chip = { hitstop: impact.chipHitstop, shake: impact.chipShake };
    const lethal = { hitstop: impact.lethalHitstop, shake: impact.lethalShake };
    assert.deepEqual(meleeImpact(hb, target), chip, 'early lethal pins with chip effects');
    target.pinned = true;
    assert.deepEqual(meleeImpact(hb, target), chip, 'early pinned contact stays chip');
    hb.lastHit = true;
    assert.deepEqual(meleeImpact(hb, target), lethal, 'last pinned contact releases');
    target.pinned = false;
    assert.deepEqual(meleeImpact(hb, target), lethal, 'last fresh kill');
    target.hp = 50;
    assert.deepEqual(meleeImpact(hb, target), chip, 'last survivor is still chip');
    hb.multiHit = false; hb.lastHit = false; target.hp = 5;
    assert.deepEqual(meleeImpact(hb, target), lethal, 'single-hit kill');
  });
}

test('supermove tuning is chip 4f/4px and lethal 8f/6px', () => {
  assert.deepEqual(MELEE_IMPACTS.supermove, {
    chipHitstop: 4, lethalHitstop: 8, chipShake: 4, lethalShake: 6,
  });
});
