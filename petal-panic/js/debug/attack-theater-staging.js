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

const GROUND_Y = 400;
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
      // The attacker hovers on a platform; the target walks left. The macro
      // tracks → locks → fires a sustained beam through the locked point.
      return tagged(elevatedShooter(t, 'walkLeft'), STAGING.targetedBeam);
    },
    update: walkLeftUpdate,
  },

  sweepingBeam: {
    setup(t) {
      // Sweeping Beam macro demo: the attacker is on the platform; the target
      // strafes so the sweep visibly catches (or misses) it during the move.
      return tagged(elevatedShooter(t, 'strafe'), STAGING.sweepingBeam);
    },
    update: strafeUpdate,
  },
  laneSequence: {
    setup(t) {
      // Lane Sequence: target stands in the middle; attacks sweep across lanes.
      t._target.x = VIEW_W / 2 - 16;
      t._target.y = GROUND_Y - 48;
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
      t._target.vx = -160;
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
      if (chosen !== 'enemy' && chosen !== 'projectile') {
        t._params.spawnType = 'bomb';
        t._params.bomb = { arc: 700, bounce: true, ttl: 1.5, damage: 25, radius: 60, explodeOnContact: true };
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

  stomp: {
    setup(t) {
      // Stomp demo: FOUR victims, EVERY ONE standing on a surface (no enemy
      // floats in empty sky). Proves the circular radius is POSITIONAL, not
      // surface-bound: ground victim INSIDE the radius (hit), TWO on a mid-air
      // platform INSIDE the radius (both hit — airborne but in the circle),
      // one on a HIGH platform ABOVE the radius (untouched). Each victim sits
      // on its own visible platform so the staging reads as intentional.
      const cx = t._attacker.x + t._attacker.w / 2;
      const midTop = GROUND_Y - 60;   // mid-air platform → victims ~66px above impact center (inside r90)
      const highTop = GROUND_Y - 250; // high platform → victim far above the blast circle
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
        new Enemy(STOMP_VIC_DEF, cx + 70, GROUND_Y - 28),   // ground (floor)
        new Enemy(STOMP_VIC_DEF, cx - 50, midTop - 28),      // mid #1 (on platform)
        new Enemy(STOMP_VIC_DEF, cx + 30, midTop - 28),      // mid #2 (on platform)
        new Enemy(STOMP_VIC_DEF, cx + 40, highTop - 28),     // high (on platform, safe)
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
    t._target.x = c.baseX - c.t * 160;
    t._target.vx = -160;
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
    t._target.x = c.baseX - c.t * 160; // steady leftward walk
    t._target.vx = -160;               // d/dt for the aim math
    t._target.vy = 0;
  } else if (!c.parked) {
    c.parked = true;
    t._target.x = TARGET_POS.x;
    t._target.vx = 0;
    t._target.vy = 0;
  }
  return false;
}
