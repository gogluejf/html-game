// Headless hero step — runs the REAL Hero.update() + resolve() pipeline
// without a DOM, camera, enemies, or game world. Used by the macro editor's
// ghost test ride and by Node tests. No physics is duplicated here: the
// integration math lives in hero.js / core/collision.js exactly as in-game.
//
// Coordinate system: screen space, y DOWN (same as the game runtime).
// The caller (buildRideWorld) converts macro unit-space into pixel AABBs.

import { Hero } from './hero.js';
import { HEROES } from './heroDefs.js';
import { resolve } from '../core/collision.js';
import { GRAVITY } from '../consts.js';
import { attachHeroSprites, updateHeroLocomotionAnim, HERO_SPRITE_DIRS } from './heroSprites.js';

/**
 * Prime the sheet-sprite cache for a hero so createHeadlessHero() can attach
 * dynamic per-anim collision boxes SYNCHRONOUSLY (the ride path is sync).
 * Await this once before creating heroes / running rides in node tests and
 * tools. In the browser the game loop has already loaded the sheets, so the
 * cache hit makes this a no-op. Safe to call repeatedly.
 * @param {'scarlet'|'balthazar'} [heroKey]
 */
export async function ensureHeadlessSprites(heroKey = 'balthazar') {
  const dir = HERO_SPRITE_DIRS[heroKey] ?? heroKey;
  const { loadHeroSprites } = await import('./heroSprites.js');
  return loadHeroSprites(dir);
}

/**
 * Build a hero instance wired for headless stepping.
 * @param {'scarlet'|'balthazar'} heroKey
 * @param {{x:number,y:number}} spawn top-left of the standing box (screen px)
 */
export function createHeadlessHero(heroKey = 'balthazar', spawn = { x: 0, y: 0 }) {
  const def = HEROES[heroKey] || HEROES.balthazar;
  const hero = new Hero(def, spawn.x, spawn.y);
  // Never draw, never animate — update() guards both behind truthy checks.
  hero.draw = () => {};
  // Infinite supers during test rides: geometry clearability, not meter pacing.
  hero.supermoveMeter = hero.SUPERMOVE_MAX;
  // Dynamic per-anim collision box (sheet-owned width + jump/crouch tuck),
  // exactly like the real game hero. No-op until ensureHeadlessSprites() has
  // primed the cache (node) or the game loop loaded the sheets (browser).
  try { attachHeroSprites(hero, HERO_SPRITE_DIRS[heroKey] ?? heroKey); } catch { /* keep default box */ }
  if (hero.sprite?.anims?.idle) {
    try { hero.setAnim('idle'); } catch { /* keep default box */ }
  }
  return hero;
}

/**
 * Advance the hero by one fixed dt using the exact in-game pipeline:
 *   hero.update(dt, input) → resolve(hero, solids) → setGrounded(probe)
 * Mirrors systems/update.js steps 1 + 3 (minus combat/camera/effects).
 *
 * @param {object} hero        from createHeadlessHero()
 * @param {number} dt          seconds (use 1/60)
 * @param {object} input       { left, right, jump, down, super, onOneWay }
 * @param {object[]} solids    plain AABBs {x,y,w,h,oneWay?}, screen px
 * @returns {{hit:object|null, grounded:boolean, onOneWay:boolean}}
 */
export function stepHeadless(hero, dt, input, solids) {
  const prevBottom = hero.worldBox().y + hero.worldBox().h - hero.vy * dt;
  hero.update(dt, input);
  // Same anim binding the game loop runs after physics (systems/update.js):
  // switches idle/run/jump and resizes the sheet-owned collision box to the
  // active frame. No-op when no sprite data is attached (unprimed node path).
  updateHeroLocomotionAnim(hero, input, dt);
  const hit = resolve(hero, solids, {
    prevBottom,
    // Drop-through window OR the flat supermove burst (phases through tops).
    ignoreOneWay: !!hero.droppingThrough || (hero.supermoveActive && hero.supermovePhase === 'burst'),
  });
  hero.setGrounded(groundedProbe(hero, hit, solids));
  return { hit, grounded: hero.grounded, onOneWay: standingOnOneWayProbe(hero, solids) };
}

/** Same contact probe as hero/physics.js isGrounded(), but over explicit solids. */
function groundedProbe(hero, hit, solids) {
  if (hit && hit.axis === 'y' && hit.dir === 1) return true;
  const wb = hero.worldBox();
  for (const s of solids) {
    if (s.oneWay && hero.droppingThrough) continue;
    if (wb.x + wb.w <= s.x || wb.x >= s.x + s.w) continue;
    const gap = s.y - (wb.y + wb.h);
    if (gap >= -2 && gap <= 4 && hero.vy >= 0) return true;
  }
  return false;
}

/** Same probe as hero/physics.js standingOnOneWay(), over explicit solids. */
function standingOnOneWayProbe(hero, solids) {
  if (!hero.grounded) return false;
  const wb = hero.worldBox();
  for (const s of solids) {
    if (!s.oneWay) continue;
    if (wb.x + wb.w <= s.x || wb.x >= s.x + s.w) continue;
    const gap = s.y - (wb.y + wb.h);
    if (gap >= -2 && gap <= 4) return true;
  }
  return false;
}
