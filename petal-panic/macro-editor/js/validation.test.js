import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './state.js';
import { validateMacroCandidate, validateDeletion } from './validation.js';

app.consts = {
  unitPxX:72, unitPxY:48, platformDrawH:6,
  hEntryClear:3, hExitClear:3, vEntryClear:0, vExitClear:3,
  hBudgetUnits:56, vBudgetUnits:56, hPlayHeightUnits:10, hZoneHeightUnits:11.25,
  vZoneWidthUnits:13, topClearanceUnits:2, hMaxSurfaceUnits:8,
};

function macro(overrides={}){
  return {
    id:'editorTest', name:'Editor Test', orientation:'horizontal', difficulty:1,
    units:[{kind:'block',x:5,y:0,width:2,height:1}], placements:[],
    variations:[], follows:[], followedBy:[], ...overrides,
  };
}

test('validates arbitrary positive block rectangles', () => {
  const result=validateMacroCandidate(macro(),{kind:'block',x:12,y:0,width:5,height:1});
  assert.equal(result.valid,true,result.reason);
  assert.deepEqual(result.macro.units.at(-1),{kind:'block',x:12,y:0,width:5,height:1});
});

test('rejects platform row zero with a useful reason', () => {
  const result=validateMacroCandidate(macro(),{kind:'platform',x:12,y:0,width:4});
  assert.equal(result.valid,false);
  assert.match(result.reason,/row 0/i);
});

test('rejects overlapping block candidates without mutating source', () => {
  const source=macro();
  const before=JSON.stringify(source);
  const result=validateMacroCandidate(source,{kind:'block',x:6,y:0,width:2,height:1});
  assert.equal(result.valid,false);
  assert.match(result.reason,/overlap/i);
  assert.equal(JSON.stringify(source),before);
});

test('enemy slots require support and deterministic descriptors remain schema-valid', () => {
  const floating=validateMacroCandidate(macro(),{slot:'enemy-1',type:'enemy',x:12,y:2});
  assert.equal(floating.valid,false);
  assert.match(floating.reason,/supporting surface/i);
  const supported=validateMacroCandidate(macro(),{slot:'enemy-1',type:'enemy',x:5,y:1});
  assert.equal(supported.valid,true,supported.reason);
});

test('power-up slots require support for newly authored opportunities', () => {
  const floating=validateMacroCandidate(macro(),{slot:'powerup-1',type:'powerup',x:12,y:4});
  assert.equal(floating.valid,false);
  const supported=validateMacroCandidate(macro(),{slot:'powerup-1',type:'powerup',x:6,y:1});
  assert.equal(supported.valid,true,supported.reason);
});

test('nearby ground blocks are accepted without an elevation warning', () => {
  const source=macro({units:[{kind:'block',x:5,y:0,width:1,height:1}]});
  const result=validateMacroCandidate(source,{kind:'block',x:7,y:0,width:1,height:1});
  assert.equal(result.valid,true,result.reason);
  assert.equal(result.severity,'valid');
});

test('same-height blocks never warn based only on x distance', () => {
  const source=macro({units:[{kind:'block',x:5,y:0,width:1,height:1}]});
  for (const x of [7,8,20]) {
    const result=validateMacroCandidate(source,{kind:'block',x,y:0,width:1,height:1});
    assert.equal(result.valid,true,result.reason);
    assert.equal(result.severity,'valid',`same-height block at x=${x}`);
  }
});

test('physics reach permits maximum-height double-jump landings', () => {
  const source=macro({units:[{kind:'block',x:5,y:0,width:1,height:1}]});
  const result=validateMacroCandidate(source,{kind:'block',x:7,y:0,width:1,height:2});
  assert.equal(result.valid,true,result.reason);
  assert.equal(result.severity,'valid');
});

test('height and lateral gap are combined for chained elevated landings', () => {
  const source=macro({units:[{kind:'block',x:5,y:0,width:1,height:2}]});
  const near=validateMacroCandidate(source,{kind:'block',x:7,y:0,width:1,height:3});
  assert.equal(near.severity,'valid',near.reason);
  const far=validateMacroCandidate(source,{kind:'block',x:12,y:0,width:1,height:3});
  assert.equal(far.valid,true,far.reason);
  assert.equal(far.severity,'warning');
});

test('unreachable elevated geometry is accepted as a warning', () => {
  const source=macro({units:[{kind:'block',x:5,y:0,width:1,height:1}]});
  const result=validateMacroCandidate(source,{kind:'block',x:7,y:0,width:1,height:4});
  assert.equal(result.valid,true,result.reason);
  assert.equal(result.severity,'warning');
  assert.ok(result.warningUnitIndices.includes(1));
});

test('exactly two top-clearance rows are legal; one is rejected', () => {
  const legal=validateMacroCandidate(macro(),{kind:'block',x:12,y:0,width:1,height:8});
  assert.equal(legal.valid,true,legal.reason);
  const illegal=validateMacroCandidate(macro(),{kind:'block',x:14,y:0,width:1,height:9});
  assert.equal(illegal.valid,false);
  assert.match(illegal.reason,/2 rows of top clearance/i);
});

test('deletion is rejected when it would leave an invalid empty macro', () => {
  const result=validateDeletion(macro(),'unit',0);
  assert.equal(result.valid,false);
  assert.match(result.reason,/non-empty array/i);
});
