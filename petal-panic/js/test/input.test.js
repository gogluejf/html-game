import assert from 'node:assert/strict';
import { test } from 'node:test';
class Events {
  handlers = new Map();
  addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn); }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); }
  emit(name, event = {}) { for (const fn of this.handlers.get(name) || []) fn({ preventDefault() {}, ...event }); }
}
const windowEvents = new Events();
globalThis.window = windowEvents;
const noop = () => {};
globalThis.document = Object.assign(new Events(), { createElement: () => ({ getContext: () => new Proxy({}, { get: () => noop }) }) });
const pads = [];
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
const { createInput, input, DEFAULT_MAPPING, formatBinding } = await import('../input.js');
const { S, setState, getState, tryTransition } = await import('../state.js');
const { Select, Pause, GameOver } = await import('../screens.js');
const { Remap } = await import('../remap.js');
const U = await import('../systems/update.js');
function pad(index = 0) { return { index, connected: true, id: 'DualSense 054c 0ce6', buttons: Array.from({ length: 16 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] }; }
function fixture() {
  const target = new Events(), document = new Events(), pads = []; const data = new Map();
  const storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
  const engine = createInput({ target, document, getGamepads: () => pads, storage: () => storage });
  return { engine, target, pads, document, data, storage,
    down: code => target.emit('keydown', { code }), up: code => target.emit('keyup', { code }) };
}
test('real keyboard and gamepad adapters produce identical press/held/release navigation traces', () => {
  function trace(source) {
    const f = fixture(), p = pad(); f.pads.push(null, p); const out = [];
    for (const [key, button] of [['ArrowDown',13], ['ArrowRight',15], ['Enter',0], ['Escape',1]]) {
      if (source === 'keyboard') f.down(key); else p.buttons[button].pressed = true;
      f.engine.poll(); out.push(structuredClone(f.engine.nav));
      f.engine.poll(); out.push(structuredClone(f.engine.nav));
      if (source === 'keyboard') f.up(key); else p.buttons[button].pressed = false;
      f.engine.poll(); out.push(structuredClone(f.engine.nav));
    }
    // Escape also supplies the separate gameplay pause intent.
    return out.map(n => ({ ...n, held: Object.fromEntries(Object.entries(n.held).filter(([a]) => a !== 'pause')), pressed: n.pressed.filter(a => a !== 'pause'), released: n.released.filter(a => a !== 'pause') }));
  }
  assert.deepEqual(trace('keyboard'), trace('gamepad'));
});
test('quick taps survive polling; held/repeat does not repeat; merge releases only after all sources release', () => {
  const f = fixture(); f.down('Enter'); f.up('Enter'); f.engine.poll();
  assert.deepEqual(f.engine.nav.pressed, ['confirm']); assert.deepEqual(f.engine.nav.released, ['confirm']);
  assert.equal(f.engine.nav.held.confirm, undefined); f.engine.poll(); assert.deepEqual(f.engine.nav.pressed, []);
  const p = pad(); f.pads.push(p); f.down('ArrowLeft'); p.buttons[14].pressed = true; f.engine.poll();
  f.target.emit('keydown', { code: 'ArrowLeft', repeat: true }); f.engine.poll(); assert.deepEqual(f.engine.nav.pressed, []);
  f.up('ArrowLeft'); f.engine.poll(); assert.equal(f.engine.nav.held.left, true); assert.deepEqual(f.engine.nav.released, []);
  f.pads.length = 0; f.engine.poll(); assert.deepEqual(f.engine.nav.released, ['left']);
  f.down('Space'); f.up('Space'); f.engine.poll(); assert.equal(f.engine.state.jump, true);
  f.engine.poll(); assert.equal(f.engine.state.jump, false);
});
test('barriers quarantine held keys and sticks until release; blur clears held state', () => {
  const f = fixture(), p = pad(); f.pads.push(p); p.axes[0] = 1; f.down('Space'); f.engine.poll(); f.engine.barrier();
  f.engine.poll(); assert.equal(f.engine.state.jump, false); assert.equal(f.engine.state.moveX, 0); assert.deepEqual(f.engine.nav.pressed, []);
  f.up('Space'); p.axes[0] = 0; f.engine.poll(); f.down('Space'); p.axes[0] = 1; f.engine.poll(); assert.equal(f.engine.state.jump, true);
  f.target.emit('blur'); f.engine.poll(); assert.equal(f.engine.state.jump, false); assert.equal(f.engine.state.moveX, 0);
});
test('mapping loads legacy values, validates corruption, applies immediately, persists and labels actual bindings', () => {
  const f = fixture(); f.data.set('petal_panic_mapping', JSON.stringify({ keyboard: { jump: 'KeyZ', shoot: 33 }, gamepad: { moveLeft: 'axis:-1x' } }));
  f.engine.loadMapping(); assert.equal(f.engine.buttonLabel('jump'), 'Z');
  assert.deepEqual(f.engine.mapping.gamepad.moveLeft, ['axis:0:-1','btn:14']);
  f.down('KeyZ'); f.engine.poll(); assert.equal(f.engine.state.jump, true);
  f.engine.setBinding('keyboard', 'jump', 'KeyB'); f.up('KeyZ'); f.engine.poll(); f.down('KeyB'); f.engine.poll(); assert.equal(f.engine.state.jump, true);
  const reloaded = createInput({ storage: () => f.storage }); assert.deepEqual(reloaded.mapping.keyboard.jump, ['KeyB']); reloaded.destroy();
  f.engine.resetMapping(); assert.equal(f.engine.buttonLabel('jump', 'keyboard'), 'SPACE');
  const unavailable = createInput({ storage: () => { throw Error('denied'); } }); assert.equal(unavailable.setBinding('keyboard', 'jump', 'KeyZ'), true); unavailable.destroy();
});
test('lockDir freezes previous aim until release, uses facing before first aim; lockMove leaves aim free', () => {
  const f = fixture(); f.down('KeyK'); f.engine.poll({ facing: -1 }); assert.equal(f.engine.state.aimX, -1);
  f.down('KeyW'); f.engine.poll(); assert.equal(f.engine.state.aimX, -1);
  f.up('KeyK'); f.engine.poll(); assert.equal(f.engine.state.aimY, -1);
  f.down('KeyK'); f.up('KeyW'); f.down('KeyD'); f.engine.poll(); assert.ok(Math.abs(f.engine.state.aimX) < 1e-9); assert.equal(f.engine.state.aimY, -1);
  f.up('KeyK'); f.down('KeyL'); f.engine.poll(); assert.equal(f.engine.state.moveX, 0); assert.equal(f.engine.state.aimX, 1);
});
function clean(state) {
  pads.length = 0; windowEvents.emit('blur'); windowEvents.emit('focus'); input.cancelCapture(); input.resetMapping();
  setState(state); U.processInput();
}
function key(code, down = true) { windowEvents.emit(down ? 'keydown' : 'keyup', { code }); }
function tap(code) { key(code); U.processInput(); key(code, false); U.processInput(); }
test('capture cancel/back is identical across both tabs and both controlling devices; next back leaves one level', () => {
  for (const tab of ['keyboard','gamepad']) for (const source of ['keyboard','gamepad']) {
    clean(S.PAUSE); tryTransition(S.REMAP); Remap.tab = tab;
    const p = pad(); pads.push(p); U.processInput();
    const press = button => { if (source === 'keyboard') key(button === 0 ? 'Enter' : 'Escape'); else p.buttons[button].pressed = true; U.processInput(); };
    const release = button => { if (source === 'keyboard') key(button === 0 ? 'Enter' : 'Escape', false); else p.buttons[button].pressed = false; U.processInput(); };
    press(0); assert.equal(Remap.capturing, true); release(0);
    press(1); assert.equal(Remap.capturing, false); assert.equal(getState(), S.REMAP);
    U.processInput(); assert.equal(getState(), S.REMAP); release(1);
    press(1); assert.equal(getState(), S.PAUSE); U.processInput(); assert.equal(getState(), S.PAUSE); release(1);
  }
  clean(S.HOME); tryTransition(S.REMAP); tap('Escape'); assert.equal(getState(), S.HOME);
});
test('capture normalizes inputs, ignores wrong source, advances once and cancels in place', () => {
  clean(S.PAUSE); tryTransition(S.REMAP); Remap.tab = 'keyboard'; Remap.focus = 4;
  tap('Enter'); const p = pad(); pads.push(p); p.buttons[3].pressed = true; U.processInput();
  assert.equal(Remap.focus,4); assert.equal(Remap.capturing,true);
  tap('Space'); assert.deepEqual(input.mapping.keyboard.jump,['Space']);
  assert.equal(Remap.focus,5); assert.equal(Remap.capturing,true);
  tap('Escape'); assert.equal(Remap.focus,5); assert.equal(Remap.capturing,false);
  Remap.tab='gamepad'; tap('Enter'); p.axes[2]=-1; U.processInput();
  assert.deepEqual(input.mapping.gamepad.shoot,['axis:2:-1']);
  assert.equal(Remap.focus,6); assert.equal(Remap.capturing,true);
  U.processInput(); assert.equal(Remap.focus,6);
  tap('Escape'); assert.equal(getState(),S.REMAP);
  tap('Escape'); assert.equal(getState(),S.PAUSE);
});
test('simultaneous sources dispatch once and transitions discard the remaining batch', () => {
  clean(S.SELECT); Select.reset(); const p = pad(); pads.push(p);
  key('ArrowRight'); p.buttons[15].pressed = true; U.processInput(); assert.equal(Select.focus, 1);
  key('Enter'); p.buttons[0].pressed = true; p.buttons[9].pressed = true; U.processInput();
  assert.equal(getState(), S.PLAY); U.processInput(); assert.equal(getState(), S.PLAY); assert.equal(input.state.jump, false);
  clean(S.PAUSE); tryTransition(S.REMAP); Remap.tab = 'keyboard'; tap('Enter'); key('Enter'); key('KeyZ'); U.processInput();
  assert.equal(Remap.capturing, true); U.processInput(); assert.equal(Remap.capturing, true);
});
test('Space jump and Circle super never pause; Escape/Options do; pause menu closures are wired', () => {
  clean(S.PLAY); key('Space'); U.processInput(); assert.equal(input.state.jump, true); assert.equal(getState(), S.PLAY);
  key('Space', false); const p = pad(); pads.push(p); p.buttons[1].pressed = true; U.processInput(); assert.equal(input.state.supermove, true); assert.equal(getState(), S.PLAY);
  p.buttons[9].pressed = true; U.processInput(); assert.equal(getState(), S.PAUSE);
  U.processInput(); assert.equal(getState(), S.PAUSE); p.buttons[9].pressed = false; U.processInput();
  Pause.focus = 1; U.getHero().lives = 1; tap('Enter'); assert.equal(getState(), S.PLAY); assert.equal(U.getHero().lives, 3);
  tap('Escape'); assert.equal(getState(), S.PAUSE); Pause.focus = 2; tap('Enter'); assert.equal(getState(), S.REMAP);
  tap('Escape'); Pause.focus = 3; tap('Enter'); assert.equal(getState(), S.HOME);
  clean(S.OVER); const h = U.getHero(); h.coins = 1500; h.continuesUsed = 0; h.checkpoint = { x: 400, y: 100 }; GameOver.focus = 1;
  tap('Enter'); assert.equal(getState(), S.PLAY); assert.equal(U.getHero().coins, 500); assert.equal(U.getHero().continuesUsed, 1); assert.equal(U.getHero().lives, 1);
});

test('disconnect, visibility and focus lifecycle release semantic holds without phantom reconnect edges', () => {
  const f = fixture(), p = pad(2); f.pads.push(null, null, p);
  p.buttons[14].pressed = true; f.engine.poll(); assert.equal(f.engine.nav.held.left, true);
  f.target.emit('gamepaddisconnected', { gamepad: p }); f.pads.length = 0; f.engine.poll();
  assert.deepEqual(f.engine.nav.released, ['left']); assert.equal(f.engine.state.gamepadLayout, null);
  f.pads.push(p); f.engine.poll(); assert.deepEqual(f.engine.nav.pressed, ['left']);
  f.target.emit('blur'); f.engine.poll(); assert.deepEqual(f.engine.nav.released, ['left']);
  f.target.emit('focus'); f.engine.poll(); assert.equal(f.engine.nav.held.left, undefined);
  p.buttons[14].pressed = false; f.engine.poll(); p.buttons[14].pressed = true; f.engine.poll();
  assert.equal(f.engine.nav.held.left, true);
  f.engine.beginCapture('keyboard'); f.document.hidden = true; f.document.emit('visibilitychange');
  assert.equal(f.engine.capturing, false); f.engine.poll(); assert.equal(f.engine.state.moveX, 0);
});
test('back wins simultaneous capture binding, and keyboard short taps can bind', () => {
  const f = fixture(), p = pad(); f.pads.push(p); f.engine.beginCapture('keyboard');
  f.down('KeyZ'); p.buttons[1].pressed = true; f.engine.poll();
  assert.deepEqual(f.engine.captureResult, { status: 'cancelled' }); assert.deepEqual(f.engine.nav.pressed, []);
  f.up('KeyZ'); p.buttons[1].pressed = false; f.engine.poll(); f.engine.beginCapture('keyboard');
  f.down('KeyB'); f.up('KeyB'); f.engine.poll();
  assert.deepEqual(f.engine.captureResult, { status: 'bound', source: 'keyboard', binding: 'KeyB' });
  f.engine.poll(); assert.deepEqual(f.engine.nav.pressed, []);
});

test('approved defaults: every movement alias, Down crouch, trigger locks and both supers', () => {
  assert.equal('crouch' in DEFAULT_MAPPING.keyboard, false);
  assert.equal('crouch' in DEFAULT_MAPPING.gamepad, false);
  for (const source of ['keyboard', 'gamepad']) for (const [action, axis, value] of [
    ['moveUp','moveY',-1], ['moveDown','moveY',1], ['moveLeft','moveX',-1], ['moveRight','moveX',1],
  ]) {
    assert.equal(DEFAULT_MAPPING[source][action].length, 2);
    for (const binding of DEFAULT_MAPPING[source][action]) {
      const f = fixture(), p = pad(); f.pads.push(p);
      if (source === 'keyboard') f.down(binding);
      else if (binding.startsWith('btn:')) p.buttons[Number(binding.slice(4))].pressed = true;
      else { const [, index, sign] = binding.split(':'); p.axes[index] = Number(sign); }
      f.engine.poll(); assert.equal(f.engine.state[axis], value);
      assert.equal(f.engine.state.crouch, action === 'moveDown');
      if (action === 'moveDown') {
        f.down('KeyL'); f.engine.poll(); assert.equal(f.engine.state.moveY, 0); assert.equal(f.engine.state.crouch, true);
      }
      f.engine.destroy();
    }
  }
  for (const [button, action] of [[6,'lockDir'], [7,'lockMove'], [2,'shooting'], [5,'supermove'], [1,'supermove']]) {
    const f = fixture(), p = pad(); f.pads.push(p); p.buttons[button].pressed = true;
    f.engine.poll(); assert.equal(f.engine.state[action], true);
    if (button === 7) assert.equal(f.engine.state.shooting, false);
    f.engine.poll(); if (action === 'supermove') assert.equal(f.engine.state.supermove, false);
    f.engine.destroy();
  }
  const f = fixture(); f.engine.setBinding('keyboard', 'moveDown', 'KeyZ');
  f.down('KeyZ'); f.down('KeyW'); f.down('KeyL'); f.engine.poll();
  assert.equal(f.engine.state.crouch, true); assert.equal(f.engine.state.moveY, 0);
  assert.equal(f.engine.buttonLabel('crouch', 'keyboard'), 'Z / ↓');
  assert.equal(formatBinding('axis:0:-1','gamepad'), 'LS ←');
  assert.equal(formatBinding('axis:1:1','gamepad'), 'LS ↓');
  assert.equal(formatBinding('btn:2','gamepad','PS5'), '□');
});
test('fixed binding limits persist replacements without losing siblings', () => {
  const f = fixture();
  assert.equal(f.engine.setBinding('keyboard','moveUp','KeyZ',1), true);
  assert.equal(f.engine.addBinding('keyboard','moveUp','KeyB'), false);
  assert.equal(f.engine.addBinding('keyboard','jump','KeyB'), false);
  f.engine.loadMapping(); assert.deepEqual(f.engine.mapping.keyboard.moveUp, ['KeyW','KeyZ']);
  assert.equal(f.engine.setBinding('gamepad','supermove','btn:4',1), true);
  assert.deepEqual(f.engine.mapping.gamepad.supermove, ['btn:1','btn:4']);
});
test('migration upgrades only exact complete old defaults, preserving custom and partial saves', () => {
  const f = fixture(); const old = structuredClone(DEFAULT_MAPPING);
  old.keyboard.shoot = ['ControlLeft','ControlRight'];
  old.keyboard.crouch = ['KeyS','ArrowDown'];
  Object.assign(old.gamepad, { shoot: ['btn:2','btn:7'], supermove: ['btn:1'], crouch: ['btn:13'], lockDir: ['btn:10'], lockMove: ['btn:11'] });
  const load = data => { f.data.set('petal_panic_mapping',JSON.stringify(data)); f.engine.loadMapping(); };
  load(old); assert.deepEqual(f.engine.mapping, DEFAULT_MAPPING);
  const singleton = structuredClone(old);
  for (const source of ['keyboard','gamepad']) for (const action of Object.keys(singleton[source])) singleton[source][action] = singleton[source][action][0];
  Object.assign(singleton.gamepad, { moveLeft: 'axis:-1x', moveRight: 'axis:1x', moveUp: 'axis:-1y', moveDown: 'axis:1y' });
  load(singleton); assert.deepEqual(f.engine.mapping, DEFAULT_MAPPING);
  singleton.gamepad.lockDir = 'btn:6'; singleton.gamepad.lockMove = 'btn:7';
  load(singleton); assert.deepEqual(f.engine.mapping.gamepad.lockDir, ['btn:6']);
  assert.deepEqual(f.engine.mapping.gamepad.lockMove, ['btn:7']);
  assert.deepEqual(f.engine.mapping.gamepad.moveLeft, ['axis:0:-1','btn:14']);
  assert.equal('crouch' in f.engine.mapping.gamepad, false);
  load({ gamepad: { shoot: ['btn:2','btn:7'] } }); assert.deepEqual(f.engine.mapping.gamepad.shoot, ['btn:2']);
});
test('direct chip navigation and continuous sequence preserve preferred column through single rows', () => {
  for (const column of [0,1]) {
    clean(S.PAUSE); tryTransition(S.REMAP); Remap.tab='gamepad';
    if (column) tap('ArrowRight');
    assert.equal(Remap.chip,column); assert.equal(Remap.capturing,false);
    tap('ArrowDown'); assert.equal(Remap.chip,column);
    tap('ArrowUp'); assert.equal(Remap.chip,column);
    const p=pad(); pads.push(p); U.processInput();
    tap('Enter'); assert.equal(Remap.capturing,true);
    const actions=['moveUp','moveDown','moveLeft','moveRight','jump','shoot','melee','supermove','switchWeapon','lockDir','lockMove'];
    for (let row=0;row<actions.length;row++) {
      const slot=column && (row<4 || row===7) ? 1 : 0;
      assert.equal(Remap.focus,row); assert.equal(Remap.chip,slot);
      const before=[...input.mapping.gamepad[actions[row]]];
      p.buttons[8].pressed=true; U.processInput();
      assert.equal(input.mapping.gamepad[actions[row]][slot],'btn:8');
      if (before.length===2) assert.equal(input.mapping.gamepad[actions[row]][1-slot],before[1-slot]);
      assert.equal(Remap.focus,Math.min(row+1,10));
      U.processInput(); assert.equal(Remap.focus,Math.min(row+1,10));
      assert.equal(Remap.capturing,row<10);
      p.buttons[8].pressed=false; U.processInput();
    }
    assert.equal(getState(),S.REMAP);
    tap('Escape'); assert.equal(getState(),S.PAUSE);
  }
});
test('tabs are a focusable row and chips have distinct navigation/capture styles', () => {
  clean(S.PAUSE); tryTransition(S.REMAP); Remap.tab='keyboard';
  tap('ArrowUp'); assert.equal(Remap.focus,-1);
  tap('ArrowRight'); assert.equal(Remap.tab,'gamepad');
  tap('ArrowLeft'); assert.equal(Remap.tab,'keyboard');
  tap('ArrowDown'); tap('ArrowRight'); assert.equal(Remap.chip,1);
  const text=[], fills=[];
  const ctx=new Proxy({}, {get:(_,prop)=>prop==='createLinearGradient' ? ()=>({addColorStop(){}})
    : prop==='fillText' ? (label,x,y)=>text.push({label,x,y}) : noop,
    set:(_,prop,value)=>{if(prop==='fillStyle') fills.push(value);return true;}});
  Remap.draw(ctx);
  assert.ok(fills.includes('rgba(255,110,199,0.15)'));
  assert.ok(!text.some(t=>t.label==='+ Add'));
  tap('Enter'); fills.length=0; Remap.draw(ctx);
  assert.ok(fills.includes('rgba(255,110,199,0.5)'));
  tap('Escape'); assert.equal(Remap.chip,1); assert.equal(Remap.focus,0);
  tap('Escape'); assert.equal(getState(),S.PAUSE);
});


test('actual shot octants honor direction lock and all eight stationary aim directions on both devices', async () => {
  const { aimFromInput, Projectile } = await import('../projectile.js');
  const directions=[[1,0,0],[1,-1,1],[0,-1,2],[-1,-1,3],[-1,0,4],[-1,1,5],[0,1,6],[1,1,7]];
  for (const source of ['keyboard','gamepad']) {
    const f=fixture(), p=pad(); f.pads.push(p);
    const direction=(x,y)=>{
      for (const [code,on] of [['ArrowLeft',x<0],['ArrowRight',x>0],['ArrowUp',y<0],['ArrowDown',y>0]]) {
        if(source==='keyboard') (on?f.down:f.up)(code);
      }
      if(source==='gamepad') { p.axes[0]=x; p.axes[1]=y; }
    };
    const lock=(kind,on)=>{
      if(source==='keyboard') (on?f.down:f.up)(kind==='dir'?'KeyK':'KeyL');
      else p.buttons[kind==='dir'?6:7].pressed=on;
    };
    direction(1,-1); f.engine.poll(); lock('dir',true); f.engine.poll();
    for(const [x,y] of directions) {
      direction(x,y); f.engine.poll();
      assert.equal(aimFromInput(f.engine.state,-1),1);
      const shot=new Projectile(0,0,aimFromInput(f.engine.state,-1));
      assert.ok(shot.vx>0 && shot.vy<0);
      assert.equal(f.engine.state.moveX,x);
    }
    lock('dir',false); lock('move',true);
    for(const [x,y,octant] of directions) {
      direction(x,y); f.engine.poll();
      assert.equal(f.engine.state.moveX,0); assert.equal(f.engine.state.moveY,0);
      assert.equal(aimFromInput(f.engine.state,1),octant,source+':'+octant);
    }
    // Right stick overrides the entire aim vector, not individual movement axes.
    direction(1,0); p.axes[2]=0; p.axes[3]=-1; f.engine.poll();
    assert.equal(aimFromInput(f.engine.state,1),2);
    f.engine.destroy();
  }
});
