// ---------- active editing tool ----------
// Tool choice is UI state only; macro mutations remain owned by pointer.js.

import { app } from './state.js';
import { draw } from './draw.js';

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

export function setTool(tool){
  if (!TOOLS.includes(tool)) throw new Error(`unknown macro editor tool: ${tool}`);
  app.editor.tool = tool;
  syncToolButtons();
  draw();
}

export function syncToolButtons(){
  for (const [tool, id] of Object.entries(BUTTONS)){
    document.getElementById(id)?.classList.toggle('armed', app.editor.tool === tool);
  }
}

export function initTools(){
  for (const [tool, id] of Object.entries(BUTTONS)){
    document.getElementById(id)?.addEventListener('click', () => setTool(tool));
  }
  syncToolButtons();
}
