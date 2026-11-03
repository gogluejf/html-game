#!/usr/bin/env node
// Petal Panic — one-off migration: add `value: "random"` to every barrel/enemy/
// powerup placement in petal-panic/macros/**/*.json (plan placeholder-typed-spawn §3.1).
//
// Idempotent: placements that already carry a value are left untouched; re-running
// changes nothing. After writing, every macro is validated with assertMacroSchema.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMacroSchema } from '../js/world/macroSchema.js';

const here = dirname(fileURLToPath(import.meta.url));
const macroDir = join(here, '..', 'macros', 'levels');

const FAMILIES = new Set(['barrel', 'enemy', 'powerup']);

function OWN(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.json')) yield full;
  }
}

let filesTouched = 0;
let placementsUpdated = 0;
let placementsSkipped = 0;

for (const file of walk(macroDir)) {
  const raw = readFileSync(file, 'utf-8');
  const macro = JSON.parse(raw);
  const id = file.split('/').pop().replace(/\.json$/, '');

  const placements = Array.isArray(macro.placements) ? macro.placements : [];
  let changed = false;
  for (const p of placements) {
    if (!FAMILIES.has(p.type)) continue;
    if (OWN(p, 'value')) { placementsSkipped++; continue; }
    p.value = 'random';
    changed = true;
    placementsUpdated++;
  }

  // Validate the (possibly updated) macro before touching disk.
  assertMacroSchema(macro, { expectedId: id });

  if (changed) {
    writeFileSync(file, JSON.stringify(macro, null, 2) + '\n');
    filesTouched++;
  }
}

console.log(`migrated ${placementsUpdated} placements across ${filesTouched} files (${placementsSkipped} already had values)`);
