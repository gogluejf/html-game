// Petal Panic — Hitbox system (design: unified attack hitboxes).
//
// A Hitbox is a transient, ownerless-in-world damage zone. It is NOT an Entity
// (no position of its own, no layer in the collision world, no pool lifetime).
// It's a plain object registered for one or more frames by its owner (hero melee,
// hero super, enemy whip, enemy lunge, etc.). The engine processes all active
// hitboxes in one generic loop — no per-attack-type special casing.
//
// Team routing:
//   - 'ally'  → hits ENEMY + BOSS + SOLID (barrels)
//   - 'foe'   → hits HERO
//   - 'neutral' → hits everything alive (explosions, hazards)
//
// The engine never asks "who owns this" or "how did it come about." It reads
// team + box + damage + method and routes accordingly.

import { LAYER } from '../consts.js';
import { Effects } from '../effects.js';
import { applyHit } from './hitResolution.js';
import { applyKnockback } from './knockback.js';
import { Team, AttackProvenance } from './targeting.js';

/** Methods whose connect deals blood (melee-family strikes). */
const BLOOD_METHODS = new Set(['melee', 'specialMelee', 'super']);

/** Screen shake tiers: any connect gets a solid kick; a KILL (star treatment)
 * is the biggest kick. The camera-shake merge rule is max-kick, so a 6 fired
 * on the same frame as the 4 always wins — no double-shake bookkeeping needed. */
const CONNECT_SHAKE = 4;
/** Subtle twitch reserved for NORMAL melee connects (the jab is spammy — a
 * full connect kick would read as noise). Special melee + supermove keep the
 * standard CONNECT_SHAKE; kills merge up to KILL_SHAKE regardless. */
const MELEE_CONNECT_SHAKE = 2;
const KILL_SHAKE = 6;

/**
 * Map a hitbox's method label to an AttackProvenance value for the unified
 * resolver. The three melee-family methods each carry their own provenance so
 * telemetry can tell a normal swing from a special swing from a supermove dash.
 */
const METHOD_PROVENANCE = {
  melee: AttackProvenance.MELEE,
  specialMelee: AttackProvenance.SPECIAL_MELEE,
  super: AttackProvenance.SUPER_MOVE,
  fire: AttackProvenance.HAZARD_FIRE,
  dust: AttackProvenance.HAZARD_DUST,
  spike: AttackProvenance.SPIKE,
  beam: AttackProvenance.BEAM,
  shockwave: AttackProvenance.SHOCKWAVE,
  stomp: AttackProvenance.STOMP,
  dash: AttackProvenance.DASH,
  projectile: AttackProvenance.PROJECTILE,
  explosion: AttackProvenance.EXPLOSION,
  contact: AttackProvenance.CONTACT,
};

/**
 * Map a hitbox's team label to a Team constant for the unified resolver.
 * Falls back to NEUTRAL for unknown labels (matches TEAM_TARGETS behaviour —
 * those teams simply have no target mask and are skipped upstream anyway).
 */
const TEAM_CONST = {
  ally: Team.ALLY,
  foe: Team.FOE,
  neutral: Team.NEUTRAL,
};

/** Target layer masks per team. */
const TEAM_TARGETS = {
  ally:    [LAYER.ENEMY, LAYER.BOSS, LAYER.SOLID],
  foe:     [LAYER.HERO],
  neutral: [LAYER.HERO, LAYER.ENEMY, LAYER.BOSS, LAYER.SOLID],
};

/**
 * Create a hitbox. Call each frame your attack is active; pass null/undefined
 * to deactivate.
 *
 * @param {object} opts
 * @param {object} opts.owner   entity dealing damage (hero, enemy, ...)
 * @param {string} opts.team    'ally' | 'foe' | 'neutral'
 * @param {{x:number,y:number,w:number,h:number}} opts.box  world-space AABB
 * @param {number} opts.damage  raw damage amount (target defense still applies)
 * @param {string} [opts.method='melee']  telemetry label
 * @returns {object} hitbox instance (reuse the same object each frame)
 */
export function makeHitbox({ owner, team, box, damage, method = 'melee' }) {
  return {
    owner,
    team,
    box,
    damage,
    method,
    hitSet: new Set(),
    active: true,
  };
}

/**
 * Reset a hitbox's hit set (call when a new swing/dash begins).
 * @param {object} hb
 */
export function resetHitbox(hb) {
  hb.hitSet.clear();
  hb.active = true;
}

/**
 * Process all active hitboxes against the target set. One generic loop.
 *
 * @param {Array<object>} hitboxes  all registered hitboxes (active or not)
 * @param {Array<object>} targets   all live entities to check against
 * @param {function} [onHit]        callback(hb, target, dealt) for VFX/shake
 */
/** True when the target is a barrel (destructible solid) — its kill payoff is
 * the fuse/explosion, NOT a knockback launch. Used to exclude barrels from the
 * kill→big-launch upgrade. */
function isBarrelTarget(t) {
  return t.layer === LAYER.SOLID;
}

/** Orient a raw knockback tier vector ({x,y,hitstun,dirMode}) into a concrete
 * shove for this impact, using the SAME direction rules as the inline orient()
 * in processHitboxes. Extracted so the kill-upgrade delta can re-orient both
 * tiers identically. Returns null when kb is absent. */
function _orientStored(hb, t, tb, kb) {
  if (!kb) return null;
  if (kb.dirMode === 'fixed') {
    return { x: kb.x ?? 0, y: kb.y ?? 0, hitstun: kb.hitstun, iFrames: kb.iFrames };
  } else if (kb.dirMode === 'alongVelocity') {
    const len = Math.hypot(hb.owner?.vx || 0, hb.owner?.vy || 0) || 1;
    const nx = (hb.owner?.vx || 0) / len;
    // Pop stays upward regardless of travel direction (see inline orient()).
    return { x: nx * (kb.x ?? 0), y: kb.y ?? 0, hitstun: kb.hitstun, iFrames: kb.iFrames };
  } else {
    const scx = hb.owner.x + (hb.owner.w || 0) / 2;
    const scy = hb.owner.y + (hb.owner.h || 0) / 2;
    const dx = (tb.x + tb.w / 2) - scx, dy = (tb.y + tb.h / 2) - scy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len, ny = dy / len;
    return { x: nx * (kb.x ?? 0), y: ny * (kb.y ?? 0), hitstun: kb.hitstun, iFrames: kb.iFrames };
  }
}

export function processHitboxes(hitboxes, targets, onHit) {
  for (const hb of hitboxes) {
    if (!hb.active || !hb.box) continue;
    const layers = TEAM_TARGETS[hb.team];
    if (!layers) continue;

    for (const t of targets) {
      if (!t || t.alive === false) continue;
      if (t === hb.owner) continue;           // never self-hit
      // Dedupe: one hit per target per SCOPE. Default scope = this hitbox
      // instance (hb.hitSet, cleared when the box re-appears). 'swing' scope
      // (melee / special melee sheet boxes) uses the OWNER's swing-level set
      // instead — it survives box gaps mid-swing and is cleared only when the
      // swing ends (Hero.endNormalMelee / endSpecialMelee). Supermove bursts
      // keep the default: each burst IS a separate hit by design.
      const dedupeSet = hb.dedupeScope === 'swing' ? (hb.owner?._swingDedupeSet ?? hb.hitSet) : hb.hitSet;
      if (dedupeSet.has(t)) continue;         // already struck this scope
      if (!layers.includes(t.layer)) continue; // team routing

      const tb = t.worldBox ? t.worldBox() : { x: t.x, y: t.y, w: t.w, h: t.h };
      if (!aabbOverlap(hb.box, tb)) continue;

      // Skip hero if invincible or mid-death.
      if (t.layer === LAYER.HERO) {
        if (t.invincible) continue;
        if (t.dying) continue;
      }

      // Knockback is a VECTOR on the hitbox (hb.knockback = { x, y } px/s).
      // Direction follows dirMode: 'alongVelocity' rides the owner's live
      // velocity; 'fixed' uses the vector as-is (the macro owns direction —
      // e.g. dashCombo always pushes along the committed dash); otherwise it
      // points source-center → target-center. The unified resolver applies it
      // via applyKnockback() after damage — same single choke point every
      // other path uses. Hero victims keep their own reaction path (takeHit)
      // — this only shoves enemy/boss/solid targets.
      // Knockback is a VECTOR on the hitbox, in TWO tiers: `knockbackModerate`
      // (surviving hit — keeps the victim in reach) and `knockbackBig` (kill /
      // finisher launch). Direction follows dirMode: 'alongVelocity' rides the
      // owner's live velocity; 'fixed' uses the vector as-is; otherwise it
      // points source-center → target-center. The unified resolver applies the
      // chosen vector via applyKnockback() after damage. Hero victims keep
      // their own reaction path (takeHit) — this only shoves enemy/boss/solid.
      let kbVector = null;
      if (t.layer !== LAYER.HERO && (hb.knockbackBig || hb.knockback)) {
        // Pick the tier: BIG when this is the finisher frame OR the hit kills
        // (we don't know that yet pre-applyHit, so we default to the box's
        // declared tier and UPGRADE to big post-applyHit if it was a kill).
        // For simplicity + correctness: compute BOTH oriented vectors now,
        // pass moderate to applyHit, and if the result destroyed the target
        // (and target is an enemy, not a barrel) re-apply the delta to reach
        // the big vector. Barrels get their own fuse path (no big launch).
        const orient = (kb) => {
          if (!kb) return null;
          if (kb.dirMode === 'fixed') {
            return { x: kb.x ?? 0, y: kb.y ?? 0, hitstun: kb.hitstun, iFrames: kb.iFrames };
          } else if (kb.dirMode === 'alongVelocity') {
            const len = Math.hypot(hb.owner?.vx || 0, hb.owner?.vy || 0) || 1;
            const nx = (hb.owner?.vx || 0) / len;
            // A horizontal lunge has ny≈0, which would multiply the loft (y)
            // away entirely — the pop must stay UPWARD regardless of the
            // owner's travel direction. Only x rides the velocity direction.
            return { x: nx * (kb.x ?? 0), y: kb.y ?? 0, hitstun: kb.hitstun, iFrames: kb.iFrames };
          } else {
            // 'fromAttacker' or 'radial': source center → target center.
            const scx = hb.owner.x + (hb.owner.w || 0) / 2;
            const scy = hb.owner.y + (hb.owner.h || 0) / 2;
            const dx = (tb.x + tb.w / 2) - scx, dy = (tb.y + tb.h / 2) - scy;
            const len = Math.hypot(dx, dy) || 1;
            const nx = dx / len, ny = dy / len;
            return { x: nx * (kb.x ?? 0), y: ny * (kb.y ?? 0), hitstun: kb.hitstun, iFrames: kb.iFrames };
          }
        };
        const bigVec = orient(hb.knockbackBig);
        const modVec = orient(hb.knockbackModerate) ?? bigVec;
        // Start with the box's declared tier: finisher frames use big,
        // non-finisher bursts use moderate. A kill upgrades moderate→big below.
        kbVector = hb.finisher ? bigVec : modVec;
      }

      // Route damage through the unified resolver (unified-hit-resolution §3).
      // applyHit() validates, checks team eligibility, routes by target class
      // (takeDamage → hit → central damage()), fires target.onHit(context,
      // result), and applies the knockback vector (context.knockback) through
      // the single applyKnockback() choke point.
      const provenance = METHOD_PROVENANCE[hb.method] ?? AttackProvenance.MELEE;
      const pipeline = typeof t.takeDamage === 'function';
      const res = applyHit({
        provenance,
        source: hb.owner,
        target: t,
        damage: hb.damage,
        team: TEAM_CONST[hb.team] ?? Team.NEUTRAL,
        knockback: kbVector,
        method: hb.method,
        // Impact freeze (SF2-style): declared on the attack's box data, fired
        // by applyHit only when this hit actually connects.
        hitstop: hb.hitstop,
      });
      const dealt = res.accepted ? res.dealt : 0;


      // KILL = STAR TREATMENT: when this hit kills an enemy (not barrel), it
      // gets the EXACT mario-star payoff — no divergence:
      //   - big launch at ignoreResist (weight skipped: "your kick, not physics")
      //   - victim.intangible = true (corpse ghosts through terrain, clears field;
      //     cleared at despawn in enemyUpdate)
      //   - screen shake
      // applyHit's `res.destroyed` is UNRELIABLE for enemies (takeDamage restores
      // alive=true for the death anim), so detect the kill directly: hp<=0 or
      // aiState flipped to 'dead'. The moderate vector was ALREADY applied by
      // applyHit (respecting weight); we add the DELTA to land exactly on the
      // ignoreResist big vector, then ghost + shake.
      const justKilled = t.layer !== LAYER.HERO && !isBarrelTarget(t)
        && ((typeof t.hp === 'number' && t.hp <= 0) || t.aiState === 'dead');
      if (justKilled && hb.knockbackBig) {
        const bigVec = _orientStored(hb, t, tb, hb.knockbackBig);
        // Current velocity already includes the moderate shove (÷ resist). To
        // reach the ignoreResist big vector, subtract what's there and add the
        // full big value. Read pre-kill vx/vy is stale post-applyHit, so use the
        // oriented moderate as the "already applied" amount when available.
        const modVec = hb.knockbackModerate ? _orientStored(hb, t, tb, hb.knockbackModerate) : null;
        const resist = t.knockbackResist ?? 1;
        if (bigVec) {
          const appliedX = modVec ? (modVec.x / resist) : 0;
          const appliedY = modVec ? (modVec.y / resist) : 0;
          applyKnockback(t, {
            x: bigVec.x - appliedX,
            y: bigVec.y - appliedY,
            hitstun: bigVec.hitstun ?? 0,
            ignoreResist: true,
          });
        }
        t.intangible = true; // star-style ghost flight until despawn
        Effects.triggerShake(KILL_SHAKE);
      }
      // Non-fatal finisher frames (supermove ender) shake at the connect tier
      // (4) — same as any other landed hit; only kills escalate to 6.

      // TRACE (temporary): what velocity does the victim actually get after a hero hit?
      if (t.layer !== LAYER.HERO) {
        console.log(`[kb] ${t.type ?? t.constructor?.name} kb=${JSON.stringify(kbVector)} → vx=${(t.vx ?? 0).toFixed(0)} vy=${(t.vy ?? 0).toFixed(0)} y=${(t.y ?? 0).toFixed(0)} grounded=${!!t._grounded}`);
      }

      if (dealt > 0) {
        dedupeSet.add(t);
        // Hero hit reaction — only flinch/stun if actual energy was lost
        // (shield-only absorption = no reaction, shield pulse is enough).
        if (t.layer === LAYER.HERO && (t._lastEnergyLost ?? 0) > 0) {
          t.takeHit({ source: hb.method, dirX: 0, dirY: 0 });
        }
        // Hit juice lives in the ENGINE, not in host callbacks: every caller
        // of processHitboxes (gameplay hitbox registry AND attack primitives
        // like meleeHitbox/beam/spike) gets the same reaction. Blood sparkles
        // on melee-family connects; shake + flash on everything else. Pipeline
        // targets already flashed themselves inside takeDamage()/hit() — the
        // engine must not double-set or INVENT a flash for non-pipeline
        // placeholders (hitFlashOwnership contract), so the shake (which
        // bumps hitFlash) runs only for pipeline targets.
        if (t.layer !== LAYER.HERO && pipeline) {
          // Normal melee gets the subtle 2px twitch; every other connect gets
          // the standard 4px kick; kills merge up to 6 via the max-kick rule.
          Effects.triggerShake(hb.method === 'melee' ? MELEE_CONNECT_SHAKE : CONNECT_SHAKE);
          if (BLOOD_METHODS.has(hb.method)) {
            const tb = t.worldBox ? t.worldBox() : t;
            Effects.spawnHitSparkles(tb.x + tb.w / 2, tb.y + tb.h / 2);
          }
          Effects.beginEnemyShake(t);
        }
        if (onHit) onHit(hb, t, dealt);
      }
    }
  }
}

/** Simple AABB overlap test. */
function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}
