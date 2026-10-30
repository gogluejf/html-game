#!/usr/bin/env node
// Petal Panic — offline authored-macro migration to the 48×48 square grid (plan §3).
//
// FIELD MAP (explicit, field-by-field; no blanket number replacement):
//   units[].x        ×2   horizontal placement coordinate (legacy 72px unit → new 48px cell)
//   units[].width    ×2   horizontal span in cells (blocks AND platforms)
//   units[].y         —   vertical coordinate: unchanged
//   units[].height    —   vertical dimension: unchanged
//   placements[].x   ×2   horizontal slot anchor
//   placements[].y    —   vertical slot anchor: unchanged
//   everything else  —   ids, names, orientation, difficulty, follows/followedBy,
//                        variations, clearance, kinds, slots, types: untouched.
//
// Nested/local offsets: the current macro schema (macro.schema.json + all 19
// authored files) has NO nested offset/anchor fields — only flat x/y/width/height.
// The transform is written generically over any object carrying {kind,x,width} or
// {slot,type,x,y}, so nested occurrences are handled if they ever appear, but none
// exist in real data today. If a future shape carries unknown geometry semantics,
// it is REJECTED, never guessed.
//
// VERSION MARKER: `schemaVersion` at the macro root.
//   - absent            → legacy v0 (pre-square-grid, 72/48 units) → migratable
//   - "square-grid-v1"  → current version → SKIPPED (idempotent)
//   - anything else     → REJECTED with an error
//
// VALIDATION REPORT (dry-run always reports; apply refuses on errors):
//   - block lattice: post-migration block x must be even and width a positive
//     multiple of 2 (agreed 2-cell block lattice). Legacy odd block x / odd block
//     width are reported as invalid lattice input.
//   - bounds overflow: ONLY when the caller supplies an explicit fixed-width
//     constraint (`fitColumns`), post-migration right edges (x+width) or slot x
//     beyond that width are reported as warnings. Horizontal areas scroll, so
//     with no constraint layout fit is NOT evaluated — no default 20-column
//     assumption, never approval-required overflow.
//
// USAGE:
//   node petal-panic/tools/migrate_square_grid.mjs [--apply] [--fit-columns N] [dir | file.json ...]
// Dry-run by default: prints per-file report, writes nothing.
// --apply: writes migrated JSON back in place (adds schemaVersion marker).
// --fit-columns N: explicit fixed-width constraint in columns; without it,
//   horizontal layout fit is NOT evaluated (areas scroll) — no overflow warnings.
// Offline only: this tool does not touch runtime code and there is NO runtime
// legacy fallback — import handling must route through this migration explicitly.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

export const CURRENT_VERSION = 'square-grid-v1';
export const LEGACY_VERSION = null; // absence of schemaVersion
// No default fixed-width constraint: horizontal areas scroll, so layout fit is
// only evaluated when the caller explicitly supplies `fitColumns`.

class MigrationError extends Error {}

/** Double a horizontal value with strict integer checks. */
function doubleX(value, path) {
  if (!Number.isInteger(value)) throw new MigrationError(`${path}: expected integer, got ${JSON.stringify(value)}`);
  return value * 2;
}

/**
 * Transform one macro object (pure). Returns { macro, report }.
 * Throws MigrationError for unknown versions / unsupported shapes.
 */
export function migrateMacro(input, { fitColumns } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new MigrationError('$: macro must be an object');
  }
  const report = { skipped: false, warnings: [], errors: [] };

  const version = Object.prototype.hasOwnProperty.call(input, 'schemaVersion') ? input.schemaVersion : LEGACY_VERSION;
  if (version === CURRENT_VERSION) {
    report.skipped = true;
    return { macro: input, report };
  }
  if (version !== LEGACY_VERSION) {
    throw new MigrationError(`$.schemaVersion: unknown version ${JSON.stringify(version)}; refusing to guess semantics`);
  }

  const out = {};
  // Copy non-geometry top-level fields verbatim, preserving order.
  for (const [key, value] of Object.entries(input)) {
    if (key === 'units' || key === 'placements') continue;
    out[key] = value;
  }
  out.schemaVersion = CURRENT_VERSION;

  const warn = (msg) => report.warnings.push(msg);
  const err = (msg) => report.errors.push(msg);

  if (!Array.isArray(input.units)) {
    err('$.units: missing or not an array; cannot verify geometry');
    out.units = input.units;
  } else {
    out.units = input.units.map((unit, i) => {
      const p = `$.units[${i}]`;
      if (unit === null || typeof unit !== 'object' || Array.isArray(unit)) {
        err(`${p}: unsupported unit shape (not an object)`);
        return unit;
      }
      const kind = unit.kind;
      if (kind !== 'block' && kind !== 'platform') {
        err(`${p}.kind: unknown kind ${JSON.stringify(kind)}; rejecting unsupported shape`);
        return unit;
      }
      const nx = doubleX(unit.x, `${p}.x`);
      const nw = doubleX(unit.width, `${p}.width`);
      const ny = unit.y;
      const migrated = { kind, height: unit.height, y: ny, x: nx, width: nw };

      if (kind === 'block') {
        if (nx % 2 !== 0) err(`${p}: block x=${nx} breaks the 2-cell lattice (legacy x was odd)`);
        if (nw <= 0 || nw % 2 !== 0) err(`${p}: block width=${nw} is not a positive multiple of 2`);
      }
      if (ny === undefined || !Number.isInteger(ny) || ny < 0) err(`${p}.y: invalid vertical coordinate ${JSON.stringify(ny)}`);
      if (fitColumns !== undefined && nx + nw > fitColumns) warn(`${p}: right edge ${nx + nw} exceeds fixed-width constraint (${fitColumns}) — bounds overflow`);
      return migrated;
    });
  }

  if (!Array.isArray(input.placements)) {
    if (Object.prototype.hasOwnProperty.call(input, 'placements')) err('$.placements: not an array; cannot verify geometry');
    else out.placements = [];
  } else {
    out.placements = input.placements.map((slot, i) => {
      const p = `$.placements[${i}]`;
      if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) {
        err(`${p}: unsupported placement shape (not an object)`);
        return slot;
      }
      const nx = doubleX(slot.x, `${p}.x`);
      const ny = slot.y;
      if (ny === undefined || !Number.isInteger(ny) || ny < 0) err(`${p}.y: invalid vertical coordinate ${JSON.stringify(ny)}`);
      if (fitColumns !== undefined && nx > fitColumns) warn(`${p}: slot x=${nx} exceeds fixed-width constraint (${fitColumns}) — bounds overflow`);
      const migrated = {};
      for (const [k, v] of Object.entries(slot)) migrated[k] = k === 'x' ? nx : v;
      return migrated;
    });
  }

  return { macro: out, report };
}

/** Migrate one file's contents (string). Pure; returns { text, report }. */
export function migrateFileText(text, opts) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new MigrationError(`invalid JSON: ${e.message}`);
  }
  const { macro, report } = migrateMacro(parsed, opts);
  return { text: JSON.stringify(macro, null, 2) + '\n', report };
}

function collectTargets(args) {
  const targets = args.filter((a) => !a.startsWith('--'));
  if (targets.length === 0) targets.push(new URL('../macros/levels/', import.meta.url).pathname);
  const files = [];
  for (const t of targets) {
    const st = statSync(t);
    if (st.isDirectory()) {
      for (const f of readdirSync(t).filter((f) => f.endsWith('.json')).sort()) files.push(join(t, f));
    } else files.push(t);
  }
  return files;
}

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const fitFlag = argv.indexOf('--fit-columns');
  let fitColumns;
  if (fitFlag !== -1) {
    const raw = argv[fitFlag + 1];
    fitColumns = Number.parseInt(raw, 10);
    if (!Number.isInteger(fitColumns) || fitColumns <= 0) {
      console.error(`ERROR  --fit-columns requires a positive integer, got ${JSON.stringify(raw)}`);
      process.exitCode = 1;
      return;
    }
  }
  const files = collectTargets(argv.filter((a, i) => a !== '--fit-columns' && argv[i - 1] !== '--fit-columns'));
  let failures = 0;
  for (const file of files) {
    const name = basename(file);
    try {
      const { text, report } = migrateFileText(readFileSync(file, 'utf8'), { fitColumns });
      if (report.skipped) {
        console.log(`SKIP   ${name}: already ${CURRENT_VERSION}`);
        continue;
      }
      for (const w of report.warnings) console.log(`WARN   ${name}: ${w}`);
      if (report.errors.length) {
        failures++;
        for (const e of report.errors) console.log(`ERROR  ${name}: ${e}`);
        continue;
      }
      if (apply) {
        writeFileSync(file, text);
        console.log(`APPLY  ${name}: migrated to ${CURRENT_VERSION}`);
      } else {
        console.log(`OK     ${name}: would migrate to ${CURRENT_VERSION}`);
      }
    } catch (e) {
      failures++;
      console.log(`ERROR  ${name}: ${e.message}`);
    }
  }
  console.log(`\n${files.length} file(s) scanned, ${failures} failure(s), mode=${apply ? 'apply' : 'dry-run'}`);
  process.exitCode = failures > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
