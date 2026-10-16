// Attack Engine — macro barrel (Task 2.1).
//
// One import line per macro; each file self-registers via registerMacro()
// on load. Consumers (theater, hero weapons, enemy AI) import THIS file for
// the side effect and then invoke by id — they never import individual macro
// files. Adding a new macro = one new file + one line here.

import './reticleShot.js';
import './spawnSplit.js';
import './homingMissile.js';
import './predictiveShot.js';
import './spreadShot.js';
import './burstShot.js';
import './radialShot.js';
import './bodyExplosion.js';
import './explosiveBomb.js';
import './explosiveProjectile.js';
