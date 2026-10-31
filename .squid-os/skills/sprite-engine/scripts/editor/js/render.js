// ---------- renderAll: the single "data changed → refresh everything" door ----------
// Any code path that mutates game data (commit, live drags, undo/redo) calls this
// instead of syncPanel()+draw() so the filmstrip stays in real-time sync with the
// main canvas and side panel.

import { syncPanel } from './panel.js';
import { draw } from './draw.js';
import { drawFilm } from './filmstrip.js';

export function renderAll(){
  syncPanel();
  draw();
  drawFilm();
}
