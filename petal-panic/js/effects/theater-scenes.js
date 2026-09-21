// Petal Panic — Theater Scenes (debug-only).
// Real carrier objects + scene definitions for the Effect Theater.
// NOT loaded in gameplay — only imported by theater.js.

import { fireManual, resetEffects, updateEffects, drawEffects, DEMO_VIEW, CATALOG } from './index.js';
import { particles } from '../particles.js';

const STAGE_X = 160, STAGE_Y = 90;
const BOX = { x: STAGE_X - 20, y: STAGE_Y - 25, w: 40, h: 50 };
const DEMO_DT = 1 / 60;

// Effects whose visual lives in the SHARED particle pool (one-shot bursts).
const POOL_DRIVEN = new Set(['particle-burst', 'explosion', 'debris', 'dust-cloud', 'composite-explosion']);
// State effects with no canvas render (render() is a no-op).
const SHAKE_PROXY = new Set(['camera-shake']);

// --- Scene carriers ---------------------------------------------------------
// Real carrier objects that expose origin()/facing()/size(). The effect engine
// reads these through its normal update() path — no feed hacks, no bypassing
// internal logic. Each scene can define its own carrier behavior.

/** A static point carrier (for position-anchored effects). */
function pointCarrier(x, y) {
  return { origin: () => ({ x, y }), facing: () => 0, size: () => ({ w: 0, h: 0 }) };
}

/** A moving projectile carrier (flies left-to-right at given speed). */
function projectileCarrier(startX, y, speed) {
  const c = { _x: startX, _y: y, _speed: speed };
  c.origin = () => ({ x: c._x, y: c._y });
  c.facing = () => 0;
  c.size = () => ({ w: 24, h: 12 });
  c.update = (dt) => { c._x += c._speed * dt; };
  // Draw a small rect so you can see the "projectile"
  c.draw = (ctx) => {
    ctx.fillStyle = '#aab';
    ctx.fillRect(c._x - 12, c._y - 6, 24, 12);
    ctx.strokeStyle = '#889';
    ctx.lineWidth = 1;
    ctx.strokeRect(c._x - 12, c._y - 6, 24, 12);
  };
  return c;
}

/** A stationary target/enemy box (sits at a fixed position). */
function enemyBox(x, y, w = 32, h = 40) {
  const c = { _hitFlash: 0 };
  c.origin = () => ({ x: x + w / 2, y: y + h / 2 });
  c.facing = () => Math.PI; // facing left
  c.size = () => ({ w, h });
  c.hitFlash = 0;
  c.update = (dt) => { if (c.hitFlash > 0) c.hitFlash -= dt; };
  c.draw = (ctx) => {
    ctx.fillStyle = c.hitFlash > 0 ? 'rgba(255,100,100,0.6)' : 'rgba(100,150,255,0.4)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#6af';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ENEMY', x + w / 2, y + h / 2 + 3);
  };
  return c;
}

/** A hero-like entity (for aura, afterimage, trail on self). */
function heroEntity(startX, y, speed) {
  const c = { _x: startX, _y: y, _speed: speed, hitFlash: 0 };
  c.origin = () => ({ x: c._x, y: c._y });
  c.facing = () => 0;
  c.size = () => ({ w: 28, h: 36 });
  c.update = (dt) => { c._x += c._speed * dt; if (c.hitFlash > 0) c.hitFlash -= dt; };
  c.draw = (ctx) => {
    ctx.fillStyle = c.hitFlash > 0 ? 'rgba(255,200,100,0.7)' : 'rgba(255,220,100,0.5)';
    ctx.fillRect(c._x - 14, c._y - 18, 28, 36);
    ctx.strokeStyle = '#fc0';
    ctx.lineWidth = 1;
    ctx.strokeRect(c._x - 14, c._y - 18, 28, 36);
    ctx.fillStyle = '#fff';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('HERO', c._x, c._y + 3);
  };
  return c;
}

// --- Scene definitions ------------------------------------------------------
// Each scene returns { carriers, fire, draw } where:
//   carriers: array of carrier objects (updated each frame via .update(dt))
//   fire(carrier): fires the effect with the appropriate carrier
//   draw(ctx, t): draws context (boxes, labels) before/after the effect

const SCENES = {
  // 1. Particle Burst: projectile flies → collides with enemy → sparks at impact, enemy dies
  'particle-burst': {
    setup() { return { proj: projectileCarrier(STAGE_X - 100, STAGE_Y, 350), enemy: enemyBox(STAGE_X + 30, STAGE_Y - 20), _hit: false }; },
    update(c, dt) {
      c.proj.update(dt);
      c.enemy.update(dt);
      if (!c._hit && c.proj._x >= c.enemy.origin().x - 16) {
        c._hit = true;
        c._hitX = c.enemy.origin().x - 16;
        c._hitY = c.enemy.origin().y;
      }
    },
    shouldFire(c) { return c._hit; },
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params, x: c._hitX, y: c._hitY } }, null); },
    draw(ctx, c) {
      if (!c._hit) { c.proj.draw(ctx); c.enemy.draw(ctx); }
    },
  },
  // 2. Explosion: barrel detonates → explosion, barrel gone
  explosion: {
    setup() { return { barrel: enemyBox(STAGE_X - 16, STAGE_Y - 20), _hit: false, _fuse: 0 }; },
    update(c, dt) {
      c.barrel.update(dt);
      c._fuse += dt;
      if (!c._hit && c._fuse >= 0.3) c._hit = true;
    },
    shouldFire(c) { return c._hit; },
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params, x: c.barrel.origin().x, y: c.barrel.origin().y } }, c.barrel); },
    draw(ctx, c) {
      if (!c._hit) {
        ctx.fillStyle = 'rgba(180,100,50,0.7)';
        ctx.fillRect(STAGE_X - 16, STAGE_Y - 20, 32, 40);
        ctx.strokeStyle = '#a64';
        ctx.lineWidth = 1;
        ctx.strokeRect(STAGE_X - 16, STAGE_Y - 20, 32, 40);
        ctx.fillStyle = '#fff';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('BARREL', STAGE_X, STAGE_Y + 3);
      }
    },
  },
  // 3. Debris: projectile hits barrel → projectile gone, barrel STAYS (still alive),
  //    debris chips fly off opposite to projectile direction
  debris: {
    setup() { return { proj: projectileCarrier(STAGE_X - 80, STAGE_Y, 500), barrel: enemyBox(STAGE_X + 20, STAGE_Y - 20), _hit: false }; },
    update(c, dt) {
      c.proj.update(dt);
      c.barrel.update(dt);
      if (!c._hit && c.proj._x >= c.barrel.origin().x - 16) {
        c._hit = true;
        c._hitX = c.barrel.origin().x - 16;
        c._hitY = c.barrel.origin().y;
      }
    },
    shouldFire(c) { return c._hit; },
    fire(c, entry) {
      // Projectile came from left (moving right), debris flies LEFT (opposite)
      fireManual({ type: entry.type, params: { ...entry.params, x: c._hitX, y: c._hitY, direction: Math.PI, spread: Math.PI / 4 } }, c.barrel);
    },
    draw(ctx, c) {
      // Barrel always visible (still alive) — draw at carrier position
      const bx = STAGE_X + 20, by = STAGE_Y - 20;
      ctx.fillStyle = 'rgba(180,100,50,0.7)';
      ctx.fillRect(bx, by, 32, 40);
      ctx.strokeStyle = '#a64';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, 32, 40);
      ctx.fillStyle = '#fff';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('BARREL', bx + 16, by + 23);
      // Projectile only visible before impact
      if (!c._hit) c.proj.draw(ctx);
    },
  },
  // 4. Ground Wave: stomp point on ground line
  'ground-wave': {
    setup() { return { carrier: pointCarrier(STAGE_X - 60, STAGE_Y + 30) }; },
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params, x: c.carrier.origin().x, y: c.carrier.origin().y } }, c.carrier); },
    draw(ctx, c) {
      ctx.fillStyle = '#555';
      ctx.fillRect(STAGE_X - 80, STAGE_Y + 38, 160, 2);
      ctx.fillStyle = '#888';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GROUND', STAGE_X, STAGE_Y + 50);
    },
  },
  // 5. Shockwave: from explosion point
  shockwave: {
    setup() { return { carrier: pointCarrier(STAGE_X, STAGE_Y) }; },
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params, x: c.carrier.origin().x, y: c.carrier.origin().y } }, c.carrier); },
    draw() {},
  },
  // 6. Trail: follows a moving projectile
  trail: {
    setup() { return { proj: projectileCarrier(STAGE_X - 100, STAGE_Y, 300) }; },
    fire(c, entry) { return fireManual({ type: entry.type, params: { ...entry.params } }, c.proj); },
    draw(ctx, c) { c.proj.draw(ctx); },
  },
  // 7. Afterimage: hero moves fast, ghosts behind
  afterimage: {
    setup() { return { hero: heroEntity(STAGE_X - 80, STAGE_Y, 200) }; },
    fire(c, entry) { return fireManual({ type: entry.type, params: { ...entry.params } }, c.hero); },
    draw(ctx, c) { c.hero.draw(ctx); },
  },
  // 8. Telegraph Circle: above an enemy
  'telegraph-circle': {
    setup() { return { enemy: enemyBox(STAGE_X - 16, STAGE_Y - 20) }; },
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params, x: c.enemy.origin().x, y: c.enemy.origin().y } }, c.enemy); },
    draw(ctx, c) { c.enemy.draw(ctx); },
  },
  // 9. Ground Target Marker: on ground line
  'ground-target-marker': {
    setup() { return { carrier: pointCarrier(STAGE_X, STAGE_Y + 20) }; },
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params, x: c.carrier.origin().x, y: c.carrier.origin().y } }, c.carrier); },
    draw(ctx, c) {
      ctx.fillStyle = '#555';
      ctx.fillRect(STAGE_X - 80, STAGE_Y + 38, 160, 2);
    },
  },
  // 10. Target Reticle: hero walks slowly, reticle tracks his position
  'target-reticle': {
    setup() { return { hero: heroEntity(STAGE_X - 60, STAGE_Y, 30) }; },
    fire(c, entry) { return fireManual({ type: entry.type, params: { ...entry.params } }, c.hero); },
    draw(ctx, c) { c.hero.draw(ctx); },
  },
  // 11. Vignette — screen-space
  vignette: {
    setup() { return {}; },
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params } }, null); },
    draw() {},
  },
  // 12. Sprite Flash: enemy flashes white
  'sprite-flash': {
    setup() { return { enemy: enemyBox(STAGE_X - 16, STAGE_Y - 20) }; },
    fire(c, entry) { return fireManual({ type: entry.type, params: { ...entry.params } }, c.enemy); },
    draw(ctx, c) { c.enemy.draw(ctx); },
  },
  // 13. Camera Shake — full screen proxy
  'camera-shake': {
    setup() { return {}; },
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params } }, null); },
    draw() {},
  },
  // 14. Screen Flash — full screen
  'screen-flash': {
    setup() { return {}; },
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params } }, null); },
    draw() {},
  },
  // 15. Sprite Shake: 3 enemies, only the middle one shakes (with crosshair)
  'sprite-shake': {
    setup() {
      const e1 = enemyBox(STAGE_X - 70, STAGE_Y - 20);
      const e2 = enemyBox(STAGE_X - 16, STAGE_Y - 20);
      const e3 = enemyBox(STAGE_X + 38, STAGE_Y - 20);
      return { e1, e2, e3, _inst: null };
    },
    shouldFire() { return true; },
    fire(c, entry) {
      c.e2.hitFlash = 0.15;
      c._inst = fireManual({ type: entry.type, params: { ...entry.params } }, c.e2);
    },
    draw(ctx, c) {
      c.e1.draw(ctx);
      c.e3.draw(ctx);
      // Middle enemy: apply shake offset from the effect instance
      let off = { x: 0, y: 0 };
      if (c._inst?.body?.getOffset) off = c._inst.body.getOffset();
      ctx.save();
      ctx.translate(off.x, off.y);
      c.e2.draw(ctx);
      ctx.restore();
      // Crosshair at nominal (unshaken) center so displacement reads
      const cx = c.e2.origin().x, cy = c.e2.origin().y;
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx + off.x, cy + off.y, 2, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  // 16. Impact Star: hero melee → star pops at top-left corner of enemy after 0.5s
  'impact-star': {
    setup() { return { hero: heroEntity(STAGE_X - 40, STAGE_Y, 0), enemy: enemyBox(STAGE_X + 10, STAGE_Y - 20), _hit: false, _timer: 0 }; },
    update(c, dt) {
      c.hero.update(dt);
      c.enemy.update(dt);
      c._timer += dt;
      if (!c._hit && c._timer >= 0.5) {
        c._hit = true;
        // Center of top-left quadrant: 25% width, 25% height from box top-left.
        c._hitX = STAGE_X + 10 + 32 * 0.25;
        c._hitY = STAGE_Y - 20 + 40 * 0.25;
      }
    },
    shouldFire(c) { return c._hit; },
    // No carrier: impactStar otherwise prefers carrier.origin() (enemy center)
    // over params.x/y. The exact collision point must remain authoritative.
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params, x: c._hitX, y: c._hitY } }, null); },
    draw(ctx, c) { c.hero.draw(ctx); c.enemy.draw(ctx); },
  },
  // 17. Fade Out: enemy fades away (no white square overlay)
  'fade-out': {
    setup() { return { enemy: enemyBox(STAGE_X - 16, STAGE_Y - 20) }; },
    fire(c, entry) { return fireManual({ type: entry.type, params: { ...entry.params } }, c.enemy); },
    draw(ctx, c, t) {
      // Enemy box fades out over the duration — no extra white rect
      const alpha = Math.max(0, 1 - t / 0.6);
      if (alpha > 0) {
        ctx.save();
        ctx.globalAlpha = alpha;
        c.enemy.draw(ctx);
        ctx.restore();
      }
    },
  },
  // 18. Scale/Pulse: power-up collision box, pulses infinitely
  'scale-pulse': {
    setup() { return { carrier: pointCarrier(STAGE_X, STAGE_Y) }; },
    fire(c, entry) { return fireManual({ type: entry.type, params: { ...entry.params, loopCount: 999 } }, c.carrier); },
    draw(ctx, c) {
      ctx.strokeStyle = '#ff0';
      ctx.lineWidth = 2;
      ctx.strokeRect(STAGE_X - 14, STAGE_Y - 14, 28, 28);
      ctx.fillStyle = '#fff';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('POWER-UP', STAGE_X, STAGE_Y + 3);
    },
  },
  // 19. Squash & Stretch: barrel gets squashed, disappears before effect
  'squash-stretch': {
    setup() { return { barrel: { _x: STAGE_X, _y: STAGE_Y, origin: () => ({ x: STAGE_X, y: STAGE_Y }), facing: () => 0, size: () => ({ w: 24, h: 32 }) } }; },
    fire(c, entry) { return fireManual({ type: entry.type, params: { ...entry.params } }, c.barrel); },
    draw(ctx, c, t) {
      // Barrel visible only before the squash starts (first 0.1s)
      if (t < 0.1) {
        ctx.fillStyle = 'rgba(180,100,50,0.7)';
        ctx.fillRect(STAGE_X - 12, STAGE_Y - 16, 24, 32);
        ctx.strokeStyle = '#a64';
        ctx.lineWidth = 1;
        ctx.strokeRect(STAGE_X - 12, STAGE_Y - 16, 24, 32);
        ctx.fillStyle = '#fff';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('BARREL', STAGE_X, STAGE_Y + 3);
      }
    },
  },
  // 20. Dust Cloud: landing on ground
  'dust-cloud': {
    setup() { return { carrier: pointCarrier(STAGE_X, STAGE_Y + 20) }; },
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params, x: c.carrier.origin().x, y: c.carrier.origin().y } }, c.carrier); },
    draw(ctx, c) {
      ctx.fillStyle = '#555';
      ctx.fillRect(STAGE_X - 60, STAGE_Y + 30, 120, 2);
    },
  },
  // 21. Slash: three claw traces appear instantly in front of hero
  slash: {
    setup() { return { hero: heroEntity(STAGE_X - 35, STAGE_Y, 0) }; },
    fire(c, entry) { return fireManual({ type: entry.type, params: { ...entry.params } }, c.hero); },
    draw(ctx, c) { c.hero.draw(ctx); },
  },
  // 22. Aura/Glow: around hero
  'aura-glow': {
    setup() { return { hero: heroEntity(STAGE_X, STAGE_Y, 0) }; },
    fire(c, entry) { return fireManual({ type: entry.type, params: { ...entry.params } }, c.hero); },
    draw(ctx, c) { c.hero.draw(ctx); },
  },
  // 23. Screen Overlay — full screen
  'screen-overlay': {
    setup() { return {}; },
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params } }, null); },
    draw() {},
  },
  // 24. Composite Explosion: big boss dies
  'composite-explosion': {
    setup() { return { boss: enemyBox(STAGE_X - 40, STAGE_Y - 50, 80, 100) }; },
    fire(c, entry) { fireManual({ type: entry.type, params: { ...entry.params, x: c.boss.origin().x, y: c.boss.origin().y } }, c.boss); },
    draw(ctx, c, t) { if (t < 0.1) c.boss.draw(ctx); },
  },
  // 26. Beam: boss fires beam (bigger than hero)
  beam: {
    setup() {
      const boss = {
        _x: STAGE_X - 80, _y: STAGE_Y,
        origin: () => ({ x: boss._x, y: boss._y }),
        facing: () => 0,
        size: () => ({ w: 48, h: 60 }),
      };
      boss.draw = (ctx) => {
        ctx.fillStyle = 'rgba(200,50,50,0.5)';
        ctx.fillRect(boss._x - 24, boss._y - 30, 48, 60);
        ctx.strokeStyle = '#f44';
        ctx.lineWidth = 2;
        ctx.strokeRect(boss._x - 24, boss._y - 30, 48, 60);
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('BOSS', boss._x, boss._y + 4);
      };
      return { boss };
    },
    fire(c, entry) { return fireManual({ type: entry.type, params: { ...entry.params } }, c.boss); },
    draw(ctx, c) { c.boss.draw(ctx); },
  },
};

/**
 * Build a stateless, deterministic demo for one catalog entry.
 * Uses the scene system: real carriers, collision detection, effects fire
 * at the right moment through the normal engine path.
 */
function makeDemo(entry) {
  const scene = SCENES[entry.type] || { setup: () => ({}), fire: (c, e) => fireManual({ type: e.type, params: { ...e.params } }, null), draw: () => {} };

  return function demo(ctx, t) {
    // Pre-roll: theater clock is negative. Show nothing.
    if (!Number.isFinite(t) || t < 0) return;
    const target = t;

    // Fresh start every call.
    resetEffects();
    particles.reset();

    // Set up carriers.
    const carriers = scene.setup();

    // Advance the simulation frame by frame.
    const frames = Math.round(target / DEMO_DT);
    for (let i = 1; i <= frames; i++) {
      // Update carriers + scene logic (collision detection, etc.)
      if (scene.update) {
        scene.update(carriers, DEMO_DT);
      } else {
        for (const c of Object.values(carriers)) {
          if (c && typeof c.update === 'function') c.update(DEMO_DT);
        }
      }
      // Fire the effect (scene decides when — on collision, immediately, etc.)
      // Guard: only fire once per demo run.
      if (!carriers._fired) {
        const shouldFire = scene.shouldFire ? scene.shouldFire(carriers) : true;
        if (shouldFire) {
          scene.fire(carriers, entry);
          carriers._fired = true;
        }
      }
      updateEffects(DEMO_DT);
      particles.updateAll(DEMO_DT);
    }

    // Draw context then the effect.
    scene.draw(ctx, carriers);

    if (SHAKE_PROXY.has(entry.type)) {
      drawShakeProxy(ctx, null, entry.type, target);
    } else {
      drawEffects(ctx, { view: DEMO_VIEW });
      if (POOL_DRIVEN.has(entry.type)) {
        for (const s of particles.activeItems) s.draw(ctx);
      }
    }
  };
}

/**
 * Visible proxy for the non-drawing shake effects. Draws a clear visual that
 * shows the jitter without relying on the effect instance's carrier (which is
 * null in the theater). Uses its own internal random offset driven by the demo
 * clock so it's deterministic per-frame and always visible.
 */
function drawShakeProxy(ctx, body, entryType, t) {
  const isCamera = entryType === 'camera-shake';
  const amt = isCamera ? 6 : 3; // px — match in-game values (explosion / projectile hit)
  const duration = isCamera ? 0.25 : 0.1; // s — match in-game (SHAKE_DURATION / hitFlash)
  // Stop shaking after the duration elapses.
  const active = t < duration;
  let off = { x: 0, y: 0 };
  if (active) {
    // Use the live offset if available (non-zero), otherwise generate our own.
    const live = typeof body?.getOffset === 'function' ? body.getOffset() : null;
    if (live && (live.x !== 0 || live.y !== 0)) {
      off = live;
    } else {
      off = { x: (Math.random() * 2 - 1) * amt, y: (Math.random() * 2 - 1) * amt };
    }
  }

  ctx.save();
  if (isCamera) {
    // Camera shake: show 3 sprites at fixed positions, ALL offset together.
    // A dashed rectangle shows the "unshaken" frame boundary.
    const positions = [
      { x: BOX.x - 40, y: BOX.y, w: 24, h: 24 },
      { x: BOX.x + BOX.w / 2 - 12, y: BOX.y - 30, w: 24, h: 24 },
      { x: BOX.x + BOX.w + 16, y: BOX.y + 10, w: 24, h: 24 },
    ];
    // Unshaken reference frame (dashed).
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(BOX.x - 50, BOX.y - 40, BOX.w + 100, BOX.h + 60);
    ctx.setLineDash([]);
    // Shaken sprites.
    ctx.fillStyle = '#fff';
    for (const p of positions) {
      ctx.fillRect(p.x + off.x, p.y + off.y, p.w, p.h);
    }
    // Label.
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('all sprites move together', BOX.x + BOX.w / 2, BOX.y + BOX.h + 35);
  } else {
    // Sprite shake: show 3 sprites, ONLY the middle one jitters.
    const positions = [
      { x: BOX.x - 40, y: BOX.y, w: 24, h: 24 },
      { x: BOX.x + BOX.w / 2 - 12, y: BOX.y - 30, w: 24, h: 24 },
      { x: BOX.x + BOX.w + 16, y: BOX.y + 10, w: 24, h: 24 },
    ];
    // Static sprites (no offset).
    ctx.fillStyle = '#666';
    ctx.fillRect(positions[0].x, positions[0].y, positions[0].w, positions[0].h);
    ctx.fillRect(positions[2].x, positions[2].y, positions[2].w, positions[2].h);
    // Shaken sprite (middle, with offset).
    ctx.fillStyle = '#fff';
    const mid = positions[1];
    ctx.fillRect(mid.x + off.x, mid.y + off.y, mid.w, mid.h);
    // Crosshair at nominal center of shaken sprite.
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mid.x + mid.w / 2 - 6, mid.y + mid.h / 2);
    ctx.lineTo(mid.x + mid.w / 2 + 6, mid.y + mid.h / 2);
    ctx.moveTo(mid.x + mid.w / 2, mid.y + mid.h / 2 - 6);
    ctx.lineTo(mid.x + mid.w / 2, mid.y + mid.h / 2 + 6);
    ctx.stroke();
    // Label.
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('only this sprite jitters', BOX.x + BOX.w / 2, BOX.y + BOX.h + 35);
  }
  ctx.restore();
}

/**
 * Uniform theater entry point. Returns every implemented effect as
 * `{ type, name, section, demo }` in catalog order.
 */
export function theaterList() {
  return [...CATALOG].sort((a, b) => a.section - b.section)
    .map(entry => ({ type: entry.type, name: entry.name, section: entry.section, demo: makeDemo(entry) }));
}
