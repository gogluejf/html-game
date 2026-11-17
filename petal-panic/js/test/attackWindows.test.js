import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BaseAttack } from '../hero/attacks/baseAttack.js';
import { releaseFinisher } from '../combat/pin.js';

function fixture(multiHit = true) {
  const h = { attackMoves: {}, spriteFrameIndex: 0, spriteAnimData: { frames: [
    { boxes: [{ label: 'hit' }], durUnits: 1 },
    { boxes: [{ label: 'hit' }], durUnits: 9 },
    { boxes: [{ label: 'attack' }], durUnits: 20 },
  ] }, _sheetAttackBox() { return this.spriteAnimData.frames[this.spriteFrameIndex].boxes.find(b => b.label === 'hit'); },
  _sheetBoxToWorld: () => ({ x: 0, y: 0, w: 10, h: 10 }),
  _attackKnockback: () => ({ knockbackModerate: { x: 300 }, knockbackBig: { x: 850 } }),
  setInvincible() { this.invincible = true; }, clearInvincible() { this.invincible = false; } };
  const a = new BaseAttack(h, { id: 'melee', multiHit, sheet: () => 'melee', active: () => true });
  h.attackMoves.melee = a;
  a.begin();
  return { h, a };
}

test('hit labels alone select windows, held frames dedupe, adjacent frames rearm', () => {
  const { h, a } = fixture(); const target = {};
  const first = a.hitbox(); first.hitTargets.add(target);
  assert.ok(a.hitbox().hitTargets.has(target));
  assert.equal(first.lastHit, false);
  h.spriteFrameIndex = 1;
  assert.equal(a.hitbox().hitTargets.has(target), false);
  assert.equal(a.hitbox().lastHit, true);
  assert.equal(a.hitbox().finisher, false, 'last window does not grant big force');
  assert.equal(a.hitbox().hitstop, 0);
  h.spriteFrameIndex = 2;
  assert.equal(a.hitbox(), null, 'durUnits does not authorize contact');
});

test('single hit mode keeps one target set across all frames', () => {
  const { h, a } = fixture(false); const target = {};
  a.hitbox().hitTargets.add(target); h.spriteFrameIndex = 1;
  assert.ok(a.hitbox().hitTargets.has(target));
  assert.equal(h.plow, undefined);
});

test('multi-hit owns plow, not invincibility, and releases only its pins once', () => {
  const { h, a } = fixture(); let deaths = 0;
  const t = { pinned: true, die() { deaths++; } };
  a.pinned.add(t);
  assert.equal(h.plow, true); assert.equal(h.invincible, undefined);
  a.end(); a.end();
  assert.equal(deaths, 1); assert.equal(h.plow, false); assert.equal(a.hitbox(), null);
  a.begin(); assert.equal(a.hitbox().hitTargets.size, 0);
});

test('last-hit release applies launch after death clears velocity', () => {
  const t = { pinned: true, die() { this.vx = this.vy = 0; } };
  releaseFinisher(t, { impulse: { x: 850, y: -260 }, hitstun: 0.3 });
  assert.equal(t.pinned, false); assert.equal(t.intangible, true);
  assert.equal(t.vx, 850); assert.equal(t.vy, -260);
});
