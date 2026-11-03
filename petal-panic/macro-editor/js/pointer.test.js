// pointer.js multi-interaction tests — node --test.
// Run: node --test petal-panic/macro-editor/js/pointer.test.js
//
// Covers the shared-dx bug in validateCopyInteraction / validateMultiInteraction:
// when a mixed selection contains a block, the snapped dx must be computed ONCE
// before processing any member so that (a) every item moves by the same offset
// and (b) the result is independent of member order.

import test from 'node:test';
import assert from 'node:assert/strict';

// --- Minimal DOM shim (pointer.js → viewport.js touches document at import) ----
const ctxStub = new Proxy({}, { get: () => () => {}, set: () => true });
const elStub = () => ({
  getContext: () => ctxStub,
  addEventListener: () => {}, removeEventListener: () => {},
  setPointerCapture: () => {}, releasePointerCapture: () => {},
  style: {}, width: 0, height: 0, classList: { add(){}, remove(){}, toggle(){} },
});
globalThis.document = {
  getElementById: () => elStub(),
  createElement: () => elStub(),
  querySelector: () => null,
  querySelectorAll: () => [],
};
if (!globalThis.window) globalThis.window = globalThis;
if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = fn => setTimeout(fn, 16);
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };

const { app } = await import('./state.js');
const { validateCopyInteraction, validateMultiInteraction, hasValueCycle, nextValue, placementTooltip, cyclePlacementValue } = await import('./pointer.js');

app.consts = {
  unitPxX:48, unitPxY:48, platformDrawH:6,
  hEntryClear:3, hExitClear:3, vEntryClear:0, vExitClear:3,
  hBudgetUnits:56, vBudgetUnits:56, hPlayHeightUnits:10, hZoneHeightUnits:11.25,
  vZoneWidthUnits:13, topClearanceUnits:2, hMaxSurfaceUnits:8,
};

// Block at x=4 (even), platform at x=9 (odd). Dragging +1 cell: the group's
// shared dx must snap to 0 for the block lattice, so BOTH items stay put —
// the pre-fix code moved the platform by +1 because it re-snapped dx after
// the block had already consumed the odd remainder.
function makeMacro(){
  return {
    id:'pointerTest', name:'Pointer Test', orientation:'horizontal', difficulty:1,
    units:[
      {kind:'block',x:4,y:0,width:2,height:1},
      {kind:'platform',x:9,y:2,width:2},
    ],
    placements:[], variations:[], follows:[], followedBy:[], schemaVersion:'square-grid-v1',
  };
}

function interactionFor(mode){
  const st = makeMacro();
  app.cur = { id: st.id, macro: st, st };
  const originals = [
    { kind:'unit', index:0, original:{...st.units[0]} },
    { kind:'unit', index:1, original:{...st.units[1]} },
  ];
  return {
    mode,
    targetKind:null, targetIndex:-1,
    anchorCell:{x:5,y:1}, currentCell:{x:6,y:1}, // raw dx = +1
    original:null, candidate:null,
    multiOriginals:originals,
    attachedPlacements:[],
    valid:true, reason:'',
  };
}

test('moving-multi: mixed block+platform share one snapped dx (order-independent)', () => {
  const iA = interactionFor('moving-multi');
  validateMultiInteraction(iA);
  assert.equal(iA.valid, true, iA.reason);
  // Shared dx snapped to 0: neither item moves.
  assert.deepEqual(iA.nextMacro.units[0].x, 4);
  assert.deepEqual(iA.nextMacro.units[1].x, 9);

  // Reversed member order must produce the identical layout.
  const iB = interactionFor('moving-multi');
  iB.multiOriginals.reverse();
  validateMultiInteraction(iB);
  assert.equal(iB.valid, true, iB.reason);
  assert.deepEqual(
    iB.nextMacro.units.map(u => [u.kind, u.x, u.y]),
    iA.nextMacro.units.map(u => [u.kind, u.x, u.y]),
  );
});

test('copying-multi: copies of a mixed group use the same snapped dx as moving', () => {
  const iB = interactionFor('copying-multi');
  // Clean even drag (+2): shared dx stays +2 for every member.
  iB.anchorCell = {x:5, y:1};
  iB.currentCell = {x:7, y:1};
  validateCopyInteraction(iB);
  assert.equal(iB.valid, true, iB.reason);
  const units = iB.nextMacro.units;
  assert.equal(units.length, 4);
  // Both copies shifted by exactly +2 (shared dx), matching their originals' delta.
  assert.deepEqual(units[2], {kind:'block',x:6,y:0,width:2,height:1});
  assert.deepEqual(units[3], {kind:'platform',x:11,y:2,width:2});
});

test('moving-multi: pure-platform selection keeps whole-cell dx (no block snap)', () => {
  const st = makeMacro();
  app.cur = { id: st.id, macro: st, st };
  const interaction = {
    mode:'moving-multi', targetKind:null, targetIndex:-1,
    anchorCell:{x:5,y:1}, currentCell:{x:6,y:1}, // dx = +1
    original:null, candidate:null,
    multiOriginals:[{ kind:'unit', index:1, original:{...st.units[1]} }],
    attachedPlacements:[], valid:true, reason:'',
  };
  validateMultiInteraction(interaction);
  assert.equal(interaction.valid, true, interaction.reason);
  assert.equal(interaction.nextMacro.units[1].x, 10); // 9 + 1, no snapping
});

// --- typed-spawn value cycling (task 4.1) ------------------------------------
// Pure helpers: hasValueCycle / nextValue / placementTooltip. Registries are
// imported from the game JS by pointer.js, so tests assert against those same
// registries (no hardcoded id lists).

import { BARREL_TYPES } from '../../js/objects/object.js';
import { ENEMY_TYPES } from '../../js/world/enemyTypes.js';
import { POWERUP_ROLL_TYPES, POWERUP_DEFS } from '../../js/objects/powerup.js';

test('value cycle: barrel full cycle random -> wood -> explosive -> coin -> random', () => {
  const p = { type:'barrel', value:'random' };
  const expected = ['wood', 'explosive', 'coin', 'random'];
  for (const want of expected) {
    assert.equal(nextValue(p), want);
    p.value = want;
  }
  // order matches the BARREL_TYPES registry exactly
  assert.deepEqual(BARREL_TYPES.map(t => t.id), ['wood', 'explosive', 'coin']);
});

test('value cycle: enemy starts at first ENEMY_TYPE id and wraps back to random', () => {
  const p = { type:'enemy', value:'random' };
  const ids = ENEMY_TYPES.map(t => t.id);
  assert.equal(nextValue(p), ids[0]);          // random -> first type
  p.value = ids[0];
  for (let i = 1; i < ids.length; i++) {       // walk the whole registry
    assert.equal(nextValue(p), ids[i]);
    p.value = ids[i];
  }
  assert.equal(nextValue(p), 'random');        // last type -> back to random
});

test('value cycle: powerup covers every POWERUP_ROLL_TYPES id then returns to random', () => {
  const p = { type:'powerup', value:'random' };
  const ids = [...POWERUP_ROLL_TYPES];
  assert.equal(nextValue(p), ids[0]);
  p.value = ids[0];
  for (let i = 1; i < ids.length; i++) {
    assert.equal(nextValue(p), ids[i]);
    p.value = ids[i];
  }
  assert.equal(nextValue(p), 'random');
  // stale/unknown value snaps to the first roll type
  assert.equal(nextValue({ type:'powerup', value:'bogus' }), ids[0]);
});

test('placementTooltip: labels cyclable types, empty for others', () => {
  assert.equal(placementTooltip({ type:'barrel', value:'coin' }), 'barrel - Coin');
  assert.equal(placementTooltip({ type:'barrel', value:'random' }), 'barrel - random');
  assert.equal(placementTooltip({ type:'barrel' }), 'barrel - random'); // missing value
  assert.equal(placementTooltip({ type:'enemy', value:'jester' }), 'enemy - Jester');
  assert.equal(placementTooltip({ type:'powerup', value:'oneUp' }), `powerup - ${POWERUP_DEFS.oneUp.label}`);
  assert.equal(placementTooltip({ type:'unit', value:'block' }), '');   // non-cyclable
  assert.equal(placementTooltip({ type:'platform' }), '');
});

test('hasValueCycle: true for barrel/enemy/powerup, false otherwise', () => {
  assert.equal(hasValueCycle('barrel'), true);
  assert.equal(hasValueCycle('enemy'), true);
  assert.equal(hasValueCycle('powerup'), true);
  assert.equal(hasValueCycle('unit'), false);
  assert.equal(hasValueCycle('platform'), false);
  assert.equal(hasValueCycle(undefined), false);
});

// --- cyclePlacementValue: the click-cycle commit path (task 4.1 acceptance) --
// Exercises the exported function against a stubbed app.cur: the placement's
// value must advance in registry order and the edit must be committed as an
// undoable change (undo snapshot pushed + draft marked changed).
test('cyclePlacementValue: advances value, pushes undo, marks changed', () => {
  const st = makeMacro();
  st.placements = [{ slot:'barrel-1', type:'barrel', value:'random', x:5, y:1 }];
  app.macros = { [st.id]: JSON.parse(JSON.stringify(st)) }; // canonical copy
  app.drafts.clear();
  app.cur = { id: st.id, macro: app.macros[st.id], st };
  app.undoStack.length = 0;

  assert.equal(cyclePlacementValue(0), true);
  assert.equal(st.placements[0].value, 'wood');   // random -> first registry id
  assert.equal(app.undoStack.length, 1, 'an undo snapshot must be pushed');
  assert.ok(app.drafts.has(st.id), 'markChanged must register the dirty draft');

  // Full cycle walks the whole BARREL_TYPES registry and wraps back to random:
  // wood -> explosive -> coin -> random (3 more cycles after the first).
  const ids = BARREL_TYPES.map(t => t.id);
  for (const want of ['explosive', 'coin', 'random']) {
    assert.equal(cyclePlacementValue(0), true);
    assert.equal(st.placements[0].value, want);
  }
  assert.equal(ids.length, 3, 'registry sanity');
  assert.equal(app.undoStack.length, 1 + ids.length, 'every cycle is undoable');

  // Cycling from a clean state registers the dirty draft again.
  app.drafts.delete(st.id);
  assert.equal(cyclePlacementValue(0), true);
  assert.equal(st.placements[0].value, 'wood');   // random -> first type again
  assert.ok(app.drafts.has(st.id), 'dirty draft re-registered after cycling');
});

test('cyclePlacementValue: rejects non-cyclable placements and bad indices', () => {
  const st = makeMacro();
  st.placements = [{ slot:'coin-1', type:'coin', value:null, x:5, y:1 }];
  app.macros = { [st.id]: JSON.parse(JSON.stringify(st)) };
  app.cur = { id: st.id, macro: app.macros[st.id], st };
  app.undoStack.length = 0;

  assert.equal(cyclePlacementValue(0), false, 'non-cyclable type must not mutate');
  assert.equal(cyclePlacementValue(99), false, 'out-of-range index must not mutate');
  assert.equal(app.undoStack.length, 0, 'no undo entry on rejected cycles');
});
