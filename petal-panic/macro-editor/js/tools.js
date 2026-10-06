// ---------- active editing tool ----------
// Tool choice is UI state only; macro mutations remain owned by pointer.js.

import { app } from './state.js';
import { draw } from './draw.js';
import { cv } from './viewport.js';

export const TOOLS = Object.freeze([
  'none', 'block', 'platform', 'slot-enemy', 'slot-barrel', 'slot-powerup', 'erase',
]);

const BUTTONS = Object.freeze({
  none: 'toolNone',
  block: 'toolBlock',
  platform: 'toolPlatform',
  'slot-enemy': 'toolSlotEnemy',
  'slot-barrel': 'toolSlotBarrel',
  'slot-powerup': 'toolSlotPowerup',
  erase: 'toolErase',
});

const LS_TOOL = 'macro-editor-tool-v1-';

export function setTool(tool){
  if (!TOOLS.includes(tool)) throw new Error(`unknown macro editor tool: ${tool}`);
  app.editor.tool = tool;
  app.editor.transientTool = null;
  app.editor.preview = null;
  syncToolButtons();
  cv.style.cursor = app.editor.hover ? 'pointer' : (tool === 'none' ? 'grab' : 'crosshair');
  try { localStorage.setItem(LS_TOOL, tool); } catch(e){}
  draw();
}

export function syncToolButtons(){
  const displayedTool=app.editor.transientTool ?? app.editor.tool;
  for (const [tool, id] of Object.entries(BUTTONS)){
    document.getElementById(id)?.classList.toggle('armed', displayedTool === tool);
  }
}

export function initTools(){
  for (const [tool, id] of Object.entries(BUTTONS)){
    document.getElementById(id)?.addEventListener('click', () => setTool(tool));
  }
  // Restore last-used tool
  let saved = null;
  try { saved = localStorage.getItem(LS_TOOL); } catch(e){}
  if (saved && TOOLS.includes(saved)) setTool(saved);
  else syncToolButtons();
}
