// Petal Panic — export the inline MACROS vocabulary to JSON files.
//
// One-time migration (and future sync tool): reads the canonical MACROS object
// from js/world/macros.js and writes one JSON file per macro to
// macros/levels/<id>.json (filename = macro id).
//
// Run: node tools/export_macros.mjs
//
// The browser game loads these files at boot (js/world/macroLoader.js); the
// inline object in macros.js remains as an offline fallback, so re-run this
// script whenever you edit the inline data.

import { MACROS } from '../js/world/macros.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'macros', 'levels');
mkdirSync(outDir, { recursive: true });

let count = 0;
for (const [id, macro] of Object.entries(MACROS)) {
  const path = join(outDir, `${id}.json`);
  writeFileSync(path, JSON.stringify(macro, null, 2) + '\n');
  console.log(`wrote ${path.replace(here + '/', '')}`);
  count++;
}
console.log(`\n${count} macros exported to macros/levels/`);
