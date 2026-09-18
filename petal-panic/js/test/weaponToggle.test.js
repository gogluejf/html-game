// Weapon toggle system (design §21, Task 2.2).
// Run: node js/test/weaponToggle.test.js
// No DOM needed: hero.js / entity.js / consts.js / projectile.js are pure modules.
//
// Direct-intent pattern (see jumpslide.test.js): call hero.update(DT, intent)
// with plain intent objects and assert behavior invariants — N toggles the
// selection without firing; J fires whichever weapon is selected through one
// path; each weapon has independent ammo + cooldown; selection persists.

import { strict as assert } from 'node:assert';
import { Hero, WEAPON_THORN, WEAPON_SPECIAL } from '../hero.js';
import { HEROES } from '../heroDefs.js';
import { projectilePool, specialPool } from '../projectile.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const DT = 1 / 60;
const noInput = () => ({ left: false, right: false, up: false, down: false, jump: false, shoot: false, melee: false });
const makeHero = () => new Hero(HEROES.scarlet, 0, 0); // saw special, freq 8/2

/** Fire once through the SAME code path update.js uses for J (tryFire dispatch). */
function fireSelected(h, input = noInput()) {
  const inp = { ...input, shoot: true };
  h.fireCooldown = 0; // clear thorn cooldown so a single call always attempts
  if (h.selectedWeapon === WEAPON_SPECIAL) {
    if (h.timers.get('special') > 0 || h.specialAmmo <= 0) return false;
    const dir = h.resolveAim(inp);
    const { x: cx, y: cy } = h.bodyCenter();
    const s = specialPool.spawn(cx - 10, cy - 10, dir, h.stats.special);
    if (!s) return false;
    h.specialAmmo -= 1;
    h.timers.set('special', h.stats.special_freq);
    return true;
  }
  if (h.ammo <= 0) return false;
  const dir = h.resolveAim(inp);
  const { x: cx, y: cy } = h.bodyCenter();
  const p = projectilePool.spawn(cx - 6, cy - 6, dir, true);
  if (!p) return false;
  h.ammo -= 1;
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

console.log('Selection state');
ok('fresh hero defaults to Thorn with an empty special pool', () => {
  const h = makeHero();
  assert.equal(h.selectedWeapon, WEAPON_THORN);
  // §20: "No ammo: no projectile is created." Fresh runs start at 0; the
  // powerup system grants special ammo during a run.
  assert.equal(h.specialAmmo, 0);
});

ok('toggleWeapon flips thorn → special → thorn', () => {
  const h = makeHero();
  assert.equal(h.selectedWeapon, WEAPON_THORN);
  h.toggleWeapon();
  assert.equal(h.selectedWeapon, WEAPON_SPECIAL);
  h.toggleWeapon();
  assert.equal(h.selectedWeapon, WEAPON_THORN);
});

console.log('N toggles without firing (AC #1)');
ok('switchWeapon intent changes selection and fires nothing', () => {
  const h = makeHero();
  const ammoBefore = h.ammo, spBefore = h.specialAmmo;
  const inp = { ...noInput(), switchWeapon: true };
  h.update(DT, inp); // N press — hero.update never reads switchWeapon
  h.toggleWeapon();  // the update system applies it edge-triggered
  assert.equal(h.selectedWeapon, WEAPON_SPECIAL);
  assert.equal(h.ammo, ammoBefore, 'thorn ammo untouched by N');
  assert.equal(h.specialAmmo, spBefore, 'special ammo untouched by N');
  assert.equal(projectilePool.count, 0, 'no thorn fired');
  assert.equal(specialPool.count, 0, 'no special fired');
});

console.log('J fires the selected weapon — one path (AC #2)');
ok('J fires a Thorn while Thorn is selected', () => {
  const h = makeHero();
  clearPools();
  const fired = fireSelected(h);
  assert.ok(fired, 'thorn shot should succeed');
  assert.equal(projectilePool.count, 1, 'one thorn in the pool');
  assert.equal(specialPool.count, 0, 'no special spawned');
  assert.equal(h.ammo, 199, 'thorn ammo consumed');
  assert.equal(h.specialAmmo, 0, 'special ammo untouched');
  clearPools();
});
ok('J fires the Special while Special is selected', () => {
  const h = makeHero();
  h.toggleWeapon();
  h.specialAmmo = 10; // grant ammo (fresh runs start at 0)
  clearPools();
  const fired = fireSelected(h);
  assert.ok(fired, 'special shot should succeed');
  assert.equal(specialPool.count, 1, 'one special in the pool');
  assert.equal(projectilePool.count, 0, 'no thorn spawned');
  assert.equal(h.specialAmmo, 9, 'special ammo consumed');
  assert.equal(h.ammo, 200, 'thorn ammo untouched');
  clearPools();
});

console.log('Independent ammo + cooldown (AC #3)');
ok('depleting Thorn ammo does not block Special', () => {
  const h = makeHero();
  h.toggleWeapon();
  h.ammo = 0; // thorn pool empty
  h.specialAmmo = 10; // grant special ammo
  clearPools();
  const fired = fireSelected(h);
  assert.ok(fired, 'special must still fire with zero thorn ammo');
  assert.equal(specialPool.count, 1);
  clearPools();
});
ok('depleting Special ammo does not block Thorn', () => {
  const h = makeHero();
  h.specialAmmo = 0; // special pool empty
  clearPools();
  const fired = fireSelected(h);
  assert.ok(fired, 'thorn must still fire with zero special ammo');
  assert.equal(projectilePool.count, 1);
  clearPools();
});
ok('each weapon keeps its own cooldown timer', () => {
  const h = makeHero();
  h.toggleWeapon();
  h.specialAmmo = 10; // grant special ammo
  clearPools();
  fireSelected(h); // consumes special → sets the 'special' labeled timer
  assert.ok(h.timers.get('special') > 0, 'special cooldown active after special shot');
  assert.ok(h.fireCooldown <= 0, 'thorn cooldown NOT set by a special shot');
  // While special cools down, Thorn can still fire immediately.
  h.toggleWeapon(); // back to thorn
  const fired = fireSelected(h);
  assert.ok(fired, 'thorn fires freely while special is cooling down');
  clearPools();
});
ok('a second special on the same frame is blocked by its own cooldown', () => {
  const h = makeHero();
  h.toggleWeapon();
  h.specialAmmo = 10; // grant special ammo
  clearPools();
  assert.ok(fireSelected(h), 'first special fires');
  assert.equal(fireSelected(h), false, 'second special blocked by cooldown');
  assert.equal(h.specialAmmo, 9, 'only one special consumed');
  clearPools();
});

console.log('Selection persistence (AC #4)');
ok('selection persists across frames until toggled again', () => {
  const h = makeHero();
  h.toggleWeapon(); // → special
  for (let i = 0; i < 120; i++) h.update(DT, noInput()); // 2s of frames
  assert.equal(h.selectedWeapon, WEAPON_SPECIAL, 'selection survives frames');
  h.toggleWeapon(); // → thorn
  for (let i = 0; i < 60; i++) h.update(DT, noInput());
  assert.equal(h.selectedWeapon, WEAPON_THORN);
});
ok('swapHero preserves the selection (update.js saved-state contract)', () => {
  // Mirrors swapHero(): rebuild the instance, Object.assign the preserved
  // runtime resources (including selectedWeapon), restore def stats.
  const old = makeHero();
  old.toggleWeapon(); // → special
  const saved = {
    x: old.x, y: old.y, vx: old.vx, vy: old.vy,
    energy: old.energy, lives: old.lives, coins: old.coins,
    ammo: old.ammo, specialAmmo: old.specialAmmo,
    selectedWeapon: old.selectedWeapon,
    checkpoint: old.checkpoint, continuesUsed: old.continuesUsed,
    stats: old.stats,
  };
  const nh = new Hero(HEROES.balthazar, saved.x, saved.y);
  Object.assign(nh, saved);
  nh.stats = HEROES.balthazar.stats;
  assert.equal(nh.selectedWeapon, WEAPON_SPECIAL, 'selection carried across the swap');
  assert.equal(nh.specialAmmo, old.specialAmmo, 'special ammo carried across the swap');
});

console.log('HUD indication (AC #5)');
ok('hud.js marks the selected weapon in the ammo readout', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../hud.js', import.meta.url), 'utf8');
  assert.ok(src.includes('selectedWeapon'), 'drawAmmo reads hero.selectedWeapon');
  assert.ok(src.includes('> '), 'selected weapon gets a ">" marker');
});

clearPools();
console.log(`\n${passed} passed`);
