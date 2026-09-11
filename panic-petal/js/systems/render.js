// Petal Panic — render system. Draws in 960x540 logical coords; the
// logical→screen transform is applied by main.js before this runs.
//
// Task 1.4: world entities are drawn under a camera translate so the level
// scrolls horizontally, and F3 toggles the full design §16 colored-box debug
// overlay (orange/green/red/blue/pink by collision layer).

import { VIEW_W, VIEW_H } from '../view.js';
import { getHero, getSolids, getEnemies, getAnimTestEnemy, getProjectiles, getSpecials, getPickups, getCamera, isDebugEnabled, getParticles, getCoins, getBarrels, getShakeOffset, getPowerups, getCheckpoints, getFloatTexts, getRealEnemies, getBoss } from './update.js';
import { Effects } from '../effects.js';
import { getState, S } from '../state.js';
import { Debug } from '../debug.js';
import { drawScreen, screenUpdate } from '../screens.js';
import { drawHUD } from '../hud.js';
import { LEVELS } from '../level.js';

export function render(ctx) {
  // Milestone 8 — Home & Select are full-screen; skip world rendering entirely.
  const state = getState();
  if (state === S.HOME || state === S.SELECT) {
    screenUpdate(1 / 60); // advance parallax at fixed step
    drawScreen(ctx);
    return;
  }

  const cam = getCamera();

  // Background (viewport-space; not affected by the camera).
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // --- World (camera-translated) -------------------------------------------
  ctx.save();
  // Task 4.1 — explosion screen shake offsets the whole world by a decaying
  // random vector (getShakeOffset returns {x:0,y:0} when idle).
  const shake = getShakeOffset();
  ctx.translate(-cam.x + shake.x, -cam.y + shake.y);

  // Solid platforms (orange per design §16 debug palette).
  for (const s of getSolids()) {
    ctx.fillStyle = '#ff9f43';
    ctx.fillRect(s.x, s.y, s.w, s.h);
  }

  // Task 4.1 — destructible barrels (drawn via Entity.draw; white flash on hit).
  for (const b of getBarrels()) {
    if (!b.alive) continue;
    if (!(Debug.viewMode === 1)) b.draw(ctx);
  }

  // Placeholder pickups / enemies / projectiles (debug-colored bodies).
  if (!(Debug.viewMode === 1)) for (const p of getPickups()) p.draw(ctx);
  for (const e of getEnemies()) {
    if (e.alive === false) continue; // destroyed target — no longer drawn
    // Task 7.1 — enemy shake: offset the draw position by a random ±3px while
    // hitFlash is running (design §12 "Enemy damaged: fast shake").
    const sh = Effects.getShakeOffset(e);
    ctx.save();
    ctx.translate(sh.x, sh.y);
    e.draw(ctx);
    ctx.restore();
    // Task 3.2 — white flash when struck (melee or projectile).
    if (e.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, e.hitFlash * 10);
      const eb = e.worldBox();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(eb.x + sh.x, eb.y + sh.y, eb.w, eb.h);
      ctx.restore();
    }
  }

  // Task 3.3 + 5.1 — real enemies (jester + vine_hound/violetta/jacko/boris).
  // Each draws itself including death shrink/fade and its attack telegraph.
  for (const e of getRealEnemies()) {
    if (!e.alive) continue;
    if ((Debug.viewMode === 1)) continue;
    const sh = Effects.getShakeOffset(e);
    ctx.save();
    ctx.translate(sh.x, sh.y);
    e.draw(ctx);
    ctx.restore();
  }

  // Task 6.1 — boss (Overgrown Elephant). Drawn with a wide HP bar above it so
  // the fight's progress reads clearly; F3 adds phase name + weak-point box.
  const boss = getBoss();
  if (boss && boss.alive) {
    if (!(Debug.viewMode === 1)) boss.draw(ctx);
    if (boss.hp != null && boss.maxHp > 0 && boss.aiState !== 'dead') {
      drawBossHpBar(ctx, boss);
    }
    if (isDebugEnabled()) drawBossDebug(ctx, boss);
  }

  // Task 3.3 — sparkle particles + dropped coins.
  for (const s of getParticles().activeItems) s.draw(ctx);
  for (const c of getCoins().activeItems) c.draw(ctx);

  // Task 4.3 — checkpoints (flags) + powerups (signboards). Both draw themselves
  // (Entity transform pipeline + bob/flash overlays).
  for (const c of getCheckpoints()) c.draw(ctx);
  for (const p of getPowerups()) p.draw(ctx);

  // Task 4.3 — floating value-text popups (powerup labels, checkpoint ids).
  for (const t of getFloatTexts()) t.draw(ctx);

  // Task 4.2 — F3 debug: show each coin's value as small text above it so the
  // per-type weight/value difference is visible during development.
  if (isDebugEnabled() && Debug.viewMode !== 2) {
    ctx.save();
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    for (const c of getCoins().activeItems) {
      if (!c.alive || c.collected) continue;
      const cx = c.x + c.w / 2;
      const cy = c.y - 4;
      ctx.fillStyle = c.debugColor ?? '#fff';
      ctx.fillText(String(c.value), cx, cy);
      // Small TTL bar (consistent with all other F3 bars).
      if (c.maxTtl > 0) {
        const barW = 14, barH = 2;
        const bx = cx - barW / 2, by = cy - 6;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = c.ttlFrac < 0.25 ? '#e74c3c' : c.debugColor ?? '#fff';
        ctx.fillRect(bx, by, barW * c.ttlFrac, barH);
      }
    }
    // Task 4.3 — F3 debug: powerup type label above each live powerup, and the
    // checkpoint id above each flag (triggered ones dimmed).
    for (const p of getPowerups()) {
      if (!p.alive || p.collected) continue;
      const cx = p.x + p.w / 2;
      const cy = p.y - 6;
      ctx.fillStyle = '#3498db';
      ctx.fillText(p.def.label, cx, cy);
    }
    for (const c of getCheckpoints()) {
      if (!c.alive) continue;
      const cx = c.x + c.w / 2;
      const cy = c.y - 6;
      ctx.fillStyle = c.triggered ? 'rgba(255,215,0,0.4)' : '#ffd700';
      ctx.fillText(`[${c.checkpointId}]`, cx, cy);
    }
    // Unified F3 labels: name + HP/energy bar for every entity.
    // Consistent format: [NAME] above a small colored bar showing remaining life.
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    const BAR_W = 24, BAR_H = 3;

    function drawLabel(ctx, x, y, name, frac, color) {
      // Name text.
      ctx.fillStyle = color;
      ctx.fillText(name, x, y);
      // Progress bar below the name.
      const by = y + 3;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - BAR_W / 2, by, BAR_W, BAR_H);
      ctx.fillStyle = frac < 0.25 ? '#e74c3c' : color;
      ctx.fillRect(x - BAR_W / 2, by, BAR_W * Math.max(0, frac), BAR_H);
    }

    // Barrels (the orange SOLID boxes)
    for (const b of getBarrels()) {
      if (!b.alive) continue;
      const label = b.type === 'explosiveBarrel' ? 'explosiveBarrel\u2728' : b.type;
      drawLabel(ctx, b.x + b.w / 2, b.y - 10, label, b.hp / b.maxHp, '#ff9f43');
    }
    // Hero: name + anim state + energy bar
    {
      const h = getHero();
      if (h && !h.dying) {
        let animName = 'idle';
        if (h.dying) animName = 'dead';
        else if (h.crouching) animName = 'crouch';
        else if (h.meleeFrame > 0) animName = 'melee';
        else if (h.vy < -10 || h.vy > 50) animName = 'jump';
        else if (Math.abs(h.vx) > 20) animName = 'run';
        drawLabel(ctx, h.x + h.w / 2, h.y - 10, `HERO:${animName}`, h.energy / h.maxEnergy, '#2ecc71');
      }
    }
    // Enemy: name + aiState + HP bar (single unified label above)
    for (const e of getRealEnemies()) {
      if (!e.alive) continue;
      const frac = e.aiState === 'dead'
        ? Math.max(0, 1 - (e.deathTimer / e.deathDuration))
        : e.hp / e.maxHp;
      drawLabel(ctx, e.x + e.w / 2, e.y - 10, `${e.type}:${e.aiState}`, frac, '#e74c3c');
    }
    // Boss HP
    {
      const b = getBoss();
      if (b && b.alive) {
        drawLabel(ctx, b.x + b.w / 2, b.y - 28, 'BOSS', b.hp / b.maxHp, '#e74c3c');
      }
    }
    // Special projectiles: name + TTL/fuse bar
    for (const s of getSpecials()) {
      if (!s.alive) continue;
      const frac = s.ttlFrac;
      const color = s.type === 'bomb' ? '#f39c12' : '#ff6ec7';
      drawLabel(ctx, s.x + s.w / 2, s.y - 10, s.type, frac, color);
    }
    ctx.restore();
  }

  const at = getAnimTestEnemy();
  if (at.alive && !(Debug.viewMode === 1)) at.draw(ctx);
  if (!(Debug.viewMode === 1)) {
    for (const p of getProjectiles()) p.draw(ctx);
    for (const s of getSpecials()) s.draw(ctx);
  }

  // Hero test box — drawn through Entity.draw() so the full transform
  // pipeline (mirror/rotate/scale + debug rect fallback) is exercised.
  // Task 4.3 — Invincibility blink: while invincibleTimer > 0 the hero sprite
  // alternates visible/invisible every 0.1s (design §12 "Invincibility active").
  // Task 5.2 — While dying the hero is invisible; a skull emoji floats up in a
  // sine wave and fades over the death duration instead.
  {
    const h = getHero();
    if (h.dying) {
      drawDeathSkull(ctx, h);
    } else if (h.invincibleTimer > 0 && Math.floor(h.invincibleTimer / 0.1) % 2 === 0) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      h.draw(ctx);
      ctx.restore();
    } else if (!(Debug.viewMode === 1)) {
      h.draw(ctx);
    }
  }

  // Debug overlay (F3): full §16 colored boxes over every entity's worldBox().
  // viewMode 0=sprites+overlay, 1=collision-only (opaque, no sprites), 2=no-visuals
  if (isDebugEnabled() && Debug.viewMode !== 2) {
    drawDebugOverlay(ctx);
    // Task 3.3 + 5.1 — per-enemy debug: aggro radius circle + AI state label
    // above each real enemy's head.
    for (const e of getRealEnemies()) drawEnemyDebug(ctx, e);
  }

  // --- Debug & Test Harness (F1, design §19) ---------------------------------
  // Aggro viz + facing arrow + state label for every live enemy/boss, plus the
  // anim-scrubber collision-box overlay on the selected entity. Gated entirely
  // behind Debug.enabled so normal play pays nothing.
  if (Debug.enabled) {
    for (const e of getRealEnemies()) drawAggroViz(ctx, e);
    const b = getBoss();
    if (b && b.alive) drawAggroViz(ctx, b);
    if (Debug.selected) drawSelectionOverlay(ctx, Debug.selected);
  }

  ctx.restore();

  // --- Viewport-space HUD hint (not scrolled with the world) -----------------
  if (isDebugEnabled()) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '12px monospace';
    ctx.fillText('DEBUG ON — F3 to toggle', 8, 16);
  }

  // --- Debug & Test Harness HUD (F1): live §4.1 telemetry + event log --------
  if (Debug.enabled) {
    if (Debug.showStats) drawStatsHUD(ctx);
    if (Debug.showLog) drawEventLog(ctx);
  }

  // Task 7.1 — screen-space effect overlays: red damage vignette + white
  // explosion flash (design §12). Drawn in viewport space after the camera
  // translate is restored so they cover the whole logical frame.
  Effects.drawOverlay(ctx, VIEW_W, VIEW_H);

  // Task 8.3 — Play HUD (design §20): energy bar + shield, ammo/special,
  // coins, lives, hero portrait, checkpoint progress line. Viewport-space,
  // drawn after the camera restore; only during PLAY (PAUSE/OVER/WIN keep the
  // frozen world visible and their screen overlay is drawn below).
  if (state === S.PLAY) {
    drawHUD(ctx, getHero(), cam, LEVELS[0]);
  }

  // Harness hint drawn LAST so it sits on top of everything (incl. level map bar).
  if (Debug.enabled) drawHarnessHint(ctx);

  // --- State overlays (Task 8.2): HOME/SELECT handled above; PAUSE/OVER/WIN
  // are drawn here as overlays on top of the frozen game world so the play
  // frame stays visible behind them (dimmed by each screen's own background).
  if (state === S.PAUSE || state === S.OVER || state === S.WIN) {
    drawScreen(ctx, getHero());
  }
}

/**
 * Task 5.2 — draw the hero-death skull effect (design §12 "Hero death"). The
 * 💀 emoji floats upward in a sine wave and fades out over the death duration.
 * Position is derived from hero.deathTimer so it stays in sync with the update
 * loop without storing extra state. Called inside the camera-translated world.
 */
function drawDeathSkull(ctx, h) {
  const t = h.deathTimer;
  const dur = h.DEATH_DURATION || 1.5;
  const alpha = Math.max(0, 1 - t / dur); // fade 1 → 0 over the duration
  if (alpha <= 0) return;

  // Start at the hero's center; drift up + sway sideways on a sine wave.
  const cx = h.x + h.w / 2;
  const cy = h.y + h.h / 2;
  const sx = cx + Math.sin(t * 4) * 10;   // horizontal sine sway
  const sy = cy - 30 * t;                 // steady upward float

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '32px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('💀', sx, sy);
  ctx.restore();
}

/**
 * Design §16 debug overlay: semi-transparent filled rects + outlines over each
 * entity's worldBox(), color-coded by collision layer.
 *   Orange — SOLID (level platforms)
 *   Green  — HERO
 *   Red    — ENEMY
 *   Blue   — PICKUP (objects / powerups)
 *   Pink   — PROJ_ALLY / PROJ_FOE (projectiles / explosions)
 */
function drawDebugOverlay(ctx) {
  ctx.save();
  ctx.globalAlpha = (Debug.viewMode === 1) ? 1.0 : 0.4;
  ctx.lineWidth = 2;

  const layers = [
    { match: L => L & 0b0000001000, color: '#ff9f43' }, // SOLID → orange
    { match: L => L & 0b0000000001, color: '#2ecc71' }, // HERO  → green
    { match: L => L & 0b0000000010, color: '#e74c3c' }, // ENEMY → red
    { match: L => L & 0b0000010000, color: '#3498db' }, // PICKUP→ blue
    { match: L => L & 0b0001100000, color: '#ff6ec7' }, // PROJ  → pink
  ];

  const all = [...getSolids().map(s => solidEntityProxy(s)),
               ...getPickups(), ...getEnemies().filter(e => e.alive !== false),
               ...getRealEnemies().filter(e => e.alive),
               ...getProjectiles(), ...getSpecials(), getHero(),
               ...getBarrels().filter(b => b.alive)];
  // Boss gets a radius circle too.
  const boss = getBoss();
  if (boss && boss.alive) all.push(boss);

  for (const ent of all) {
    const layer = ent.layer ?? 0;
    const rule = layers.find(r => r.match(layer));
    if (!rule) continue;
    const b = ent.worldBox ? ent.worldBox() : ent;
    ctx.fillStyle = rule.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = rule.color;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }

  ctx.restore();

  // Task 3.2 — draw the melee hitbox in YELLOW when active (debug only).
  const hero = getHero();
  const mh = hero.meleeHitboxWorld;
  if (mh) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(mh.x, mh.y, mh.w, mh.h);
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 2;
    ctx.strokeRect(mh.x, mh.y, mh.w, mh.h);
    ctx.restore();
  }

  // Generic effect-radius circles (F3): any entity with radius > 0 gets a
  // dashed circle. Color: pink = explosion AoE, red = aggro/detection.
  for (const ent of all) {
    const r = ent.radius ?? 0;
    if (r <= 0) continue;
    const b = ent.worldBox ? ent.worldBox() : ent;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const isExplosion = ent.explosive === true;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = isExplosion ? '#ff6ec7' : '#e74c3c';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// SOLIDS are plain AABBs ({x,y,w,h}); wrap them as a minimal proxy so the
// overlay loop can treat them uniformly with Entity instances (worldBox()).
function solidEntityProxy(box) {
  return { x: box.x, y: box.y, w: box.w, h: box.h, layer: 0b0000001000, worldBox: () => box };
}

/** Task 3.1 — small HP bar above a targetable enemy so thorn damage is visible. */
function drawHpBar(ctx, e) {
  const frac = Math.max(0, e.hp / e.maxHp);
  const w = e.w, h = 4;
  const x = e.x, y = e.y - 8;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#2ecc71';
  ctx.fillRect(x, y, w * frac, h);
}

// --- Task 6.1 — boss debug + HP helpers --------------------------------------

/**
 * Wide HP bar for the boss (design §9). Spans the full body width with a thick
 * fill so the fight's progress reads at a glance.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../boss.js').Elephant} b
 */
function drawBossHpBar(ctx, b) {
  const frac = Math.max(0, b.hp / b.maxHp);
  const w = b.w + 40; // wider than the body for legibility
  const h = 8;
  const x = b.x + b.w / 2 - w / 2;
  const y = b.y - 16;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#5a3d8a';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = frac > 0.5 ? '#2ecc71' : (frac > 0.25 ? '#f39c12' : '#e74c3c');
  ctx.fillRect(x, y, w * frac, h);
  ctx.restore();
}

/**
 * F3 debug overlay for the boss: phase name + escalation above its head, the
 * weak-point box highlighted in gold, and the arena bounds as dashed lines.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../boss.js').Elephant} b
 */
function drawBossDebug(ctx, b) {
  const cx = b.x + b.w / 2;

  // Arena bounds (dashed verticals).
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = '#8e6bbf';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(b.arenaX, 0); ctx.lineTo(b.arenaX, VIEW_H);
  ctx.moveTo(b.arenaX + b.arenaW, 0); ctx.lineTo(b.arenaX + b.arenaW, VIEW_H);
  ctx.stroke();
  ctx.restore();

  // Weak point box (gold outline).
  const wp = b.weakPointWorld();
  ctx.save();
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 2;
  ctx.strokeRect(wp.x, wp.y, wp.w, wp.h);
  ctx.restore();

  // Phase + escalation label.
  ctx.save();
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd700';
  ctx.fillText(`BOSS ${b.phase.toUpperCase()} ×${b.escalation.toFixed(2)}`, cx, b.y - 24);
  ctx.restore();
}

// --- Task 3.3 + 5.1 — per-enemy debug overlay (F3) ---------------------------
// Draws each real enemy's aggro radius as a faint circle and its current AI
// state as a label above its head. Helps validate every state machine during
// development (jester whip, hound lunge, violetta pace/shoot, jacko roll/launch,
// boris hover/dive).

/**
 * Draw per-enemy debug info: aggro circle + AI state label.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Enemy} e any real enemy entity
 */
// No-op: aggro circles are now drawn by the generic radius loop in drawDebugOverlay.
// Kept as a call target so existing for-loops don't break.
function drawEnemyDebug(_ctx, _e) {}

// --- Debug & Test Harness (F1, design §19) — world-space overlays ------------

/**
 * Aggro viz for a single enemy/boss: faint aggro-radius circle, a facing arrow
 * from the body center, and the current AI-state label above its head. Drawn in
 * world space (caller is inside the camera translate). No-op when not alive.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Enemy|Elephant} e
 */
function drawAggroViz(ctx, e) {
  if (!e || !e.alive) return;
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;

  // Facing arrow only (name + aggro circle are F3's job via drawLabel/drawEnemyDebug).
  const dir = e.facing ?? 1;
  const len = 22;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = '#2ecc71';
  ctx.fillStyle = '#2ecc71';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + dir * len, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + dir * len, cy);
  ctx.lineTo(cx + dir * (len - 6), cy - 4);
  ctx.lineTo(cx + dir * (len - 6), cy + 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Selection overlay for the anim scrubber: a bright outline around the selected
 * entity's collision box + a small info tag (type, anim name, frame index).
 * This is the "overlay its collision box on the sprite per frame" requirement.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Entity} sel
 */
function drawSelectionOverlay(ctx, sel) {
  if (!sel) return;
  const b = sel.worldBox();

  // Collision-box outline (bright cyan so it stands out over any sprite).
  ctx.save();
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#00e5ff';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.restore();

  // Info tag: type + anim frame index.
  const anim = sel.anim ?? sel.anims?.attack;
  const frame = anim && anim.frames.length ? `${anim.frameIndex}/${anim.frames.length - 1}` : '—';
  const label = `${sel.type ?? sel.heroDef?.id ?? '?'}  f${frame}`;
  ctx.save();
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(b.x - 2, b.y - 18, tw + 8, 14);
  ctx.fillStyle = '#00e5ff';
  ctx.fillText(label, b.x + 2, b.y - 7);
  ctx.restore();
}

// --- Debug & Test Harness HUD (F1) — viewport-space ---------------------------

/**
 * Live §4.1 telemetry HUD in the top-left corner: kills by type, coins, damage
 * dealt by method, barrels destroyed, hits taken, distance, time. Reads straight
 * off hero.stats so it always reflects the live run.
 * @param {CanvasRenderingContext2D} ctx
 */
function drawStatsHUD(ctx) {
  const h = getHero();
  const s = h.runStats ?? h.stats ?? {};
  const ek = s.enemiesKilled ?? {};
  const dd = s.damageDealt ?? {};
  const bm = dd.byMethod ?? {};
  const be = dd.byEnemy ?? {};
  const ht = s.hitsTaken ?? {};
  const bc = s.barrelsDestroyed ?? {};
  const cc = s.coinsCollected ?? {};

  const lines = [];
  lines.push('=== TELEMETRY (F1) ===');
  // Kills by type.
  const killStr = Object.entries(ek).map(([k, v]) => `${k}:${v}`).join(' ') || 'none';
  lines.push(`kills   ${killStr}`);
  lines.push(`coins   ${cc.total ?? 0}  (b/s/g ${cc.bronze ?? 0}/${cc.silver ?? 0}/${cc.gold ?? 0})`);
  lines.push(`dmg     melee:${bm.melee ?? 0} proj:${bm.projectile ?? 0} special:${bm.special ?? 0}`);
  const dmgByEnemy = Object.entries(be).map(([k, v]) => `${k}:${Math.round(v)}`).join(' ');
  lines.push(`byType  ${dmgByEnemy || '—'}`);
  lines.push(`barrels wood:${bc.woodBarrel ?? 0} expl:${bc.explosiveBarrel ?? 0} coin:${bc.coinBarrel ?? 0}`);
  lines.push(`hitsTkn contact:${ht.enemyContact ?? 0} proj:${ht.enemyProjectile ?? 0} expl:${ht.explosion ?? 0} tot:${ht.total ?? 0}`);
  lines.push(`dist    ${Math.round(s.distanceTraveled ?? 0)}px  shots:${s.projectilesShot ?? 0} swings:${s.meleeSwings ?? 0}`);

  // God mode + time scale status line.
  const flags = [Debug.god ? 'GOD' : null, `t=${Debug.timeScale}x`, Debug.showLog ? 'LOG' : null]
    .filter(Boolean).join('  ');
  lines.push(flags);

  ctx.save();
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  const pad = 6;
  const lh = 14;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2;
  const x = 8, y = 60;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x, y, w, lines.length * lh + pad * 2);
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? '#00e5ff' : (i === lines.length - 1 ? '#ffd700' : '#ffffff');
    ctx.fillText(l, x + pad, y + pad + lh * (i + 0.5));
  });
  ctx.restore();
}

/**
 * Event-log tail (last 10 entries) in the bottom-right corner. Shown only while
 * Debug.showLog is true (L toggles it). Timestamps are relative to now.
 * @param {CanvasRenderingContext2D} ctx
 */
function drawEventLog(ctx) {
  const log = Debug.log;
  if (!log.length) return;
  const tail = log.slice(-10);
  const now = performance.now();

  ctx.save();
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  const lh = 14;
  const maxW = Math.max(...tail.map(l => ctx.measureText(l.msg).width));
  const w = maxW + 70; // room for timestamp
  const x = VIEW_W - 8, y = VIEW_H - 12 - tail.length * lh;

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - w, y - 4, w, tail.length * lh + 8);
  tail.forEach((entry, i) => {
    const age = ((now - entry.t) / 1000).toFixed(1);
    const ly = y + i * lh + lh * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(`+${age}s`, x - w + 44, ly);
    ctx.fillStyle = '#aef78e';
    ctx.fillText(entry.msg, x - 4, ly);
  });
  ctx.restore();
}

/**
 * Compact keybind hint bar shown at the bottom-center while the harness is on,
 * so the developer remembers the controls without leaving the game.
 * @param {CanvasRenderingContext2D} ctx
 */
function drawHarnessHint(ctx) {
  const line1 = 'F1 | 1-9 spawn | F god | Z spd | T tele | Y hero | L log | E dump | C view';
  const line2 = 'RMB sel | LMB force | arrows scrub | X desel';
  ctx.save();
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  const x = 8, y = VIEW_H - 34;
  const w1 = ctx.measureText(line1).width;
  const w2 = ctx.measureText(line2).width;
  const w = Math.max(w1, w2);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y, w + 8, 30);
  ctx.fillStyle = '#00e5ff';
  ctx.fillText(line1, x + 4, y + 12);
  ctx.fillText(line2, x + 4, y + 26);
  ctx.restore();
}
