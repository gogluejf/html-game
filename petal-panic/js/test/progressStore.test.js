// Task 1.1 — progressStore tests (pure logic, no DOM).
// Run: node --test js/test/progressStore.test.js

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_PROGRESS, DEFAULT_SETTINGS,
  loadStore, saveStore, updateProgress, updateSettings,
  markMediaUnlocked, hasSave, clearRunSave, resetStore, setStorage, _resetCache,
} from '../systems/progressStore.js';

const KEY = 'petal_panic_store';

function fixture() {
  const data = new Map();
  const storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
  setStorage(storage); _resetCache();
  return { data, storage };
}

test('loadStore returns defaults when localStorage is empty', () => {
  fixture();
  const store = loadStore();
  assert.deepEqual(store.progress, structuredClone(DEFAULT_PROGRESS));
  assert.deepEqual(store.settings, structuredClone(DEFAULT_SETTINGS));
  assert.equal(store.saveMeta, null);
  assert.equal(hasSave(), false);
});

test('loadStore returns defaults when stored JSON is invalid or mistyped', () => {
  const f = fixture();
  f.data.set(KEY, '{not json');
  assert.deepEqual(loadStore().settings, DEFAULT_SETTINGS);
  _resetCache();
  f.data.set(KEY, JSON.stringify({ progress: { defeatedBosses: 'nope', mediaUnlocked: 42 }, settings: { music: 'yes' } }));
  const s = loadStore();
  assert.deepEqual(s.progress.defeatedBosses, []);
  assert.deepEqual(s.progress.mediaUnlocked, []);
  assert.equal(s.settings.music, true); // mistyped → default
});

test('saveStore persists one JSON document under the stable key', () => {
  const f = fixture();
  const store = loadStore();
  store.saveMeta = { level: 2, area: 3, score: 900, timestamp: 123 };
  assert.equal(saveStore(store), true);
  assert.equal(f.data.size, 1);
  assert.ok(f.data.has(KEY));
  assert.deepEqual(JSON.parse(f.data.get(KEY)), store);
});

test('updateProgress mutates and persists atomically; survives reload', () => {
  fixture();
  // Plan §5.3 callback style: the mutator receives the PROGRESS section.
  updateProgress((store) => {
    store.completedAreas['area-5'] = true;
    if (!store.defeatedBosses.includes('boss-1')) store.defeatedBosses.push('boss-1');
  });
  _resetCache();
  const reloaded = loadStore();
  assert.equal(reloaded.progress.completedAreas['area-5'], true);
  assert.deepEqual(reloaded.progress.defeatedBosses, ['boss-1']);
});

test('updateSettings mutates and persists atomically; survives reload', () => {
  fixture();
  updateSettings((s) => { s.music = true; s.screenShake = false; });
  _resetCache();
  const s = loadStore().settings;
  assert.equal(s.music, true);
  assert.equal(s.sfx, true); // untouched
  assert.equal(s.screenShake, false);
  assert.equal(s.vibration, true);
});

test('markMediaUnlocked dedupes and persists', () => {
  fixture();
  markMediaUnlocked('level-1');
  markMediaUnlocked('level-1');
  markMediaUnlocked('ending');
  _resetCache();
  assert.deepEqual(loadStore().progress.mediaUnlocked, ['level-1', 'ending']);
});

test('hasSave reflects whether a resumable run exists', () => {
  fixture();
  assert.equal(hasSave(), false);
  updateProgress((progress) => { progress.mediaUnlocked.push('level-1'); });
  // saveMeta is set via the full document through loadStore (not via the
  // progress-section mutator), as Save & Quit does.
  loadStore().saveMeta = { level: 1, area: 1, score: 10, timestamp: 1 };
  saveStore(loadStore());
  assert.equal(hasSave(), true);
  clearRunSave();
  assert.equal(hasSave(), false);
  _resetCache();
  assert.equal(loadStore().saveMeta, null);
});

test('hasSave is false when persisted saveMeta is an empty object', () => {
  const f = fixture();
  f.data.set(KEY, JSON.stringify({ saveMeta: {} }));
  _resetCache();
  assert.equal(hasSave(), false);
  assert.equal(loadStore().saveMeta, null);
});

test('clearRunSave keeps progress and settings, only drops saveMeta', () => {
  fixture();
  updateProgress((progress) => { progress.completedAreas['a1'] = true; });
  loadStore().saveMeta = { level: 1 };
  saveStore(loadStore());
  updateSettings((s) => { s.music = true; });
  clearRunSave();
  _resetCache();
  const s = loadStore();
  assert.equal(s.saveMeta, null);
  assert.equal(s.progress.completedAreas['a1'], true);
  assert.equal(s.settings.music, true);
});

test('storage failure leaves in-memory state usable and reports failure', () => {
  // F4: a storage object whose getItem/setItem throw — actually exercised.
  setStorage({
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  });
  _resetCache();
  const store = loadStore();
  assert.deepEqual(store.settings, DEFAULT_SETTINGS); // defaults, no crash
  store.saveMeta = { level: 1 };
  assert.equal(saveStore(store), false);
  assert.equal(hasSave(), true); // memory still holds it
  // mutations must not crash against denied storage either
  updateSettings((s) => { s.music = true; });
  setStorage(null); _resetCache();
});

test('update* rolls back memory and returns false when persist fails (denied storage)', () => {
  fixture();
  updateProgress((progress) => { progress.completedAreas['a1'] = true; }); // good baseline in storage
  const before = structuredClone(loadStore());
  setStorage({
    getItem: k => 'x'.repeat(0),
    setItem() { throw new Error('denied'); },
  });
  assert.equal(updateSettings((s) => { s.music = true; }), false);
  assert.equal(updateProgress((p) => { p.completedAreas['a2'] = true; }), false);
  // memory equals pre-call state after both failed calls
  assert.deepEqual(loadStore(), before);
  setStorage(null); _resetCache();
});

test('absent storage: saveStore returns false and update* roll back', () => {
  // No storage object at all (e.g. node without localStorage): the write
  // genuinely cannot happen, so it must report failure and roll back.
  setStorage(null); _resetCache();
  const store = loadStore();
  assert.deepEqual(store.settings, DEFAULT_SETTINGS); // defaults, no crash
  store.saveMeta = { level: 1 };
  assert.equal(saveStore(store), false); // no storage → write failed
  const before = structuredClone(loadStore());
  assert.equal(updateSettings((s) => { s.music = true; }), false);
  assert.equal(loadStore().settings.music, before.settings.music); // rolled back
  assert.equal(updateProgress((p) => { p.mediaUnlocked.push('intro'); }), false);
  assert.deepEqual(loadStore().progress.mediaUnlocked, before.progress.mediaUnlocked);
});

test('updateProgress rolls back when the mutator throws', () => {
  fixture();
  updateProgress((progress) => { progress.completedAreas['a1'] = true; });
  assert.throws(() => {
    updateProgress((progress) => {
      progress.completedAreas['a2'] = true;
      throw new Error('boom');
    });
  }, /boom/);
  // a1 kept, a2 rolled back, nothing persisted by the failed call
  const s = loadStore();
  assert.equal(s.progress.completedAreas['a1'], true);
  assert.equal(s.progress.completedAreas['a2'], undefined);
  _resetCache();
  const reloaded = loadStore();
  assert.equal(reloaded.progress.completedAreas['a1'], true);
  assert.equal(reloaded.progress.completedAreas['a2'], undefined);
});

test('updateSettings rolls back when the mutator throws', () => {
  fixture();
  updateSettings((s) => { s.music = true; });
  assert.throws(() => {
    updateSettings((s) => {
      s.sfx = false;
      throw new Error('kaboom');
    });
  }, /kaboom/);
  const s = loadStore().settings;
  assert.equal(s.music, true);
  assert.equal(s.sfx, true); // rolled back
});

test('failed persist restores pre-mutation memory (no divergence)', () => {
  fixture();
  updateSettings((s) => { s.music = true; }); // successfully persisted baseline
  // now make writes fail
  setStorage({
    getItem: k => 'x'.repeat(0), // irrelevant; reads come from memory cache
    setItem() { throw new Error('quota exceeded'); },
  });
  const ok = updateSettings((s) => { s.sfx = false; });
  assert.equal(ok, false);
  // memory must match what was last successfully persisted
  const s = loadStore().settings;
  assert.equal(s.music, true);
  assert.equal(s.sfx, true); // rolled back to last good write
  setStorage(null); _resetCache();
});

test('defaults are the documented literals, not just self-referential', () => {
  // F5: hardcoded literal expectations so a wrong default can't silently pass.
  fixture();
  const s = loadStore();
  assert.equal(s.settings.music, true);
  assert.equal(s.settings.sfx, true);
  assert.equal(s.settings.screenShake, true);
  assert.equal(s.settings.vibration, true);
  assert.equal(s.progress.version, 1);
  assert.deepEqual(s.progress.completedAreas, {});
  assert.deepEqual(s.progress.defeatedBosses, []);
  assert.deepEqual(s.progress.mediaUnlocked, []);
});

test('resetStore wipes back to defaults and persists', () => {
  const f = fixture();
  updateProgress((progress) => { progress.mediaUnlocked.push('level-9'); });
  updateSettings((s) => { s.sfx = false; });
  resetStore();
  _resetCache();
  const s = loadStore();
  assert.deepEqual(s.progress, structuredClone(DEFAULT_PROGRESS));
  assert.deepEqual(s.settings, structuredClone(DEFAULT_SETTINGS));
  assert.equal(s.saveMeta, null);
  assert.ok(f.data.has(KEY));
});

test('nested mutation that throws rolls back memory AND storage (R1a)', () => {
  const f = fixture();
  // Baseline: a persisted media unlock so storage is non-empty.
  markMediaUnlocked('intro');
  let writes = 0;
  const origSet = f.storage.setItem.bind(f.storage);
  f.storage.setItem = (k, v) => { writes++; return origSet(k, v); };
  assert.throws(() => {
    updateProgress((progress) => {
      progress.completedAreas['a1'] = true;
      markMediaUnlocked('level-3'); // inner mutation inside outer mutator
      throw new Error('boom');
    });
  }, /boom/);
  // Memory rolled back: no a1, no level-3.
  const mem = loadStore();
  assert.equal(mem.progress.completedAreas['a1'], undefined);
  assert.deepEqual(mem.progress.mediaUnlocked, ['intro']);
  // Simulated fresh reload: raw storage must show no 'level-3' either —
  // the inner write was deferred and never flushed.
  _resetCache();
  const reloaded = loadStore();
  assert.equal(reloaded.progress.completedAreas['a1'], undefined);
  assert.deepEqual(reloaded.progress.mediaUnlocked, ['intro']);
  // The failed call flushed exactly once (the rollback snapshot).
  assert.equal(writes, 1);
  setStorage(null); _resetCache();
});

test('successful nested mutation persists exactly once with final state (R1b)', () => {
  const f = fixture();
  markMediaUnlocked('intro');
  let writes = 0;
  const origSet = f.storage.setItem.bind(f.storage);
  f.storage.setItem = (k, v) => { writes++; return origSet(k, v); };
  const ok = updateProgress((progress) => {
    progress.completedAreas['a1'] = true;
    markMediaUnlocked('level-3'); // inner: memory-only while depth > 0
  });
  assert.equal(ok, true);
  assert.equal(writes, 1); // single flush of the final combined state
  const raw = JSON.parse(f.data.get(KEY));
  assert.equal(raw.progress.completedAreas['a1'], true);
  assert.deepEqual(raw.progress.mediaUnlocked, ['intro', 'level-3']);
  _resetCache();
  assert.deepEqual(loadStore().progress.mediaUnlocked, ['intro', 'level-3']);
  setStorage(null); _resetCache();
});

test('S1: mutator that throws a FALSY value (null) still rolls back and rethrows', () => {
  fixture();
  updateProgress((progress) => { progress.completedAreas['a1'] = true; }); // baseline
  assert.throws(() => {
    updateProgress((progress) => {
      progress.completedAreas['a2'] = true;
      throw null; // falsy exception — must NOT be treated as "no throw"
    });
  }, (e) => e === null);
  // memory rolled back: a2 gone, a1 kept
  const mem = loadStore();
  assert.equal(mem.progress.completedAreas['a1'], true);
  assert.equal(mem.progress.completedAreas['a2'], undefined);
  // storage matches: reload shows no a2 either
  _resetCache();
  const reloaded = loadStore();
  assert.equal(reloaded.progress.completedAreas['a1'], true);
  assert.equal(reloaded.progress.completedAreas['a2'], undefined);
});

test('S1: updateSettings mutator throwing a falsy value also rolls back', () => {
  fixture();
  updateSettings((s) => { s.music = true; }); // baseline
  assert.throws(() => {
    updateSettings((s) => {
      s.sfx = false;
      throw ''; // empty string is falsy too
    });
  }, (e) => e === '');
  const s = loadStore().settings;
  assert.equal(s.music, true);
  assert.equal(s.sfx, true); // rolled back
  _resetCache();
  assert.equal(loadStore().settings.sfx, true); // storage agrees
});

test('S2: outer catches inner failure and continues — no resurrection of failed inner change', () => {
  fixture();
  markMediaUnlocked('intro'); // persisted baseline
  const ok = updateProgress((progress) => {
    try {
      updateSettings((s) => { s.music = true; throw new Error('inner boom'); });
    } catch { /* outer swallows the inner error and continues */ }
    progress.completedAreas['a9'] = true; // outer keeps mutating after inner failure
  });
  assert.equal(ok, true);
  // Memory: the inner settings mutation was rolled back to its pre-call base
  // (music default true — the inner `s.music = true` was a no-op change that
  // got undone), a9 IS set (outer continued).
  const mem = loadStore();
  assert.equal(mem.settings.music, true);
  assert.equal(mem.progress.completedAreas['a9'], true);
  // Storage must equal memory exactly: no resurrection of the failed inner
  // settings change, and the outer change is present.
  _resetCache();
  const reloaded = loadStore();
  assert.deepEqual(reloaded, structuredClone(mem));
  assert.equal(reloaded.settings.music, true);
  assert.equal(reloaded.progress.completedAreas['a9'], true);
});

test('S2: outer updateProgress continues after a successful inner markMediaUnlocked, then a caught error (committed mutations persist)', () => {
  const f = fixture();
  // Baseline persisted in storage so the S2 case is observable on reload.
  markMediaUnlocked('intro');
  const ok = updateProgress((progress) => {
    try {
      markMediaUnlocked('level-3'); // inner mutation COMPLETES successfully before...
      throw new Error('inner boom'); // ...the outer callback throws (caught below)
    } catch { /* outer swallows and continues */ }
    progress.completedAreas['a9'] = true;
  });
  assert.equal(ok, true);
  // Semantics (chosen): each withTransaction call is its own atomic unit. The
  // inner markMediaUnlocked committed successfully BEFORE the outer's caught
  // throw, so it is NOT part of any failed transaction and MUST persist —
  // there is no all-or-nothing guarantee across separately-committed nested
  // calls. Only the outer's OWN partial mutation (none here besides a9, which
  // completed) would roll back if the outer threw uncaught.
  const mem = loadStore();
  assert.deepEqual(mem.progress.mediaUnlocked, ['intro', 'level-3']);
  assert.equal(mem.progress.completedAreas['a9'], true);
  // Storage must equal memory exactly.
  _resetCache();
  const reloaded = loadStore();
  assert.deepEqual(reloaded, structuredClone(mem));
  assert.deepEqual(reloaded.progress.mediaUnlocked, ['intro', 'level-3']);
  assert.equal(reloaded.progress.completedAreas['a9'], true);
});

test('S3: assigning an empty saveMeta object via API + save → hasSave() is false immediately', () => {
  const f = fixture();
  const store = loadStore();
  store.saveMeta = {}; // in-memory empty object
  assert.equal(saveStore(store), true);
  // No reload needed: hasSave must be false right away.
  assert.equal(hasSave(), false);
  // And the write normalized it: storage holds null, not {}.
  const raw = JSON.parse(f.data.get(KEY));
  assert.equal(raw.saveMeta, null);
  _resetCache();
  assert.equal(loadStore().saveMeta, null); // reload agrees
});
