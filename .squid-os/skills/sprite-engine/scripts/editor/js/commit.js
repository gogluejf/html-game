// ---------- edit commit: the ONLY door for game-data mutations ----------
// Every code path that changes game data (pointer drag, side-panel inputs,
// keyboard nudges, add/delete) calls commit(). It owns the full choreography:
//   undo snapshot → mutate → persist game data → refresh panel + canvas.
// UI files must NOT call pushUndo/markGameDataChanged/syncPanel/draw in
// sequence themselves — that duplication is how desync bugs were born.

import { app } from './state.js';
import { pushUndo } from './undo.js';
import { markGameDataChanged } from './save.js';
import { renderAll } from './render.js';

// Commit a game-data mutation. `mutate` runs with the undo snapshot already
// taken; if it throws, nothing is marked changed and the caller can abort.
// Ordering matters: markGameDataChanged() MUST run AFTER mutate(). renderAll()
// is deferred to a microtask so syncPanel() reads the POST-mutation state —
// doing it synchronously here made callers race the panel refresh (fps/scale/
// paste edits visually "not saving"). Callers that set UI values themselves
// must do it BEFORE commit(), since the deferred syncPanel overwrites them.
export function commit(mutate){
  if (!app.cur || !app.cur.st) return Promise.resolve();
  pushUndo();
  mutate();
  markGameDataChanged();
  return Promise.resolve().then(renderAll);
}
