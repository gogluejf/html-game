// ---------- undo / redo (global: crosses macros) ----------
// Mirrors Sprite Editor's 100-entry global history and toolbar behavior.

import { app } from './state.js';
import { $ } from './viewport.js';
import { selectMacro, syncPanel } from './sidebar.js';
import { markChanged } from './save.js';
import { draw } from './draw.js';
import { analyzeMacroWarnings } from './validation.js';

function snap(){
  return app.cur ? { id:app.cur.id, st:JSON.stringify(app.cur.st) } : null;
}

export function pushUndo(){
  const entry=snap();
  if (!entry) return;
  app.undoStack.push(entry);
  if (app.undoStack.length>100) app.undoStack.shift();
  app.redoStack.length=0;
  syncUndoButtons();
}

function restore(entry){
  if (!entry || !app.macros[entry.id]) return;
  if (!app.cur || app.cur.id!==entry.id) selectMacro(entry.id);
  const st=JSON.parse(entry.st);
  app.drafts.set(entry.id,st);
  app.cur.st=st;
  app.editor.hover=null;
  app.editor.selection=null;
  app.editor.interaction=null;
  app.editor.pan=null;
  app.editor.warningUnitIndices=analyzeMacroWarnings(st).warningUnitIndices;
  markChanged();
  syncPanel();
  draw();
}

export function doUndo(){
  if (!app.cur || !app.undoStack.length) return;
  app.redoStack.push(snap());
  restore(app.undoStack.pop());
  syncUndoButtons();
}

export function doRedo(){
  if (!app.cur || !app.redoStack.length) return;
  app.undoStack.push(snap());
  restore(app.redoStack.pop());
  syncUndoButtons();
}

export function clearHistory(){
  app.undoStack.length=0;
  app.redoStack.length=0;
  syncUndoButtons();
}

export function syncUndoButtons(){
  const undo=$('undoBtn'),redo=$('redoBtn');
  if (undo) undo.disabled=!app.undoStack.length;
  if (redo) redo.disabled=!app.redoStack.length;
}
