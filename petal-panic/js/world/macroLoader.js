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
/** Headless fallback: read the macro directory from disk (node tests have no
 * HTTP server). Builds the same id→macro map as the HTTP path, with schema
 * validation. Returns null when fs/path are unavailable (browser). */
async function loadMacrosFromDisk() {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    // Resolve relative to this file: petal-panic/macros/levels/
    const dir = new URL(`../../macros/levels/`, import.meta.url);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const macros = {};
    for (const f of files) {
      const macro = JSON.parse(fs.readFileSync(path.join(dir.pathname, f), 'utf8'));
      const id = f.replace(/\.json$/, '');
      assertMacroSchema(macro, { expectedId: id });
      macros[id] = macro;
    }
    return macros;
  } catch {
    return null;
  }
}

export async function loadMacros() {
  // Headless (node tests): no HTTP server — read the macro directory from disk.
  // Node 18+ HAS a global fetch, so probe for node:fs instead of fetch's absence.
  // This runs BEFORE any other module import in main.js's boot, so it cannot be
  // affected by circular-import TDZ states (see fullscreen-layout incident).
  if (typeof process !== 'undefined' && process.versions?.node) {
    const fromDisk = await loadMacrosFromDisk();
    if (fromDisk) return fromDisk;
    console.warn('[macros] disk fallback failed — falling through to HTTP');
  }
  let res;
  try {
    res = await fetch(MACRO_DIR);
  } catch {
    // fetch exists but cannot resolve the relative URL (headless without a
    // server root) — fall back to disk before giving up.
    const fromDisk = await loadMacrosFromDisk();
    if (fromDisk) return fromDisk;
    throw new Error(`loadMacros: cannot list ${MACRO_DIR} and no disk fallback available`);
  }
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
