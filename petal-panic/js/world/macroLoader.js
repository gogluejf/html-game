// Petal Panic — macro data loader.
//
// Macros live as JSON files in `macros/levels/<id>.json` (one file per macro,
// filename = macro id). This module fetches them at runtime and rebuilds the
// same frozen `MACROS` map the rest of the engine consumes.
//
// Directory layout (forward-looking):
//   macros/
//   ├── levels/    level terrain macros (this loader)
//   └── attack/    attack macros (future)
//
// The game must be served over HTTP (./server.sh go) for fetch() to work.

import { assertMacroSchema } from './macroSchema.js';

const MACRO_DIR = 'macros/levels/';

/**
 * Fetch every macro JSON in the directory and build the MACROS map.
 *
 * @returns {Promise<Object<string, object>>} map of id → macro object
 *   (same shape as the former inline MACROS constant; Object.freeze applied
 *   by the caller if desired)
 */
export async function loadMacros() {
  const res = await fetch(MACRO_DIR);
  if (!res.ok) {
    throw new Error(`loadMacros: cannot list ${MACRO_DIR} (HTTP ${res.status}) — is the server running?`);
  }
  // python3 -m http.server returns a plain HTML directory listing with
  // href="<name>" links. Extract .json filenames from it.
  const html = await res.text();
  const files = [...html.matchAll(/href="([^"]+\.json)"/g)].map((m) => m[1]);
  if (files.length === 0) {
    throw new Error(`loadMacros: no macro JSON files found in ${MACRO_DIR}`);
  }

  const entries = await Promise.all(
    files.map(async (file) => {
      const r = await fetch(`${MACRO_DIR}${file}`);
      if (!r.ok) {
        throw new Error(`loadMacros: failed to fetch ${file} (HTTP ${r.status})`);
      }
      const macro = await r.json();
      const id = file.replace(/\.json$/, '');
      assertMacroSchema(macro, { expectedId: id });
      return [id, macro];
    })
  );

  const macros = {};
  for (const [id, macro] of entries) {
    if (macro.id !== id) {
      throw new Error(`loadMacros: ${file(id)} declares id "${macro.id}" but lives in "${id}.json"`);
    }
    macros[id] = macro;
  }
  return macros;
}

function file(id) {
  return `${id}.json`;
}
