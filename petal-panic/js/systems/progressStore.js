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

/** A saveMeta is a real, resumable save only when it is a non-empty object. */
function isRealSaveMeta(sm) {
  return sm !== null && typeof sm === 'object' && !Array.isArray(sm) && Object.keys(sm).length > 0;
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
  // saveMeta: an empty object (e.g. persisted as {"saveMeta":{}}) carries
  // nothing to resume and must normalize to null so hasSave() stays false.
  base.saveMeta = isRealSaveMeta(raw.saveMeta) ? { ...raw.saveMeta } : null;
  return base;
}

/**
 * Normalize-on-write: apply the same field rules as normalize() to a live
 * in-memory document before it is persisted, so what lands in storage is
 * always exactly what a reload would produce (empty saveMeta → null, etc.).
 * Mutates and returns the document.
 */
function normalizeForWrite(doc) {
  if (doc.saveMeta !== null && !isRealSaveMeta(doc.saveMeta)) doc.saveMeta = null;
  return doc;
}

let _store = null;
let _mutationDepth = 0; // >0 while inside a withTransaction body
let _sectionBase = null; // pre-fn snapshot of the current transaction's section

/** Load the store from localStorage (defaults when empty or invalid). */
export function loadStore() {
  if (!_store) _store = readRaw();
  return _store;
}

/** Internal: force re-read from storage, bypassing the in-memory cache. */
function reloadFromStorage() {
  _store = readRaw();
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

/** Persist the given store document under the stable key. Returns success.
 *  While an outer mutation is in flight (_mutationDepth > 0) this is
 *  memory-only: the outermost mutation flushes to storage exactly once on
 *  success, so a nested throw cannot leave partial writes behind. */
export function saveStore(store) {
  if (_mutationDepth > 0) return true; // deferred: outermost mutation owns the write
  try {
    const s = storage();
    if (!s) return false; // no storage at all: the write genuinely failed
    s.setItem(STORAGE_KEY, JSON.stringify(normalizeForWrite(store)));
    return true;
  } catch { return false; } // storage blocked: state stays in memory
}

/**
 * Shared transaction helper for all mutating APIs.
 *
 * - Snapshots the CURRENT cached document before fn runs.
 * - Runs fn with the CURRENT cached document (fresh reference resolved at
 *   call time, never a captured one).
 * - On ANY thrown error (including falsy ones like `throw null`): restore the
 *   snapshot to `_store`, flush that snapshot to storage when we are the
 *   outermost mutation, and rethrow the original error.
 * - On success: when we are the outermost mutation, flush the CURRENT `_store`
 *   (live cache — whatever nested mutations left there) to storage exactly
 *   once. If the write fails, roll memory back to the snapshot.
 *
 * Because both the rollback and the success flush operate on the live
 * `_store` rather than a reference captured before fn ran, a nested
 * mutation's rollback (which replaces `_store`) is exactly what gets flushed.
 * @param {(store: object) => void} fn receives the current full store document.
 * @returns {boolean} true when the transaction committed (outermost flush
 *   succeeded or was deferred by an enclosing transaction), false when the
 *   outermost persist failed and memory was rolled back.
 */
function withTransaction(fn, innerKey = null) {
  const store = loadStore();
  const snapshot = structuredClone(store);
  let threw = false;
  let err;
  _mutationDepth++;
  _sectionBase = innerKey ? structuredClone(store[innerKey]) : null;
  try {
    fn(loadStore()); // fresh reference: may differ from `store` after nested ops
  } catch (e) {
    threw = true;
    err = e;
  } finally {
    _mutationDepth--;
    if (_mutationDepth === 0) _sectionBase = null;
  }
  if (threw) {
    // Rollback semantics:
    // - If the error PROPAGATES out of this transaction (the mutator did not
    //   catch it), nothing inside is trusted: at the outermost level we
    //   restore the pre-fn snapshot to memory AND storage.
    // - If a NESTED transaction failed but the enclosing mutator CAUGHT the
    //   error and continued, the live document is authoritative: nested
    //   sections rolled back by their own transactions stay rolled back,
    //   and the enclosing mutator's subsequent work is kept. The outermost
    //   success path then flushes the live document once.
    // `threw` is only true when the error escaped THIS fn; a caught nested
    // error never sets it, so the two cases cannot be confused here.
    if (_mutationDepth === 0) {
      _store = snapshot; // full rollback: no one above will act on partial state
      saveStore(snapshot); // sync storage to rolled-back memory
    }
    // When nested (depth > 0): leave _store exactly as this transaction left
    // it and let the error propagate. The enclosing mutator's catch block
    // owns the live document from here on; whatever it does next is what the
    // outermost flush will persist. No restoration at this level.
    throw err; // rethrow the ORIGINAL error, even if falsy (null/0/'')
  }
  if (_mutationDepth > 0) return true; // nested: outermost transaction owns the flush
  const ok = saveStore(_store); // outermost: single flush of the LIVE cache
  if (!ok) _store = snapshot; // persist failed: memory rolls back to last good state
  else reloadFromStorage(); // keep memory in sync with what was actually persisted
  return ok;
}

/**
 * Restore the given section of the live document to this transaction's
 * pre-fn base, IN PLACE (so references held by the enclosing mutator stay
 * valid). Used when a nested mutation failed and the enclosing mutator
 * caught the error: the mutator then continues on a clean base, and the
 * outermost flush persists exactly what it ends up with.
 */
function resetSectionToBase(key) {
  const doc = loadStore();
  const section = doc[key];
  const base = _sectionBase;
  for (const k of Object.keys(section)) delete section[k];
  if (base) Object.assign(section, base);
}

/**
 * Mutate the progress section and persist atomically.
 * The mutator receives store.progress (the PROGRESS section, not the full
 * document), matching the plan's documented callback style:
 *   updateProgress((store) => { store.completedAreas[areaId] = true; });
 * If the mutator throws or persistence fails, the in-memory store is restored
 * to its pre-mutation state. Returns true on success, false when persistence
 * failed (mutator errors are rethrown).
 * @param {(progress: object) => void} mutator receives store.progress.
 */
export function updateProgress(mutator) {
  return withTransaction((store) => {
    try {
      mutator(store.progress);
    } catch (e) {
      resetSectionToBase('progress');
      throw e;
    }
  }, 'progress');
}

/**
 * Mutate the settings section and persist atomically.
 * The mutator receives store.settings. Same snapshot/rollback semantics as
 * updateProgress: a throwing mutator leaves the store unchanged, and a failed
 * write restores the pre-mutation state so memory never diverges from storage.
 * @param {(settings: object) => void} mutator receives store.settings.
 */
export function updateSettings(mutator) {
  return withTransaction((store) => {
    try {
      mutator(store.settings);
    } catch (e) {
      resetSectionToBase('settings');
      throw e;
    }
  }, 'settings');
}

/** Unlock a media entry (id like 'intro', 'level-3', 'ending') and persist. */
export function markMediaUnlocked(id) {
  withTransaction((store) => {
    if (!store.progress.mediaUnlocked.includes(id)) store.progress.mediaUnlocked.push(id);
  });
  return loadStore();
}

/** True when a resumable run exists (saveMeta was written by Save & Quit).
 *  Requires a NON-EMPTY saveMeta so an in-memory `{}` never counts as a save. */
export function hasSave() {
  return isRealSaveMeta(loadStore().saveMeta);
}

/** Drop the resumable run (New Game / clearing the save). Keeps progress+settings. */
export function clearRunSave() {
  withTransaction((store) => { store.saveMeta = null; });
  return loadStore();
}

/** Wipe the entire stored document (back to defaults) and persist. */
export function resetStore() {
  _store = freshDefaults();
  const ok = saveStore(_store); // outermost call: flushes immediately
  if (!ok) _store = freshDefaults(); // memory stays at defaults either way
  return _store;
}

/** Test hook: forget the cached in-memory store (next loadStore re-reads). */
export function _resetCache() { _store = null; }
