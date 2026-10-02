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
    hBudgetUnits:56, vBudgetUnits:56, vZoneWidthUnits:22, hZoneHeightUnits:11.25,
  };
  try{
    const mod = await import('../../js/world/macros.js');
    const lvl = await import('../../js/world/level.js');
    return {
      unitPxX: mod.UNIT_PX_X ?? fallback.unitPxX,
      unitPxY: mod.UNIT_PX_Y ?? fallback.unitPxY,
      platformDrawH: mod.PLATFORM_DRAW_H ?? fallback.platformDrawH,
      entryClear: mod.ENTRY_CLEAR ?? fallback.entryClear,
      exitClear: mod.EXIT_CLEAR ?? fallback.exitClear,
      // Area length budget in UNITS (what the composer fills), per orientation.
      hBudgetUnits: Math.round(lvl.HORIZONTAL_AREA_LENGTH_PX / (mod.UNIT_PX_X || fallback.unitPxX)),
      vBudgetUnits: Math.round(lvl.VERTICAL_AREA_LENGTH_PX / (mod.UNIT_PX_Y || fallback.unitPxY)),
      // Zone HEIGHTS in units: horizontal area is one screen tall (VIEW_H);
      // vertical is the climb budget (already vBudgetUnits). A horizontal level
      // is NOT "as tall as its terrain" — it's a full-screen-tall world.
      hZoneHeightUnits: lvl.ZONE_H_HORIZONTAL / (mod.UNIT_PX_Y || fallback.unitPxY),
      // Vertical zone is one screen wide — the lateral bound for vertical macros.
      vZoneWidthUnits: Math.floor(lvl.ZONE_WIDTH_VERTICAL / (mod.UNIT_PX_X || fallback.unitPxX)),
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
