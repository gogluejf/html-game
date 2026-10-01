// ---------- edit commit: the ONLY door for game-data mutations ----------
// Every code path that changes game data (pointer drag, side-panel inputs,
// keyboard nudges, add/delete) calls commit(). It owns the full choreography:
//   undo snapshot → mutate → persist game data → refresh panel + canvas.
// UI files must NOT call pushUndo/markGameDataChanged/syncPanel/draw in
// sequence themselves — that duplication is how desync bugs were born.

import { app } from './state.js';
import { draw } from './draw.js';
import { syncPanel } from './panel.js';
import { pushUndo } from './undo.js';
import { markGameDataChanged } from './save.js';

// Commit a game-data mutation. `mutate` runs with the undo snapshot already
// taken; if it throws, nothing is marked changed and the caller can abort.
export function commit(mutate){
  if (!app.cur || !app.cur.st) return;
  pushUndo();
  mutate();
  markGameDataChanged();
  syncPanel();
  draw();
}
