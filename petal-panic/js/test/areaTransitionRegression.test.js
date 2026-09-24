import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const noop = () => {};
const ctx = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => ctx, addEventListener: noop }) };
globalThis.window = { addEventListener: noop, __selectedHero: 'scarlet' };
const U = await import('../systems/update.js');
const { S, setState, getState } = await import('../state.js');
const { makeCheckpoint } = await import('../object.js');
const { ZONE_ENTRY_X, ZONE_GROUND_Y } = await import('../level.js');
const DT = 1 / 60;

for (const from of [1, 4]) {
  test(`real update loop: ${from} entry transition must not simulate the next zone at the old exit`, () => {
    U.bossZone.reset();
    Object.assign(U.getClearSequence(), { state: 'idle', timer: 0, pendingArea: null, pendingFadeIn: false });
    const h = U.getHero();
    h.currentArea = from;
    h.dying = false;
    h.alive = true;
    h.energy = h.maxEnergy;
    const zone = U.getActiveZone(h);
    const flag = makeCheckpoint(zone.exitFlag.id, zone.exitFlag.x, zone.exitFlag.y, { isEntry: false });
    U.loadActiveZone(zone, { solids: zone.platforms, enemies: [], barrels: [], powerups: [], checkpoints: [flag] });
    h.x = flag.x - 20;
    h.y = ZONE_GROUND_Y - h.h;
    h.vx = h.vy = 0;
    setState(S.PLAY);
    U.update(DT); // Real collision, not a direct call to the clear helper.
    assert.equal(U.getClearSequence().state, 'banner');
    let frames = 0;
    while (h.currentArea === from && frames++ < 300) U.update(DT);
    assert.equal(h.currentArea, from + 1);
    assert.equal(getState(), S.AREA_ENTRY);
    assert.equal(U.getClearSequence().state, 'idle', 'no second clear or boss intro on the zone-swap frame');
    assert.equal(U.bossZone.active, false, 'boss trigger must not run behind entry card');
    assert.ok(U.getCheckpoints().every(c => !c.triggered));
    for (let i = 0; i < 240; i++) U.update(DT); // Timed entry, no confirm shortcut or held key.
    assert.equal(getState(), S.PLAY);
    assert.equal(h.currentArea, from + 1);
    assert.equal(h.x, ZONE_ENTRY_X);
    assert.equal(U.bossZone.active, false);
  });
}
