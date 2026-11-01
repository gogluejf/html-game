import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const saveSource = fs.readFileSync(path.join(here, 'js', 'save.js'), 'utf8');

test('post-save manifest refresh reads fresh disk entity, not stale local draft', () => {
  assert.match(saveSource, /freshEntity\.fps \?\? null/);
  assert.match(saveSource, /freshEntity\.playback \?\? null/);
  assert.match(saveSource, /freshEntity\.direction \|\| 'forward'/);
  assert.doesNotMatch(saveSource, /speed: gameData\.speed,\s*\n\s*playback: gameData\.playback/);
});
