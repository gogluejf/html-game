// pickerRide tests — ONE full end-to-end ride per macro, classified per platform.
//
// The ride (runPickerRide) is the single source of truth for "can the hero
// actually traverse this macro". BFS (traversalRoute) supplies the expectation:
// which surfaces are reachable (blue, in the route) vs unreachable (amber).
//
// Every platform gets exactly one verdict:
//   1. touched   + expected touch  → pass
//   2. untouched + unreachable     → pass (amber, correctly never visited)
//   3. untouched + expected touch  → FAIL (stall: report index + where it died)
//   4. touched   + unreachable     → FAIL (route/bookkeeping bug)
//
// No per-hop isolation harness: the ride plays ENTIRELY and we classify the
// result. A stall anywhere fails the macro with a clear per-platform report.
//
// Run: node --test js/test/pickerRide.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { traversalRoute } from '../world/macros.js';
import { runPickerRide } from '../world/pickerRide.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MACRO_DIR = path.join(__dirname, '../../macros/levels');

const loadMacros = () =>
  fs.readdirSync(MACRO_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(MACRO_DIR, f), 'utf8')))
    .sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''));

/** Build a clear per-platform report for one ride result.
 *  Returns { ok, lines[] } where lines is a human-readable table. */
function report(macro, r){
  const landedSet = new Set(r.landed);
  const amberSet = new Set(r.unreachable ?? []);
  const lines = [];
  let missed = 0, ghost = 0;

  // Per-goal (expected-touch) rows, in route order.
  for (const i of r.goals){
    if (landedSet.has(i)) {
      lines.push(`  #${String(i).padStart(2)}  ✅ touched`);
    } else {
      lines.push(`  #${String(i).padStart(2)}  ❌ MISSED (expected touch, never landed)`);
      missed++;
    }
  }
  // Amber rows (expected-untouch).
  for (const i of [...amberSet].sort((a, b) => a - b)){
    if (landedSet.has(i)) {
      lines.push(`  #${String(i).padStart(2)}  ❌ GHOST (BFS-unreachable but ride landed on it)`);
      ghost++;
    } else {
      lines.push(`  #${String(i).padStart(2)}  ⬜ amber (unreachable, correctly skipped)`);
    }
  }

  const last = r.landed.length ? '#' + r.landed[r.landed.length - 1] : 'entry';
  const failReason = r.failPoint
    ? `${r.failPoint.reason} @ #${r.failPoint.goal}`
    : 'ride ended early';
  lines.push(`  ── stalled after ${last}; ${failReason}`);
  lines.push(`  ── total: ${r.landed.length}/${r.goals.length} goals touched, ${missed} missed, ${ghost} ghost`);

  return { ok: missed === 0 && ghost === 0, lines };
}

// ---------------------------------------------------------------------------
// THE test: one full ride per macro, every platform classified
// ---------------------------------------------------------------------------

test('ride: full end-to-end ride classifies every platform (all shipped macros)', () => {
  const failures = [];
  let passCount = 0;
  for (const macro of loadMacros()){
    const r = runPickerRide(macro);
    const rep = report(macro, r);
    if (rep.ok){
      passCount++;
    } else {
      failures.push(`${macro.id}:\n` + rep.lines.join('\n'));
    }
  }
  // Always print a compact summary line so a green run still shows coverage.
  const summary = `classified ${passCount + failures.length} macros: ${passCount} pass, ${failures.length} fail`;
  if (failures.length){
    assert.equal(failures.length, 0,
      summary + '\n\n' + failures.join('\n\n'));
  } else {
    console.log('  ✓ ' + summary);
  }
});

// ---------------------------------------------------------------------------
// Sanity: BFS marks a too-tall isolated rise as unreachable (amber)
// ---------------------------------------------------------------------------

test('bfs: a too-tall isolated rise is unreachable', () => {
  const macro = {
    id: 'synthetic-too-tall',
    orientation: 'horizontal',
    units: [{ kind: 'platform', x: 6, y: 5, width: 2 }],
  };
  const tagged = macro.units.map((u, i) => ({ ...u, _editorIndex: i }));
  const { order, unreachable } = traversalRoute({ orientation: macro.orientation, units: tagged });
  assert.ok(unreachable.includes(0), 'expected the tall platform to be amber/unreachable');
  assert.ok(!order.includes(0), 'unreachable surface must not be in the route');
});
