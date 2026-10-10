#!/usr/bin/env node
// ride-report.mjs — one-command ride status table for ALL shipped macros.
//
// Runs the SAME shared driver the browser TEST ride uses (runPickerRide →
// stepRide) over every macro in macros/levels/ and prints a compact table:
//   Macro | Result | Goal order (BFS route) | Missed goals | Died at
//
// This is the canonical "how are we doing" report — no more hand-typing
// grep/awk pipelines. Referenced from macro-editor/DEBUGGING.md §6.
//
// Usage:
//   node tools/ride-report.mjs              # full table, all macros
//   node tools/ride-report.mjs --json       # machine-readable JSON lines
//   node tools/ride-report.mjs newMacro     # only macros whose id contains "newMacro"
//   node tools/ride-report.mjs --fail       # only failing macros
//
// Exit code: 0 if all pass, 1 if any fail (so it works in CI / pre-commit).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPickerRide } from '../js/world/pickerRide.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MACRO_DIR = path.join(__dirname, '../macros/levels');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const onlyFail = args.includes('--fail');
const filter = args.find(a => !a.startsWith('--')) ?? null;

const files = fs.readdirSync(MACRO_DIR).filter(f => f.endsWith('.json')).sort();

const rows = [];
for (const f of files){
  const macro = JSON.parse(fs.readFileSync(path.join(MACRO_DIR, f), 'utf8'));
  const id = macro.id ?? f.replace(/\.json$/, '');
  if (filter && !id.toLowerCase().includes(filter.toLowerCase())) continue;
  const r = runPickerRide(macro);
  const landedSet = new Set(r.landed);
  const missed = r.goals.filter(i => !landedSet.has(i));
  const ok = missed.length === 0;
  rows.push({
    id,
    result: ok ? 'PASS' : 'FAIL',
    order: r.goals.join('>'),
    missed,
    died: r.failPoint ? `${r.failPoint.reason}@#${r.failPoint.goal}` : '',
  });
}

if (asJson){
  for (const row of rows) console.log(JSON.stringify(row));
} else {
  const shown = onlyFail ? rows.filter(r => r.result === 'FAIL') : rows;
  // Column widths
  const wId = Math.max(4, ...shown.map(r => r.id.length));
  const wOrd = Math.max(6, ...shown.map(r => r.order.length));
  const wMiss = Math.max(6, ...shown.map(r => (r.missed.length ? String(r.missed).length : 0)));
  const wDied = Math.max(7, ...shown.map(r => r.died.length));
  const header = `Macro | Result | Goal order | Missed | Died at`;
  console.log(header);
  console.log('-'.repeat(header.length + 4));
  for (const r of shown){
    const miss = r.missed.length ? r.missed.join(',') : '—';
    const died = r.died || '—';
    console.log(
      r.id.padEnd(wId) + ' | ' +
      (r.result === 'PASS' ? '✅ PASS' : '❌ FAIL').padEnd(6) + ' | ' +
      r.order.padEnd(wOrd) + ' | ' +
      miss.padEnd(wMiss) + ' | ' +
      died
    );
  }
  const pass = rows.filter(r => r.result === 'PASS').length;
  const fail = rows.length - pass;
  console.log('');
  console.log(`${pass} pass / ${fail} fail` + (onlyFail ? ` (showing ${shown.length} failing)` : ''));
}

process.exitCode = rows.some(r => r.result === 'FAIL') ? 1 : 0;
