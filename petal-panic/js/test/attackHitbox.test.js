// Task 4.1 — node-based unit tests for the §30 data-driven attack-hitbox
// resolver (Hero.attackHitboxWorld). Run: node js/test/attackHitbox.test.js
// No DOM needed: entity.js / consts.js / hero.js / heroDefs.js are pure modules.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero.js';
import { HEROES, ATTACK_MELEE, ATTACK_SPECIAL_MELEE, ATTACK_SUPERMOVE } from '../heroDefs.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const DT = 1 / 60;
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, super: false, melee: false });

// --- Helpers -----------------------------------------------------------------
function makeHero(id = 'scarlet', x = 0, y = 0) { return new Hero(HEROES[id], x, y); }
// Advance a normal swing to a specific integer frame index without update().
function setSwingFrame(h, idx) { h.meleeActive = true; h.meleeFrame = idx; }
// Advance a special swing to a specific integer frame index + derived phase.
function setSpecialFrame(h, idx) {
  const cfg = h.heroDef.specialMelee;
  const phase = idx < cfg.frames.windup ? 'windup'
    : idx < cfg.frames.windup + cfg.frames.active ? 'active'
    : 'recovery';
  h.specialMeleeActive = true;
  h.specialMeleePhase = phase;
  h.specialMeleeFrame = idx;
}
// Start a real supermove dash via the production path.
function startDash(h, facing = 1) {
  h.facing = facing;
  h.supermoveMeter = h.SUPERMOVE_MAX;
  const inp = noInput(); inp.super = true;
  h.update(DT, inp);
}
const center = (h) => { const wb = h.worldBox(); return { cx: wb.x + wb.w / 2, cy: wb.y + wb.h / 2 }; };
/** Assert a box is mirrored correctly around the active-box center for `dir`. */
function assertMirrored(box, dir, entry, h) {
  const { cx, cy } = center(h);
  const wantX = dir > 0 ? cx + entry.ox : cx - entry.ox - entry.bw;
  assert.ok(approx(box.x, wantX), `x=${box.x} want ${wantX} (facing ${dir})`);
  assert.ok(approx(box.y, cy + entry.oy - entry.bh / 2), `y=${box.y} want ${cy + entry.oy - entry.bh / 2}`);
  assert.equal(box.w, entry.bw);
  assert.equal(box.h, entry.bh);
}

console.log('Resolver API');
ok('all three attacks resolve through attackHitboxWorld', () => {
  const h = makeHero();
  assert.equal(typeof h.attackHitboxWorld, 'function');
  // Idle hero: every attack resolves to null (no active window).
  assert.equal(h.attackHitboxWorld(ATTACK_MELEE), null);
  assert.equal(h.attackHitboxWorld(ATTACK_SPECIAL_MELEE), null);
  assert.equal(h.attackHitboxWorld(ATTACK_SUPERMOVE), null);
});
ok('unknown attack name throws (no silent null)', () => {
  const h = makeHero();
  assert.throws(() => h.attackHitboxWorld('bogus'), /unknown attack/);
});

console.log('Data tables live in heroDefs (§30 tuning surface)');
ok('every hero carries an attacks table with all three entries', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const atk = HEROES[id].attacks;
    assert.ok(atk, `${id} missing attacks table`);
    assert.ok(Array.isArray(atk[ATTACK_MELEE].frames), `${id} melee frames must be a per-frame array`);
    assert.ok(atk[ATTACK_MELEE].frames.length >= 5, `${id} melee frames must span the 5-frame swing`);
    assert.ok(atk[ATTACK_SPECIAL_MELEE] ?? HEROES[id].specialMelee.hitbox, `${id} missing special melee hitbox data`);
    assert.ok(atk[ATTACK_SUPERMOVE].box, `${id} missing supermove box data`);
  }
});
ok('per-hero special melee differences come from DATA, not code branches', () => {
  // Both heroes share geometry today; the point is the resolver reads the
  // per-hero table. Give scarlet a distinct box and confirm it flows through
  // with zero code changes.
  const saved = { ...HEROES.scarlet.specialMelee.hitbox };
  HEROES.scarlet.specialMelee.hitbox = { ox: 12, oy: -4, bw: 52, bh: 30 };
  try {
    const s = makeHero('scarlet');
    const b = makeHero('balthazar');
    s.x = 100; s.y = 100; s.facing = 1;
    b.x = 100; b.y = 100; b.facing = 1;
    setSpecialFrame(s, 4);
    setSpecialFrame(b, 4);
    const sb = s.attackHitboxWorld(ATTACK_SPECIAL_MELEE);
    const bb = b.attackHitboxWorld(ATTACK_SPECIAL_MELEE);
    assert.equal(sb.w, 52); assert.equal(sb.h, 30);   // scarlet's data
    assert.equal(bb.w, 36); assert.equal(bb.h, 26);   // balthazar's data (half-height leg sweep)
    assert.notEqual(sb.x, bb.x, 'boxes must differ purely by data');
  } finally {
    HEROES.scarlet.specialMelee.hitbox = saved;
  }
});

console.log('Active windows (AC #2)');
ok('melee: box only on configured active frame(s), null elsewhere', () => {
  const h = makeHero();
  const frames = HEROES.scarlet.attacks[ATTACK_MELEE].frames;
  for (let f = 0; f < frames.length; f++) {
    setSwingFrame(h, f);
    const box = h.attackHitboxWorld(ATTACK_MELEE);
    if (frames[f]) assert.ok(box, `frame ${f} has data → box expected`);
    else assert.equal(box, null, `frame ${f} has no data → null expected`);
  }
  h.meleeActive = false;
  assert.equal(h.attackHitboxWorld(ATTACK_MELEE), null, 'idle hero → null');
});
ok('special melee: box only during the active phase', () => {
  const h = makeHero('balthazar');
  const cfg = HEROES.balthazar.specialMelee;
  for (let f = 0; f < h.specialMeleeTotalFrames; f++) {
    setSpecialFrame(h, f);
    const box = h.attackHitboxWorld(ATTACK_SPECIAL_MELEE);
    const isActive = f >= cfg.frames.windup && f < cfg.frames.windup + cfg.frames.active;
    if (isActive) assert.ok(box, `frame ${f} is active → box expected`);
    else assert.equal(box, null, `frame ${f} is not active → null expected`);
  }
  h.specialMeleeActive = false;
  assert.equal(h.attackHitboxWorld(ATTACK_SPECIAL_MELEE), null, 'idle hero → null');
});
ok('supermove: box for the whole dash, null when idle or after end', () => {
  const h = makeHero();
  assert.equal(h.attackHitboxWorld(ATTACK_SUPERMOVE), null, 'before trigger → null');
  startDash(h);
  const during = h.attackHitboxWorld(ATTACK_SUPERMOVE);
  assert.ok(during, 'dashing → box expected');
  assert.equal(during.h, h.h, 'body-height box matches the hero height');
  // Run the dash out naturally.
  for (let i = 0; i < 120 && h.supermoveActive; i++) h.update(DT, noInput());
  assert.equal(h.supermoveActive, false);
  assert.equal(h.attackHitboxWorld(ATTACK_SUPERMOVE), null, 'after dash ends → null');
});

console.log('Facing mirror (AC #3): both facings × all attacks');
for (const id of ['scarlet', 'balthazar']) {
  ok(`${id}: melee mirrors correctly for facing ±1`, () => {
    const h = makeHero(id, 100, 100);
    const entry = HEROES[id].attacks[ATTACK_MELEE].frames[3];
    setSwingFrame(h, 3);
    h.facing = 1;
    assertMirrored(h.attackHitboxWorld(ATTACK_MELEE), 1, entry, h);
    h.facing = -1;
    assertMirrored(h.attackHitboxWorld(ATTACK_MELEE), -1, entry, h);
  });
  ok(`${id}: special melee mirrors correctly for facing ±1`, () => {
    const h = makeHero(id, 100, 100);
    const entry = HEROES[id].specialMelee.hitbox;
    setSpecialFrame(h, 4);
    h.facing = 1;
    assertMirrored(h.attackHitboxWorld(ATTACK_SPECIAL_MELEE), 1, entry, h);
    h.facing = -1;
    assertMirrored(h.attackHitboxWorld(ATTACK_SPECIAL_MELEE), -1, entry, h);
  });
  ok(`${id}: supermove mirrors correctly for facing ±1`, () => {
    const h = makeHero(id, 100, 100);
    const raw = HEROES[id].attacks[ATTACK_SUPERMOVE].box;
    const entry = { ...raw, bh: raw.bh === 'body' ? h.h : raw.bh };
    startDash(h, 1);
    assertMirrored(h.attackHitboxWorld(ATTACK_SUPERMOVE), 1, entry, h);
    h.facing = -1; // mid-dash turn: the box must follow the new facing
    assertMirrored(h.attackHitboxWorld(ATTACK_SUPERMOVE), -1, entry, h);
  });
}

console.log('Legacy getters delegate to the resolver');
ok('melee/special/supermove getters return exactly what the resolver returns', () => {
  const h = makeHero('balthazar', 50, 50);
  setSwingFrame(h, 3);
  setSpecialFrame(h, 4);
  startDash(h);
  assert.deepEqual(h.meleeHitboxWorld, h.attackHitboxWorld(ATTACK_MELEE));
  assert.deepEqual(h.specialMeleeHitboxWorld, h.attackHitboxWorld(ATTACK_SPECIAL_MELEE));
  assert.deepEqual(h.supermoveHitboxWorld, h.attackHitboxWorld(ATTACK_SUPERMOVE));
});

console.log(`\n${passed} assertions passed.`);
if (process.exitCode) console.error('FAILURES above');
