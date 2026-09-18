import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
let failures = 0;
for (const f of files) {
  try {
    execFileSync('node', [join(dir, f)], { stdio: 'pipe' });
    console.log(`✓ ${f}`);
  } catch (e) {
    failures++;
    console.log(`✗ ${f}`);
    if (process.env.DEBUG) console.error(e.stderr?.toString() || e.message);
  }
}
console.log(`\n${files.length - failures}/${files.length} passed`);
process.exit(failures > 0 ? 1 : 0);
