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
  const hit = resolve(hero, solids, {
    prevBottom,
    ignoreOneWay: !!hero.droppingThrough,
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
