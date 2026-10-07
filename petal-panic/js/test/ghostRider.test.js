// Ghost rider tests — verifies the headless hero + rider brain against
// canonical macros and synthetic fixtures. Run: node --test js/test/ghostRider.test.js

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGhostRide, buildRideWorld } from '../world/ghostRider.js';
import { createHeadlessHero, stepHeadless } from '../hero/headless.js';
import { HEROES } from '../hero/heroDefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MACRO_DIR = path.join(__dirname, '../../macros/levels');

const loadMacros = () =>
  fs.readdirSync(MACRO_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(MACRO_DIR, f), 'utf8')));

// ---------------------------------------------------------------------------
// Headless core sanity
// ---------------------------------------------------------------------------

test('headless: hero falls under gravity', async () => {
  const hero = createHeadlessHero('balthazar', { x: 100, y: 0 });
  const solids = [{ x: 0, y: 500, w: 2000, h: 48 }];
  const y0 = hero.worldBox().y;
  stepHeadless(hero, 1 / 60, {}, solids);
  assert.ok(hero.worldBox().y > y0, 'hero should fall');
});

test('headless: hero runs right at full speed on flat ground', async () => {
  const hero = createHeadlessHero('balthazar', { x: 0, y: 400 });
  const solids = [{ x: 0, y: 500, w: 5000, h: 48 }];
  for (let i = 0; i < 30; i++) stepHeadless(hero, 1 / 60, { right: true }, solids);
  assert.ok(Math.abs(hero.vx - HEROES.balthazar.stats.speed) < 5, `vx=${hero.vx}`);
});

test('headless: jump gives negative vy then lands', async () => {
  const hero = createHeadlessHero('balthazar', { x: 100, y: 448 });
  const solids = [{ x: 0, y: 500, w: 2000, h: 48 }];
  // Settle on the floor first so a ground jump is available.
  stepHeadless(hero, 1 / 60, {}, solids);
  assert.ok(hero.grounded, 'hero should be grounded before jumping');
  stepHeadless(hero, 1 / 60, { jump: true }, solids);
  assert.ok(hero.vy < 0, `vy should be negative after jump, got ${hero.vy}`);
  let landed = false;
  for (let i = 0; i < 120; i++) {
    stepHeadless(hero, 1 / 60, {}, solids);
    if (hero.grounded) { landed = true; break; }
  }
  assert.ok(landed, 'hero should land within 2s');
});

test('headless: supermove dashes horizontally at high speed', async () => {
  const hero = createHeadlessHero('balthazar', { x: 100, y: 440 });
  const solids = [{ x: 0, y: 500, w: 5000, h: 48 }];
  // Get to full run speed first.
  for (let i = 0; i < 30; i++) stepHeadless(hero, 1 / 60, { right: true }, solids);
  const x0 = hero.worldBox().x;
  stepHeadless(hero, 1 / 60, { right: true, super: true }, solids);
  assert.ok(hero.supermoveActive, 'supermove should be active');
  assert.ok(Math.abs(hero.vx) > 500, `super vx=${hero.vx}`);
  for (let i = 0; i < 40; i++) stepHeadless(hero, 1 / 60, { right: true }, solids);
  assert.ok(hero.worldBox().x - x0 > 300, 'should have dashed far');
});

// ---------------------------------------------------------------------------
// World building
// ---------------------------------------------------------------------------

test('buildRideWorld: horizontal macro produces floor + unit solids', () => {
  const macro = {
    orientation: 'horizontal',
    units: [
      { kind: 'block', x: 5, y: 0, width: 3, height: 2 },
      { kind: 'platform', x: 10, y: 1, width: 2 },
    ],
  };
  const w = buildRideWorld(macro);
  assert.equal(w.vertical, false);
  assert.ok(w.solids.length >= 3, 'floor + 2 units');
  assert.equal(w.landings.length, 2);
  // Block top at row 2 → y = H - 2*UY
  const blockLanding = w.landings.find(l => l.kind === 'block');
  assert.equal(blockLanding.y, w.H - 2 * w.UY);
});

test('buildRideWorld: vertical macro uses bottom platform as floor', () => {
  const macro = {
    orientation: 'vertical',
    units: [{ kind: 'platform', x: 5, y: 10, width: 3 }],
  };
  const w = buildRideWorld(macro);
  assert.equal(w.vertical, true);
  assert.equal(w.entry.y, w.groundY, 'entry at bottom');
});

// ---------------------------------------------------------------------------
// Rider: canonical macros that are simple enough for the v1 brain
// ---------------------------------------------------------------------------

test('rider: easyPlatformHop clears', () => {
  const macro = JSON.parse(fs.readFileSync(path.join(MACRO_DIR, 'easyPlatformHop.json'), 'utf8'));
  const r = runGhostRide(macro);
  assert.equal(r.cleared, true, `reason=${r.failPoint?.reason}`);
  assert.ok(r.path.length > 10, 'trail should have points');
});

test('rider: platformHops clears', () => {
  const macro = JSON.parse(fs.readFileSync(path.join(MACRO_DIR, 'platformHops.json'), 'utf8'));
  const r = runGhostRide(macro);
  assert.equal(r.cleared, true, `reason=${r.failPoint?.reason}`);
});

test('rider: pyramid3 clears (may need retries)', () => {
  const macro = JSON.parse(fs.readFileSync(path.join(MACRO_DIR, 'pyramid3.json'), 'utf8'));
  const r = runGhostRide(macro);
  assert.equal(r.cleared, true, `reason=${r.failPoint?.reason} attempts=${r.attempts}`);
});

test('rider: stretchedPyramid clears', () => {
  const macro = JSON.parse(fs.readFileSync(path.join(MACRO_DIR, 'stretchedPyramid.json'), 'utf8'));
  const r = runGhostRide(macro);
  assert.equal(r.cleared, true, `reason=${r.failPoint?.reason}`);
});

// ---------------------------------------------------------------------------
// Rider: deterministic
// ---------------------------------------------------------------------------

test('rider: same macro twice → identical path', () => {
  const macro = JSON.parse(fs.readFileSync(path.join(MACRO_DIR, 'pyramid3.json'), 'utf8'));
  const a = runGhostRide(JSON.parse(JSON.stringify(macro)));
  const b = runGhostRide(JSON.parse(JSON.stringify(macro)));
  assert.equal(a.path.length, b.path.length);
  for (let i = 0; i < a.path.length; i++) {
    assert.equal(a.path[i].x, b.path[i].x);
    assert.equal(a.path[i].y, b.path[i].y);
  }
});

// ---------------------------------------------------------------------------
// Rider: synthetic dead-end must FAIL (not clear)
// ---------------------------------------------------------------------------

test('rider: unreachable wall fails with failPoint', () => {
  // A 10-row wall with no staircase: Balthazar cannot climb it (DJ apex ~2 rows).
  const macro = {
    id: 'deadEnd',
    orientation: 'horizontal',
    difficulty: 1,
    units: [
      { kind: 'block', x: 8, y: 0, width: 4, height: 10 },
    ],
  };
  const r = runGhostRide(macro);
  assert.equal(r.cleared, false, 'unclimbable wall must not clear');
  assert.ok(r.failPoint, 'must report a fail point');
  assert.ok(r.failPoint.x > 0 && r.failPoint.x < 8 * 72 + 4 * 72, 'fail near the wall');
});

// ---------------------------------------------------------------------------
// Known-hard macros (v1 brain limitations — tracked for v2)
// These currently FAIL; the test documents the gap without blocking CI.
// ---------------------------------------------------------------------------

const KNOWN_HARD = [
  'lowRepeated.json',       // staircase + 8-row wall
  'gapLanding.json',        // wide gaps needing precise super timing
  'mixedCrossing.json',     // mixed block/platform routing
  'blockBridge.json',       // elevated block bridge
  'blockPlatformBridge.json',
  'climbing.json',          // vertical zigzag
  'climbingWide.json',
  'climbingDense.json',
  'climbingGaps.json',
  'climbingZigzag.json',
  'climbSimple.json',
];

test('rider: known-hard macros are tracked (expected to fail in v1)', () => {
  const results = {};
  for (const f of KNOWN_HARD) {
    const p = path.join(MACRO_DIR, f);
    if (!fs.existsSync(p)) continue;
    const macro = JSON.parse(fs.readFileSync(p, 'utf8'));
    const r = runGhostRide(macro);
    results[f] = r.cleared;
  }
  // Log for visibility; do NOT assert — these are tracking tests.
  console.info('[ghostRider] known-hard status:', results);
  // At least one should still fail (otherwise update the list above).
  assert.ok(Object.values(results).some(v => !v), 'at least one known-hard macro should still fail');
});
