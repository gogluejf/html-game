// Petal Panic — test helper: load macro JSON files into the MACROS map.
// Call this at the top of each test file that imports from macros.js.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setMacros } from '../../js/world/macros.js';
import { assertMacroSchema } from '../../js/world/macroSchema.js';

const here = dirname(fileURLToPath(import.meta.url));
const macroDir = join(here, '..', '..', 'macros', 'levels');

export function loadTestMacros() {
  const files = readdirSync(macroDir).filter(f => f.endsWith('.json'));
  const macros = {};
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    const data = JSON.parse(readFileSync(join(macroDir, file), 'utf-8'));
    assertMacroSchema(data, { expectedId: id });
    macros[id] = data;
  }
  setMacros(macros);
  return macros;
}
