// Petal Panic — Hero sheet-sprite loader + locomotion anim binding.
//
// Loads a hero's *_sheet.json files (assets/heroes/<heroId>/) into the shared
// sprite pipeline and binds the LOCOMOTION subset to gameplay state:
//   idle  ↔ grounded + not moving
//   run   ↔ grounded + |vx| > threshold
// mirrorX follows facing (syncMirror already does this; drawSprite applies it).
//
// Scope is deliberately minimal (v1): no aim variants, no jump/crouch/attack
// yet — those land as follow-ups on the same wiring. Heroes without sheets
// (or node tests where Image is undefined) keep the primitive rect path.

import { parseSheet } from '../core/spriteData.js';
import { loadFrames } from '../core/frameLoader.js';
import { uniformScale } from '../core/spriteData.js';

/** Module-level cache: heroId → { data, frames }. */
const heroSpriteCache = new Map();

/** Node-only JSON reader for file: URLs (browser uses fetch instead). */
async function readFileJson(url) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  return JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
}

/**
 * Load all sheet JSONs for one hero directory and merge their anims.
 * @param {string} heroId folder name under assets/heroes/ (e.g. 'scarlet_vale')
 * @returns {Promise<{data:object, frames:Map}|null>} null when unavailable
 *   (no sheets / load failure) — caller keeps the primitive path.
 */
export async function loadHeroSprites(heroId) {
  if (heroSpriteCache.has(heroId)) return heroSpriteCache.get(heroId);
  const base = new URL(`../../assets/heroes/${heroId}/`, import.meta.url).href;
  try {
    // Directory listing differs by platform, so we probe the known anim names
    // instead of readdir.
    const names = [
      'idle', 'run', 'jump', 'crouch', 'crouch_shoot',
      'idle_aim_front', 'idle_aim_up', 'idle_aim_down',
      'idle_aim_45up', 'idle_aim_45down',
      'run_aim_front', 'run_aim_up', 'run_aim_down',
      'run_aim_45up', 'run_aim_45down',
      'melee', 'super_melee', 'superpower', 'supermove',
      'air_sweep',
      'cane_attack', 'jump2', 'run2',
    ];
    const urls = names.map((n) => new URL(`${n}_sheet.json`, base).href);
    const results = await Promise.all(urls.map(async (u) => {
      try {
        if (u.startsWith('file:')) return await readFileJson(u);
        const r = await fetch(u);
        return r.ok ? r.json() : null;
      } catch { return null; }
    }));
    const sheets = results.filter(Boolean);
    if (sheets.length === 0) return null;
    const data = parseSheet(sheets);
    // sprites.md §4: every anim needs an authored collision box as the scale
    // reference. Hero sheets are only partially authored; any anim still
    // missing one is dropped so setAnim() can never reach uniformScale()
    // with a null reference box (the rest of the hero keeps working).
    for (const name of Object.keys(data.anims)) {
      if (!data.anims[name].collisionBox) delete data.anims[name];
    }
    const frames = await loadFrames(data, base);
    const entry = { data, frames };
    heroSpriteCache.set(heroId, entry);
    return entry;
  } catch (e) {
    console.warn(`[sprite] hero ${heroId} sheets failed to load`, e);
    return null;
  }
}

/**
 * Attach loaded sprite data to a hero entity (idempotent). Uses the LIVE
 * frames accessor pattern so late-loaded images are picked up automatically.
 * boxFromSheet: false — the hero's gameplay hitbox stays authoritative;
 * sheets only provide art + scale reference.
 * @returns {boolean} true when sprite data was attached
 */
export function attachHeroSprites(hero, heroId) {
  const entry = heroSpriteCache.get(heroId);
  if (!entry || !entry.data.anims.idle) return false;
  // Sheet-owned size: width comes from the active anim's collision-box aspect
  // (setAnim() clears _baseW on handover). No pinning — the art IS the box.
  hero.sprite = { anchor: 'bottom-center', anims: entry.data.anims };
  Object.defineProperty(hero.sprite, 'frames', { get: () => entry.frames });
  return true;
}

/** Grounded speed above which the run cycle plays (px/s). Below this the
 *  hero is "standing" even with residual friction drift. */
const RUN_SPEED_THRESHOLD = 20;

/** heroDef.id → assets/heroes/ folder name (single source of truth). */
export const HERO_SPRITE_DIRS = { scarlet: 'scarlet_vale' };

// Aim → sheet suffix table. The 8-way index (DIR_ANGLES order in core/vec.js):
//   0 right, 1 up-right, 2 up, 3 up-left, 4 left, 5 down-left, 6 down, 7 down-right.
// Sheets exist for 5 directions (front/up/down/45up/45down); left aims reuse
// the same art mirrored (mirrorX already flips it). No sheet → plain base anim.
const AIM_SUFFIX = { 0: 'front', 1: '45up', 2: 'up', 3: '45up', 4: 'front', 5: '45down', 6: 'down', 7: '45down' };

/**
 * Bind the active locomotion + aim anim from live hero state. Call once per
 * frame after physics/input/shooting (hero.update + tryFire). No-op when no
 * sprite data is attached. Only switches anims on actual change — setAnim()
 * re-fits scale each call, so steady-state frames must not churn it.
 *
 * Anim resolution (most specific wins):
 *   crouching        → crouch_shoot while shooting, else crouch
 *   grounded+shooting→ {idle|run}_aim_{dir} when a sheet exists, else idle/run
 *   grounded         → run | idle
 */
export function updateHeroLocomotionAnim(hero, input) {
  if (!hero.sprite?.anims) return;
  const shooting = !!(input && input.shoot);

  // Attack anims own their window: while a swing runs, the sheet (melee /
  // super_melee) plays from f1 at its authored fps. When the swing ends, the
  // next frame falls through to the locomotion switch below and reclaims
  // idle/run/crouch — no per-attack end-of-swing reset needed.
  if (hero.specialMeleeActive && hero.sprite.anims.super_melee) {
    if (hero._spriteAnim !== 'super_melee') {
      try { hero.setAnim('super_melee'); } catch { /* keep current */ }
    }
    return;
  }
  if (hero.meleeActive && hero.sprite.anims.melee) {
    if (hero._spriteAnim !== 'melee') {
      try { hero.setAnim('melee'); } catch { /* keep current */ }
    }
    return;
  }

  // Crouch owns its own height (applyCrouchHeight + crouch anim) — it must
  // win over the run/idle switch or setAnim('idle') would restore full height.
  if (hero.crouching) {
    const want = (shooting && hero.sprite.anims.crouch_shoot) ? 'crouch_shoot' : 'crouch';
    if (hero._spriteAnim !== want) {
      try {
        // Preserve the crouch height scale across crouch-family switches:
        // setAnim() resets _targetHScale from the NEW anim's hScale (absent on
        // crouch_shoot → 1), which would stand the hero back up mid-crouch.
        const prevHScale = hero._targetHScale;
        hero.setAnim(want);
        if (prevHScale !== 1) {
          const prevH = hero.h;
          hero._targetHScale = prevHScale;
          const newH = hero.h;
          if (newH !== prevH) hero.y += prevH - newH;
        }
      } catch { /* keep current */ }
    }
    // setAnim() fits the sheet onto this.h at SWITCH time, but the crouch
    // height change happens in a separate step (applyCrouchHeight) — re-derive
    // scale + width from the active sheet + CURRENT h so both axes follow the
    // sheet aspect at the crouched height (same rule as setAnim, re-run).
    const cb = hero.sprite?.anims?.[hero._spriteAnim]?.collisionBox;
    if (cb) {
      try {
        hero._spriteScale = uniformScale(hero.sprite.anims[hero._spriteAnim], hero.h);
        hero.w = cb.w * hero._spriteScale;
      } catch { /* keep current */ }
    }
    return;
  }

  const running = hero.grounded && Math.abs(hero.vx) > RUN_SPEED_THRESHOLD;
  const base = running ? 'run' : 'idle';
  let want = base;
  if (shooting && hero.grounded) {
    const dir = hero.resolveAim(input);
    const suffix = AIM_SUFFIX[dir];
    const aimName = `${base}_aim_${suffix}`;
    if (hero.sprite.anims[aimName]) want = aimName;
  }
  if (hero._spriteAnim !== want) {
    try {
      hero.setAnim(want);
    } catch { /* anim missing for this hero — keep current */ }
  }
}
