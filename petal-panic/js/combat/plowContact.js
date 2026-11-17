// Plow changes body blocking only. Hits, pinning and immunity keep their owners.
import { resolve } from '../core/collision.js';

const isBody = e => e && e.alive !== false && e.aiState !== 'dead' && !e.intangible;
const boxOf = e => e.worldBox ? e.worldBox() : e;

// Called after hero movement, before enemy movement. Never displace enemies.
export function resolvePlowHero(hero, enemies) {
  if (!hero?.plow || !isBody(hero)) return;
  resolve(hero, enemies.filter(isBody).map(boxOf));
}

// Called after enemy movement. Includes flyers; preserves terrain grounded state.
export function resolvePlowEnemy(enemy, hero) {
  if (!hero?.plow || !isBody(hero) || !isBody(enemy)) return;
  resolve(enemy, [boxOf(hero)]);
}
