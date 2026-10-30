// ---------- loader (macro editor) ----------
// Reads game constants from the real module (single source of truth) and loads
// all macros from petal-panic/macros/levels/*.json — the SAME files the game uses.

import { app } from './state.js';
import * as CONSTS from './state.js';
import { assertMacroSchema, CURRENT_SCHEMA_VERSION } from '../../js/world/macroSchema.js';

const MACRO_DIR = '../macros/levels/';   // relative to /petal-panic/macro-editor/

// Pull the authoritative unit constants from the game's own module so the
// editor grid can never drift from the game. Stored on app; draw.js reads them.
// No fallback chain: if the game module cannot load, boot fails loudly rather
// than silently drawing on a divergent grid.
export async function loadGameConstants(){
  const mod = await import('../../js/world/macros.js');
  return {
    unitPxX: mod.UNIT_PX_X,
    unitPxY: mod.UNIT_PX_Y,
    platformDrawH: CONSTS.PLATFORM_DRAW_H,
    // Orientation-specific clearance values (single source of truth in macros.js)
    hEntryClear: mod.H_ENTRY_CLEAR,
    hExitClear: mod.H_EXIT_CLEAR,
    vEntryClear: mod.V_ENTRY_CLEAR,
    vExitClear: mod.V_EXIT_CLEAR,
    // Canonical grid dimensions: game + editor consume the same unit-space
    // constants; pixel dimensions are derived only for rendering.
    hBudgetUnits: mod.HORIZONTAL_ZONE_LENGTH_UNITS,
    vBudgetUnits: mod.VERTICAL_ZONE_HEIGHT_UNITS,
    hPlayHeightUnits: mod.HORIZONTAL_PLAY_HEIGHT_UNITS,
    hZoneHeightUnits: mod.HORIZONTAL_ZONE_HEIGHT_UNITS,
    vZoneWidthUnits: mod.VERTICAL_ZONE_WIDTH_UNITS,
    topClearanceUnits: mod.TOP_CLEARANCE_UNITS,
    hMaxSurfaceUnits: mod.HORIZONTAL_MAX_SURFACE_UNITS,
  };
}

/**
 * Fetch every macro JSON in the directory, then merge in any localStorage
 * drafts (draft-only macros that were never saved to disk). Returns a map
 * id -> macro object. Every file is schema-validated, which enforces the
 * current square-grid version marker — legacy (un-migrated) imports are
 * rejected here, never silently reinterpreted.
 */
export async function loadMacros(){
  const res = await fetch(MACRO_DIR);
  if (!res.ok) throw new Error(`cannot list ${MACRO_DIR} (HTTP ${res.status})`);
  const html = await res.text();
  const files = [...html.matchAll(/href="([^"]+\.json)"/g)].map(m => m[1]);
  if (!files.length) throw new Error(`no macro JSON files in ${MACRO_DIR}`);

  const entries = await Promise.all(files.map(async file => {
    const r = await fetch(`${MACRO_DIR}${file}`);
    if (!r.ok) throw new Error(`failed to fetch ${file} (HTTP ${res.status})`);
    const macro = await r.json();
    const id = file.replace(/\.json$/, '');
    assertMacroSchema(macro, { expectedId: id });
    return [id, macro];
  }));

  const macros = {};
  for (const [id, macro] of entries) macros[id] = macro;

  // Merge localStorage drafts: any draft whose id has no disk file is a
  // draft-only macro. If the id DOES have a disk file, the draft takes
  // precedence (unsaved edits override the saved version). Drafts are also
  // schema-gated so an old pre-square-grid draft can never enter the editor.
  const LS_PREFIX = 'macro-editor-draft-v4-';
  try{
    for (let i = 0; i < localStorage.length; i++){
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LS_PREFIX)) continue;
      const draftId = key.slice(LS_PREFIX.length);
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try{
        const draft = JSON.parse(raw);
        if (draft && draft.id){
          if (draft.schemaVersion !== CURRENT_SCHEMA_VERSION) {
            console.warn(`[macro-editor] dropping stale draft "${draftId}" (schemaVersion ${JSON.stringify(draft.schemaVersion)})`);
            localStorage.removeItem(key);
            continue;
          }
          assertMacroSchema(draft, { expectedId: draftId });
          macros[draftId] = draft;
        }
      }catch(_){ /* corrupt or legacy draft, skip */ }
    }
  }catch(e){ /* localStorage unavailable */ }

  return macros;
}
