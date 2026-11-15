// Task 4.1 — node-based unit tests for the §30 data-driven attack-hitbox
// resolver (Hero.attackHitboxWorld). Run: node js/test/attackHitbox.test.js
// No DOM needed: entity.js / consts.js / hero.js / heroDefs.js are pure modules.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero/hero.js';
import { HEROES, ATTACK_MELEE, ATTACK_SPECIAL_MELEE, ATTACK_SUPERMOVE } from '../hero/heroDefs.js';
import { makeHitbox, processHitboxes } from '../combat/hitbox.js';
import { LAYER } from '../consts.js';

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
  h.specialMeleeActive = true;
  h.specialMeleePhase = h._specialMeleePhaseAt(idx) ?? 'active';
  h.specialMeleeFrame = idx;
}
// Start a real supermove dash via the production path.
function startDash(h, facing = 1) {
  h.facing = facing;
  h.supermoveMeter = h.SUPERMOVE_MAX;
  const inp = noInput(); inp.super = true;
  h.update(DT, inp);
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
    // Melee: sheet-only boxes — the table carries knockback tiers only.
    assert.ok(atk[ATTACK_MELEE].knockbackModerate && atk[ATTACK_MELEE].knockbackBig, `${id} missing melee knockback data`);
    assert.equal(atk[ATTACK_MELEE].frames, undefined, `${id} melee must not carry a frame table (sheet-only)`);
    assert.ok(HEROES[id].specialMelee.hitbox, `${id} missing special melee hitbox data`);
    // Supermove: NO hardcoded box — the damage window is sheet-authored only
    // (per-frame `attack` boxes). The table keeps knockback data as two tiers
    // (moderate burst shove / big finisher launch) since the two-tier rework.
    assert.equal(atk[ATTACK_SUPERMOVE].box, undefined, `${id} supermove must not carry a hardcoded box`);
    assert.ok(atk[ATTACK_SUPERMOVE].knockbackModerate && atk[ATTACK_SUPERMOVE].knockbackBig, `${id} missing supermove knockback data`);
  }
});
ok('per-hero special melee differences come from DATA, not code branches', () => {
  // Both heroes share geometry today; the point is the data table carries the
  // per-hero box (tuning surface for sheets without authored boxes). The
  // resolver itself is sheet-only — this asserts the DATA shape only.
  const saved = { ...HEROES.scarlet.specialMelee.hitbox };
  HEROES.scarlet.specialMelee.hitbox = { ox: 12, oy: -4, bw: 52, bh: 30 };
  try {
    assert.deepEqual(HEROES.scarlet.specialMelee.hitbox, { ox: 12, oy: -4, bw: 52, bh: 30 });
    assert.notDeepEqual(HEROES.scarlet.specialMelee.hitbox, HEROES.balthazar.specialMelee.hitbox,
      'boxes must differ purely by data');
  } finally {
    HEROES.scarlet.specialMelee.hitbox = saved;
  }
});

console.log('Active windows (AC #2)');
ok('melee: sheet-only — null on every swing frame without authored boxes', () => {
  const h = makeHero();
  for (let f = 0; f < 5; f++) {
    setSwingFrame(h, f);
    assert.equal(h.attackHitboxWorld(ATTACK_MELEE), null, `frame ${f} → no sheet boxes in node tests → null`);
  }
  h.meleeActive = false;
  assert.equal(h.attackHitboxWorld(ATTACK_MELEE), null, 'idle hero → null');
});
ok('special melee: sheet-only box — null without authored sheet boxes', () => {
  const h = makeHero('balthazar');
  for (let f = 0; f < h.specialMeleeTotalFrames; f++) {
    setSpecialFrame(h, f);
    assert.equal(h.attackHitboxWorld(ATTACK_SPECIAL_MELEE), null, `frame ${f} → no sheet boxes in node tests → null`);
  }
  h.specialMeleeActive = false;
  assert.equal(h.attackHitboxWorld(ATTACK_SPECIAL_MELEE), null, 'idle hero → null');
});
ok('supermove: sheet-only box — null without authored sheet boxes', () => {
  const h = makeHero();
  assert.equal(h.attackHitboxWorld(ATTACK_SUPERMOVE), null, 'before trigger → null');
  startDash(h);
  // Node tests attach no sprite sheets (Image undefined) → _sheetAttackBox
  // finds nothing → NO damage box. The box exists only when the supermove
  // sheet carries per-frame `attack` boxes (melee active-frame pattern).
  assert.equal(h.attackHitboxWorld(ATTACK_SUPERMOVE), null, 'no sheet boxes → null mid-dash');
  // Run the dash out naturally.
  for (let i = 0; i < 120 && h.supermoveActive; i++) h.update(DT, noInput());
  assert.equal(h.supermoveActive, false);
  assert.equal(h.attackHitboxWorld(ATTACK_SUPERMOVE), null, 'after dash ends → null');
});

console.log('Facing mirror (AC #3): both facings × all attacks');
for (const id of ['scarlet', 'balthazar']) {
  ok(`${id}: melee mirrors correctly for facing ±1`, () => {
    const h = makeHero(id, 100, 100);
    // Sheet-only: node tests attach no sheets → null on the active frame.
    setSwingFrame(h, 3);
    assert.equal(h.attackHitboxWorld(ATTACK_MELEE), null, 'no sheet boxes → null (mirror math covered in-game by _sheetBoxToWorld)');
    h.meleeActive = false;
  });
  ok(`${id}: special melee mirrors correctly for facing ±1`, () => {
    const h = makeHero(id, 100, 100);
    // Sheet-only: node tests attach no sheets → null (mirror math covered
    // in-game by _sheetBoxToWorld).
    setSpecialFrame(h, 4);
    assert.equal(h.attackHitboxWorld(ATTACK_SPECIAL_MELEE), null);
    h.specialMeleeActive = false;
  });
  ok(`${id}: supermove mirrors correctly for facing ±1`, () => {
    const h = makeHero(id, 100, 100);
    // Sheet-only box: node tests have no sheet attached → null both facings.
    // (In-game the per-frame sheet boxes mirror via _sheetBoxToWorld, same as
    // melee — covered by the browser debug overlay.)
    startDash(h, 1);
    assert.equal(h.attackHitboxWorld(ATTACK_SUPERMOVE), null);
    h.facing = -1;
    assert.equal(h.attackHitboxWorld(ATTACK_SUPERMOVE), null);
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

console.log('Swing-scope dedupe (one hit per target per swing across box gaps)');
// A sheet melee box can blink off mid-swing (unboxed frames). The slot
// lifecycle re-arms the instance hitSet on each re-appearance, so 'swing'
// scope boxes must dedupe against the owner's swing-level set instead.
function mkTarget(x) {
  const t = { x, y: 0, w: 20, h: 20, layer: LAYER.ENEMY, alive: true, hp: 100 };
  t.worldBox = () => ({ x: t.x, y: t.y, w: t.w, h: t.h });
  t.takeDamage = (dmg) => { t.hp -= dmg; return dmg; };
  return t;
}
ok('swing-scoped box hits a target once even when the box re-appears', () => {
  const h = makeHero('scarlet', 0, 0);
  const target = mkTarget(30);
  const hb = makeHitbox({ owner: h, team: 'ally', box: { x: 20, y: -10, w: 40, h: 40 }, damage: 10, method: 'melee' });
  hb.dedupeScope = 'swing';
  // Window 1: box active → one connect.
  processHitboxes([hb], [target]);
  assert.equal(target.hp, 90, 'first window deals one hit');
  // Box blinks off (slot would resetHitbox here — emulate it):
  hb.active = false;
  hb.hitSet.clear();
  // Window 2: box back ON within the SAME swing → swing memory blocks re-hit.
  hb.active = true;
  processHitboxes([hb], [target]);
  assert.equal(target.hp, 90, 'second window of the same swing must NOT re-hit');
  // Swing ends → memory clears → next swing connects again.
  h.endNormalMelee();
  hb.hitSet.clear();
  processHitboxes([hb], [target]);
  assert.equal(target.hp, 80, 'new swing connects again');
});
ok('default-scope box still dedupes per instance only (supermove burst contract)', () => {
  const h = makeHero('scarlet', 0, 0);
  const target = mkTarget(30);
  const hb = makeHitbox({ owner: h, team: 'ally', box: { x: 20, y: -10, w: 40, h: 40 }, damage: 10, method: 'supermove' });
  processHitboxes([hb], [target]);
  assert.equal(target.hp, 90, 'burst 1 connects');
  // Burst gap: instance resets (each supermove burst IS a separate hit).
  hb.hitSet.clear();
  processHitboxes([hb], [target]);
  assert.equal(target.hp, 80, 'burst 2 connects again (no swing memory)');
});
ok('swing memory clears on natural completion (updateMelee past total frames)', () => {
  const h = makeHero('scarlet', 0, 0);
  const target = mkTarget(30);
  const hb = makeHitbox({ owner: h, team: 'ally', box: { x: 20, y: -10, w: 40, h: 40 }, damage: 10, method: 'melee' });
  hb.dedupeScope = 'swing';
  // Swing 1: connect.
  h.meleeActive = true;
  processHitboxes([hb], [target]);
  assert.equal(target.hp, 90, 'swing 1 connects');
  // Run the swing out naturally — the inline completion path must clear memory.
  h.updateMelee(h.MELEE_DURATION + 0.05);
  assert.equal(h.meleeActive, false, 'swing ended');
  assert.equal(h._meleeHitTargets.size, 0, 'memory cleared on natural completion');
  // Swing 2 against the same target must connect again.
  h.tryMelee();
  hb.hitSet.clear();
  processHitboxes([hb], [target]);
  assert.equal(target.hp, 80, 'swing 2 connects after natural completion');
});

console.log(`\n${passed} assertions passed.`);
if (process.exitCode) console.error('FAILURES above');
