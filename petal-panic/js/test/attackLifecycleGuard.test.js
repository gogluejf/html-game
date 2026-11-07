// Attack Lifecycle — discarded-handle GUARD test (task 4.2).
//
// Catches the bug class "macro fired and abandoned": an attack handle that is
// neither driven by the registry, stepped by a live parent, nor finished.
// Coverage (minimal but representative, per plan §4.2):
//   - hero-shot roots via BombAttackHost.spawn (explosiveBomb, homingMissile)
//   - barrel payload: bare invoke('spawnSplit', { child: 'molotov' }) fan
//   - enemy payloads: bare invoke('shockwave') + invoke('explosion')
// Guard property: every handle that passed through AttackLifecycle.register
// must be (a) in _live, (b) completed/cancelled, or (c) reachable from a live
// root via .handles/.inner. Any other case = discarded handle = failure.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import '../effects/registry.js';
import '../combat/attack/macros/index.js';
import '../combat/attack/primitives/explosion.js';
import '../combat/attack/primitives/shockwave.js';
import { invoke } from '../combat/attack/engine.js';
import { BombAttackHost } from '../combat/attack/bombAttackHost.js';
import { AttackLifecycle } from '../combat/attack/lifecycle.js';
import { Pool, Projectile } from '../objects/projectile.js';

const dt = 1 / 60;

function harnessCtx() {
  return {
    attacker: { x: 0, y: 0, w: 32, h: 48 },
    pools: { projectilePool: new Pool(Projectile, 16) },
    groundY: 400,
    platforms: [],
    bombTerrainStepped: true,
    world: { targets: [], hero: null },
  };
}

/** Walk .handles/.inner from every live root; return the reachable set. */
function reachableFromLive() {
  const seen = new Set();
  const visit = (h) => {
    if (!h || seen.has(h)) return;
    seen.add(h);
    for (const c of h.handles ?? []) visit(c);
    visit(h.inner);
  };
  for (const h of AttackLifecycle._live) visit(h);
  return seen;
}

test('guard: no discarded handles across hero/barrel/enemy entry points', () => {
  AttackLifecycle.clear();
  // Instrument register to record every handle that passes through it.
  const registered = [];
  const origRegister = AttackLifecycle.register.bind(AttackLifecycle);
  AttackLifecycle.register = (h, opts) => {
    if (h) registered.push(h);
    return origRegister(h, opts);
  };
  try {
    const ctx = harnessCtx();
    const host = new BombAttackHost(() => ctx);

    // 1. Hero-shot roots (registry-owned since task 3.2).
    const bombRoot = host.spawn('explosiveBomb', { ttl: 0.3 }, ctx.attacker);
    const missileRoot = host.spawn('homingMissile', { timeToTarget: 0.3 }, ctx.attacker);

    // 2. Barrel payload: propane-style molotov fan (bare invoke, inline ctx).
    const fanRoot = invoke('spawnSplit', {
      x: 200, y: 300, count: 3, centerDirection: -Math.PI / 2, angle: Math.PI * 0.7,
      force: 520, child: 'molotov',
      molotov: { arc: 800, bounce: false, ttl: 0.4, fireSegments: 2, team: 'neutral' },
      groundY: 400,
    }, ctx);

    // 3. Enemy payloads: shockwave (duration, needs stepping) + explosion (instant).
    const shockRoot = invoke('shockwave', {
      x: 300, y: 350, radius: 200, duration: 0.2, damage: 5, shake: false,
    }, ctx);
    const blastRoot = invoke('explosion', {
      x: 300, y: 350, radius: 60, damage: 40, burst: false, screenFlash: false, shake: false,
    }, ctx);

    // Drive frames so deferred children materialize and short attacks finish.
    for (let i = 0; i < 40; i++) {
      ctx.pools.projectilePool.updateAll(dt);
      AttackLifecycle.stepAll(dt, ctx.world.targets, { refreshCtx: () => ctx });
    }

    // Acceptance bullet 1: the molotov fan's children are not discarded.
    assert.ok(fanRoot._completed || AttackLifecycle._live.has(fanRoot),
      'fan root must be live or completed');
    const fanChildren = fanRoot.handles ?? [];
    assert.ok(fanChildren.length > 0, 'fan materialized molotov children');
    const reachable = reachableFromLive();
    for (const ch of fanChildren) {
      assert.ok(reachable.has(ch) || ch._completed || ch._cancelled,
        `fan child ${ch.id} is discarded (not live, not reachable, not finished)`);
    }

    // Acceptance bullet 2: enemy payloads registered-or-completed, never dropped.
    assert.ok(blastRoot._completed, 'explosion completes synchronously');
    assert.ok(shockRoot._completed || AttackLifecycle._live.has(shockRoot) || reachable.has(shockRoot),
      'shockwave payload must be live or completed (not silently dropped)');

    // Guard property over EVERY registered handle.
    const discarded = registered.filter((h) =>
      !AttackLifecycle._live.has(h) &&
      !h._completed && !h._cancelled &&
      !reachable.has(h));
    assert.equal(discarded.length, 0,
      `discarded handles: ${discarded.map((h) => h.id).join(', ')}`);

    // Sanity: the roots we care about were actually registered.
    for (const root of [bombRoot, missileRoot, fanRoot, shockRoot]) {
      assert.ok(registered.includes(root), `${root.id} root must pass through register()`);
    }
  } finally {
    AttackLifecycle.register = origRegister;
    AttackLifecycle.clear();
  }
});
