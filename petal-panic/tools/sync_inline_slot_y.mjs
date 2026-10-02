#!/usr/bin/env node
// One-shot: sync the INLINE MACROS object in js/world/macros.js so every
// placement carries an explicit `y`, matching the canonical JSON files.
// The inline object is the synchronous fallback used by tests + composer;
// it must agree with macros/levels/*.json or slots resolve to NaN at runtime.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const levelsDir = join(here, '..', 'macros', 'levels');
const macrosPath = join(here, '..', 'js', 'world', 'macros.js');

// Build slot -> y lookup from the canonical JSONs, keyed by macro id + slot name.
import { readdirSync } from 'node:fs';
const yBySlot = {};   // `${macroId}::${slotName}` -> y
for (const f of readdirSync(levelsDir).filter((f) => f.endsWith('.json'))) {
  const id = f.replace(/\.json$/, '');
  const d = JSON.parse(readFileSync(join(levelsDir, f), 'utf8'));
  for (const s of d.placements ?? []) {
    yBySlot[`${id}::${s.slot}`] = s.y;
  }
}

let src = readFileSync(macrosPath, 'utf8');

// Track which macro block we're inside by scanning for `  <id>: Object.freeze({`.
// For each placement line `{ slot: 'NAME', x: N, type: 'T' }`, insert `, y: Y`
// before the closing brace using the yBySlot lookup for the current macro id.
const lines = src.split('\n');
let curMacro = null;
let patched = 0, missing = 0;
const out = [];
for (const line of lines) {
  const mHead = line.match(/^\s{2}([a-zA-Z0-9_]+):\s*Object\.freeze\(\{\s*$/);
  if (mHead) curMacro = mHead[1];
  const mPlace = line.match(/^(\s*\{\s*slot:\s*'([^']+)',\s*x:\s*(\d+),\s*type:\s*'([a-z]+)')(\s*\})/, );
  if (mPlace && curMacro) {
    const slotName = mPlace[2];
    const key = `${curMacro}::${slotName}`;
    const y = yBySlot[key];
    if (y === undefined) {
      missing++;
      console.warn(`MISSING y for ${key} — left unchanged`);
      out.push(line);
    } else {
      out.push(`${mPlace[1]}, y: ${y}${mPlace[5]}`);
      patched++;
    }
  } else {
    out.push(line);
  }
}
writeFileSync(macrosPath, out.join('\n'));
console.log(`patched ${patched} placements, ${missing} missing`);
