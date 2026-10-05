// Macro JSON Schema contract: canonical files pass both the browser/runtime
// validator and the formal Draft 2020-12 schema (via Python jsonschema).
// Run: node js/test/macroSchema.test.js

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { macroSchemaErrors, assertMacroSchema } from '../world/macroSchema.js';

const here = dirname(fileURLToPath(import.meta.url));
const macroRoot = join(here, '..', '..', 'macros');
const macroDir = join(macroRoot, 'levels');
const schemaPath = join(macroRoot, 'macro.schema.json');
const files = readdirSync(macroDir).filter((f) => f.endsWith('.json')).sort();

const canonical = files.map((file) => ({
  file,
  id: file.replace(/\.json$/, ''),
  data: JSON.parse(readFileSync(join(macroDir, file), 'utf8')),
}));

test('all canonical macros pass the shared runtime/editor validator', () => {
  for (const { file, id, data } of canonical) {
    assert.deepEqual(macroSchemaErrors(data, { expectedId: id }), [], file);
    assert.equal(assertMacroSchema(data, { expectedId: id }), data);
  }
});

test('all canonical macros pass macro.schema.json Draft 2020-12 validation', () => {
  const script = `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
schema = json.loads(Path(sys.argv[1]).read_text())
validator = Draft202012Validator(schema)
for filename in sys.argv[2:]:
    data = json.loads(Path(filename).read_text())
    errors = sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path))
    if errors:
        for e in errors:
            path = '$' + ''.join(f'[{p}]' if isinstance(p, int) else f'.{p}' for p in e.absolute_path)
            print(f'{filename}: {path}: {e.message}', file=sys.stderr)
        raise SystemExit(1)
`;
  const result = spawnSync('python3', ['-c', script, schemaPath, ...files.map((f) => join(macroDir, f))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('schema rejects malformed dimensions, kinds, placement types, and filename mismatch', () => {
  const good = structuredClone(canonical[0].data);

  const noWidth = structuredClone(good);
  delete noWidth.units[0].width;
  assert.throws(() => assertMacroSchema(noWidth, { expectedId: good.id }), /width/);

  const fractional = structuredClone(good);
  fractional.units[0].width = 1.5;
  assert.throws(() => assertMacroSchema(fractional), /positive integer/);

  const badKind = structuredClone(good);
  badKind.units[0].kind = 'ladder';
  assert.throws(() => assertMacroSchema(badKind), /block or platform/);

  const badSlot = structuredClone(good);
  badSlot.placements[0].type = 'coin';
  assert.throws(() => assertMacroSchema(badSlot), /enemy, barrel, or powerup/);

  assert.throws(() => assertMacroSchema(good, { expectedId: 'differentFile' }), /match filename/);
});

test('schema rejects editor/runtime metadata and platform row zero', () => {
  const extra = structuredClone(canonical[0].data);
  extra._el = {};
  assert.throws(() => assertMacroSchema(extra), /unknown property/);

  const platformMacro = structuredClone(canonical.find(({ data }) => data.units.some((u) => u.kind === 'platform')).data);
  platformMacro.units.find((u) => u.kind === 'platform').y = 0;
  assert.throws(() => assertMacroSchema(platformMacro), /platform row/);
});
