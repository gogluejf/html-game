import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blinkTransition } from '../effects/blinkTransition.js';
import { fireManual, updateEffects, resetEffects, activeInstances } from '../effects/index.js';
import '../effects/registry.js';
import { makeDemo } from '../debug/effect-theater-scenes.js';

const params = { frameA: 'red', frameB: 'blue', duration: 2, box: { x: 1, y: 2, w: 3, h: 4 } };
function canvas() {
  return { calls: [], save() {}, restore() {}, fillRect(...a) { this.calls.push([this.fillStyle, ...a]); }, drawImage(...a) { this.calls.push(a); } };
}
test('slow first switch, accelerating phase and stable destination', () => {
  const b = blinkTransition(params);
  assert.equal(b.frame(), 'red');
  b.update(0.2); assert.equal(b.frame(), 'red');
  b.update(0.25); assert.equal(b.frame(), 'blue');
  const deltas = [];
  for (const t of [0, 0.5, 1, 1.5]) {
    b.elapsed = t; const a = b.phase(); b.elapsed += 0.1; deltas.push(b.phase() - a);
  }
  assert.ok(deltas.every((d, i) => i === 0 || d > deltas[i - 1]));
  b.update(10); assert.equal(b.frame(), 'blue'); assert.equal(b.settled, true);
  assert.equal(b.done, false); b.update(10); assert.equal(b.frame(), 'blue');
  const c = canvas(); b.render(c); assert.equal(c.calls[0][0], 'blue');
});
test('reverse and single-frame appearance/disappearance', () => {
  for (const direction of ['forward', 'reverse']) {
    const b = blinkTransition({ ...params, frameB: null, direction });
    assert.equal(b.frame(), direction === 'forward' ? 'red' : null);
    const c = canvas(); b.render(c); assert.equal(c.calls.length, direction === 'forward' ? 1 : 0);
    b.update(2); assert.equal(b.frame(), direction === 'forward' ? null : 'red');
  }
  const b = blinkTransition({ ...params, direction: 'reverse' });
  assert.equal(b.frame(), 'blue'); b.update(2); assert.equal(b.frame(), 'red');
});
test('timestep partitions agree; invalid updates are ignored', () => {
  const a = blinkTransition(params), b = blinkTransition(params);
  a.update(1.25); for (let i = 0; i < 125; i++) b.update(0.01);
  assert.equal(a.frameIndex(), b.frameIndex()); assert.ok(Math.abs(a.phase() - b.phase()) < 1e-10);
  for (const dt of [NaN, Infinity, -1, 0]) a.update(dt);
  assert.equal(a.elapsed, 1.25);
});
test('image frame draws at live carrier bounds with no placeholder', () => {
  const image = {}, box = { x: 10, y: 20, w: 30, h: 40 };
  const b = blinkTransition({ ...params, frameA: image }, { worldBox: () => box });
  const c = canvas(); b.render(c); assert.deepEqual(c.calls, [[image, 10, 20, 30, 40]]);
  box.x = 11; b.render(c); assert.equal(c.calls[1][1], 11);
});
test('engine holds destination, releases explicitly, supports one-shot handoff', () => {
  resetEffects(); let finishes = 0;
  const i = fireManual({ type: 'blink-transition', params: { ...params, onFinish: (f, n) => { finishes++; assert.equal(f, 'blue'); assert.equal(n, 1); } } });
  updateEffects(3); updateEffects(3); assert.equal(finishes, 1); assert.ok(activeInstances().includes(i));
  i.complete(); updateEffects(0); assert.equal(activeInstances().length, 0);
  fireManual({ type: 'blink-transition', params: { ...params, hold: false, onFinish: () => finishes++ } });
  updateEffects(3); assert.equal(finishes, 2); assert.equal(activeInstances().length, 0);
  fireManual({ type: 'blink-transition', params: { ...params, onFinish: () => finishes++ } });
  resetEffects(); assert.equal(finishes, 2);
});
test('theater uses real effect and retains blue / reversed red / transparent endpoint', () => {
  for (const [overrides, expected] of [[{}, 'blue'], [{ direction: 'reverse' }, 'red'], [{ singleFrame: true }, null]]) {
    const c = canvas(); makeDemo({ type: 'blink-transition', params: { ...params, ...overrides } })(c, 3);
    assert.equal(c.calls.length, expected === null ? 0 : 1);
    if (expected) assert.equal(c.calls[0][0], expected);
  }
  resetEffects();
});
