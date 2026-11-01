import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '..', 'record_tuning.py');

test('sheet save writes fps, playback, and direction', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-tuning-'));
  const sheet = path.join(dir, 'sheet.json');
  fs.writeFileSync(sheet, JSON.stringify({
    file: 'sheet.png', size: '100x50', rows: 1, cols: 2, kind: 'animation', description: 't',
    entities: [{ name: 'x', anim: 'fly', frames: [{ file: 'a.png' }, { file: 'b.png' }] }],
  }, null, 2));

  execFileSync('python3', [script, 'write', '--sheet', sheet, '--name', 'x', '--anim', 'fly', '--data', JSON.stringify({ fps: 12, playback: 'loop', direction: 'forward' })], { stdio: 'pipe' });
  const written = JSON.parse(fs.readFileSync(sheet, 'utf8')).entities[0];
  assert.equal(written.fps, 12);
  assert.equal(written.playback, 'loop');
  assert.equal(written.direction, 'forward');
});
