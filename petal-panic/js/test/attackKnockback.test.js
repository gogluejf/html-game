// Task 2.1 — knockback vectors on the three committed hero attack hitboxes
// (docs/architecture/knockback.md §11). Run: node js/test/attackKnockback.test.js
// No DOM needed: heroDefs.js / hero.js are pure modules.
//
// Each melee-family attack carries two shove tiers:
//   - knockbackModerate: surviving hits keep the victim in reach.
//   - knockbackBig: killing hits and finisher frames launch them away.
// The resolved world box exposes both tiers; processHitboxes chooses big when
// the hit kills or the frame is marked as a finisher. Thorn/special projectile
// definitions carry no knockback fields.

import { strict as assert } from 'node:assert';
import { Hero } from '../hero/hero.js';
import { HEROES, ATTACK_MELEE, ATTACK_SPECIAL_MELEE, ATTACK_SUPERMOVE } from '../hero/heroDefs.js';
import { applyKnockback } from '../combat/knockback.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60;
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, special: false, melee: false, super: false });
const makeHero = (id) => new Hero(HEROES[id], 0, 0);
function setSpecialActive(h) {
  h.specialMeleeActive = true;
  h.specialMeleePhase = 'active';
  h.specialMeleeFrame = 4; // mid-swing (table fallback: active)
}
function startDash(h, facing = 1) {
  h.facing = facing;
  h.supermoveMeter = h.SUPERMOVE_MAX;
  const inp = noInput(); inp.super = true;
  h.update(DT, inp);
}
function setSwingFrame(h, idx) { h.meleeActive = true; h.meleeFrame = idx; }

console.log('heroDefs data (two-tier knockback matrix)');

for (const id of ['balthazar', 'scarlet']) {
  ok(`${id} sweep carries moderate + big pushback`, () => {
    const cfg = HEROES[id].specialMelee;
    assert.ok(cfg.knockbackModerate && cfg.knockbackBig);
    assert.equal(cfg.knockbackModerate.x, 550);
    assert.equal(cfg.knockbackModerate.y, -180);
    assert.equal(cfg.knockbackModerate.hitstun, 0.45);
    assert.equal(cfg.knockbackModerate.dirMode, 'fixed');
    assert.equal(cfg.knockbackBig.x, 750);
    assert.equal(cfg.knockbackBig.y, -330);
    assert.equal(cfg.knockbackBig.hitstun, 0.50);
    assert.equal(cfg.knockbackBig.dirMode, 'fixed');
  });

  ok(`${id} supermove carries strongest moderate + big launch`, () => {
    const cfg = HEROES[id].attacks[ATTACK_SUPERMOVE];
    assert.ok(cfg.knockbackModerate && cfg.knockbackBig);
    assert.equal(cfg.knockbackModerate.x, 300);
    assert.equal(cfg.knockbackModerate.y, -120);
    assert.equal(cfg.knockbackModerate.hitstun, 0.30);
    assert.equal(cfg.knockbackModerate.dirMode, 'fromAttacker');
    assert.equal(cfg.knockbackBig.x, 850);
    assert.equal(cfg.knockbackBig.y, -260);
    assert.equal(cfg.knockbackBig.hitstun, 0.30);
    assert.equal(cfg.knockbackBig.dirMode, 'alongVelocity');
  });

  ok(`${id} normal melee carries moderate + big jab shove`, () => {
    const cfg = HEROES[id].attacks[ATTACK_MELEE];
    assert.ok(cfg.knockbackModerate && cfg.knockbackBig);
    assert.equal(cfg.knockbackModerate.x, 450);
    assert.equal(cfg.knockbackModerate.y, -120);
    assert.equal(cfg.knockbackModerate.hitstun, 0.40);
    assert.equal(cfg.knockbackModerate.dirMode, 'fromAttacker');
    assert.equal(cfg.knockbackBig.x, 750);
    assert.equal(cfg.knockbackBig.y, -260);
    assert.equal(cfg.knockbackBig.hitstun, 0.45);
    assert.equal(cfg.knockbackBig.dirMode, 'fromAttacker');
    for (const frame of cfg.frames) {
      if (frame) assert.equal(frame.knockback, undefined, 'knockback sits beside the frames, not inside them');
    }
  });

  ok(`${id} strength ordering: super >= sweep > melee (big tier)`, () => {
    const superX = HEROES[id].attacks[ATTACK_SUPERMOVE].knockbackBig.x;
    const sweepX = HEROES[id].specialMelee.knockbackBig.x;
    const meleeX = HEROES[id].attacks[ATTACK_MELEE].knockbackBig.x;
    // 2026-11-14 retune: sweep and melee bigs share the 750 x-cap (user cap);
    // supermove's finisher (850, alongVelocity) still leads on raw push.
    assert.ok(superX >= sweepX && sweepX >= meleeX);
    const superY = HEROES[id].attacks[ATTACK_SUPERMOVE].knockbackBig.y;
    const sweepY = HEROES[id].specialMelee.knockbackBig.y;
    const meleeY = HEROES[id].attacks[ATTACK_MELEE].knockbackBig.y;
    // loft order flipped with the retune: sweep now arcs HIGHER than melee
    // (sweep kill should launch harder than a jab kill).
    assert.ok(sweepY < meleeY);
  });

  ok(`${id} thorn / special projectile definitions carry NO knockback`, () => {
    const def = HEROES[id];
    assert.equal(def.attacks.knockback, undefined);
    assert.equal(def.specialMelee.hitbox.knockback, undefined, 'knockback sits beside the hitbox, not inside it');
  });
}

console.log('Resolved world boxes expose both tiers');

ok('sweep hitbox resolves with moderate + big vectors', () => {
  for (const id of ['balthazar', 'scarlet']) {
    const h = makeHero(id);
    setSpecialActive(h);
    const box = h.attackHitboxWorld(ATTACK_SPECIAL_MELEE);
    assert.ok(box, 'active-phase sweep must resolve a box');
    assert.deepEqual(box.knockbackModerate, HEROES[id].specialMelee.knockbackModerate);
    assert.deepEqual(box.knockbackBig, HEROES[id].specialMelee.knockbackBig);
    // finisher:false — the kill tier is owned by the kill check in hitbox.js
    assert.equal(box.finisher, false);
  }
});

ok('supermove hitbox is sheet-only without authored sheet boxes', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const h = makeHero(id);
    startDash(h);
    assert.equal(h.attackHitboxWorld(ATTACK_SUPERMOVE), null,
      `${id} dashing hero must resolve a sheet-only supermove box (null without sheets)`);
  }
});

ok('melee hitbox resolves with moderate + big vectors', () => {
  for (const id of ['scarlet', 'balthazar']) {
    const h = makeHero(id);
    setSwingFrame(h, 3); // active frame per MELEE_HITBOX_FRAMES
    const box = h.attackHitboxWorld(ATTACK_MELEE);
    assert.ok(box, 'active-frame melee must resolve a box');
    assert.deepEqual(box.knockbackModerate, HEROES[id].attacks[ATTACK_MELEE].knockbackModerate);
    assert.deepEqual(box.knockbackBig, HEROES[id].attacks[ATTACK_MELEE].knockbackBig);
    // finisher:false — the kill tier is owned by the kill check in hitbox.js
    assert.equal(box.finisher, false);
  }
});

console.log('Loft on hard hits (y component of the vector)');
const mkVictim = (resist = 1) => ({ vx: 0, vy: 0, knockbackResist: resist });

ok('a supermove big hit sets victim.vy upward by the vector\'s y', () => {
  const kb = HEROES.scarlet.attacks[ATTACK_SUPERMOVE].knockbackBig;
  const v = mkVictim(1);
  const applied = applyKnockback(v, { x: kb.x, y: kb.y, hitstun: kb.hitstun });
  assert.equal(applied, true);
  assert.ok(v.vy < 0, `expected upward (negative) vy, got ${v.vy}`);
  assert.ok(Math.abs(v.vy - kb.y) < 1e-9, `expected vy=${kb.y}, got ${v.vy}`);
  assert.ok(v.vx > 0, `expected positive vx, got ${v.vx}`);
});

ok('supermove loft scales down for heavier victims (mass resists the whole vector)', () => {
  const kb = HEROES.balthazar.attacks[ATTACK_SUPERMOVE].knockbackBig;
  const light = mkVictim(1);
  const heavy = mkVictim(2);
  applyKnockback(light, { x: kb.x, y: kb.y });
  applyKnockback(heavy, { x: kb.x, y: kb.y });
  assert.ok(Math.abs(heavy.vy - light.vy / 2) < 1e-9, `heavy vy=${heavy.vy} should be half of light vy=${light.vy}`);
});

ok('sweep loft is tuned between melee and supermove (not exaggerated)', () => {
  const sweepKb = HEROES.balthazar.specialMelee.knockbackBig;
  const meleeKb = HEROES.scarlet.attacks[ATTACK_MELEE].knockbackBig;
  const v1 = mkVictim(1);
  const v2 = mkVictim(1);
  applyKnockback(v1, { x: sweepKb.x, y: sweepKb.y });
  applyKnockback(v2, { x: meleeKb.x, y: meleeKb.y });
  assert.ok(v1.vy < 0, 'sweep must still loft upward');
  // 2026-11-14 retune: sweep kill arcs higher than a jab kill.
  assert.ok(-v1.vy > -v2.vy,
    `sweep loft (${Math.abs(v1.vy)}) must be bigger than melee loft (${Math.abs(v2.vy)})`);
});

ok('a Thorn hit (no knockback) leaves vy unchanged', () => {
  const v = mkVictim(1);
  v.vx = 10; v.vy = -5;
  assert.equal(applyKnockback(v, null), false);
  assert.equal(applyKnockback(v, undefined), false);
  assert.equal(v.vy, -5, 'vy must be unchanged by a no-knockback hit');
  assert.equal(v.vx, 10, 'vx must be unchanged by a no-knockback hit');
  assert.equal(v.hitstunTimer, undefined, 'no stun from a no-knockback hit');
  for (const id of ['scarlet', 'balthazar']) {
    const def = HEROES[id];
    assert.equal(def.attacks.knockback, undefined);
    assert.equal(def.specialMelee.hitbox.knockback, undefined);
  }
});

console.log(`\n${passed} assertions passed.`);
