import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Data URL keeps these tests runnable without changing the project's module type.
const source = await readFile(new URL('./js/sequence.js', import.meta.url), 'utf8');
const { frameSequence, resetSequence, resumeSequence, seekSequence, advanceSequence } =
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const directions = ['forward', 'reverse', 'ping_pong', 'ping_pong_reverse'];
const trips = [[0,1,2,3,4], [4,3,2,1,0], [0,1,2,3,4,3,2,1,0], [4,3,2,1,0,1,2,3,4]];
function state(direction, playback, units = [1,2,3,4,5]){
  const st = { direction, playback, speed: 8, playing: true, frames: units.map(durUnits => ({durUnits})) };
  resetSequence(st);
  return st;
}
for (const playback of ['loop', 'once']) for (const [d, direction] of directions.entries()){
  test(`${playback}/${direction}: traversal, every visit's timing, completion and replay`, () => {
    const st = state(direction, playback);
    const expected = trips[d].slice();
    if (playback === 'loop' && d >= 2) expected.pop();
    assert.deepEqual(frameSequence(st), expected);
    const visits = playback === 'loop' ? [...expected, ...expected, ...expected] : expected;
    for (const i of visits){
      assert.equal(st.frameIdx, i);
      assert.equal(st.completed, false);
      const duration = st.frames[i].durUnits / st.speed;
      advanceSequence(st, duration - 1/16);
      assert.equal(st.frameIdx, i, 'hold for the full per-frame duration');
      assert.equal(st.completed, false, 'not complete before ending duration');
      advanceSequence(st, 1/16);
    }
    assert.equal(st.completed, playback === 'once');
    if (playback === 'once'){
      assert.equal(st.frameIdx, expected.at(-1));
      advanceSequence(st, 100);
      assert.equal(st.frameIdx, expected.at(-1), 'completed once must remain held');
      resumeSequence(st);
      assert.equal(st.completed, false);
      assert.equal(st.frameIdx, expected[0]);
      assert.equal(st.elapsedUnits, 0);
      advanceSequence(st, st.frames[st.frameIdx].durUnits / st.speed);
      assert.equal(st.frameIdx, expected[1]);
    }
  });
  test(`${playback}/${direction}: single frame`, () => {
    const st = state(direction, playback, [3]);
    assert.deepEqual(frameSequence(st), [0]);
    advanceSequence(st, 2/8);
    assert.equal(st.completed, false);
    advanceSequence(st, 1/8);
    assert.equal(st.completed, playback === 'once');
    assert.equal(st.frameIdx, 0);
    resumeSequence(st);
    assert.equal(st.completed, false);
  });
}
test('default direction and two-frame seamless endpoints', () => {
  assert.deepEqual(frameSequence(state(undefined, 'once')), trips[0]);
  for (const direction of directions.slice(2)){
    const st = state(direction, 'loop', [1,1]);
    const start = st.frameIdx;
    for (let i=1; i<=10; i++){
      advanceSequence(st, 1/8);
      assert.equal(st.frameIdx, i%2 ? 1-start : start);
    }
  }
});
test('large delta equals incremental progression with irregular timing', () => {
  for (const mode of ['loop','once']) for (const direction of directions){
    const big = state(direction, mode), small = state(direction, mode);
    advanceSequence(big, 1234.5);
    for (let i=0; i<9876; i++) advanceSequence(small, 1/8);
    assert.deepEqual(big, small);
  }
});
test('pause/resume preserves return leg and partial hold; seeking clears completion', () => {
  const st = state('ping_pong', 'once', [1,2,3]);
  advanceSequence(st, 6/8);
  assert.equal(st.frameIdx, 1);
  advanceSequence(st, 1/8);
  st.playing = false;
  advanceSequence(st, 10);
  resumeSequence(st);
  st.playing = true;
  advanceSequence(st, 1/8);
  assert.equal(st.frameIdx, 0);
  advanceSequence(st, 1/8);
  assert.equal(st.completed, true);
  seekSequence(st, 1);
  assert.equal(st.completed, false);
  assert.equal(st.elapsedUnits, 0);
});

// Execute the real persistence module; isolate its UI dependencies only.
async function saveModule(){
  const store = new Map();
  const app = { project:'test', flatIdx:0, flatList:[{li:0,ei:0}], manifest:{labels:[{entities:[{char:'hero',anim:'idle'}]}]}, cur:null };
  const context = vm.createContext({
    document:{getElementById:()=>null},
    localStorage:{getItem:k=>store.get(k) ?? null, setItem:(k,v)=>store.set(k,v)},
  });
  const mod = new vm.SourceTextModule(await readFile(new URL('./js/save.js', import.meta.url), 'utf8'), {context});
  await mod.link(spec => {
    const exports = spec === './state.js' ? {app,FILM:{}} :
      spec === './viewport.js' ? {$:()=>null} :
      spec === './playback.js' ? {setPlaying:()=>{}} :
      spec === './tools.js' ? {syncToggles:()=>{}} :
      spec === './dialog.js' ? {confirmDialog:()=>{}} : {showToast:()=>{}};
    return new vm.SyntheticModule(Object.keys(exports), function(){
      for (const [key,value] of Object.entries(exports)) this.setExport(key,value);
    }, {context});
  });
  await mod.evaluate();
  return {api:mod.namespace,app};
}
test('real draft save/load and exported tuning preserve all combinations; no transient cursor fields', async () => {
  const {api,app} = await saveModule();
  for (const mode of ['loop','once']) for (const direction of directions){
    const st = state(direction, mode);
    app.cur = {st};
    api.markGameDataChanged();
    const restored = api.readGameData('hero_idle');
    assert.equal(restored.direction, direction);
    assert.equal(restored.playback, mode);
    assert.deepEqual(Array.from(restored.frames, f=>f.durUnits), [1,2,3,4,5]);
    assert.equal('sequencePos' in restored, false);
    assert.equal('completed' in restored, false);
    assert.equal(JSON.parse(JSON.stringify(api.collectGameData(st))).direction, direction);
  }
  assert.equal(api.collectGameData(state(undefined,'loop')).direction, 'forward');
});
test('real Play integration: completed-once replay and panel callback do not recurse', async () => {
  const app = {cur:{st:state('reverse','once')}, isPlaying:false};
  const context = vm.createContext({});
  const mod = new vm.SourceTextModule(await readFile(new URL('./js/playback.js', import.meta.url), 'utf8'), {context});
  let refreshes = 0;
  const element = {querySelectorAll:()=>[], innerHTML:''};
  const modules = {
    './sequence.js':{advanceSequence,resumeSequence,seekSequence},
    './state.js':{app,ROT_MAX_VEL:180,ROT_ACCEL:400,ROT_DECEL:300},
    './viewport.js':{$:()=>element},
    './geometry.js':{curFrameIdx:()=>app.cur.st.frameIdx,editingLocked:()=>false},
    './draw.js':{draw:()=>{}},
    './panel.js':{setRotSpeed:()=>{},syncPanel:()=>{
      assert.ok(++refreshes < 3, 'panel callback must not recurse');
      mod.namespace.setPlaying(app.cur.st.playing);
    }},
    './timing.js':{buildTimingTable:()=>{}},
    './save.js':{saveState:()=>{},markGameDataChanged:()=>{}},
    './tools.js':{syncToggles:()=>{}},
    './undo.js':{pushUndo:()=>{}},
  };
  await mod.link(spec => new vm.SyntheticModule(Object.keys(modules[spec]), function(){
    for (const [key,value] of Object.entries(modules[spec])) this.setExport(key,value);
  }, {context}));
  await mod.evaluate();
  advanceSequence(app.cur.st, 100);
  mod.namespace.setPlaying(false);
  mod.namespace.setPlaying(true);
  assert.equal(app.cur.st.frameIdx, 4);
  assert.equal(app.cur.st.completed, false);
  assert.equal(refreshes, 1);
  advanceSequence(app.cur.st, 1/8);
  mod.namespace.setPlaying(true); // syncPanel does this on every refresh
  assert.equal(app.cur.st.elapsedUnits, 1);
});
