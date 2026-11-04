// Task 3.1 — node-based unit tests for Projectile + Pool + 8-way aim.
// Run: node js/test/projectile.test.js
// No DOM needed: entity.js / consts.js / projectile.js are pure modules.

import { strict as assert } from 'node:assert';
import {
  Projectile, Pool, projectilePool, MAX_PROJECTILES,
  dirAngle, aimFromInput, PROJECTILE_TARGET_H,
  initProjectileSprites, getProjectileSpriteData,
} from '../objects/projectile.js';
import { spawnProjectile } from '../combat/attack/primitives/projectile.js';
import { LAYER } from '../consts.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('Projectile class');
ok('friendly → PROJ_ALLY layer', () => {
  const p = new Projectile(0, 0, 0, true);
  assert.equal(p.layer, LAYER.PROJ_ALLY);
});
ok('foe → PROJ_FOE layer', () => {
  const p = new Projectile(0, 0, 0, false);
  assert.equal(p.layer, LAYER.PROJ_FOE);
  assert.equal(p.friendly, false);
});
ok('size from pure target model (targetH × 48), gravity 0, speed 600, damage 10, life 2', () => {
  const p = new Projectile(0, 0, 0, true);
  // h is ALWAYS targetH × 48; w is sheet-owned (square thorn box ⇒ w == h).
  assert.ok(Math.abs(p.h - PROJECTILE_TARGET_H * 48) < 1e-9, `h=${p.h}`);
  assert.ok(Math.abs(p.w - p.h) < 1, `w=${p.w} should match h (square sheet box)`);
  assert.equal(p.gravity, 0);
  assert.equal(p.speed, 600);
  assert.equal(p.damage, 10);
  assert.equal(p.life, 2);
});

console.log('8-direction velocities (speed 600)');
// Expected unit vectors per dir index.
const EXPECTED = [
  [1, 0],      // 0 right
  [Math.SQRT1_2, -Math.SQRT1_2], // 1 up-right
  [0, -1],     // 2 up
  [-Math.SQRT1_2, -Math.SQRT1_2],// 3 up-left
  [-1, 0],     // 4 left
  [-Math.SQRT1_2, Math.SQRT1_2], // 5 down-left
  [0, 1],      // 6 down
  [Math.SQRT1_2, Math.SQRT1_2],  // 7 down-right
];
for (let d = 0; d < 8; d++) {
  ok(`dir ${d} velocity`, () => {
    const p = new Projectile(0, 0, d, true);
    assert.ok(approx(p.vx, EXPECTED[d][0] * 600), `vx=${p.vx} want ${EXPECTED[d][0]*600}`);
    assert.ok(approx(p.vy, EXPECTED[d][1] * 600), `vy=${p.vy} want ${EXPECTED[d][1]*600}`);
  });
}

console.log('aimFromInput');
ok('no input → facing (right)', () => assert.equal(aimFromInput({}, 1), 0));
ok('no input → facing (left)', () => assert.equal(aimFromInput({}, -1), 4));
ok('right', () => assert.equal(aimFromInput({ right: true }, 1), 0));
ok('left', () => assert.equal(aimFromInput({ left: true }, -1), 4));
ok('up', () => assert.equal(aimFromInput({ up: true }, 1), 2));
ok('down', () => assert.equal(aimFromInput({ down: true }, 1), 6));
ok('up+right', () => assert.equal(aimFromInput({ up: true, right: true }, 1), 1));
ok('up+left', () => assert.equal(aimFromInput({ up: true, left: true }, -1), 3));
ok('down+left', () => assert.equal(aimFromInput({ down: true, left: true }, -1), 5));
ok('down+right', () => assert.equal(aimFromInput({ down: true, right: true }, 1), 7));

console.log('Lifetime cull');
ok('dies after 2s of updates', () => {
  const p = new Projectile(0, 0, 0, true);
  assert.equal(p.alive, true);
  p.update(1);   // t=1
  assert.equal(p.alive, true);
  p.update(0.99); // t=1.99
  assert.equal(p.alive, true);
  p.update(0.02); // t=2.01
  assert.equal(p.alive, false);
});

console.log('Lifetime cull');
ok('moves straight (no gravity drift)', () => {
  const p = new Projectile(0, 0, 0, true);
  p.update(0.5);
  assert.ok(approx(p.x, 300), `x=${p.x} want 300`);
  assert.ok(approx(p.y, 0), `y=${p.y} want 0`);
});

console.log('Ballistic fields (Task 1.1)');
ok('defaults: gravityValue=0, explode=false, plain life timer (no relabel)', () => {
  const p = new Projectile(0, 0, 0, true);
  assert.equal(p.gravityValue, 0);
  assert.equal(p.explode, false);
  assert.equal(p._ttlLabel, undefined, 'no relabel — tickTtl() defaults to life');
  assert.ok(p.timers.get('life') > 0, 'life timer registered');
});
ok('explode=true → plain life timer counts down and expiry kills the shot', () => {
  const p = new Projectile(0, 0, 0, true, 'bomb');
  // Bombs no longer relabel the life timer as 'fuse' — same plain 'life'
  // countdown as thorns (display and expiry share one bar).
  assert.ok(p.timers.get('life') > 0, 'bomb carries the plain life timer');
  const t0 = p.timers.get('life'); // bomb lifetime (1.5)
  p.update(0.5);
  assert.ok(Math.abs(p.ttl - (t0 - 0.5)) < 1e-9, `ttl=${p.ttl} want ${t0 - 0.5}`);
  assert.equal(p.alive, true);
  p.update(1.6);
  assert.equal(p.alive, false, 'life expiry kills the shot');
  assert.equal(p.ttlExpired, true, 'expiry flagged ttlExpired');
});
ok('arcing motion: gravityValue=800 integrates vy += g*dt and moves by v*dt', () => {
  const p = new Projectile(0, 0, 0, true); // dir 0: vx=600, vy=0
  p.gravityValue = 800;
  const dt = 0.1;
  // Step 1: vy 0→80, x += 600*0.1, y += 80*0.1 (gravity applied before move).
  p.update(dt);
  assert.ok(Math.abs(p.vy - 80) < 1e-9, `vy=${p.vy} want 80`);
  assert.ok(Math.abs(p.x - 60) < 1e-9, `x=${p.x} want 60`);
  assert.ok(Math.abs(p.y - 8) < 1e-9, `y=${p.y} want 8`);
  // Step 2: vy 80→160, x += 60, y += 160*0.1 (move uses the UPDATED vy).
  p.update(dt);
  assert.ok(Math.abs(p.vy - 160) < 1e-9, `vy=${p.vy} want 160`);
  assert.ok(Math.abs(p.x - 120) < 1e-9, `x=${p.x} want 120`);
  assert.ok(Math.abs(p.y - 24) < 1e-9, `y=${p.y} want 24`);
});

console.log('Object Pool');
ok('pool size == MAX_PROJECTILES (64)', () => {
  assert.equal(MAX_PROJECTILES, 64);
  assert.equal(projectilePool.items.length, 64);
});
ok('spawn reuses inactive slots, returns live item', () => {
  const pool = new Pool(Projectile, 4);
  const a = pool.spawn(10, 10, 0, true);
  assert.ok(a && a.alive);
  assert.equal(pool.count, 1);
  a.alive = false; pool.active.splice(0, 1); // kill it
  const b = pool.spawn(20, 20, 4, true);
  assert.equal(b, a); // same slot reused (no allocation)
  assert.equal(pool.count, 1);
});
ok('exhausted pool returns null (soft cap)', () => {
  const pool = new Pool(Projectile, 2);
  assert.ok(pool.spawn(0, 0, 0, true));
  assert.ok(pool.spawn(0, 0, 1, true));
  assert.equal(pool.spawn(0, 0, 2, true), null);
});
ok('updateAll ticks active and drops dead', () => {
  const pool = new Pool(Projectile, 4);
  const a = pool.spawn(0, 0, 0, true);
  const b = pool.spawn(0, 0, 4, true);
  pool.updateAll(2.5); // both exceed lifetime
  assert.equal(pool.count, 0);
  assert.equal(a.alive, false);
  assert.equal(b.alive, false);
});
ok('fire 100 shots → no allocation beyond pool, all reused', () => {
  const pool = new Pool(Projectile, 8);
  // Every spawned item must be one of the 8 pre-allocated slots (no new objects).
  const slots = new Set(pool.items);
  for (let i = 0; i < 100; i++) {
    const p = pool.spawn(i, i, i % 8, true);
    assert.ok(slots.has(p), `allocation outside pool at shot ${i}`);
    pool.updateAll(3); // cull everything so next spawn reuses a slot
  }
  assert.equal(pool.items.length, 8); // still exactly 8 objects
});
ok('shared projectilePool is pre-allocated once', () => {
  assert.equal(projectilePool.items.length, MAX_PROJECTILES);
  assert.equal(projectilePool.count, 0);
});


// --- Bomb bounce off solids (special-weapons.md: bombs reflect, saws fizzle) ---
ok('bomb bounce reflects horizontal velocity with energy loss', () => {
  const b = new Projectile(0, 0, 0, true, 'bomb');
  assert.equal(b.solidBehavior, 'reflect', 'bomb data declares reflect');
  b.x = 60; b.y = 50; b.vx = 300; b.vy = -100;
  const box = { x: 50, y: 0, w: 20, h: 100 }; // right edge at x=70 = bomb center
  b.reflectVelocity(box);
  assert.ok(b.vx < 0, `vx flipped (${b.vx.toFixed(1)})`);
  assert.ok(Math.abs(b.vx) < 300, 'energy lost on bounce');
});
ok('saw data declares stop; bomb vertical reflection works', () => {
  const sw = new Projectile(0, 0, 0, true, 'saw');
  assert.equal(sw.solidBehavior, 'stop', 'saw data declares stop');
  const b = new Projectile(0, 0, 0, true, 'bomb');
  b.x = 0; b.y = 90; b.vx = 100; b.vy = 300;
  const box = { x: -50, y: 80, w: 200, h: 40 };
  b.reflectVelocity(box);
  assert.ok(b.vy < 0, `vy flipped upward (${b.vy.toFixed(1)})`);
});

// --- Task 1.5: rock look for typeless arcing carriers -------------------------
// Sheets load through the file: URL path (node fs) — the same code the
// browser takes over fetch. Without them applyRockLook() must still set the
// flag + clear the outline (pre-boot contract).
ok('applyRockLook (pre-boot): flag set, outline cleared, no crash', () => {
  const p = new Projectile(0, 0, 0, true);
  p.w = 18; p.h = 18; p.vx = 300; p.vy = -400;
  p.applyRockLook();
  assert.equal(p._rockLook, true, 'look flag set even pre-boot');
  assert.equal(p._outline, null, 'rock never gets the thorn outline');
  assert.equal(p.w, 18);
  assert.equal(p.h, 18);
});

await initProjectileSprites();
ok('applyRockLook (sheet loaded): sprite is the rock_medium anim', () => {
  const p = new Projectile(0, 0, 0, true);
  p.w = 18; p.h = 18; p.vx = 300; p.vy = -400;
  p.applyRockLook();
  assert.equal(p._rockLook, true);
  assert.equal(p._outline, null, 'no outline on rock');
  const rockData = getProjectileSpriteData('rock_medium');
  assert.ok(rockData?.anims?.shoot, 'rock_medium sheet loaded');
  assert.equal(p.sprite?.anims?.shoot, rockData.anims.shoot, 'sprite switched to rock_medium');
});
ok('applyRockLook: 18px physics box survives setAnim re-derivation', () => {
  const p = new Projectile(0, 0, 0, true);
  p.w = 18; p.h = 18;
  p.applyRockLook();
  assert.equal(p.w, 18, `w=${p.w} — box must stay the 18px carrier square`);
  assert.equal(p.h, 18, `h=${p.h}`);
});
ok('straight typeless shot: no rock look (thorn path untouched)', () => {
  const p = new Projectile(0, 0, 0, true);
  assert.equal(p._rockLook, undefined, 'initialize never sets the flag');
  assert.equal(p.gravityValue, 0);
});

// --- Task 1.5 (reviewer B2 follow-ups): draw routing, box re-pin, pool reuse, e2e

// Minimal 2d-canvas recorder: drawSprite()/drawers only call standard
// methods, and each identity has a distinct fillStyle to spy on.
function recordingCtx() {
  const rec = { fillStyles: [], calls: [] };
  const target = {
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() {},
    fillRect() { rec.calls.push('fillRect'); },
    drawImage() { rec.calls.push('drawImage'); },
  };
  return {
    rec,
    ctx: new Proxy(target, {
      get(t, k) { return k in t ? t[k] : (...a) => { rec.calls.push(k); }; },
      set(t, k, v) { if (k === 'fillStyle') rec.fillStyles.push(String(v)); t[k] = v; return true; },
    }),
  };
}

ok('draw routing: rock carrier draws rockDrawer art, never the thorn debug fill', () => {
  const p = new Projectile(0, 0, 0, true);
  p.w = 18; p.h = 18; p.vx = 300; p.vy = -400;
  p.applyRockLook();
  const { rec, ctx } = recordingCtx();
  p.draw(ctx);
  assert.ok(rec.fillStyles.includes('#8d7b6b'), `rock body color in ${rec.fillStyles}`);
  assert.ok(!rec.fillStyles.includes('#ff6ec7'), 'thorn debug fill absent');
  assert.ok(!rec.calls.includes('drawImage'), 'no sheet frame without loaded images');
});
ok('draw routing: straight thorn keeps its debug-fill path (no rock drawer)', () => {
  const p = new Projectile(0, 0, 0, true);
  const { rec, ctx } = recordingCtx();
  p.draw(ctx);
  assert.ok(rec.fillStyles.includes('#ff6ec7'), 'thorn debug fill present');
  assert.ok(!rec.fillStyles.includes('#8d7b6b'), 'rock drawer absent');
});
ok('box re-pin: a non-18 explicit carrier box survives applyRockLook', () => {
  const p = new Projectile(0, 0, 0, true);
  p.w = 24; p.h = 8; // throwMine-style non-square box
  p.applyRockLook();
  assert.equal(p.w, 24, `w=${p.w}`);
  assert.equal(p.h, 8, `h=${p.h}`);
});
ok('pool reuse: rock flag does not leak into the next (thorn) life', () => {
  const pool = new Pool(Projectile, 4);
  const rock = pool.spawn(10, 10, 0, true);
  rock.w = 18; rock.h = 18; rock.applyRockLook();
  assert.equal(rock._rockLook, true);
  rock.alive = false;
  const thorn = pool.spawn(20, 20, 4, true);
  assert.equal(thorn, rock, 'same slot reused (no allocation)');
  assert.equal(thorn._rockLook, undefined, 'flag wiped by Pool.spawn key-delete');
});
ok('spawnArcing e2e: default typeless arcing carrier keeps the THORN look', () => {
  const pool = new Pool(Projectile, 4);
  const ctx = { pools: { projectilePool: pool }, attacker: { x: 100, y: 100, w: 32, h: 32 } };
  const ent = spawnProjectile({ speed: 500, direction: -0.6, arc: 800, ttl: 2, damage: 40, team: 'ally' }, ctx, null);
  assert.ok(ent, 'carrier spawned');
  assert.equal(ent._rockLook, undefined, 'default arcing carrier is NOT a rock (1.5 revised)');
  assert.equal(ent.w, 18, `w=${ent.w}`);
  assert.equal(ent.h, 18, `h=${ent.h}`);
  assert.equal(ent._attackId, 'projectile');
  assert.equal(ent._arcRecipe, true);
});
ok('spawnArcing e2e: rock:true gives a real rock-look Projectile', () => {
  const pool = new Pool(Projectile, 4);
  const ctx = { pools: { projectilePool: pool }, attacker: { x: 100, y: 100, w: 32, h: 32 } };
  const ent = spawnProjectile({ speed: 500, direction: -0.6, arc: 800, ttl: 2, damage: 40, team: 'ally', rock: true }, ctx, null);
  assert.ok(ent, 'carrier spawned');
  assert.ok(ent instanceof Projectile, 'real Projectile from the real pool');
  assert.equal(ent._rockLook, true, 'rock param applied the rock look');
  assert.equal(ent._outline, null, 'no outline');
  assert.equal(ent.w, 18, `w=${ent.w}`);
  assert.equal(ent.h, 18, `h=${ent.h}`);
});

// --- Task 2.1: outline thickness is data-driven (sheet `outline` field) --------
ok('outline: thorn (sheet declares none) gets the default contour', () => {
  const p = new Projectile(0, 0, 0, true);
  assert.equal(getProjectileSpriteData('thorn').outline, undefined, 'thorn sheet declares no outline');
  assert.ok(p._outline, 'default-2 contour created for thorn');
});
ok('outline: rock sheet declares 0 → no outline (via applyRockLook)', () => {
  const p = new Projectile(0, 0, 0, true);
  p.w = 18; p.h = 18; p.applyRockLook();
  assert.equal(getProjectileSpriteData('rock_medium').outline, 0, 'sheet value passthrough');
  assert.equal(p._outline, null, 'outline: 0 → none');
});
ok('outline: bomb (sheet declares none) gets the default contour', () => {
  const b = new Projectile(0, 0, 0, true, 'bomb');
  assert.equal(getProjectileSpriteData('bomb').outline, undefined, 'bomb sheet declares no outline');
  assert.ok(b._outline, 'default-2 contour created for bomb');
});
ok('outline: a sheet-declared custom thickness (3) reaches the render', () => {
  // Drive a non-default thickness through the REAL initialize() path by
  // patching the loaded thorn sheet data (restored in finally).
  const data = getProjectileSpriteData('thorn');
  assert.ok(data, 'thorn sheet loaded');
  const orig = data.outline;
  try {
    data.outline = 3;
    const p = new Projectile(0, 0, 0, true);
    assert.ok(p._outline, 'outline created for the configured thickness');
    // No frames in node → spriteOutline uses the box fallback: the stroke is
    // centered on the path, so lineWidth = 2t. Observable wiring proof.
    const seen = {};
    const ctx = {
      save() {}, restore() {},
      strokeRect() { seen.strokeRect = true; },
      set lineWidth(v) { seen.lineWidth = v; },
    };
    p._outline.render(ctx);
    assert.equal(seen.lineWidth, 6, `lineWidth=${seen.lineWidth} — expected 2×3`);
  } finally {
    data.outline = orig;
  }
});
console.log(`\n${passed} assertions passed.`);
