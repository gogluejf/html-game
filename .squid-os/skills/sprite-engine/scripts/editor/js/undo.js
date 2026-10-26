// ---------- undo / redo (global: crosses frames AND animations) ----------
import { app } from './state.js';
import { $ } from './viewport.js';
import { syncPanel } from './panel.js';
import { draw } from './draw.js';
import { selectEntity } from './sidebar.js';
import { saveState } from './save.js';

function snap(){ return { name: app.cur.name, st: JSON.stringify(app.cur.st), fi: app.cur.st.frameIdx }; }

export function pushUndo(){
  if (!app.cur || !app.cur.st) return;
  app.undoStack.push(snap());
  if (app.undoStack.length > 100) app.undoStack.shift();
  app.redoStack.length = 0;
  syncUndoButtons();
  saveState();
}

async function restore(entry){
  // jump back to the exact animation + frame this edit was made on
  const pos = app.entityPos.get(entry.name);
  if (pos && (!app.cur || app.cur.name !== entry.name)) await selectEntity(pos.li, pos.ei, { noRefine:true });
  app.cur.st = JSON.parse(entry.st);
  app.cur.st.frameIdx = entry.fi % app.cur.st.frames.length;
  app._selectedBox = null;
  syncPanel(); draw();
}

export function doUndo(){
  if (!app.cur || !app.undoStack.length) return;
  app.redoStack.push(snap());
  restore(app.undoStack.pop()).then(syncUndoButtons);
}

export function doRedo(){
  if (!app.cur || !app.redoStack.length) return;
  app.undoStack.push(snap());
  restore(app.redoStack.pop()).then(syncUndoButtons);
}

export function clearHistory(){ app.undoStack.length = 0; app.redoStack.length = 0; syncUndoButtons(); }

export function syncUndoButtons(){
  const u = $('undoBtn'), r = $('redoBtn');
  if (u) u.disabled = !app.undoStack.length;
  if (r) r.disabled = !app.redoStack.length;
}
