// Task 1.2 — Ownership tag: no double-stepping (js/combat/attack/lifecycle.js).
// Run: node --test petal-panic/js/test/attackLifecycle.test.js
//
// Acceptance covered (task 1.2):
//   1. A host-owned root registered with owned=true is drawn but NOT stepped
//      by stepAll.
//   2. A registry-owned handle is both stepped and drawn.
//   3. No handle is ever stepped twice in one frame (asserted via counting
//      stubs), including when the same handle is re-registered mid-frame.
//
// Acceptance covered (task 2.1, end-to-end through engine.invoke()):
//   4. A bare invoke() of a duration macro lands in AttackLifecycle._live
//      with _registryStepped === true and NO caller wiring.
//   5. An instant macro that completes synchronously is NOT left in the
//      registry.
//   6. A BombAttackHost.spawn root is present in _live for drawing and
//      carries _registryStepped === false (never undefined) — stamped at the
//      SINGLE registration point inside invoke() via the { owned: true }
//      passthrough; spawn() never writes the flag or calls register itself.

import { strict as assert } from 'node:assert';
import { test, before } from 'node:test';
import { AttackLifecycle } from '../combat/attack/lifecycle.js';
import { invoke, AttackHandle } from '../combat/attack/engine.js';
import { registerMacro } from '../combat/attack/registry.js';
import { BombAttackHost } from '../combat/attack/bombAttackHost.js';
import '../effects/registry.js'; // side effect: registers real effect types (dust-cloud, shockwave, camera-shake)
import '../combat/attack/primitives/fireArea.js'; // real duration primitive (step + zone)
import '../combat/attack/primitives/dustZone.js'; // real duration primitive (step + zone)
import '../combat/attack/primitives/shockwave.js'; // real duration primitive (step, no zone)
import { resetEffects } from '../effects/index.js';
import '../combat/attack/macros/mine.js'; // real duration macro (step + zone)

// Counting stub: a live handle whose step() counts calls and which carries a
// drawable zone so drawAll() has something to visit.
function makeCountingHandle(label) {
  const h = {
    _label: label,
    steps: 0,
    draws: 0,
    step(dt, targets) { this.steps++; },
    zone: { draw() { h.draws++; } },
  };
  return h;
}

before(() => AttackLifecycle.clear());

test('host-owned root (owned=true) is drawn but NOT stepped', () => {
  AttackLifecycle.clear();
  const h = makeCountingHandle('host-root');
  AttackLifecycle.register(h, { owned: true });
  assert.equal(h._registryStepped, false, 'owned registration must mark host stepping');
  AttackLifecycle.stepAll(1 / 60, []);
  // mineDrawer uses save/restore + fillRect; a minimal canvas stub suffices.
  const gradStub = { addColorStop() {} };
  AttackLifecycle.drawAll({ save() {}, restore() {}, fillRect() {}, strokeRect() {},
    createLinearGradient: () => gradStub, createRadialGradient: () => gradStub });
  assert.equal(h.steps, 0, 'registry must not step a host-owned root');
  assert.equal(h.draws, 1, 'registry must still draw its zone');
});

test('registry-owned handle is both stepped and drawn', () => {
  AttackLifecycle.clear();
  const h = makeCountingHandle('registry-handle');
  AttackLifecycle.register(h);
  assert.equal(h._registryStepped, true, 'default registration must be registry-stepped');
  AttackLifecycle.stepAll(1 / 60, []);
  // mineDrawer uses save/restore + fillRect; a minimal canvas stub suffices.
  const gradStub = { addColorStop() {} };
  AttackLifecycle.drawAll({ save() {}, restore() {}, fillRect() {}, strokeRect() {},
    createLinearGradient: () => gradStub, createRadialGradient: () => gradStub });
  assert.equal(h.steps, 1, 'registry must step its own handle exactly once');
  assert.equal(h.draws, 1, 'registry must draw its zone');
});

test('no handle is stepped twice in one frame (counting stub)', () => {
  AttackLifecycle.clear();
  const a = makeCountingHandle('a');
  const b = makeCountingHandle('b');
  const host = makeCountingHandle('host');
  AttackLifecycle.register(a);
  AttackLifecycle.register(b);
  AttackLifecycle.register(host, { owned: true });
  // Re-registering an already-live handle must not create a second step.
  AttackLifecycle.register(a);
  // Two full frames: each registry-owned handle steps exactly once per frame.
  for (let f = 0; f < 2; f++) {
    AttackLifecycle.stepAll(1 / 60, []);
    assert.equal(a.steps, f + 1, `frame ${f + 1}: a stepped ${a.steps}x`);
    assert.equal(b.steps, f + 1, `frame ${f + 1}: b stepped ${b.steps}x`);
    assert.equal(host.steps, 0, `frame ${f + 1}: host-owned root never stepped`);
  }
  AttackLifecycle.drawAll({});
  assert.equal(a.draws, 1);
  assert.equal(b.draws, 1);
  assert.equal(host.draws, 1, 'host-owned root still drawn');
});

test('clear() empties the set even if a cancel() throws', () => {
  AttackLifecycle.clear();
  const good = makeCountingHandle('good');
  const bad = { ...makeCountingHandle('bad') };
  bad.cancel = () => { throw new Error('boom'); };
  AttackLifecycle.register(good);
  AttackLifecycle.register(bad);
  assert.doesNotThrow(() => AttackLifecycle.clear());
  assert.equal(AttackLifecycle._live.size, 0, '_live must be empty after clear despite throwing cancel');
});

// ---------------------------------------------------------------------------
// Task 2.1 — end-to-end acceptance through engine.invoke().
// Stubs are registered into the REAL registry (registerMacro) and invoked via
// the real invoke(), so registration/ownership flows through the single
// stamp point exactly as in gameplay.
// ---------------------------------------------------------------------------

const bareCtx = { attacker: { x: 0, y: 0, w: 8, h: 8 }, world: { targets: [] } };

test('bare invoke() of a duration macro lands in _live with _registryStepped === true', () => {
  AttackLifecycle.clear();
  registerMacro('e2e_duration', {
    params: {},
    impl: () => {
      // Real macros return an AttackHandle whose .step/.zone the registry
      // drives; mirror that shape (a plain object would be wrapped into an
      // inner handle and lose its step/zone at the root).
      const h = new AttackHandle('e2e_duration');
      h.step = () => {};
      h.zone = { draw() {} };
      return h;
    },
  });
  // NO caller wiring: no register() call, no flag write — just invoke().
  const h = invoke('e2e_duration', {}, bareCtx);
  assert.ok(AttackLifecycle._live.has(h), 'duration handle must be auto-registered by invoke()');
  assert.equal(h._registryStepped, true, 'bare invoke() must stamp registry stepping');
  // The registry actually drives it: one frame steps + draws it once.
  let steps = 0, draws = 0;
  h.step = () => { steps++; };
  h.zone.draw = () => { draws++; };
  AttackLifecycle.stepAll(1 / 60, []);
  // mineDrawer uses save/restore + fillRect; a minimal canvas stub suffices.
  const gradStub = { addColorStop() {} };
  AttackLifecycle.drawAll({ save() {}, restore() {}, fillRect() {}, strokeRect() {},
    createLinearGradient: () => gradStub, createRadialGradient: () => gradStub });
  assert.equal(steps, 1, 'registry must step a bare-invoke handle');
  assert.equal(draws, 1, 'registry must draw a bare-invoke handle');
});

test('instant macro that completes synchronously is NOT left in the registry', () => {
  AttackLifecycle.clear();
  registerMacro('e2e_instant', {
    params: {},
    impl: () => {
      const h = new AttackHandle('e2e_instant');
      h.step = () => {};
      h.zone = { draw() {} };
      h._complete(); // completes DURING invoke
      return h;
    },
  });
  const h = invoke('e2e_instant', {}, bareCtx);
  assert.equal(h._completed, true, 'stub completed synchronously');
  assert.ok(!AttackLifecycle._live.has(h), 'completed-synchronously handle must not enter _live');
  assert.equal(AttackLifecycle._live.size, 0, 'registry must stay empty');
});

test('BombAttackHost.spawn root is present in _live, registry-owned, and carries _ctx/_ctxRefresh', () => {
  AttackLifecycle.clear();
  const context = { pools: {}, groundY: 400, platforms: [], bombTerrainStepped: true, world: { targets: [] } };
  const host = new BombAttackHost(() => context);
  const attacker = { x: 0, y: 0, w: 32, h: 32 };
  // Real 'mine' macro: persistent body with .step + .zone, contact/TTL armed —
  // stays live across frames without any pool or collision world.
  const h = host.spawn('mine', { x: 100, ttl: 5, blinkDuration: 5 }, attacker);
  assert.equal(h._completed, false, 'mine root must still be live at spawn time');
  assert.ok(AttackLifecycle._live.has(h), 'host-spawned root must be present in _live for drawing');
  // Task 3.2 contract: hero-shot roots are REGISTRY-OWNED (single lifecycle
  // owner). The host only builds the rich ctx; the registry steps AND draws.
  assert.equal(h._registryStepped, true, 'host-spawned root must be registry-owned (stepped by the registry)');
  assert.equal(typeof h._ctx, 'object', 'root must carry its AttackContext bag for the arc-recipe fallback');
  assert.equal(typeof h._ctxRefresh, 'function', 'root must carry a per-frame ctx refresher');
  // Registry steps AND draws the root (one owner does both now).
  let steps = 0, draws = 0;
  const origStep = h.step, origDraw = h.zone.draw;
  h.step = (...a) => { steps++; return origStep(...a); };
  h.zone.draw = (...a) => { draws++; return origDraw(...a); };
  AttackLifecycle.stepAll(1 / 60, []);
  // mineDrawer uses save/restore + fillRect; a minimal canvas stub suffices.
  const gradStub = { addColorStop() {} };
  AttackLifecycle.drawAll({ save() {}, restore() {}, fillRect() {}, strokeRect() {},
    createLinearGradient: () => gradStub, createRadialGradient: () => gradStub });
  assert.equal(steps, 1, 'registry must step the registry-owned root exactly once');
  assert.equal(draws, 1, 'registry must draw the root exactly once');
  // Host teardown cancels; the next registry frame prunes the root.
  host.clear();
  assert.equal(h._cancelled, true);
  AttackLifecycle.stepAll(1 / 60, []);
  assert.ok(!AttackLifecycle._live.has(h), 'terminal root must be pruned from _live');
});

// ---------------------------------------------------------------------------
// Task 4.1 — plug-and-play CONTRACT tests through the REAL primitives
// (fireArea, dustZone, shockwave). Each is fired via a BARE invoke() from a
// minimal ctx with ZERO caller lifecycle wiring: no register(), no step loop,
// no draw call outside the registry. The contract under test:
//   (a) the registry stepped it at least once (counted via wrapped h.step),
//   (b) its zone was drawn at least once (counted via wrapped h.zone.draw +
//       one AttackLifecycle.drawAll pass),
//   (c) after completion it is pruned from AttackLifecycle._live.
// duration: 0.2 at dt = 1/60 → completes in ~13 frames; we drive up to 30.
// ---------------------------------------------------------------------------

const DT = 1 / 60;
const MAX_FRAMES = 30; // comfortably beyond 0.2s @ 60fps (~13 frames)

/** Minimal canvas stub: every 2D API used by the real drawers is a no-op. */
function makeCanvasStub() {
  const gradStub = { addColorStop() {} };
  return {
    save() {}, restore() {}, fillRect() {}, strokeRect() {},
    beginPath() {}, closePath() {}, arc() {}, ellipse() {}, fill() {}, stroke() {},
    createLinearGradient: () => gradStub, createRadialGradient: () => gradStub,
  };
}

/** Drive registry frames until the handle completes or MAX_FRAMES elapse. */
function runToCompletion(h) {
  for (let f = 0; f < MAX_FRAMES && !h._completed; f++) {
    AttackLifecycle.stepAll(DT, []);
  }
}

test('CONTRACT: fireArea — bare invoke() is stepped, drawn, and pruned by the registry', () => {
  AttackLifecycle.clear();
  resetEffects();
  const ctx = { attacker: { x: 0, y: 0, w: 8, h: 8 }, world: { targets: [] } };
  const h = invoke('fireArea', { x: 100, y: 100, duration: 0.2 }, ctx);
  assert.equal(h._registryStepped, true, 'bare invoke() must stamp registry stepping');
  assert.ok(AttackLifecycle._live.has(h), 'duration primitive must land in _live');
  // Count registry-driven steps + zone draws through wrappers.
  let steps = 0, draws = 0;
  const origStep = h.step, origDraw = h.zone.draw.bind(h.zone);
  h.step = (...a) => { steps++; return origStep(...a); };
  h.zone.draw = (...a) => { draws++; return origDraw(...a); };
  // (b) one render pass while live: the registry draws the zone.
  AttackLifecycle.drawAll(makeCanvasStub());
  assert.equal(draws, 1, 'registry must draw the zone exactly once per drawAll');
  // (a) drive frames until completion: the registry steps it each frame.
  runToCompletion(h);
  assert.ok(steps >= 1, `registry must have stepped fireArea at least once (got ${steps})`);
  assert.equal(h._completed, true, 'fireArea must complete within the driven frames');
  // (c) pruning happens on the frame that completes it.
  assert.ok(!AttackLifecycle._live.has(h), 'completed fireArea must be pruned from _live');
  assert.equal(AttackLifecycle._live.size, 0, 'registry must hold nothing after completion');
});

test('CONTRACT: dustZone — bare invoke() is stepped, drawn, and pruned by the registry', () => {
  AttackLifecycle.clear();
  resetEffects();
  const ctx = { attacker: { x: 0, y: 0, w: 8, h: 8 }, world: { targets: [] } };
  const h = invoke('dustZone', { x: 100, y: 100, duration: 0.2 }, ctx);
  assert.equal(h._registryStepped, true, 'bare invoke() must stamp registry stepping');
  assert.ok(AttackLifecycle._live.has(h), 'duration primitive must land in _live');
  let steps = 0, draws = 0;
  const origStep = h.step, origDraw = h.zone.draw.bind(h.zone);
  h.step = (...a) => { steps++; return origStep(...a); };
  h.zone.draw = (...a) => { draws++; return origDraw(...a); };
  AttackLifecycle.drawAll(makeCanvasStub());
  assert.equal(draws, 1, 'registry must draw the zone exactly once per drawAll');
  runToCompletion(h);
  assert.ok(steps >= 1, `registry must have stepped dustZone at least once (got ${steps})`);
  assert.equal(h._completed, true, 'dustZone must complete within the driven frames');
  assert.ok(!AttackLifecycle._live.has(h), 'completed dustZone must be pruned from _live');
  assert.equal(AttackLifecycle._live.size, 0, 'registry must hold nothing after completion');
});

test('CONTRACT: shockwave — bare invoke() is stepped and pruned by the registry (zone-less)', () => {
  AttackLifecycle.clear();
  resetEffects();
  const ctx = { attacker: { x: 0, y: 0, w: 8, h: 8 }, world: { targets: [] } };
  const h = invoke('shockwave', { x: 100, y: 100, duration: 0.2, shake: false }, ctx);
  assert.equal(h._registryStepped, true, 'bare invoke() must stamp registry stepping');
  assert.ok(AttackLifecycle._live.has(h), 'duration primitive must land in _live');
  assert.equal(h.zone, undefined, 'shockwave carries no zone — the ring effect IS the visual');
  let steps = 0;
  const origStep = h.step;
  h.step = (...a) => { steps++; return origStep(...a); };
  runToCompletion(h);
  assert.ok(steps >= 1, `registry must have stepped shockwave at least once (got ${steps})`);
  assert.equal(h._completed, true, 'shockwave must complete within the driven frames');
  assert.ok(!AttackLifecycle._live.has(h), 'completed shockwave must be pruned from _live');
  assert.equal(AttackLifecycle._live.size, 0, 'registry must hold nothing after completion');
});

test('CONTRACT (negative): a handle with no .step and no .zone is NOT registered into _live', () => {
  AttackLifecycle.clear();
  const bare = new AttackHandle('contract_bare'); // no step, no zone
  AttackLifecycle.register(bare);
  assert.ok(!AttackLifecycle._live.has(bare), 'no-step/no-zone handle must skip the live set');
  assert.equal(AttackLifecycle._live.size, 0, '_live must stay empty');
  // And it stays out even after a full frame cycle.
  AttackLifecycle.stepAll(DT, []);
  AttackLifecycle.drawAll(makeCanvasStub());
  assert.ok(!AttackLifecycle._live.has(bare), 'frame cycle must not pull it into _live');
});
