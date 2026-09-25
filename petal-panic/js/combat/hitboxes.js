// Unified hitbox system — all attack hitboxes register here each frame.
// One generic loop processes them via processHitboxes(). Each hitbox "slot"
// follows the same lifecycle: box appears → activate + reset hitSet, box
// persists → stay active, box disappears → deactivate.

import { makeHitbox, resetHitbox, processHitboxes } from './hitbox.js';
import { applyKnockback } from './knockback.js';
import { ATTACK_MELEE, ATTACK_SPECIAL_MELEE, ATTACK_SUPERMOVE } from '../hero/heroDefs.js';
import { LAYER } from '../consts.js';
import { Effects } from '../effects.js';
import { ctx } from '../world/context.js';

const _hitboxes = []; // registered hitbox instances (reused, not allocated per frame)

/**
 * A hitbox slot: pairs a persistent Hitbox object with the state needed to
 * track its instance lifecycle (reset-on-first-frame pattern).
 */
function makeSlot(hb, { ownerGet, boxGet, damageGet, resetFlag }) {
  return { hb, ownerGet, boxGet, damageGet, resetFlag };
}

/**
 * Update one hitbox slot for this tick. Returns nothing; mutates the slot's
 * hitbox in place. The resetFlag is a [getter, setter] pair on the owner so
 * each entity tracks its own "has this instance already reset?" state.
 */
function updateSlot(slot) {
  const { hb, ownerGet, boxGet, damageGet, resetFlag } = slot;
  const owner = ownerGet();
  const box = boxGet();
  if (box && owner) {
    hb.owner = owner;
    hb.box = box;
    hb.damage = damageGet();
    // Knockback rides on the resolved box (heroDefs data → attackHitboxWorld).
    // Copy it onto the hitbox so processAllHitboxes reads hb.knockback at impact.
    hb.knockback = box.knockback;
    hb.active = true;
    if (!resetFlag.get()) {
      resetHitbox(hb);
      resetFlag.set(true);
    }
  } else {
    hb.active = false;
    resetFlag.set(false);
  }
}

// Hero melee slot.
const _hbMelee = makeHitbox({ owner: null, team: 'ally', box: null, damage: 0, method: 'melee' });
_hitboxes.push(_hbMelee);
const _slotMelee = makeSlot(_hbMelee, {
  ownerGet: () => ctx.hero,
  boxGet: () => ctx.hero.attackHitboxWorld(ATTACK_MELEE),
  damageGet: () => ctx.hero.stats.attack,
  resetFlag: { get: () => !!ctx.hero._meleeHbReset, set: v => ctx.hero._meleeHbReset = v },
});

// Hero supermove dash slot.
const _hbSuper = makeHitbox({ owner: null, team: 'ally', box: null, damage: 0, method: 'super' });
_hitboxes.push(_hbSuper);
const _slotSuper = makeSlot(_hbSuper, {
  ownerGet: () => ctx.hero,
  boxGet: () => ctx.hero.attackHitboxWorld(ATTACK_SUPERMOVE),
  damageGet: () => ctx.hero.stats.attack * 2,
  resetFlag: { get: () => !!ctx.hero._supermoveHbReset, set: v => ctx.hero._supermoveHbReset = v },
});

// Hero special melee slot (design §15): Down+Melee per-hero trajectory swing.
// Same lifecycle as the normal melee slot — only the active phase exposes a
// box; damage routes through the same central damage() system.
const _hbSpecialMelee = makeHitbox({ owner: null, team: 'ally', box: null, damage: 0, method: 'specialMelee' });
_hitboxes.push(_hbSpecialMelee);
const _slotSpecialMelee = makeSlot(_hbSpecialMelee, {
  ownerGet: () => ctx.hero,
  boxGet: () => ctx.hero.attackHitboxWorld(ATTACK_SPECIAL_MELEE),
  damageGet: () => ctx.hero.stats.attack,
  resetFlag: { get: () => !!ctx.hero._specialMeleeHbReset, set: v => ctx.hero._specialMeleeHbReset = v },
});

/**
 * Register active hitboxes for this frame and process them all in one pass.
 * Called once per update tick after all entities have integrated.
 */
export function processAllHitboxes() {
  const h = ctx.hero;

  // --- Hero slots (melee + special melee + supermove) ---
  updateSlot(_slotMelee);
  updateSlot(_slotSpecialMelee);
  updateSlot(_slotSuper);

  // --- Enemy attack hitboxes (whip, lunge, jab) ---
  // Each real enemy exposes an attack hitbox getter. Register dynamically.
  for (const e of ctx.realEnemies) {
    if (!e.alive || e.aiState === 'dead') continue;
    const ehb = getEnemyAttackHitbox(e);
    if (!ehb) {
      // No box this frame → deactivate + ready for next attack.
      if (e._hitbox) {
        e._hitbox.active = false;
        e._hitboxReset = false;
      }
      continue;
    }
    let hb = e._hitbox;
    if (!hb) {
      hb = makeHitbox({ owner: e, team: 'foe', box: null, damage: e.stats.attack, method: 'melee' });
      e._hitbox = hb;
      _hitboxes.push(hb);
    }
    hb.owner = e;
    hb.box = ehb;
    hb.damage = e.stats.attack;
    hb.active = true;
    if (!e._hitboxReset) {
      resetHitbox(hb);
      e._hitboxReset = true;
    }
  }

  // --- Process all against all targets ---
  // Boss zone flow (boss-arena.md §2): the boss cannot take damage before
  // COMBAT. This gate MUST run BEFORE any damage is applied — processHitboxes
  // applies damage (takeDamage / hit) internally, so the onHit callback fires
  // only AFTER the boss has already been damaged. Filtering the boss out of
  // the target list here is the pre-damage guard: it stops melee, projectiles,
  // and specials from ever reaching the boss's takeDamage() until COMBAT.
  // (The onHit callback below keeps a redundant guard as a safety net.)
  const bossDamageAllowed = ctx.bossZone.bossCanTakeDamage();
  const targets = [h, ...ctx.realEnemies,
    ...(bossDamageAllowed ? [ctx.boss] : []),
    ...ctx.barrels, ...ctx.woodBarrels, ...ctx.coinBarrels].filter(Boolean);
  processHitboxes(_hitboxes, targets, (hb, target, dealt) => {
    // Safety net (defense in depth): the boss was already excluded from
    // `targets` above when combat has not started, so this never fires for the
    // boss pre-COMBAT. Kept for clarity / future refactor safety.
    if (target === ctx.boss && !ctx.bossZone.bossCanTakeDamage()) return;
    // Self-protection on connect (knockback.md ): the FIRST clean
    // hit of a special melee swing arms the hero's protection window for the
    // rest of that swing. The callback only fires when the box actually struck
    // a target — a whiff never reaches here, so it grants nothing. Normal
    // melee and supermove connects intentionally do NOT arm it (acceptance #4).
    if (hb.method === 'specialMelee' && hb.owner === h) {
      h.markSpecialConnect();
    }
    // VFX / juice on hit.
    if (target.layer === LAYER.HERO) {
      Effects.heroDamaged();
    } else {
      Effects.beginEnemyShake(target);
      if (target.hitFlash !== undefined) target.hitFlash = 0.1;

      // Hero→enemy knockback: if the attack hitbox carries a `knockback`
      // setting, apply the physical reaction to the enemy. No per-attack-type
      // branching — presence of the data is the only gate. The setting lives on
      // the hitbox (design §7), not the hero; the hero is used for motion/dir.
      const source = hb.owner;
      if (hb.knockback) {
        const dirMode = hb.knockback.dirMode || 'fromAttacker';
        let nx, ny;
        if (dirMode === 'alongVelocity') {
          const len = Math.hypot(source.vx || 0, source.vy || 0) || 1;
          nx = (source.vx || 0) / len;
          ny = (source.vy || 0) / len;
        } else {
          // 'fromAttacker' or 'radial': direction from source center to enemy center
          const scx = source.x + (source.w || 0) / 2;
          const scy = source.y + (source.h || 0) / 2;
          const ecx = target.x + target.w / 2;
          const ecy = target.y + target.h / 2;
          const dx = ecx - scx, dy = ecy - scy;
          const len = Math.hypot(dx, dy) || 1;
          nx = dx / len; ny = dy / len;
        }
        applyKnockback(target, source, hb.knockback, { x: nx, y: ny });
      }
    }
    // Remove dead enemies from world.
    if (target.alive === false && target !== h) {
      ctx.collisionWorld.remove(target);
    }
    // Handle barrel destruction.
    if (target.destroyed) {
      ctx.handleBarrelDestroyed(target);
    }
  });
}

/**
 * Get the current attack hitbox for a real enemy, or null.
 * Each enemy type stores its hitbox getter under a known property name.
 */
function getEnemyAttackHitbox(e) {
  // Jester: whipHitboxWorld, VineHound: lungeHitboxWorld, Violetta: meleeHitboxWorld
  if (e.whipHitboxWorld != null) return e.whipHitboxWorld;
  if (e.lungeHitboxWorld != null) return e.lungeHitboxWorld;
  if (e.meleeHitboxWorld != null) return e.meleeHitboxWorld;
  return null;
}
