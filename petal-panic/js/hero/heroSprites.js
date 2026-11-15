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
import { SpritePlayer } from '../core/spritePlayer.js';

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
      'idle_special',
      'idle_aim_front', 'idle_aim_up', 'idle_aim_down',
      'idle_aim_45up', 'idle_aim_45down',
      'run_aim_front', 'run_aim_up', 'run_aim_down',
      'run_aim_45up', 'run_aim_45down',
      'melee', 'air_melee', 'super_melee', 'superpower', 'supermove',
      'hit',
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

// Idle playback pattern: while standing still, play the `idle` anim for this
// many full cycles, then (if an `idle_special` sheet exists) the special idle
// for that many cycles — then repeat.
//
// Why a shared clock instead of counting each anim's own cycles: the two
// sheets have DIFFERENT cycle lengths (idle 16f@9fps ≈ 1.78s, idle_special
// 8f@7fps ≈ 1.14s). Counting "N cycles of whichever anim is active" can't
// hold a stable ratio — the shorter special wraps back almost immediately.
// A single monotonic clock measured against the engine's own cycleDuration
// values gives a deterministic 3:1 window regardless of per-sheet length.
// cycleDuration comes from SpritePlayer (per-frame duration overrides + fps),
// so no manual timing math here. Pure code constants; no sheet data.
export const IDLE_CYCLE_COUNT = 3;
export const IDLE_SPECIAL_CYCLE_COUNT = 1;

/** heroDef.id → assets/heroes/ folder name (single source of truth). */
export const HERO_SPRITE_DIRS = { scarlet: 'scarlet_vale', balthazar: 'balthazar' };

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
export function updateHeroLocomotionAnim(hero, input, dt = 0) {
  if (!hero.sprite?.anims) return;
  const shooting = !!(input && input.shoot);

  // Hit reaction owns the sprite for its WHOLE playback (hit > attack > crouch
  // > jump). The sheet is a 'once' anim: setAnim() starts it at frame 0 and
  // playback runs to the terminal frame; while _spriteAnim === 'hit' this
  // branch keeps winning — even AFTER hit-stun expires, since the pose (0.75s)
  // outlives the stun (0.25–0.30s). That tail matters: crouch entry/exit is
  // input-gated in hero.update (skipped while hitStunned), so a Down held from
  // before the hit makes this.crouching flip true the first unstunned frame —
  // if the hit branch had already yielded, the crouch branch would shrink the
  // box under the full-height hit art (or vice versa on the snap back). Owning
  // the frame until playback truly ends keeps height + art + box consistent.
  // Knockback physics runs underneath — the pose is purely visual. Re-hit
  // mid-playback restarts it (setAnim rebuilds the player).
  const hitPoseActive = hero._spriteAnim === 'hit' && hero.sprite.anims.hit
    && (!hero._player || !hero._player.isDone);
  if ((hero.hitStunned || hitPoseActive) && hero.sprite.anims.hit) {
    delete hero._idlePatternClock;
    // The hit pose is FULL standing height, always (airborne or grounded):
    // setAnim('hit') applies the sheet's hScale (1.0) and re-fits art + box
    // together — height follows the playing anim, no manual restore needed.
    if (hero._spriteAnim !== 'hit') {
      try { hero.setAnim('hit'); } catch { /* keep current */ }
    }
    return;
  }

  // Supermove supermove: the supermove sheet plays at its AUTHORED fps (the
  // SpritePlayer ticks it in hero.update's anim tick) — no progress mapping.
  // The 0.6s supermove covers only the first part of the cycle; the remainder
  // finishes as a visual freeze tail AFTER the supermove ends (branch below).
  if (hero.supermoveActive && hero.sprite.anims.supermove) {
    delete hero._idlePatternClock;
    // A jump-cancel out of the decel phase ends the supermove early — the freeze
    // tail branch below still lets the art finish before reclaiming locomotion.
    // Height is anim-owned: setAnim('supermove') applies the sheet's hScale
    // (full-body pose = 1.0), so the supermove renders at standing height whether
    // we launched from the ground, a crouch, or a tucked jump.
    if (hero._spriteAnim !== 'supermove') {
      try { hero.setAnim('supermove'); } catch { /* keep current */ }
    }
    return;
  }

  // Supermove freeze tail: the supermove physics are over (normal control has
  // resumed) but the sheet is still mid-cycle — hold the supermove pose until
  // playback reaches its terminal frame, then fall through so the generic
  // switch reclaims idle/run/jump. Purely visual: input/physics are already
  // normal, only the sprite stays on the sheet. Height stays with the pose
  // (anim-owned) until the next setAnim switches it.
  if (hero._spriteAnim === 'supermove' && hero.sprite.anims.supermove
      && (!hero._player || !hero._player.isDone)) {
    delete hero._idlePatternClock;
    return;
  }
  if (hero._spriteAnim === 'supermove') {
    // Freeze tail just ended (or no player to track): the supermove anim is
    // fully off screen. Clear the pose so the generic switch reclaims it.
    hero._spriteAnim = null;
  }

  // Attack anims own their window: while a swing runs, the sheet (melee /
  // super_melee) plays from f1 at its authored fps. When the swing ends, the
  // next frame falls through to the locomotion switch below and reclaims
  // idle/run/crouch — no per-attack end-of-swing reset needed.
  if (hero.specialMeleeActive && hero.sprite.anims.super_melee) {
    delete hero._idlePatternClock; // left idle — restart pattern next stand-still
    // Height is anim-owned: setAnim applies the sheet's hScale, so landing
    // mid-swing just switches to the grounded sheet and the height follows.
    if (hero._spriteAnim !== 'super_melee') {
      try { hero.setAnim('super_melee'); } catch { /* keep current */ }
    }
    return;
  }
  if (hero.meleeActive && hero.sprite.anims.melee) {
    delete hero._idlePatternClock;
    // Airborne swings play the `air_melee` sheet when one exists — captured at
    // swing start (hero._meleeAirborne). The flag is fixed for the whole swing:
    // landing mid-swing keeps the air art (the hitbox/anim stay in lockstep),
    // and a coyote-time swing started just after leaving the ground plays the
    // grounded sheet. Height follows whichever sheet is active (hScale).
    const want = (hero._meleeAirborne && hero.sprite.anims.air_melee) ? 'air_melee' : 'melee';
    if (hero._spriteAnim !== want) {
      try { hero.setAnim(want); } catch { /* keep current */ }
    }
    return;
  }

  // Crouch owns its own height via the crouch sheet's hScale (0.5) — it
  // must win over the run/idle switch. Height follows the playing anim
  // (setAnim applies hScale), so crouched height is preserved automatically.
  //
  // EXCEPT while airborne with a jump initiated: a jump launched from a crouch
  // exits the crouch state atomically in hero.update, but a Down held through
  // the launch would re-enter crouch on the first grounded frame and this
  // branch would keep playing the crouch sheet for the whole air time. Jumping,
  // the jump pose always wins (it owns both the art and the tucked height).
  //
  // The fall-grace window is the ONE airborne case where crouch still wins:
  // crouched at a ledge edge with Down held walks off still crouched (the
  // crouch flag only clears on an actual jump or landing), so the grace keeps
  // the crouch sheet + tucked height exactly as before the fix — then the
  // jump tuck takes over when the grace expires.
  const inFallGrace = !hero.grounded && hero.jumpsUsed === 0 && hero._fallAnimGrace > 0;
  if (hero.crouching && (hero.grounded || inFallGrace)) {
    delete hero._idlePatternClock;
    const want = (shooting && hero.sprite.anims.crouch_shoot) ? 'crouch_shoot' : 'crouch';
    // Height is anim-owned: setAnim applies the crouch sheet's hScale (0.5)
    // and re-fits art + box together — no separate height step, no re-fit.
    // This also self-heals stale full-height states (e.g. the frame after a
    // hit pose ends): switching to the crouch sheet tucks atomically.
    if (hero._spriteAnim !== want) {
      try {
        hero.setAnim(want);
      } catch { /* keep current */ }
    }
    return;
  }

  // Airborne jump pose: while NOT grounded (and not mid-attack/crouch above),
  // play the `jump` anim — its sheet declares hScale 0.5, so setAnim tucks
  // box + art together for the whole air time (height follows the playing
  // anim; there is no separate "air tuck" step). Landing switches back to a
  // full-height sheet and the height restores on that setAnim.
  //
  // Fall grace (hero._fallAnimGrace): an UNJUMPED air entry (walked off a
  // ledge, knocked into the air) keeps the last grounded anim for a short
  // window before the jump pose takes over — snapping into the tucked pose on
  // the exact frame you leave a platform reads as a flinch. A real jump never
  // sees this window (jumpsUsed > 0 from the launch frame).
  if (!hero.grounded && !(hero.jumpsUsed === 0 && hero._fallAnimGrace > 0)) {
    delete hero._idlePatternClock; // airborne — restart pattern on landing+stand
    if (hero.sprite.anims.jump) {
      if (hero._spriteAnim !== 'jump') {
        try { hero.setAnim('jump'); } catch { /* keep current */ }
      }
    }
    return;
  }

  // Fall-grace window (unjumped air entry): the jump-tuck branch above is
  // suppressed, so fall through to the grounded-style switch below and keep
  // playing run/idle while the grace clock runs out. Height stays FULL during
  // the grace — the tuck only begins once the jump pose actually takes over.
  // (A crouched walk-off never reaches here: the crouch branch above already
  // claimed it for the whole grace window.)

  // Run anim requires an ACTIVE direction input, not just velocity: on release
  // the body coasts to a stop under ground friction (the skid), but the run
  // cycle is a propulsion pose — playing it while coasting reads as "still
  // accelerating" and stutters at low speed. Idle-during-skid reads as
  // momentum instead. Holding a direction (including reversing mid-skid)
  // keeps the run anim since the hero is actively driving again. The speed
  // threshold still applies so a held direction at near-zero drift doesn't
  // churn into the run cycle.
  //
  // Fall-grace exception: airborne during the grace window the hero KEEPS its
  // last grounded anim — running off a ledge must stay in the run cycle (not
  // snap to idle), standing at the edge stays idle. The grounded gate on
  // `running` is relaxed ONLY for that window; aim overrides stay grounded-only.
  const dirHeld = !!(input && ((input.left && !input.right) || (input.right && !input.left)));
  const running = (hero.grounded || inFallGrace) && dirHeld && Math.abs(hero.vx) > RUN_SPEED_THRESHOLD;

  // Idle pattern clock: while standing still with no aim override and an
  // idle_special sheet exists, alternate 3× idle → 1× idle_special. It only
  // sets a PHASE FLAG — the actual anim binding happens in the generic switch
  // below, exactly like any other anim. Leaving idle (running/aiming) resets
  // the clock + phase so the next stand-still starts fresh on `idle`.
  if (!running && !shooting && hero.sprite.anims.idle_special) {
    const idleDur = new SpritePlayer(hero.sprite.anims.idle).cycleDuration * IDLE_CYCLE_COUNT;
    const specialDur = new SpritePlayer(hero.sprite.anims.idle_special).cycleDuration * IDLE_SPECIAL_CYCLE_COUNT;
    const total = idleDur + specialDur;
    if (hero._idlePatternClock == null) hero._idlePatternClock = 0;
    hero._idlePatternClock += dt;
    const phase = hero._idlePatternClock % total;
    hero._idleSpecialPhase = phase < idleDur ? 'idle' : 'special';
  } else {
    hero._idleSpecialPhase = 'idle';
    delete hero._idlePatternClock;
  }

  // Generic locomotion switch (run | idle | idle_special | aim variants).
  // ONE setAnim path for everything — idle_special is just another base anim,
  // picked from the phase flag above. No separate owner, no second binding.
  const base = running ? 'run' : (hero._idleSpecialPhase === 'special' ? 'idle_special' : 'idle');
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
