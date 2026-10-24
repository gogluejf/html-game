// Petal Panic — Persistent progress and settings store.
//
// Single localStorage-backed JSON document for game progress (completed areas,
// defeated bosses, media unlocks), player settings, and save metadata
// (the resumable run). Screens and systems must go through this module's API
// instead of touching localStorage directly, so persistence has one key,
// one shape, and one set of safe defaults.
//
// Persistence: localStorage('petal_panic_store')
//
// The in-memory store is the source of truth once loaded; every mutating API
// (updateProgress / updateSettings / markMediaUnlocked / clearRunSave) applies
// the change to memory AND persists the whole document atomically.

const STORAGE_KEY = 'petal_panic_store';

export const DEFAULT_PROGRESS = {
  version: 1,
  completedAreas: {},
  defeatedBosses: [],
  mediaUnlocked: [],
};

export const DEFAULT_SETTINGS = {
  music: false,
  sfx: true,
  screenShake: true,
  vibration: true,
};

let _storage = null; // resolved lazily so node tests can stub globalThis.localStorage

function storage() {
  if (_storage === null) _storage = globalThis.localStorage ?? null;
  return _storage;
}

/** Test hook: point the store at a different storage object (or null). */
export function setStorage(impl) { _storage = impl ?? null; }

function freshDefaults() {
  return {
    progress: structuredClone(DEFAULT_PROGRESS),
    settings: structuredClone(DEFAULT_SETTINGS),
    saveMeta: null,
  };
}

function coerce(value, fallback, type) {
  return value !== undefined && typeof value === type ? value : fallback;
}

/** Merge a parsed document onto defaults, tolerating missing/mistyped fields. */
function normalize(raw) {
  const base = freshDefaults();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw.progress;
  if (p && typeof p === 'object') {
    base.progress.completedAreas = (p.completedAreas && typeof p.completedAreas === 'object' && !Array.isArray(p.completedAreas))
      ? { ...p.completedAreas } : {};
    base.progress.defeatedBosses = Array.isArray(p.defeatedBosses)
      ? p.defeatedBosses.filter(b => typeof b === 'string') : [];
    base.progress.mediaUnlocked = Array.isArray(p.mediaUnlocked)
      ? p.mediaUnlocked.filter(m => typeof m === 'string') : [];
  }
  const s = raw.settings;
  if (s && typeof s === 'object') {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      base.settings[key] = coerce(s[key], DEFAULT_SETTINGS[key], 'boolean');
    }
  }
  // saveMeta: keep as-is when it looks like an object; otherwise no save.
  base.saveMeta = (raw.saveMeta && typeof raw.saveMeta === 'object' && !Array.isArray(raw.saveMeta))
    ? { ...raw.saveMeta } : null;
  return base;
}

let _store = null;

/** Load the store from localStorage (defaults when empty or invalid). */
export function loadStore() {
  if (!_store) _store = readRaw();
  return _store;
}

function readRaw() {
  try {
    const text = storage()?.getItem(STORAGE_KEY);
    if (!text) return freshDefaults();
    return normalize(JSON.parse(text));
  } catch { /* unavailable/corrupt storage: defaults remain usable */ }
  return freshDefaults();
}

/** Persist the given store document under the stable key. Returns success. */
export function saveStore(store) {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch { return false; } // storage blocked: state stays in memory
}

/**
 * Mutate the progress section and persist atomically.
 * @param {(store: object) => void} mutator receives the full store document.
 */
export function updateProgress(mutator) {
  const store = loadStore();
  mutator(store);
  saveStore(store);
  return store;
}

/**
 * Mutate the settings section and persist atomically.
 * @param {(settings: object) => void} mutator receives store.settings.
 */
export function updateSettings(mutator) {
  const store = loadStore();
  mutator(store.settings);
  saveStore(store);
  return store;
}

/** Unlock a media entry (id like 'intro', 'level-3', 'ending') and persist. */
export function markMediaUnlocked(id) {
  const store = loadStore();
  if (!store.progress.mediaUnlocked.includes(id)) store.progress.mediaUnlocked.push(id);
  saveStore(store);
  return store;
}

/** True when a resumable run exists (saveMeta was written by Save & Quit). */
export function hasSave() {
  return !!loadStore().saveMeta;
}

/** Drop the resumable run (New Game / clearing the save). Keeps progress+settings. */
export function clearRunSave() {
  const store = loadStore();
  store.saveMeta = null;
  saveStore(store);
  return store;
}

/** Wipe the entire stored document (back to defaults) and persist. */
export function resetStore() {
  _store = freshDefaults();
  saveStore(_store);
  return _store;
}

/** Test hook: forget the cached in-memory store (next loadStore re-reads). */
export function _resetCache() { _store = null; }
