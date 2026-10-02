#!/usr/bin/env node
// One-shot migration: unify macro unit coords to x/y and give slots an explicit y.
//   - units: col -> x, row -> y (keep kind/height/width)
//   - placements/slots: ADD explicit y = surfaceElevationAt(units, slot.x)
//     using the SAME logic as macros.js surfaceElevationAt:
//       slot rests on top of block (y + height) / face of platform (y + 1)
//       under its column; highest wins; empty cell -> 0.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../macros/levels/', import.meta.url).pathname;

function surfaceY(units, col) {
  let best = 0;
  for (const u of units) {
    const uStart = u.x;
    const uEnd = u.x + (u.kind === 'block' ? 1 : u.width);
    if (col >= uStart && col < uEnd) {
      const surface = u.kind === 'block' ? u.y + u.height : u.y + 1;
      if (surface > best) best = surface;
    }
  }
  return best;
}

let totalUnits = 0, totalSlots = 0;
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
  const path = join(DIR, f);
  const data = JSON.parse(readFileSync(path, 'utf8'));

  // Units: rename col->x, row->y, preserve key order kind, size, y, x.
  data.units = data.units.map((u) => {
    const out = { kind: u.kind };
    if (u.kind === 'block') out.height = u.height;
    else out.width = u.width;
    out.y = u.row;
    out.x = u.col;
    totalUnits++;
    return out;
  });

  // Slots: add explicit y (surface elevation), keep slot/x/type order.
  data.placements = data.placements.map((p) => {
    const out = { slot: p.slot, x: p.x, type: p.type };
    out.y = surfaceY(data.units, p.x);
    totalSlots++;
    return out;
  });

  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`migrated ${f}: ${data.units.length} units, ${data.placements.length} slots`);
}
console.log(`\nTOTAL: ${totalUnits} units, ${totalSlots} slots across ${readdirSync(DIR).filter(f=>f.endsWith('.json')).length} files`);
