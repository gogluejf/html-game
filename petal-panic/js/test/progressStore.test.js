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
  assert.equal(s.settings.music, false); // mistyped → default
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
  updateProgress((store) => {
    store.progress.completedAreas['area-5'] = true;
    if (!store.progress.defeatedBosses.includes('boss-1')) store.progress.defeatedBosses.push('boss-1');
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
  updateProgress((store) => { store.saveMeta = { level: 1, area: 1, score: 10, timestamp: 1 }; });
  assert.equal(hasSave(), true);
  clearRunSave();
  assert.equal(hasSave(), false);
  _resetCache();
  assert.equal(loadStore().saveMeta, null);
});

test('clearRunSave keeps progress and settings, only drops saveMeta', () => {
  fixture();
  updateProgress((store) => { store.progress.completedAreas['a1'] = true; store.saveMeta = { level: 1 }; });
  updateSettings((s) => { s.music = true; });
  clearRunSave();
  _resetCache();
  const s = loadStore();
  assert.equal(s.saveMeta, null);
  assert.equal(s.progress.completedAreas['a1'], true);
  assert.equal(s.settings.music, true);
});

test('storage failure leaves in-memory state usable and reports failure', () => {
  setStorage(() => { throw Error('denied'); }); _resetCache();
  const store = loadStore();
  store.saveMeta = { level: 1 };
  assert.equal(saveStore(store), false);
  assert.equal(hasSave(), true); // memory still holds it
  setStorage(null); _resetCache();
});

test('resetStore wipes back to defaults and persists', () => {
  const f = fixture();
  updateProgress((store) => { store.saveMeta = { level: 9 }; });
  updateSettings((s) => { s.sfx = false; });
  resetStore();
  _resetCache();
  const s = loadStore();
  assert.deepEqual(s.progress, structuredClone(DEFAULT_PROGRESS));
  assert.deepEqual(s.settings, structuredClone(DEFAULT_SETTINGS));
  assert.equal(s.saveMeta, null);
  assert.ok(f.data.has(KEY));
});
