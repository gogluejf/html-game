// SpritePlayer — playback engine tests (sprites.md §5–7, plan T3.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpritePlayer } from '../core/spritePlayer.js';

/** Build a minimal AnimData with sensible overrides. */
function anim(over = {}, frameOver = {}) {
  const n = frameOver.n ?? 5;
  const framesMeta = Array.from({ length: n }, (_, i) => ({
    duration: frameOver.durations?.[i] ?? null,
  }));
  return {
    fps: 10, mode: 'loop', direction: 'forward', timing: 'fps',
    frames: Array.from({ length: n }, (_, i) => ({ file: `f${i}.png` })),
    framesMeta,
    ...over,
  };
}

const STEP = 1 / 60; // fixed timestep like the game loop

/** Run a player for t seconds and record the VISITED frame sequence
 *  (deduplicated consecutive repeats → the traversal signature). */
function visitSequence(player, t) {
  const seen = [];
  let elapsed = 0;
  while (elapsed < t - 1e-9) {
    const dt = Math.min(STEP, t - elapsed);
    player.tick(dt);
    elapsed += dt;
    const f = player.frameIndex;
    if (seen[seen.length - 1] !== f) seen.push(f);
    if (player.isDone) break;
  }
  return seen;
}

test('forward+loop cycles 0,1,2,3,4,0,1… at fps rate', () => {
  const p = new SpritePlayer(anim()); // fps 10 → 0.1s/frame
  const seq = visitSequence(p, 1.05); // ~10 frame boundaries
  assert.deepEqual(seq.slice(0, 10), [0, 1, 2, 3, 4, 0, 1, 2, 3, 4]);
  assert.equal(p.isDone, false);
});

test('ping_pong visits 1,2,3,4,5,4,3,2,1,2 with NO endpoint duplication (§6)', () => {
  const p = new SpritePlayer(anim({ direction: 'ping_pong' }));
  // 10 frame-durations = 1.0s covers exactly 10 visits of the sequence
  // 0,1,2,3,4,3,2,1,0,1 (0-indexed form of the spec's 1..N example).
  const seq = visitSequence(p, 1.0 + STEP); // slight overrun to catch the re-entry
  assert.deepEqual(seq.slice(0, 10), [0, 1, 2, 3, 4, 3, 2, 1, 0, 1]);
  // No consecutive duplicates anywhere in the raw walk:
  const raw = [];
  const q = new SpritePlayer(anim({ direction: 'ping_pong' }));
  for (let i = 0; i < 12; i++) { q.tick(0.1); raw.push(q.frameIndex); }
  for (let i = 1; i < raw.length; i++) assert.notEqual(raw[i], raw[i - 1], `dup at step ${i}: ${raw}`);
});

test('ping_pong_reverse starts at last frame and mirrors', () => {
  const p = new SpritePlayer(anim({ direction: 'ping_pong_reverse' }));
  const seq = visitSequence(p, 1.0 + STEP);
  assert.deepEqual(seq.slice(0, 10), [4, 3, 2, 1, 0, 1, 2, 3, 4, 3]);
});

test('reverse traverses N-1 … 0', () => {
  const p = new SpritePlayer(anim({ direction: 'reverse' }));
  // 0.49s = 4 full boundaries → visits 4,3,2,1,0 without wrapping to 4 again.
  const seq = visitSequence(p, 0.49);
  assert.deepEqual(seq, [4, 3, 2, 1, 0]);
});

test('once+forward completes AFTER the terminal frame fully elapsed', () => {
  const p = new SpritePlayer(anim({ mode: 'once' })); // 5 frames × 0.1s
  // At 0.4s we are INSIDE the last frame (index 4) — not done yet.
  for (let i = 0; i < 4; i++) p.tick(0.1);
  assert.equal(p.frameIndex, 4);
  assert.equal(p.isDone, false, 'terminal frame must stay visible for its full duration');
  p.tick(0.1); // finish frame 4
  assert.equal(p.isDone, true);
  assert.equal(p.frameIndex, 4, 'holds on terminal frame after completion');
  // Ticking a done player is a no-op.
  p.tick(1);
  assert.equal(p.frameIndex, 4);
});

test('once+reverse completes on frame 0 (direction decides the ending frame)', () => {
  const p = new SpritePlayer(anim({ mode: 'once', direction: 'reverse' }));
  for (let i = 0; i < 3; i++) p.tick(0.1); // inside frame index 1 (4th visit)
  assert.equal(p.frameIndex, 1);
  assert.equal(p.isDone, false);
  p.tick(0.1); // finish it → terminal frame 0 becomes visible
  assert.equal(p.frameIndex, 0);
  assert.equal(p.isDone, false, 'terminal frame still playing its own duration');
  p.tick(0.1); // terminal frame fully elapsed
  assert.equal(p.isDone, true);
});

test('per-frame duration override holds longer than 1/fps neighbors (§5)', () => {
  // Frame 1 (index 1) gets an explicit 0.3s vs the 0.1s default.
  const p = new SpritePlayer(anim({}, { durations: [null, 0.3, null, null, null] }));
  p.tick(0.1); // → frame 1
  assert.equal(p.frameIndex, 1);
  p.tick(0.15); // still inside frame 1's extended hold
  assert.equal(p.frameIndex, 1, 'extended-duration frame must hold');
  p.tick(0.15); // 0.3s total elapsed in frame 1 → advances
  assert.equal(p.frameIndex, 2);
});

test('relative timing: setProgress maps [0,1] onto traversal, ignoring durations (§7)', () => {
  const p = new SpritePlayer(anim({ timing: 'relative' }, { durations: [0.5, 0.1, 0.1, 0.1, 0.1] }));
  p.setProgress(0);
  assert.equal(p.frameIndex, 0);
  p.setProgress(0.5);
  assert.equal(p.frameIndex, 2, 'mid-traversal regardless of fps/durations (5 frames: slot 2)');
  p.setProgress(1);
  assert.equal(p.frameIndex, 4);
  // Out-of-range clamps.
  p.setProgress(1.7);
  assert.equal(p.frameIndex, 4);
  p.setProgress(-0.3);
  assert.equal(p.frameIndex, 0);
});

test('relative+once: p=1 marks done; tick() does not drive relative anims', () => {
  const p = new SpritePlayer(anim({ timing: 'relative', mode: 'once' }));
  p.tick(5); // clock must NOT advance a relative anim
  assert.equal(p.frameIndex, 0);
  assert.equal(p.isDone, false);
  p.setProgress(1);
  assert.equal(p.isDone, true);
});

test('single-frame anim stays put in every direction/mode', () => {
  for (const dir of ['forward', 'reverse', 'ping_pong', 'ping_pong_reverse']) {
    const p = new SpritePlayer(anim({ direction: dir }, { n: 1 }));
    p.tick(2);
    assert.equal(p.frameIndex, 0);
  }
  const once = new SpritePlayer(anim({ mode: 'once' }, { n: 1 }));
  once.tick(0.05);
  assert.equal(once.isDone, false);
  once.tick(0.05); // one full 1/fps duration elapsed
  assert.equal(once.isDone, true);
});

test('reset() rewinds and clears completion (pool respawn path)', () => {
  const p = new SpritePlayer(anim({ mode: 'once' }));
  p.tick(1);
  assert.equal(p.isDone, true);
  p.reset();
  assert.equal(p.isDone, false);
  assert.equal(p.frameIndex, 0);
  p.tick(0.1);
  assert.equal(p.frameIndex, 1, 'plays again after reset');
});

test('dt larger than a slot duration crosses multiple frames in one tick', () => {
  const p = new SpritePlayer(anim()); // 0.1s/frame
  p.tick(0.35);
  assert.equal(p.frameIndex, 3); // 3.5 slots → floor 3
});

test('constructor rejects empty/missing frames', () => {
  assert.throws(() => new SpritePlayer(null));
  assert.throws(() => new SpritePlayer({ frames: [] }));
});
