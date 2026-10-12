// Special weapon slots + rotation (special-weapons.md).
// Run: node js/test/specialRotation.test.js
// No DOM needed: hero.js / entity.js / consts.js / projectile.js are pure modules.
//
// Invariants under test (all driven by SPECIAL_SLOT_COUNT — nothing here
// assumes exactly two slots beyond what that constant says):
//   - acquireSpecial: first empty → replace selected slot → slot 0; ALWAYS auto-selects
//   - same-special pickup replaces per placement rules (no stacking)
//   - rotateWeapon cycles default → filled slots → default, skipping empties
//   - loseSelectedSpecial clears the selected slot, compacts left, falls back
//   - J fires the selected slot's weapon without mutating it; N never fires

import { strict as assert } from 'node:assert';
import { Hero, WEAPON_THORN, SPECIAL_SLOT_COUNT } from '../hero/hero.js';
import { HEROES } from '../hero/heroDefs.js';
import { projectilePool, specialPool, SPECIAL_WEAPON_DEFS } from '../objects/projectile.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60;
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, melee: false });
const makeHero = () => new Hero(HEROES.scarlet, 0, 0);

/** Fire once through the SAME code path update.js uses for J (tryFire dispatch). */
function fireSelected(h, input = noInput()) {
  const inp = { ...input, shoot: true };
  h.fireCooldown = 0;
  if (Number.isInteger(h.selectedWeapon)) {
    if (h.timers.get('special') > 0) return false;
    const type = h.specialSlots?.[h.selectedWeapon];
    if (!type) return false;
    const dir = h.resolveAim(inp);
    const { x: cx, y: cy } = h.bodyCenter();
    const s = specialPool.spawn(cx - 10, cy - 10, dir, type);
    if (!s) return false;
    h.timers.set('special', SPECIAL_WEAPON_DEFS[type].fireCooldown);
    return true;
  }
  const dir = h.resolveAim(inp);
  const { x: cx, y: cy } = h.bodyCenter();
  const p = projectilePool.spawn(cx - 6, cy - 6, dir, true);
  if (!p) return false;
  h.fireCooldown = 1 / h.stats.projectile_freq;
  return true;
}
/** Clear all live projectiles/specials between assertions (pool hygiene). */
function clearPools() {
  for (const p of projectilePool.activeItems) p.alive = false;
  projectilePool.active.length = 0;
  for (const s of specialPool.activeItems) s.alive = false;
  specialPool.active.length = 0;
}

console.log('Slot state');
ok('fresh hero: default weapon selected, all slots empty', () => {
  const h = makeHero();
  assert.equal(h.selectedWeapon, WEAPON_THORN);
  assert.equal(h.specialSlots.length, SPECIAL_SLOT_COUNT);
  assert.ok(h.specialSlots.every((t) => t == null));
});

console.log('acquireSpecial placement (AC #1-#5)');
ok('first pickup places at slot 0 and selects it', () => {
  const h = makeHero();
  h.acquireSpecial('bomb');
  assert.deepEqual(h.specialSlots, ['bomb', null]);
  assert.equal(h.selectedWeapon, 0);
});
ok('second pickup places at next empty and selects it', () => {
  const h = makeHero();
  h.acquireSpecial('bomb');
  h.acquireSpecial('saw');
  assert.deepEqual(h.specialSlots, ['bomb', 'saw']);
  assert.equal(h.selectedWeapon, 1);
});
ok('third pickup while a slot is selected replaces THAT slot', () => {
  const h = makeHero();
  h.acquireSpecial('bomb'); // sel 0
  h.acquireSpecial('saw');  // sel 1
  h.acquireSpecial('bomb'); // both full, slot 1 selected → replace slot 1
  assert.deepEqual(h.specialSlots, ['bomb', 'bomb']);
  assert.equal(h.selectedWeapon, 1);
});
ok('third pickup while default is selected replaces slot 0', () => {
  const h = makeHero();
  h.acquireSpecial('bomb'); // sel 0
  h.acquireSpecial('saw');  // sel 1
  h.selectedWeapon = WEAPON_THORN;
  h.acquireSpecial('saw');  // both full, default selected → replace slot 0
  assert.deepEqual(h.specialSlots, ['saw', 'saw']);
  assert.equal(h.selectedWeapon, 0);
});
ok('same-special pickup replaces per placement rules (no stacking)', () => {
  const h = makeHero();
  h.acquireSpecial('bomb'); // sel 0
  h.acquireSpecial('bomb'); // both... slot 0 full, slot 1 empty → first EMPTY wins: slot 1
  assert.deepEqual(h.specialSlots, ['bomb', 'bomb']);
  assert.equal(h.selectedWeapon, 1);
});

console.log('rotateWeapon cycle (AC #6)');
ok('cycles default → 0 → 1 → default with both slots filled', () => {
  const h = makeHero();
  h.acquireSpecial('bomb');
  h.specialSlots[1] = 'saw';
  h.selectedWeapon = WEAPON_THORN;
  h.rotateWeapon();
  assert.equal(h.selectedWeapon, 0);
  h.rotateWeapon();
  assert.equal(h.selectedWeapon, 1);
  h.rotateWeapon();
  assert.equal(h.selectedWeapon, WEAPON_THORN);
});
ok('skips empty slots', () => {
  const h = makeHero();
  h.specialSlots[1] = 'saw'; // only slot 1 filled
  h.selectedWeapon = WEAPON_THORN;
  h.rotateWeapon();
  assert.equal(h.selectedWeapon, 1, 'jumps straight to the only filled slot');
  h.rotateWeapon();
  assert.equal(h.selectedWeapon, WEAPON_THORN, 'wraps back past the empty slot 0');
});
ok('with no specials, rotation is a no-op', () => {
  const h = makeHero();
  h.rotateWeapon();
  h.rotateWeapon();
  assert.equal(h.selectedWeapon, WEAPON_THORN);
});

console.log('loseSelectedSpecial (AC #7)');
ok('no-op when default weapon is selected', () => {
  const h = makeHero();
  h.acquireSpecial('bomb');
  h.selectedWeapon = WEAPON_THORN;
  h.loseSelectedSpecial();
  assert.deepEqual(h.specialSlots, ['bomb', null]);
});
ok('losing one of two keeps selection index on the now-empty slot', () => {
  const h = makeHero();
  h.acquireSpecial('bomb');
  h.acquireSpecial('saw'); // sel 1
  h.loseSelectedSpecial();
  assert.deepEqual(h.specialSlots, ['bomb', null]);
  assert.equal(h.selectedWeapon, 1, 'other special remains — index persists, rotation skips empties');
});
ok('losing the LAST special falls back to default weapon (no empty-slot trap)', () => {
  const h = makeHero();
  h.acquireSpecial('bomb'); // sel 0
  h.loseSelectedSpecial();
  assert.ok(h.specialSlots.every((t) => t == null));
  assert.equal(h.selectedWeapon, WEAPON_THORN, 'thorn is selectable again immediately');
  clearPools();
  assert.ok(fireSelected(h), 'thorn fires right after losing the last special');
  clearPools();
});
ok('compact-left + fallback: losing the only held special returns to default', () => {
  const h = makeHero();
  h.specialSlots[1] = 'saw';
  h.selectedWeapon = 1;
  h.loseSelectedSpecial();
  assert.ok(h.specialSlots.every((t) => t == null), 'slot cleared');
  assert.equal(h.selectedWeapon, WEAPON_THORN, 'last special gone → default weapon');
  // next pickup auto-selects itself and lands in the first empty slot
  h.acquireSpecial('bomb');
  assert.deepEqual(h.specialSlots, ['bomb', null]);
  assert.equal(h.selectedWeapon, 0);
});

console.log('Firing off slots (AC #8)');
ok('J fires thorn while default is selected', () => {
  const h = makeHero();
  clearPools();
  assert.ok(fireSelected(h), 'thorn shot should succeed');
  assert.equal(projectilePool.count, 1);
  assert.equal(specialPool.count, 0);
  clearPools();
});
ok('J fires the selected slot\'s special WITHOUT mutating the slot', () => {
  const h = makeHero();
  h.acquireSpecial('saw'); // sel 0
  clearPools();
  assert.ok(fireSelected(h), 'special shot should succeed');
  assert.equal(specialPool.count, 1);
  assert.equal(projectilePool.count, 0);
  assert.equal(h.specialSlots[0], 'saw', 'slot still holds the weapon after firing');
  clearPools();
});
ok('firing with an empty selected slot spawns nothing and does not throw', () => {
  const h = makeHero();
  h.selectedWeapon = 1; // slot 1 is empty
  clearPools();
  assert.equal(fireSelected(h), false);
  assert.equal(specialPool.count, 0);
  assert.equal(projectilePool.count, 0);
  clearPools();
});
ok('special cooldown gates re-fire; thorn unaffected', () => {
  const h = makeHero();
  h.acquireSpecial('saw'); // sel 0
  clearPools();
  assert.ok(fireSelected(h), 'first special fires');
  assert.equal(fireSelected(h), false, 'second blocked by cooldown');
  h.selectedWeapon = WEAPON_THORN;
  assert.ok(fireSelected(h), 'thorn fires freely while special cools down');
  clearPools();
});

console.log('N rotates without firing (AC #9)');
ok('switchWeapon intent changes selection and fires nothing', () => {
  const h = makeHero();
  h.acquireSpecial('bomb'); // sel 0
  h.selectedWeapon = WEAPON_THORN;
  clearPools();
  const inp = { ...noInput(), switchWeapon: true };
  h.update(DT, inp);          // N press — hero.update never reads switchWeapon
  h.rotateWeapon();           // the update system applies it edge-triggered
  assert.equal(h.selectedWeapon, 0);
  assert.equal(projectilePool.count, 0, 'no thorn fired');
  assert.equal(specialPool.count, 0, 'no special fired');
  clearPools();
});

console.log('Selection persistence (AC #10)');
ok('selection persists across frames until rotated again', () => {
  const h = makeHero();
  h.acquireSpecial('bomb'); // sel 0
  for (let i = 0; i < 120; i++) h.update(DT, noInput()); // 2s of frames
  assert.equal(h.selectedWeapon, 0, 'selection survives frames');
});
ok('swapHero preserves slots + selection (update.js saved-state contract)', () => {
  // Mirrors swapHero(): rebuild the instance, Object.assign the preserved
  // runtime resources (including specialSlots/selectedWeapon), restore def stats.
  const old = makeHero();
  old.acquireSpecial('bomb');
  old.specialSlots[1] = 'saw';
  const saved = {
    x: old.x, y: old.y, vx: old.vx, vy: old.vy,
    energy: old.energy, lives: old.lives, coins: old.coins,
    specialSlots: old.specialSlots,
    selectedWeapon: old.selectedWeapon,
    checkpoint: old.checkpoint, continuesUsed: old.continuesUsed,
    stats: old.stats,
  };
  const nh = new Hero(HEROES.balthazar, saved.x, saved.y);
  Object.assign(nh, saved);
  nh.stats = HEROES.balthazar.stats;
  assert.equal(nh.selectedWeapon, old.selectedWeapon, 'selection carried across the swap');
  assert.deepEqual(nh.specialSlots, old.specialSlots, 'slots carried across the swap');
});

clearPools();
console.log(`\n${passed} passed`);
