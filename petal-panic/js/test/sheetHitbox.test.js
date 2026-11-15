// Sheet-authored attack boxes → world (melee / air_melee / special melee).
// Run: node petal-panic/js/test/sheetHitbox.test.js
import { loadTestMacros } from './_macroSetup.mjs';
loadTestMacros();
const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => ctxStub, addEventListener: noop }) };
globalThis.window = { addEventListener: noop, __selectedHero: 'scarlet' };

const strict = await import('node:assert');
const assert = strict.strict;
const { Hero } = await import('../hero/hero.js');
const { HEROES } = await import('../hero/heroDefs.js');

let passed = 0;
function ok(name, fn) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; } }

console.log('Sheet attack boxes (Scarlet)');

ok('no sheet attached → _sheetAttackBox returns null (sheet-only contract)', () => {
  const h = new Hero(HEROES.scarlet, 0, 0);
  assert.equal(h._sheetAttackBox('melee'), null);
});

ok('attackHitboxWorld is sheet-only: no sheet → no box (melee active frame)', () => {
  const h = new Hero(HEROES.scarlet, 0, 0);
  h.meleeActive = true;
  h.meleeFrame = 3; // active frame per MELEE_ACTIVE_FRAME
  assert.equal(h.attackHitboxWorld('melee'), null, 'no table fallback — sheet boxes only');
});

console.log(`\n${passed} passed`);

// --- End-to-end with real sheet data (Scarlet) -----------------------------
const { loadHeroSprites, attachHeroSprites } = await import('../hero/heroSprites.js');

async function testSheetMelee() {
  const entry = await loadHeroSprites('scarlet_vale');
  assert.ok(entry, 'scarlet sprites loaded');
  const h = new Hero(HEROES.scarlet, 100, 200);
  attachHeroSprites(h, 'scarlet_vale');
  h.setAnim('melee');
  // Drive the player to a frame that HAS an authored box (f4 = index 3).
  h.setProgress(3 / 5); // 6-frame sheet: progress 0.6 → slot 3
  h.meleeActive = true;
  h.meleeFrame = 3;
  h.facing = 1;
  const box = h.attackHitboxWorld('melee');
  assert.ok(box, 'box resolved');
  assert.equal(box._source, 'sheet', `expected sheet source, got ${box._source}`);
  // Box must be in front of a right-facing hero (sheet boxes are authored +x):
  // its center sits right of the anchor.
  const acx = 100 + h.w / 2;
  assert.ok(box.x + box.w / 2 > acx, `box center right of anchor (${(box.x + box.w / 2).toFixed(0)} > ${acx.toFixed(0)})`);
  assert.ok(Number.isFinite(box.w) && box.w > 0 && Number.isFinite(box.h) && box.h > 0);
}

async function testMirror() {
  await loadHeroSprites('scarlet_vale');
  const hR = new Hero(HEROES.scarlet, 100, 200);
  attachHeroSprites(hR, 'scarlet_vale');
  hR.setAnim('melee'); hR.setProgress(3 / 5);
  hR.meleeActive = true; hR.meleeFrame = 3; hR.facing = 1;
  const bR = hR.attackHitboxWorld('melee');
  const hL = new Hero(HEROES.scarlet, 100, 200);
  attachHeroSprites(hL, 'scarlet_vale');
  hL.setAnim('melee'); hL.setProgress(3 / 5);
  hL.meleeActive = true; hL.meleeFrame = 3; hL.facing = -1;
  const bL = hL.attackHitboxWorld('melee');
  assert.equal(bR._source, 'sheet'); assert.equal(bL._source, 'sheet');
  const cxR = bR.x + bR.w / 2, cxL = bL.x + bL.w / 2;
  const acx = 100 + hR.w / 2;
  assert.ok(cxR > acx, 'right-facing box centered right of anchor');
  assert.ok(cxL < acx, 'left-facing box centered left of anchor');
  assert.ok(Math.abs(bR.w - bL.w) < 0.01 && Math.abs(bR.h - bL.h) < 0.01);
}

async function testAirMelee() {
  await loadHeroSprites('scarlet_vale');
  const h = new Hero(HEROES.scarlet, 100, 200);
  attachHeroSprites(h, 'scarlet_vale');
  h.setAnim('air_melee');
  h.setProgress(3 / 5);
  h.meleeActive = true; h.meleeFrame = 3; h._meleeAirborne = true; h.facing = 1;
  const box = h.attackHitboxWorld('melee');
  assert.ok(box, 'box resolved');
  assert.equal(box._source, 'sheet');
}

async function testSpecialMelee() {
  await loadHeroSprites('scarlet_vale');
  const h = new Hero(HEROES.scarlet, 100, 200);
  attachHeroSprites(h, 'scarlet_vale');
  h.setAnim('super_melee');
  // 16-frame sheet; f7 (index 6) has a box. progress 6/15 ≈ 0.4.
  h.setProgress(6 / 15);
  h.specialMeleeActive = true; h.specialMeleePhase = 'active'; h.facing = 1;
  const box = h.attackHitboxWorld('specialMelee');
  assert.ok(box, 'box resolved');
  assert.equal(box._source, 'sheet', `expected sheet, got ${box._source}`);
}

async function testSpecialWindup() {
  await loadHeroSprites('scarlet_vale');
  const h = new Hero(HEROES.scarlet, 100, 200);
  attachHeroSprites(h, 'scarlet_vale');
  h.setAnim('super_melee');
  h.setProgress(0); // f1: no box
  h.specialMeleeActive = true; h.specialMeleePhase = 'windup';
  assert.equal(h.attackHitboxWorld('specialMelee'), null);
}

const e2e = [
  ['sheet melee: active frame resolves a SHEET box in world space', testSheetMelee],
  ['sheet melee: facing left mirrors the box to the left side', testMirror],
  ['sheet air_melee: airborne swing uses the air sheet box', testAirMelee],
  ['sheet specialMelee: active phase resolves super_melee sheet box', testSpecialMelee],
  ['sheet specialMelee: windup phase → no box', testSpecialWindup],
];
for (const [name, fn] of e2e) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log(`\n${passed} passed (total)`);
