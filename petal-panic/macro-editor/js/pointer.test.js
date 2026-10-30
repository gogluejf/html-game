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
  style: {}, width: 0, height: 0, classList: { add(){}, remove(){} },
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
const { validateCopyInteraction, validateMultiInteraction } = await import('./pointer.js');

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
