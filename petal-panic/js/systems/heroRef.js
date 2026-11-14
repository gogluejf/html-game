// Hero reference indirection (newGameHook needs setHeroRef without importing
// update.js, which would be circular). update.js registers the real setter at
// boot; bare callers get a no-op.
let _setHeroRef = null;
export function registerHeroRefSetter(fn) { _setHeroRef = fn; }
export function setHeroRef(h) { if (_setHeroRef) _setHeroRef(h); }
