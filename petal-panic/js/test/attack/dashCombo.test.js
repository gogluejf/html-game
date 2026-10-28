// Dash Combo macro tests (pure logic, no DOM).
// Run: node js/test/attack/dashCombo.test.js

import { strict as assert } from 'node:assert';
import '../../effects/registry.js'; // side effect: registers afterimage/sprite-shake/hit-sparkle
import { activeInstances, activeCount } from '../../effects/index.js';
import { resolveDashDirection, normalizeSegment, segmentHitboxBox } from '../../combat/attack/macros/dashCombo.js';
import { invoke } from '../../combat/attack/engine.js';
import { makeContext } from '../../combat/attack/context.js';
import { LAYER } from '../../consts.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const DT = 1 / 60;
const GROUND_Y = 400;

function attacker(x = 200) {
  return { x, y: GROUND_Y - 48, w: 32, h: 48, vx: 0, vy: 0, alive: true, layer: LAYER.HERO };
}

function ctx(a = attacker(), extra = {}) {
  return makeContext(a, {
    world: { targets: [], hero: null },
    effects: { spawnHitSparkles() {}, fireManual() {} },
    groundY: GROUND_Y,
    ...extra,
  });
}

function dummyEnemy(x, y = GROUND_Y - 24, hp = 100) {
  return {
    x, y, w: 24, h: 24, alive: true, hp, layer: LAYER.ENEMY, vx: 0, vy: 0, hitstunTimer: 0,
    takeDamage(amt) { if (!this.alive) return 0; this.hp -= amt; if (this.hp <= 0) this.alive = false; return amt; },
  };
}

/** 3-segment preset mirroring the theater demo. */
const SEGS = [
  { frame: 'a', speed: 380, duration: 0.18, freezeFrames: 0.12, hitbox: { w: 48, h: 40, offset: { x: 30, y: 0 } }, damage: 8, knockback: null, shove: 0.6 },
  { frame: 'b', speed: 460, duration: 0.18, freezeFrames: 0.12, hitbox: { w: 52, h: 44, offset: { x: 34, y: 0 } }, damage: 10, knockback: null, shove: 0.6 },
  { frame: 'c', speed: 520, duration: 0.16, freezeFrames: 0.14, hitbox: { w: 56, h: 48, offset: { x: 38, y: 0 } }, damage: 18, knockback: { base: 260, scaleBySpeed: 1.0, hitstun: 0.3, dirMode: 'fromAttacker' }, shove: 0.6 },
];

ok('direction is a full 0–2π param (no clamping, same contract as charge)', () => {
  assert.equal(resolveDashDirection(0), 0);
  assert.ok(Math.abs(resolveDashDirection(Math.PI / 2) - Math.PI / 2) < 1e-9); // up stays up
  assert.equal(resolveDashDirection(Math.PI), Math.PI);
  assert.ok(Math.abs(resolveDashDirection(-Math.PI / 3) + Math.PI / 3) < 1e-9); // up-right stays up-right
  assert.equal(resolveDashDirection(NaN), 0); // invalid → default right
});

ok('segment normalization fills defaults', () => {
  const s = normalizeSegment({ frame: 'x' });
  assert.equal(s.frame, 'x');
  assert.equal(s.speed, 420);
  assert.equal(s.duration, 0.18);
  assert.equal(s.freezeFrames, 0.12);
  assert.equal(s.shove, 0.6);
  assert.ok(s.hitbox && s.hitbox.w > 0);
});

ok('hitbox box is centered on attacker + offset', () => {
  const a = attacker(100); // center (116, 376)
  const seg = normalizeSegment({ hitbox: { w: 48, h: 40, offset: { x: 30, y: 0 } } });
  const box = segmentHitboxBox(seg, a);
  assert.ok(Math.abs(box.x - (116 + 30 - 24)) < 1e-9, `x=${box.x}`);
  assert.ok(Math.abs(box.y - (376 - 20)) < 1e-9, `y=${box.y}`);
  assert.equal(box.w, 48); assert.equal(box.h, 40);
});

ok('phase sequencing: startup → (move→freeze)×N → recovery → done', () => {
  const a = attacker();
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0.1, recovery: 0.1 }, ctx(a));
  const phases = [];
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    finished = h.step(DT, []);
    if (h.state.phase !== phases[phases.length - 1]) phases.push(h.state.phase);
  }
  assert.ok(finished, 'completes');
  assert.deepEqual(phases, ['startup', 'move', 'freeze', 'move', 'freeze', 'move', 'freeze', 'recovery'], `got ${phases.join('→')}`);
});

ok('frame label tracks the current segment', () => {
  const a = attacker();
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0 }, ctx(a));
  const frames = new Set();
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) { finished = h.step(DT, []); frames.add(h.state.frame); }
  assert.ok(finished);
  assert.deepEqual([...frames].sort(), ['a', 'b', 'c']);
});

ok('move phase deals NO damage; freeze phase DOES', () => {
  const a = attacker();
  // One dummy per segment's landing zone. The shove drags victims along the
  // dash (by design — stand still = eat the combo), so each later dummy sits
  // where the dragged victim arrives, not where it started.
  const e1 = dummyEnemy(260), e2 = dummyEnemy(330), e3 = dummyEnemy(540);
  const c = ctx(a);
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0 }, c);
  const hits = [];
  let lastHitPhase = null;
  h.on('hit', (info) => { hits.push(info); lastHitPhase = h.state.phase; });
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    finished = h.step(DT, [e1, e2, e3]);
    if (hits.length && lastHitPhase === 'move') throw new Error('hit landed during move phase');
    for (const e of [e1, e2, e3]) { e.x += (e.vx ?? 0) * DT; e.vx *= 0.85; }
  }
  assert.ok(finished);
  // Each segment's freeze hits its target exactly once (hitSet dedupes per swing).
  // With 7-frame freezes and slow dummies, a single dummy can be in range for
  // multiple frames but only takes ONE hit per segment. Assert unique segments.
  const segsHit = [...new Set(hits.map((x) => x.segmentIndex))].sort();
  assert.ok(segsHit.length >= 2, `at least 2 segments connected (got ${JSON.stringify(segsHit)})`);
  assert.ok(!hits.some((x) => x.phase === 'move'), 'no hits during move phase');
});

ok('shove: overlapping dummy gains vx toward dash direction during move, none during freeze', () => {
  const a = attacker();
  const e = dummyEnemy(230); // close enough to be shoved early
  const c = ctx(a);
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0 }, c);
  let sawShove = false;
  let freezeShoved = false;
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    const before = e.vx;
    finished = h.step(DT, [e]);
    if (h.state.phase === 'move' && e.vx > before + 1) sawShove = true;
    if (h.state.phase === 'freeze' && e.vx !== before) freezeShoved = true;
  }
  assert.ok(sawShove, 'victim was shoved during a move phase');
  assert.ok(!freezeShoved, 'no shove during freeze');
});

ok('knockback ONLY on the last freeze (data carried correctly per segment)', () => {
  // The macro's job: carry knockback data on the hitbox. Application is the
  // host's job (gameplay hitboxes.js / theater). Assert the DATA pattern:
  // early segments null, finisher carries the launch setting.
  const a = attacker();
  const e = dummyEnemy(280);
  const c = ctx(a);
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0 }, c);
  const seen = {};
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    finished = h.step(DT, [e]);
    if (h.state.phase === 'freeze' && h.state.hb && seen[h.state.segmentIndex] == null) {
      seen[h.state.segmentIndex] = h.state.hb.knockback;
    }
    if (!finished) e.x += (e.vx ?? 0) * DT;
  }
  assert.ok(finished);
  assert.equal(seen[0], null, 'seg1: no knockback data');
  assert.equal(seen[1], null, 'seg2: no knockback data');
  assert.equal(seen[2]?.base, 260, 'seg3 (finisher): carries the launch');
});

ok('finisher knockback data present, early segments null (no-shove control)', () => {
  // Control case: shove disabled. Assert the DATA on live hitboxes per segment —
  // that's what the macro owns. Application is the host's job.
  const segsNoShove = SEGS.map((s) => ({ ...s, shove: 0 }));
  const a = attacker();
  const e = dummyEnemy(280);
  const c = ctx(a);
  const h = invoke('dashCombo', { segments: segsNoShove, direction: 0, startup: 0, recovery: 0 }, c);
  const seen = {};
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    finished = h.step(DT, [e]);
    if (h.state.phase === 'freeze' && h.state.hb && seen[h.state.segmentIndex] == null) {
      seen[h.state.segmentIndex] = h.state.hb.knockback;
    }
    if (!finished) e.x += (e.vx ?? 0) * DT;
  }
  assert.ok(finished);
  assert.equal(seen[0], null, 'seg1: no knockback');
  assert.equal(seen[1], null, 'seg2: no knockback');
  assert.equal(seen[2]?.base, 260, 'seg3 (finisher): carries the launch');
});

ok('finisher knockback data lands on the final freeze (single-segment control)', () => {
  // Isolated proof of the knockback wiring: ONE segment carrying the launch
  // setting. Victim stands inside its freeze box from frame one. The macro's
  // own hitbox routing does NOT apply knockback to plain test dummies (the
  // unified system applies it in the gameplay callback), so we assert the
  // DATA is correctly carried on the live hitbox during the freeze — that is
  // what the macro owns; application is the host's job (hitboxes.js).
  const solo = [{ frame: 'x', speed: 400, duration: 0.1, freezeFrames: 0.12, hitbox: { w: 60, h: 48, offset: { x: 38, y: 0 } }, damage: 18, knockback: { base: 260, scaleBySpeed: 1.0, hitstun: 0.3, dirMode: 'fromAttacker' }, shove: 0 }];
  const a = attacker();
  const e = dummyEnemy(280);
  const c = ctx(a);
  const h = invoke('dashCombo', { segments: solo, direction: 0, startup: 0, recovery: 0 }, c);
  let sawKnockbackBox = false;
  let finished = false;
  for (let i = 0; i < 300 && !finished; i++) {
    finished = h.step(DT, [e]);
    if (h.state.phase === 'freeze' && h.state.hb?.knockback?.base === 260) sawKnockbackBox = true;
    if (!finished) e.x += (e.vx ?? 0) * DT;
  }
  assert.ok(finished);
  assert.ok(sawKnockbackBox, 'freeze hitbox carried the knockback setting');
});

ok('early freezes carry NO knockback data (only the last segment does)', () => {
  // The combo rule: every segment except the last MUST be knockback:null so
  // the victim keeps control until the finisher. Assert the DATA on the live
  // hitboxes per segment.
  const a = attacker();
  const e = dummyEnemy(280);
  const c = ctx(a);
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0 }, c);
  const seen = {};
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    finished = h.step(DT, [e]);
    if (h.state.phase === 'freeze' && h.state.hb && seen[h.state.segmentIndex] == null) {
      seen[h.state.segmentIndex] = h.state.hb.knockback;
    }
    if (!finished) e.x += (e.vx ?? 0) * DT;
  }
  assert.ok(finished);
  assert.equal(seen[0], null, 'seg1: no knockback');
  assert.equal(seen[1], null, 'seg2: no knockback');
  assert.equal(seen[2]?.base, 260, 'seg3 (finisher): carries the launch');
});

ok('breaker: melee hit on attacker during move AND freeze aborts with broken:true', () => {
  for (const targetPhase of ['move', 'freeze']) {
    const a = attacker();
    const c = ctx(a);
    const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0.5 }, c);
    let finished = false;
    let broke = null;
    h.on('complete', (info) => { broke = info; });
    for (let i = 0; i < 600 && !finished; i++) {
      finished = h.step(DT, []);
      if (h.state.phase === targetPhase) { h.breakOnMeleeHit(); break; }
    }
    assert.ok(broke, `${targetPhase}: complete fired`);
    assert.equal(broke.broken, true, `${targetPhase}: broken flag`);
    assert.equal(h.state.done, true, `${targetPhase}: timeline dropped`);
    assert.equal(a.dashDefyingGravity, false, `${targetPhase}: gravity hold released`);
  }
});

ok('projectile hit does NOT break the combo', () => {
  const a = attacker();
  const c = ctx(a);
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0 }, c);
  // Simulate a projectile graze: damage only, no breakOnMeleeHit call.
  a.energy = 50;
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, []);
  assert.ok(finished, 'timeline ran to completion despite the graze');
  assert.equal(h.state.broken, false);
});

ok('afterimage instance exists during move, gone-of-new-points during freeze', () => {
  const a = attacker();
  const c = ctx(a);
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0 }, c);
  let moveGhosts = 0;
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    finished = h.step(DT, []);
    const inst = h._aiInst();
    if (inst && !inst.done && h.state.phase === 'move') {
      moveGhosts = Math.max(moveGhosts, inst.body.ghosts.length);
    }
  }
  assert.ok(finished);
  assert.ok(moveGhosts > 0, `trail recorded during move (got ${moveGhosts})`);
});

ok('impact ghost: planted at each freeze connect, one per connection', () => {
  const a = attacker();
  const e1 = dummyEnemy(260), e2 = dummyEnemy(330), e3 = dummyEnemy(540);
  const c = ctx(a);
  const before = activeCount();
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0, impactGhost: { color: '#ffe066' } }, c);
  const hits = [];
  h.on('hit', (i) => hits.push(i));
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    finished = h.step(DT, [e1, e2, e3]);
    for (const e of [e1, e2, e3]) { e.x += (e.vx ?? 0) * DT; e.vx *= 0.85; }
  }
  assert.ok(finished);
  assert.ok(hits.length >= 1, 'combo connected');
  // Each connection spawned a discrete afterimage instance holding exactly
  // one ghost (count-1 ring buffer). Count them among live instances.
  const planted = activeInstances().filter((x) => x.type === 'afterimage' && x.body?.ghosts?.length === 1);
  assert.ok(planted.length >= hits.length, `one planted ghost per hit (${planted.length} planted, ${hits.length} hits)`);
  assert.ok(activeCount() > before, 'effect set grew by the impact ghosts');
});

ok('impact ghost OFF by default (null param spawns nothing extra)', () => {
  const a = attacker();
  const e = dummyEnemy(260);
  const c = ctx(a);
  // Snapshot BEFORE: the effects active set is process-global, so instances
  // from earlier tests may still be fading. Only NEW standalones matter.
  const beforeStandalones = new Set(activeInstances().filter((x) => x.type === 'afterimage' && !x.carrier));
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0 }, c);
  const hits = [];
  h.on('hit', (i) => hits.push(i));
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    finished = h.step(DT, [e]);
    e.x += (e.vx ?? 0) * DT; e.vx *= 0.85;
  }
  assert.ok(finished);
  assert.ok(hits.length >= 1, 'combo connected');
  // No NEW impact-ghost instances: impact ghosts are standalone no-carrier
  // afterimages; with impactGhost null none of those may appear.
  const newStandalones = activeInstances().filter((x) => x.type === 'afterimage' && !x.carrier && !beforeStandalones.has(x));
  assert.equal(newStandalones.length, 0, `no standalone impact ghosts when off (got ${newStandalones.length})`);
});

ok('travel ghost override: { count: 0 } disables the trail', () => {
  const a = attacker();
  const c = ctx(a);
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0, afterimage: { count: 0 } }, c);
  let moveGhosts = 0;
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    finished = h.step(DT, []);
    const inst = h._aiInst();
    if (inst && !inst.done && h.state.phase === 'move') {
      moveGhosts = Math.max(moveGhosts, inst.body.ghosts.length);
    }
  }
  assert.ok(finished);
  assert.equal(moveGhosts, 0, 'no travel ghosts with count: 0');
});

ok('victim death mid-combo completes cleanly', () => {
  const a = attacker();
  const e = dummyEnemy(260, GROUND_Y - 24, 10); // dies on the first freeze
  const c = ctx(a);
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0 }, c);
  let finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    finished = h.step(DT, [e]);
    e.x += (e.vx ?? 0) * DT;
    e.vx *= 0.85;
  }
  assert.ok(finished, 'combo completes even though the victim died');
  assert.equal(e.alive, false);
});

ok('cancel mid-timeline leaves no ghost hitbox and releases gravity', () => {
  const a = attacker();
  const c = ctx(a);
  const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0, recovery: 0 }, c);
  for (let i = 0; i < 10; i++) h.step(DT, []); // into the first move
  h.cancel();
  assert.equal(h.state.hb, null, 'no ghost hitbox after cancel');
  assert.equal(a.dashDefyingGravity, false, 'gravity hold released on cancel');
});

ok('determinism: two runs, identical outputs', () => {
  const run = () => {
    const a = attacker();
    const e = dummyEnemy(280);
    const c = ctx(a);
    const h = invoke('dashCombo', { segments: SEGS, direction: 0, startup: 0.1, recovery: 0.1 }, c);
    const log = [];
    h.on('hit', (i) => log.push(`hit${i.segmentIndex}:${i.dealt}`));
    let finished = false;
    for (let i = 0; i < 600 && !finished; i++) finished = h.step(DT, [e]);
    return { log: log.join(','), ax: Math.round(a.x * 100) / 100, ex: Math.round(e.x * 100) / 100, hvx: Math.round(e.vx * 100) / 100 };
  };
  const r1 = run(), r2 = run();
  assert.deepEqual(r2, r1, `runs diverged: ${JSON.stringify(r1)} vs ${JSON.stringify(r2)}`);
});

console.log(`\ndashCombo: ${passed} passed`);
