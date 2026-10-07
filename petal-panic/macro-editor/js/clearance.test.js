import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  macroContentSignature,
  hasValidClearance,
  stampClearance,
  invalidateStaleClearance,
  macroEndpoint,
} from './clearance.js';

const macro = () => ({
  id:'testMacro', name:'Test', orientation:'horizontal', difficulty:1,
  units:[{kind:'block',x:2,y:0,width:3,height:1}],
  placements:[], variations:[], follows:[], followedBy:[],
});

test('clearance proof matches only the exact macro content', ()=>{
  const m=macro();
  stampClearance(m);
  assert.equal(hasValidClearance(m),true);
  const sig=m.clearance.contentSignature;
  assert.equal(sig,macroContentSignature(m));
  m.units[0].width=4;
  assert.equal(hasValidClearance(m),false);
  assert.equal(invalidateStaleClearance(m),true);
  assert.equal('clearance' in m,false);
});

test('restoring the exact cleared snapshot restores the valid proof', ()=>{
  const m=macro();
  stampClearance(m);
  const snapshot=JSON.stringify(m);
  m.units[0].x++;
  invalidateStaleClearance(m);
  assert.equal(hasValidClearance(m),false);
  const restored=JSON.parse(snapshot);
  assert.equal(hasValidClearance(restored),true);
});

test('horizontal endpoint is the farthest unit right edge', ()=>{
  const m=macro();
  m.units.push({kind:'platform',x:8,y:2,width:4});
  assert.deepEqual(macroEndpoint(m),{orientation:'horizontal',value:12});
});

test('vertical endpoint is the highest standable unit edge', ()=>{
  const m=macro();
  m.orientation='vertical';
  m.units=[
    {kind:'block',x:2,y:4,width:2,height:3},
    {kind:'platform',x:7,y:9,width:2},
  ];
  assert.deepEqual(macroEndpoint(m),{orientation:'vertical',value:10});
});
