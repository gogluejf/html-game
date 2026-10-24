// Petal Panic — Attack Theater per-attack STAGING (theater-cleanup #9).
//
// Declarative choreography for the debug Attack Theater. Each entry owns ONE
// attack's demo staging: param overrides, entity positioning, victim/platform
// staging (setup) and any movement-demo / gated-invoke behavior (update). The
// theater itself only positions entities and sets params — all COMBAT behavior
// comes from the engine (invoke() + handle stepping).
//
// Entry shape: { setup(theater), update?(theater, c, dt) }
//   - setup runs at replay time; returns the choreo state object (or null when
//     the attack needs no choreo). It tags the state with `stage` so the
//     theater can dispatch update() without a second lookup.
//   - update runs each fixed step while that choreo is active (movement demos,
//     gated invokes like punch/kamikaze, post-step contact blocks). Returning
//     true completes the choreo (the theater clears it).
//
// Pure reorganization of what used to be inline if/else branches in
// attack-theater.js — every position, speed, log message, and gate is
// preserved verbatim.

import { invoke } from '../combat/attack/engine.js';
import { makeContext } from '../combat/attack/context.js';
import { Enemy } from '../enemies/enemy.js';
import { Effects } from '../effects.js';
import { VIEW_W } from '../core/view.js';
import { ZONE_GROUND_Y } from '../world/level.js';

// Same floor as the theater + engine (level.js) — never a local guess.
const GROUND_Y = ZONE_GROUND_Y;
// Stomp-demo victim def: identical to the one the theater kept inline — a REAL
// base-class Enemy whose no-op ai() keeps staged victims standing still.
const STOMP_VIC_DEF = {
  id: 'stompVictim', name: 'Stomp Victim', w: 28, h: 28,
  stats: { stamina: 999, defense: 0, fly: false },
};
const ATTACKER_HOME = { x: 140, y: GROUND_Y - 48, w: 32, h: 48 };
const TARGET_POS = { x: 560, y: GROUND_Y - 48, w: 32, h: 48 };
const DT = 1 / 60;

/** Tag the choreo state with its stage entry so the theater can dispatch. */
function tagged(state, entry) {
  state.stage = entry;
  return state;
}

/** Shared elevated-shooter staging: attacker hovers on a platform high left. */
function elevatedShooter(t, kind) {
  const c = { [kind]: true, t: 0, baseX: TARGET_POS.x };
  t._attacker.x = 140;
  t._attacker.y = 150; // up on the platform
  t._attacker.facing = 1;
  return c;
}

export const STAGING = {
  mine: {
    setup(t) {
      // Sandbox enemy stands in for the hero; no inventory or hero recoil system.
      t._target.loseSelectedSpecial ??= () => {};
      t._target.takeHit ??= () => {};
      t._params.x = VIEW_W / 2;
      t._params.groundY = GROUND_Y;
      t._target.x = VIEW_W / 2 + 180;
      t._target.y = GROUND_Y - t._target.h;
      return tagged({ kind: 'mineContact' }, STAGING.mine);
    },
    update(t, c, dt) {
      // The mine demo context identifies this target as hero for foe mines.
      const walker = t._target;
      const dx = VIEW_W / 2 - (walker.x + walker.w / 2);
      walker.x += Math.sign(dx) * Math.min(Math.abs(dx), 90 * dt);
      return false;
    },
  },
  charge: {
    setup(t) {
      // Charge DASHES AT the target by default: face it, run until body
      // contact ends it. Respects user tweaks: if direction/duration were
      // adjusted in the panel, use those instead of the auto-aim defaults.
      const tCx = t._target.x + t._target.w / 2;
      if (!t._tweaks['charge']?.direction) {
        t._params.direction = t._attacker.x < tCx ? 0 : Math.PI;
      }
      if (!t._tweaks['charge']?.distanceType) {
        t._params.distanceType = 'infinit'; // run until out of screen (or contact below)
      }
      return tagged({ kind: 'chargeToTarget' }, STAGING.charge);
    },
    update(t, c) {
      // Post-step contact: end the dash when the bodies meet.
      const touching = t._attacker.x + t._attacker.w > t._target.x &&
        t._attacker.x < t._target.x + t._target.w &&
        t._attacker.y + t._attacker.h > t._target.y;
      if (!touching) return false;
      const dealt = t._target.takeDamage(t._params.damage ?? 20, t._attacker, 'contact');
      if (dealt > 0) {
        Effects.spawnHitSparkles(t._target.x + 16, t._target.y + 24, 8);
        t._log.unshift(`CHARGE HIT ${dealt} dmg`);
      }
      for (const h of t._handles) { if (h.id === 'charge') h._complete({ traveled: h.state?.traveled, blocked: false }); }
      t._handles = t._handles.filter((h) => h.id !== 'charge');
      return true;
    },
  },

  bodyContact: {
    setup(t) {
      // Body contact: the VICTIM walks into the attacker (like an enemy
      // shoving you) — opposite of charge, where the attacker moves. The
      // attacker's body is the weapon; the dummy closes the distance.
      return tagged({ kind: 'victimWalksIn', speed: 260 }, STAGING.bodyContact);
    },
    update(t, c, dt) {
      const gap = (t._target.x + t._target.w / 2) - (t._attacker.x + t._attacker.w / 2);
      // The dummy target walks toward the stationary attacker.
      if (Math.abs(gap) > t._target.w / 2 + 2) {
        t._target.x -= Math.sign(gap) * c.speed * DT;
      }
      // Overlap IS the attack. Route contact damage through the target's
      // pipeline with a per-hit cooldown (mirrors the gameplay CONTACT_COOLDOWN
      // rule).
      c.cd = Math.max(0, (c.cd ?? 0) - dt);
      const overlapping = t._attacker.x + t._attacker.w > t._target.x &&
        t._attacker.x < t._target.x + t._target.w &&
        t._attacker.y + t._attacker.h > t._target.y;
      if (overlapping && c.cd <= 0 && t._target.alive) {
        c.cd = 0.5;
        const dealt = t._target.takeDamage(t._params.damage ?? 20, t._attacker, 'contact');
        if (dealt > 0) {
          Effects.spawnHitSparkles(t._target.x + 16, t._target.y + 24, 6);
          t._log.unshift(`CONTACT ${dealt} dmg`);
        }
      }
      return false;
    },
  },

  meleeHitbox: {
    setup(t) {
      // Melee: start side by side, then throw a VISIBLE punch — the swing arc
      // sweeps out in sync with the live hitbox frames.
      return tagged({ kind: 'punch', dist: 56, done: false, swingFrame: 0 }, STAGING.meleeHitbox);
    },
    update(t, c) {
      const gap = (t._target.x + t._target.w / 2) - (t._attacker.x + t._attacker.w / 2);
      if (!c.done) {
        if (Math.abs(gap) > c.dist) {
          // Walk beside the target first.
          t._attacker.x += Math.sign(gap) * 420 * DT;
          t._attacker.facing = Math.sign(gap) || 1;
        } else {
          // Beside: throw the punch. The swing visual (drawn in draw()) is
          // driven by c.swingFrame, which advances here IN SYNC with the
          // live hitbox frames from the meleeHitbox handle.
          c.done = true;
          const mh = invoke('meleeHitbox', { ...t._params }, t._ctx());
          mh.on('hit', (i) => { t._log.unshift(`HIT ${i.dealt ?? ''} dmg`.trim()); });
          mh.on('complete', () => t._log.unshift('COMPLETE'));
          t._handles.push(mh);
          c.swingTotal = t._params.activeFrames ?? 10;
        }
      } else if (c.swingFrame < c.swingTotal) {
        c.swingFrame++;
      }
      return false;
    },
  },

  homingMissile: {
    setup(t) {
      // Homing demo: the target WEAVES (slow drift + jump bursts) trying to
      // dodge; the missile must visibly curve after it. Fires immediately.
      return tagged({ kind: 'dodgeWeave', t: 0, jumping: false, jumpT: 0, nextJump: 0.8 }, STAGING.homingMissile);
    },
    update(t, c, dt) {
      // Target drifts slowly left/right and periodically JUMPS (vertical burst
      // + pause) to try to shake the missile. The missile's visible re-curve
      // after each jump is the whole point of the demo. FINITE run: parks back
      // home after ~4s so the next demo is clean.
      c.t += dt;
      const base = TARGET_POS.x;
      if (c.t < 4) {
        t._target.x = base + Math.sin(c.t * 1.2) * 90;
        if (!c.jumping && c.t >= c.nextJump) {
          c.jumping = true; c.jumpT = 0;
        }
        if (c.jumping) {
          c.jumpT += dt;
          // Jump arc: up then down over ~0.7s (parabola), then a brief pause.
          const jt = c.jumpT / 0.7;
          if (jt < 1) t._target.y = TARGET_POS.y - Math.sin(jt * Math.PI) * 70;
          else if (jt < 1.4) t._target.y = TARGET_POS.y; // hang at apex end
          else { c.jumping = false; c.nextJump = c.t + 1.6; t._target.y = TARGET_POS.y; }
        }
      } else if (!c.parked) {
        c.parked = true;
        t._target.x = TARGET_POS.x;
        t._target.y = TARGET_POS.y;
      }
      return false;
    },
  },

  reticleShot: {
    setup(t) {
      // Reticle Shot macro demo: the ATTACKER hovers on a platform high to the
      // left; the target WALKS LEFT along the ground. The macro tracks → locks
      // → fires ONE shot at the locked point when duration ends. Staging only —
      // the composition itself lives in combat/attack/macros/reticleShot.js.
      return tagged(elevatedShooter(t, 'walkLeft'), STAGING.reticleShot);
    },
    update: walkLeftUpdate,
  },

  targetedBeam: {
    setup(t) {
      // Targeted Beam macro demo: same elevated-shooter staging as reticleShot.
      // The attacker hovers on a platform; the target walks right. The macro
      // tracks → locks → fires a sustained beam through the locked point.
      const c = elevatedShooter(t, 'walkLeft');
      c.baseX = 80;
      c.velocity = 160;
      t._target.x = c.baseX;
      t._target.vx = c.velocity;
      return tagged(c, STAGING.targetedBeam);
    },
    update: walkLeftUpdate,
  },

  sweepingBeam: {
    setup(t) {
      // Sweeping Beam macro demo: the attacker is on the platform; the target
      // walks left-to-right so it crosses the sweep during the move.
      const c = elevatedShooter(t, 'strafe');
      c.baseX = 80;
      c.velocity = 160;
      t._target.x = c.baseX;
      t._target.vx = c.velocity;
      return tagged(c, STAGING.sweepingBeam);
    },
    update: strafeUpdate,
  },
  laneSequence: {
    setup(t) {
      // Two occupied rows, using the same real Enemy/platform lifecycle as stomp.
      t._target.x = VIEW_W / 2 - t._target.w / 2;
      t._target.y = GROUND_Y - t._target.h;
      const top = GROUND_Y - t._params.laneOffset - t._params.laneSpacing;
      const x = VIEW_W / 2 - STOMP_VIC_DEF.w / 2;
      t._stompPlatforms = [{ x: x - 12, y: top, w: STOMP_VIC_DEF.w + 24 }];
      t._stompVics = [new Enemy(STOMP_VIC_DEF, x, top - STOMP_VIC_DEF.h)];
      for (const v of t._stompVics) t._world.add(v);
      return tagged({ kind: 'laneSequence' }, STAGING.laneSequence);
    },
  },

  predictiveShot: {
    setup(t) {
      // Predictive demo: the ATTACKER hovers on a platform high to the left;
      // the target WALKS LEFT along the ground. One shot is fired at the
      // PREDICTED position (intercept point from bullet speed) — no reticle,
      // no aim marker: you judge success by watching the bullet arrive where
      // the walker is ABOUT to be. The macro fires the shot itself at invoke;
      // the strafe velocity just needs to exist when that happens.
      const c = elevatedShooter(t, 'strafe');
      // Give the walker its real velocity BEFORE the invoke so the intercept
      // math has something to lead against (the choreo keeps moving it).
      t._target.vx = c.velocity ?? -160;
      t._target.vy = 0;
      return tagged(c, STAGING.predictiveShot);
    },
    update: strafeUpdate,
  },

  radialShot: {
    setup(t) {
      // Radial Shot demo: the ATTACKER hovers on a platform high to the left;
      // the target WALKS LEFT along the ground. The ring fires around the
      // attacker's body — you watch bolts leave in every direction and see
      // which ones catch the walker. Bump sequenceInterval in the param list
      // to sweep the ring bolt-by-bolt (the boss pattern). Same staging
      // family as reticleShot/predictiveShot.
      return tagged(elevatedShooter(t, 'strafe'), STAGING.radialShot);
    },
    update: strafeUpdate,
  },

  burstShot: {
    setup(t) {
      // Burst Shot demo: the ATTACKER hovers on a platform high to the left;
      // the target WALKS LEFT along the ground. The burst fires its group at
      // a DIAGONAL angle — you watch 3+ volleys leave one after another and
      // judge the intra-burst interval by eye. Bump count/interval in the
      // param list for M16-style fire groups. Same staging family as the
      // other elevated shooters.
      return tagged(elevatedShooter(t, 'strafe'), STAGING.burstShot);
    },
    update: strafeUpdate,
  },

  orbit: {
    setup(t) {
      // Orbit demo: the ATTACKER walks up to the target so the satellites
      // sweep through its body. Space toggles eject (when ejectable).
      t._params.ejectable = true; // sandbox always allows the eject demo
      return tagged({ kind: 'walkToTarget', speed: 120, ejected: false }, STAGING.orbit);
    },
    update(t, c) {
      // Attacker walks toward the target so satellites sweep through its body.
      // When every live orbit ring is gone (ejected / ttl), WALK BACK home —
      // additive replay never resets position, so without this the attacker
      // stays parked at the target for all following demos.
      const gap = (t._target.x + t._target.w / 2) - (t._attacker.x + t._attacker.w / 2);
      const orbitsLive = t._handles.some((h) => h.id === 'orbit');
      if (!orbitsLive) {
        if (Math.abs(gap) > 4) {
          t._attacker.x -= Math.sign(gap) * c.speed * DT;
          t._attacker.facing = -Math.sign(gap) || -1;
        } else {
          t._attacker.x = ATTACKER_HOME.x;
          t._attacker.y = ATTACKER_HOME.y;
          t._attacker.facing = 1;
          return true; // choreo complete
        }
      } else if (Math.abs(gap) > 26) {
        t._attacker.x += Math.sign(gap) * c.speed * DT;
        t._attacker.facing = Math.sign(gap) || 1;
      }
      return false;
    },
  },

  bodyExplosion: {
    setup(t) {
      // Kamikaze demo: the attacker WALKS to the target, then vanishes and
      // explodes ON IT. No standing-around payload pre-fire.
      return tagged({ kind: 'kamikaze', speed: 200, exploded: false }, STAGING.bodyExplosion);
    },
    update(t, c) {
      // Self-destruct demo: attacker walks to the target, then VANISHES and
      // explodes on it. The explosion payload was pre-aimed at the target.
      if (c.exploded) return false;
      const gap = (t._target.x + t._target.w / 2) - (t._attacker.x + t._attacker.w / 2);
      if (Math.abs(gap) > 20) {
        t._attacker.x += Math.sign(gap) * c.speed * DT;
        t._attacker.facing = Math.sign(gap) || 1;
        return false;
      }
      // Contact: trigger the body explosion NOW (payload blast centered
      // on the target), and hide the attacker body — it IS the bomb.
      c.exploded = true;
      t._attackerVisible = false;
      // Real Enemy body at the attacker's position (the bomb IS its body):
      // takeDamage() runs the actual pipeline, and killAttacker() inside
      // the macro routes through it. Base-class Enemy → no-op ai().
      const victim = new Enemy(STOMP_VIC_DEF, t._attacker.x, t._attacker.y);
      const kh = invoke('bodyExplosion', { ...t._params }, makeContext(victim, { world: { targets: [t._target] }, target: t._target, pools: t._pools, collisionWorld: t._world, effects: Effects }));
      kh.on('hit', (i) => t._log.unshift(`HIT ${i.dealt ?? ''} dmg`.trim()));
      kh.on('detonate', () => t._log.unshift('KAMIKAZE BOOM'));
      kh.on('complete', () => t._log.unshift('COMPLETE'));
      // The default payload (explosion) resolves SYNCHRONOUSLY: finish() emits
      // detonate/complete DURING invoke(), before the listeners above exist.
      // Replay the terminal state so the demo log still reads correctly.
      if (kh._completed) { t._log.unshift('KAMIKAZE BOOM'); t._log.unshift('COMPLETE'); }
      t._handles.push(kh);
      return false;
    },
  },

  explosion: {
    setup(t) {
      // Explosion demo: the ATTACKER detonates on itself — the blast is
      // centered on the attacker's body and it vanishes (same read as
      // spawnSplit: the body IS the attack). The target takes the blast.
      t._params.x = t._attacker.x + t._attacker.w / 2;
      t._params.y = t._attacker.y + t._attacker.h / 2;
      return tagged({ kind: 'vanishOnReplay' }, STAGING.explosion);
    },
    update(t) {
      // The attacker disappears the instant the blast happens (it BECOMES the
      // explosion).
      t._attackerVisible = false;
      return false;
    },
  },

  spawnSplit: {
    setup(t) {
      // Split demo: default to ballistic bombs that arc down, bounce off the
      // ground, and detonate. But if the user explicitly retuned spawnType
      // (projectile/enemy) via the param list, honor that — don't clobber it.
      const chosen = t._params.spawnType;
      if (chosen !== 'enemy' && chosen !== 'projectile' && chosen !== 'mine') {
        t._params.spawnType = 'bomb';
        t._params.bomb = { arc: 700, bounce: true, ttl: 1.5, damage: 25, radius: 60, explodeOnContact: true };
      }
      // Enemy children are THROWN (throwEnemy): ensure a nested config exists
      // so the theater's dotted tweaks (enemy.ttl / enemy.mineType) have a
      // home, without clobbering user choices. Reset enemyType to the split
      // default so it doesn't carry over from a throwEnemy session.
      if (chosen === 'enemy') {
        if (!t._params.enemy) t._params.enemy = {};
        if (!t._tweaks.spawnSplit?.enemyType) t._params.enemyType = 'explosive_monkey';
      }
      // centerDirection + angle come from SANDBOX_PRESETS (the demo fan) and are
      // user-tweakable — do NOT reset them here or every replay clobbers the choice.
      t._params.x = t._attacker.x + t._attacker.w / 2;
      t._params.y = t._attacker.y + 10;
      return tagged({ kind: 'vanishOnReplay' }, STAGING.spawnSplit);
    },
    update(t) {
      // Spawn/split demo: the attacker disappears the instant the split
      // happens (it BECOMES the bombs).
      t._attackerVisible = false;
      return false;
    },
  },

  throwEnemy: {
    setup(t) {
      // Throw Enemy demo: the ATTACKER stands at home (left) and throws the
      // monkey in a ballistic arc toward the TARGET (right). The carrier lands
      // (bomb layer), becomes a real enemy, walks to the target, and detonates
      // on contact. Foe team + hero staging: the sandbox target stands in for
      // the hero so foe-aligned contact semantics resolve against it.
      t._params.origin = { x: t._attacker.x + t._attacker.w / 2, y: t._attacker.y + 8 };
      const dx = (t._target.x + t._target.w / 2) - (t._attacker.x + t._attacker.w / 2);
      if (!t._tweaks.throwEnemy?.direction) t._params.direction = -0.35; // up-right lobe
      if (!t._tweaks.throwEnemy?.speed) t._params.speed = Math.min(700, Math.max(380, dx * 0.9));
      // Foe-aligned blasts only hit ctx.world.hero — stage the dummy AS the
      // hero reference for this run (same pattern as the mine demo). The
      // context is rebuilt every frame from entries[index], so this holds for
      // the whole throwEnemy run.
      if (t._params.team === 'foe') {
        t._target.loseSelectedSpecial ??= () => {};
        t._target.takeHit ??= () => {};
        t._ctxHeroOverride = t._target;
      }
      return tagged({ kind: 'throwEnemy' }, STAGING.throwEnemy);
    },
    update(t) {
      // Static staging — the macro owns flight → landing → walk → detonate.
      return false;
    },
  },

  stomp: {
    setup(t) {
      // Stomp demo: FOUR victims, EVERY ONE standing on a surface (no enemy
      // floats in empty sky). Proves the impact is POSITIONAL + SURFACE-AWARE:
      // ground victim INSIDE the blast (hit), TWO on a mid-air platform INSIDE
      // the radius (both hit — airborne but in the circle), one on a HIGH
      // platform ABOVE the radius (untouched). Each victim sits on its own
      // visible platform so the staging reads as intentional.
      // The default 'strike' mode burns ALL surfaces in the span, so the
      // high-platform victim also takes the strike — switch to 'radius' in
      // the panel to see it go safe again.
      const cx = t._attacker.x + t._attacker.w / 2;
      const midTop = GROUND_Y - 60;   // mid-air platform → victims ~66px above impact center (inside r590)
      const highTop = GROUND_Y - 250; // high platform → victim far above the old r90 circle
      // Mid platform hugs BOTH mid-air victims: span from the left edge of #1
      // to the right edge of #2, with a small pad on each side — no ugly long
      // tail. High platform does the same for its single safe victim.
      const midL = cx - 50, midR = cx + 30 + 28;          // victim extents
      const hiX = cx + 40, hiW = 28;
      t._stompPlatforms = [
        { x: midL - 12, y: midTop, w: (midR - midL) + 24 },
        { x: hiX - 12, y: highTop, w: hiW + 24 },
      ];
      t._stompVics = [
        new Enemy(STOMP_VIC_DEF, cx - 130, GROUND_Y - 28), // LEFT of attacker on the floor (wave/strike coverage)
        new Enemy(STOMP_VIC_DEF, cx + 70, GROUND_Y - 28),   // ground (floor)
        new Enemy(STOMP_VIC_DEF, cx - 50, midTop - 28),      // mid #1 (on platform)
        new Enemy(STOMP_VIC_DEF, cx + 30, midTop - 28),      // mid #2 (on platform)
        new Enemy(STOMP_VIC_DEF, cx + 40, highTop - 28),     // high (on platform, safe vs radius)
      ];
      for (const v of t._stompVics) t._world.add(v);
      return tagged({ kind: 'stompStage' }, STAGING.stomp);
    },
    // Static staging — the macro owns the whole sequence (telegraph → hop →
    // impact/waves). Nothing to move.
  },

  stompWave: {
    setup(t) {
      // Stomp Wave demo: exactly TWO victims, both on the ground, ONE PER SIDE
      // of the centered attacker. No air victims: waves ride surfaces, so each
      // wave visibly catches its own side victim.
      const cx = (t._attacker.x = 400) + t._attacker.w / 2; // center stage
      t._stompVics = [
        new Enemy(STOMP_VIC_DEF, cx - 130, GROUND_Y - 28),
        new Enemy(STOMP_VIC_DEF, cx + 102, GROUND_Y - 28),
      ];
      t._stompPlatforms = [];
      for (const v of t._stompVics) t._world.add(v);
      return tagged({ kind: 'stompStage' }, STAGING.stompWave);
    },
    // Static staging — the macro owns the whole sequence (telegraph → hop →
    // waves). Nothing to move.
  },

  surfaceStrike: {
    setup(t) {
      // Surface Strike demo: a WIDE platform spans the strike's default x, and
      // the floor runs under it. The strike burns EVERY surface in its span —
      // platform top AND floor — so victims on both take damage; only the one
      // outside the right edge of the span survives. Victims spawn 2px ABOVE
      // each surface face so the theater's one-way resolve() lands them cleanly
      // instead of pushing them off mid-demo.
      const platTop = GROUND_Y - 70;
      const platX = 330, platW = 340; // spans 330..670; default x=508 is inside
      t._params.x = 508;
      t._params.y = platTop;
      t._stompPlatforms = [{ x: platX, y: platTop, w: platW }];
      t._stompVics = [
        new Enemy(STOMP_VIC_DEF, 420, platTop - 28 - 2),   // on platform, inside span → HIT
        new Enemy(STOMP_VIC_DEF, 560, platTop - 28 - 2),   // on platform, inside span → HIT
        new Enemy(STOMP_VIC_DEF, 640, platTop - 28 - 2),   // on platform, OUTSIDE right edge → safe
        new Enemy(STOMP_VIC_DEF, 480, GROUND_Y - 28 - 2),  // on the FLOOR under the platform → HIT (all surfaces burn)
      ];
      for (const v of t._stompVics) t._world.add(v);
      return tagged({ kind: 'stompStage' }, STAGING.surfaceStrike);
    },
    // Static staging — the primitive owns the hot window. Nothing to move.
  },

  skyMissile: {
    setup(t) {
      // Sky Missile demo: stage a SMALL platform under part of the drop column
      // so the column-resolution behavior is visible — the marker lands on the
      // platform top, not the floor below (doc §22 demo rule). The target
      // stands on the ground at the default drop x; moving the x param onto
      // the platform span shows the impact climbing up to it.
      const platX = TARGET_POS.x - 40;
      const platTop = GROUND_Y - 70;
      t._stompPlatforms = [{ x: platX, y: platTop, w: 110 }];
      return tagged({ kind: 'stompStage' }, STAGING.skyMissile);
    },
    // Static staging — the macro owns warning → drop.
  },

  skyDiveStomp: {
    setup(t) {
      // Sky Dive Stomp demo — ONE body. The attacker IS the diver: it walks
      // off-screen (it's "in the sky"), then the SAME body drops in from above
      // the marker, lands, stomps, lingers, and blinks out. No second box, no
      // idle stand-in. Two victims flank the impact column so each stomp wave
      // visibly catches its own side.
      const cx = VIEW_W / 2;
      t._params.x = cx;
      t._params.groundY = GROUND_Y;
      t._target.x = cx + 130;
      t._target.y = GROUND_Y - t._target.h;
      t._stompVics = [new Enemy(STOMP_VIC_DEF, cx - 130 - 28, GROUND_Y - 28)];
      for (const v of t._stompVics) t._world.add(v);
      t._stompPlatforms = [];
      // Attacker at home, visible, facing left (walks off the left edge).
      t._attacker.x = ATTACKER_HOME.x;
      t._attacker.y = ATTACKER_HOME.y;
      t._attacker.facing = -1;
      t._attackerVisible = true;
      return tagged({ kind: 'skyDiveWalkOff', t: 0, phase: 'walkOff', speed: 260 }, STAGING.skyDiveStomp);
    },
    update(t, c, dt) {
      // Phase 1 — walk off the left edge, then hide (it's in the sky now) and
      // fire the attack. The invoke is GATED here (theater skips auto-invoke for
      // this kind) so the marker/drop only start AFTER the enemy has left.
      if (c.phase === 'walkOff') {
        t._attacker.x -= c.speed * DT;
        t._attacker.facing = -1;
        if (t._attacker.x + t._attacker.w < -40 && !c.invoked) {
          c.invoked = true;
          t._attackerVisible = false; // out of the collision world + not drawn
          c.phase = 'diving';
          t._log.unshift('ENEMY LEFT (sky)');
          const h = invoke('skyDiveStomp', { ...t._params, target: t._target }, t._ctx());
          h.on('hit', (i) => t._log.unshift(`HIT ${i.dealt ?? ''} dmg`.trim()));
          h.on('complete', () => t._log.unshift('COMPLETE'));
          t._handles.push(h);
        }
        return false;
      }
      // Phase 2 — hidden while the marker shows, then the SAME attacker body
      // becomes the falling diver (driven by the macro's state.diverY). On
      // impact it snaps onto the ground and reappears; on the blink-out it
      // hides again. The theater draws this one body from _attacker.x/y.
      if (c.phase === 'diving') {
        const h = t._handles.find((x) => x.id === 'skyDiveStomp');
        if (!h || h.state?.done) return false; // macro finished; leave it
        const s = h.state;
        if (s.phase === 'warning') {
          // Still in the sky — stay hidden while the marker warns the spot.
          return false;
        }
        if (s.phase === 'drop') {
          // The attacker IS the diver: place its body at the macro's fall pos.
          t._attackerVisible = true;
          t._attacker.x = s.impact.x - t._attacker.w / 2;
          t._attacker.y = s.diverY;
          return false;
        }
        // Landed (waves/linger/vanish): sit on the impact point.
        if (!c.landed) {
          c.landed = true;
          t._attacker.x = s.impact.x - t._attacker.w / 2;
          t._attacker.y = s.impact.y - t._attacker.h;
          t._attackerVisible = true;
          t._log.unshift('LANDED');
        }
        // During the blink-out, HIDE the real body — the blink-transition
        // effect IS the enemy now (it alternates its color / nothing). Drawing
        // both would layer a second box over it.
        if (s.phase === 'vanish') {
          t._attackerVisible = false;
          if (!c.vanishedLogged) { c.vanishedLogged = true; t._log.unshift('VANISHED'); }
        }
        return false;
      }
      return false;
    },
  },

  missileRain: {
    setup(t) {
      // Missile Rain demo: the rain centers on the view middle and spreads
      // across the ground — the target stands under part of the pattern. No
      // platform staging: every drop column resolves to the floor here, which
      // is the readable default case (skyMissile's own demo covers platforms).
      t._params.xCoordinate = VIEW_W / 2;
      return tagged({ kind: 'stompStage' }, STAGING.missileRain);
    },
    // Static staging — the macro owns launch burst → per-missile activation.
  },

  dashCombo: {
    setup(t) {
      // Dash Combo demo: attacker starts at HOME (left), dashes right AT the
      // dummy. Target is staged close enough that the freeze hitboxes connect
      // (the dash travels ~235px from home; hitbox reaches ~+38px past body).
      t._attacker.x = ATTACKER_HOME.x;
      t._attacker.y = ATTACKER_HOME.y;
      t._attacker.facing = 1;
      t._target.x = ATTACKER_HOME.x + 60; // right next to the attacker
      t._target.y = TARGET_POS.y;
      return tagged({ kind: 'dashStage' }, STAGING.dashCombo);
    },
    // Static staging — the macro owns the whole timeline.
  },

  dustZone: {
    setup(t) {
      // Dust Zone demo: attacker stands near the cloud, target is INSIDE it.
      // The cloud is at x=ATTACKER_HOME.x+80, so put the target dead center.
      t._attacker.x = ATTACKER_HOME.x - 40; // just left of the cloud
      t._attacker.y = ATTACKER_HOME.y;
      t._attacker.facing = 1;
      t._target.x = t._params.x; // center of the zone
      // Target rests ON the ground — the zone's y param is its CENTER, so
      // bottom-align the target to GROUND_Y (not the zone center) or it
      // floats a few pixels above the floor.
      t._target.y = GROUND_Y - t._target.h;
      return null; // no choreo — static staging only
    },
  },
};

// --- Shared movement-demo updates ---------------------------------------------

/**
 * ReticleShot/TargetedBeam staging: target WALKS LEFT at constant speed. The
 * macro owns track → lock → fire; this only moves the dummy. FINITE run: parks
 * after ~3s so the next demo starts clean. The dummy also HITS when the bullet
 * overlaps it — its body vanishes on impact and respawns home when the run ends
 * (the "target disappears" read).
 */
function walkLeftUpdate(t, c, dt) {
  c.t += dt;
  if (c.t < 3) {
    t._target.x = c.baseX + c.t * (c.velocity ?? -160);
    t._target.vx = c.velocity ?? -160;
    t._target.vy = 0;
  } else if (!c.parked) {
    c.parked = true;
    t._target.x = TARGET_POS.x;
    t._target.vx = 0;
    t._target.vy = 0;
    // Respawn the dummy (it may have been killed by the bullet): full HP,
    // visible again at home.
    t._target.hp = 999;
    t._target.alive = true;
  }
  return false;
}

/**
 * Predictive/Sweeping/Radial/Burst staging: target WALKS LEFT at constant
 * speed (real velocity, so the lead math has something to predict). FINITE
 * run: after ~3s it parks back home so the next demo starts from a clean scene.
 */
function strafeUpdate(t, c, dt) {
  c.t += dt;
  if (c.t < 3) {
    t._target.x = c.baseX + c.t * (c.velocity ?? -160); // configured walk direction
    t._target.vx = c.velocity ?? -160;               // d/dt for the aim math
    t._target.vy = 0;
  } else if (!c.parked) {
    c.parked = true;
    t._target.x = TARGET_POS.x;
    t._target.vx = 0;
    t._target.vy = 0;
  }
  return false;
}
