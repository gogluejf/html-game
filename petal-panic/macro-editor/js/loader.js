// ---------- loader (macro editor) ----------
// Reads game constants from the real module (single source of truth) and loads
// all macros from petal-panic/macros/levels/*.json — the SAME files the game uses.

import { app } from './state.js';
import * as CONSTS from './state.js';

const MACRO_DIR = '../macros/levels/';   // relative to /petal-panic/macro-editor/

// Pull the authoritative unit constants from the game's own module so the
// editor grid can never drift from the game. Stored on app; draw.js reads them.
export async function loadGameConstants(){
  const fallback = {
    unitPxX:CONSTS.UNIT_PX_X, unitPxY:CONSTS.UNIT_PX_Y, platformDrawH:CONSTS.PLATFORM_DRAW_H,
    entryClear:3, exitClear:3,
    hBudgetUnits:56, vBudgetUnits:56, vZoneWidthUnits:13, hZoneHeightUnits:11,
    topClearanceUnits:2, hMaxSurfaceUnits:8,
  };
  try{
    const mod = await import('../../js/world/macros.js');
    return {
      unitPxX: mod.UNIT_PX_X ?? fallback.unitPxX,
      unitPxY: mod.UNIT_PX_Y ?? fallback.unitPxY,
      platformDrawH: mod.PLATFORM_DRAW_H ?? fallback.platformDrawH,
      // Orientation-specific clearance values (single source of truth in macros.js)
      hEntryClear: mod.H_ENTRY_CLEAR ?? 3,
      hExitClear: mod.H_EXIT_CLEAR ?? 3,
      vEntryClear: mod.V_ENTRY_CLEAR ?? 0,
      vExitClear: mod.V_EXIT_CLEAR ?? 3,
      // Canonical grid dimensions: game + editor consume the same unit-space
      // constants; pixel dimensions are derived only for rendering.
      hBudgetUnits: mod.HORIZONTAL_ZONE_LENGTH_UNITS ?? fallback.hBudgetUnits,
      vBudgetUnits: mod.VERTICAL_ZONE_HEIGHT_UNITS ?? fallback.vBudgetUnits,
      hZoneHeightUnits: mod.HORIZONTAL_ZONE_HEIGHT_UNITS ?? fallback.hZoneHeightUnits,
      vZoneWidthUnits: mod.VERTICAL_ZONE_WIDTH_UNITS ?? fallback.vZoneWidthUnits,
      topClearanceUnits: mod.TOP_CLEARANCE_UNITS ?? fallback.topClearanceUnits,
      hMaxSurfaceUnits: mod.HORIZONTAL_MAX_SURFACE_UNITS ?? fallback.hMaxSurfaceUnits,
    };
  }catch(e){
    console.warn('[macro-editor] using fallback constants:', e.message);
    return fallback;
  }
}

/**
 * Fetch every macro JSON in the directory. Returns a map id -> macro object.
 */
export async function loadMacros(){
  const res = await fetch(MACRO_DIR);
  if (!res.ok) throw new Error(`cannot list ${MACRO_DIR} (HTTP ${res.status})`);
  const html = await res.text();
  const files = [...html.matchAll(/href="([^"]+\.json)"/g)].map(m => m[1]);
  if (!files.length) throw new Error(`no macro JSON files in ${MACRO_DIR}`);

  const entries = await Promise.all(files.map(async file => {
    const r = await fetch(`${MACRO_DIR}${file}`);
    if (!r.ok) throw new Error(`failed to fetch ${file} (HTTP ${r.status})`);
    const macro = await r.json();
    return [file.replace(/\.json$/, ''), macro];
  }));

  const macros = {};
  for (const [id, macro] of entries) macros[id] = macro;
  return macros;
}
