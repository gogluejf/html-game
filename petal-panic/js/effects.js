// Petal Panic — central effects module (design §12).
//
// One-stop API for every screen-space + entity-space visual effect. Pure VFX:
// no collision, no logic impact. Reuses the pooled particle system from
// js/particles.js for all burst-style effects; owns its own timers for the
// screen-space overlays (damage vignette, white flash) and the per-enemy hit
// shake.
//
// Screen-space state (read by render.js via drawOverlay / getShakeOffset):
//   - vignette    0..1  red edge glow when the hero takes damage (decays 0.5s)
//   - screenFlash 0..1  white full-screen flash on big explosions (decays 0.15s)
//
// Entity-space helpers:
//   - spawnHitSparkles(x, y, n)      small red "blood" sparkles on projectile hits
//   - spawnDeathSparkle(x, y, size)  sparkle burst scaled to a sprite's size
//   - spawnPickupPop(x, y, color)    powerup collect pop
//   - spawnExplosion(x, y, radius)   barrel/bomb blast (orange/red, sized to AoE)
//   - beginEnemyShake(entity)       ±3px random offset for 0.1s while hitFlash runs
//
// The enemy shake is driven off the entity's existing `hitFlash` timer so we
// don't need a second clock: update() recomputes the offset each frame while
// hitFlash > 0 and zeroes it when the flash ends.

import { particles } from './particles.js';

// --- Tunables -----------------------------------------------------------------
const VIGNETTE_DECAY = 1 / 0.5;     // full fade over 0.5s (CoD-style, subtle)
const FLASH_DECAY = 1 / 0.15;       // full fade over 0.15s (brief white pop)
const HIT_SPARKLE_COUNT = [3, 5];   // design §12: 3–5 red sparkles per hit
const HIT_SPARKLE_SPEED = [60, 140];
const DEATH_SPARKLE_BASE = 8;       // baseline sparkle count at 32px sprite width
const PICKUP_POP_COUNT = 8;
const EXPLOSION_MIN = 12;           // min particles for an explosion blast
const EXPLOSION_PER_PX = 0.15;      // extra particles per px of radius
const SHAKE_AMT = 3;                // ±3px (design §12 "fast shake")

// Warm fire palette shared by explosions.
const FIRE_COLORS = ['#e74c3c', '#f39c12', '#ff6ec7', '#ffffff'];
// Blood-like palette for projectile hit sparkles.
const BLOOD_COLORS = ['#e74c3c', '#c0392b', '#ff6b6b'];

// ---------------------------------------------------------------------------
// Effects singleton
// ---------------------------------------------------------------------------

export const Effects = {
  // --- Screen-space state ---------------------------------------------------
  vignette: 0,      // 0..1 red edge glow
  screenFlash: 0,   // 0..1 white overlay

  /**
   * Hero took damage → kick the red vignette to full. Decays in update().
   * @param {number} [strength=1] 0..1 initial intensity
   */
  heroDamaged(strength = 1) {
    this.vignette = Math.max(this.vignette, Math.min(1, strength));
  },

  /**
   * Big explosion (barrel / bomb) → brief white screen flash.
   * @param {number} [strength=1] 0..1 initial intensity
   */
  bigExplosion(strength = 1) {
    this.screenFlash = Math.max(this.screenFlash, Math.min(1, strength));
  },

  // --- Entity-space spawners --------------------------------------------------

  /**
   * Small red sparkle at a projectile→enemy impact point (design §12
   * "Projectile hit on enemy: small red sparkle (blood-like)").
   * @param {number} x world x of the impact
   * @param {number} y world y of the impact
   * @param {number} [count] overrides the random 3–5 roll
   * @returns {number} sparkles actually spawned
   */
  spawnHitSparkles(x, y, count) {
    const n = count ?? (HIT_SPARKLE_COUNT[0] + Math.floor(Math.random() * (HIT_SPARKLE_COUNT[1] - HIT_SPARKLE_COUNT[0] + 1)));
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = HIT_SPARKLE_SPEED[0] + Math.random() * (HIT_SPARKLE_SPEED[1] - HIT_SPARKLE_SPEED[0]);
      const color = BLOOD_COLORS[i % BLOOD_COLORS.length];
      if (particles.spawnOne(x, y, color, speed, angle)) spawned++;
    }
    return spawned;
  },

  /**
   * Sprite-sized death sparkle burst (design §12 "sparkle burst (sized to
   * sprite)"). Count scales with the sprite's pixel area so a big boss pops
   * harder than a small flyer.
   * @param {number} x center x
   * @param {number} y center y
   * @param {number} [size=32] representative sprite dimension (px)
   * @returns {number} sparkles actually spawned
   */
  spawnDeathSparkle(x, y, size = 32) {
    const count = Math.max(4, Math.round(DEATH_SPARKLE_BASE + size * 0.25));
    return particles.spawnBurst(x, y, count);
  },

  /**
   * Powerup pickup pop: a ring of colored sparkles radiating outward
   * (design §12 "Powerup pickup: pop/sparkle").
   * @param {number} x center x
   * @param {number} y center y
   * @param {string} [color='#fff'] the powerup's theme color
   * @returns {number} sparkles actually spawned
   */
  spawnPickupPop(x, y, color = '#ffffff') {
    let spawned = 0;
    for (let i = 0; i < PICKUP_POP_COUNT; i++) {
      // Evenly spaced angles give a clean "pop ring".
      const angle = (i / PICKUP_POP_COUNT) * Math.PI * 2;
      const speed = 100 + Math.random() * 80;
      if (particles.spawnOne(x, y, color, speed, angle)) spawned++;
    }
    return spawned;
  },

  /**
   * Barrel / bomb explosion VFX: warm-colored particles scaled to the AoE
   * radius (design §12 "multiple random bomb-explosion frames scaled to the
   * collision-box area"). Pair with bigExplosion() for the screen flash.
   * @param {number} x blast center x
   * @param {number} y blast center y
   * @param {number} [radius=60] explosion radius (px) — scales spread + count
   * @returns {number} particles actually spawned
   */
  spawnExplosion(x, y, radius = 60) {
    const count = Math.min(24, EXPLOSION_MIN + Math.round(radius * EXPLOSION_PER_PX));
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * (radius * 1.5);
      const color = FIRE_COLORS[i % FIRE_COLORS.length];
      if (particles.spawnOne(x, y, color, speed, angle)) spawned++;
    }
    return spawned;
  },

  /**
   * Mark an entity as shaking (design §12 "Enemy damaged: fast shake"). The
   * shake rides on the entity's existing hitFlash timer (0.1s), so just set
   * hitFlash — update() then calls getShakeOffset(e) each frame to read the
   * random offset. This helper exists so callers have one semantic call site.
   * @param {object} e any entity with a hitFlash timer
   */
  beginEnemyShake(e) {
    if (!e) return;
    e.hitFlash = Math.max(e.hitFlash ?? 0, 0.1);
  },

  /**
   * Per-frame random shake offset for an entity whose hitFlash is running.
   * Returns {x,y} in [-SHAKE_AMT, +SHAKE_AMT] while hitFlash > 0, else {0,0}.
   * Callers add this to the entity's draw position.
   * @param {object} e entity with a hitFlash timer
   * @returns {{x:number,y:number}}
   */
  getShakeOffset(e) {
    if (!e || !(e.hitFlash > 0)) return { x: 0, y: 0 };
    return {
      x: (Math.random() * 2 - 1) * SHAKE_AMT,
      y: (Math.random() * 2 - 1) * SHAKE_AMT,
    };
  },

  // --- Frame step -------------------------------------------------------------

  /**
   * Decay the screen-space timers. Called once per fixed step from update().
   * @param {number} dt seconds
   */
  update(dt) {
    if (this.vignette > 0) {
      this.vignette = Math.max(0, this.vignette - VIGNETTE_DECAY * dt);
    }
    if (this.screenFlash > 0) {
      this.screenFlash = Math.max(0, this.screenFlash - FLASH_DECAY * dt);
    }
  },

  /**
   * Draw the screen-space overlays (vignette + white flash) in VIEWPORT space.
   * Must be called AFTER the camera translate has been restored, so it covers
   * the whole logical viewport regardless of scroll.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} viewW logical viewport width (VIEW_W)
   * @param {number} viewH logical viewport height (VIEW_H)
   */
  drawOverlay(ctx, viewW, viewH) {
    // --- Red damage vignette (CoD-style radial gradient) ---------------------
    if (this.vignette > 0) {
      const v = this.vignette;
      const cx = viewW / 2, cy = viewH / 2;
      // Gradient reaches full red only at the corners; the center stays clear.
      const r = Math.hypot(cx, cy);
      const grad = ctx.createRadialGradient(cx, cy, r * 0.45, cx, cy, r);
      grad.addColorStop(0, 'rgba(180, 20, 20, 0)');
      grad.addColorStop(0.7, `rgba(180, 20, 20, ${0.15 * v})`);
      grad.addColorStop(1, `rgba(150, 10, 10, ${0.55 * v})`);
      ctx.save();
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }

    // --- White explosion flash -----------------------------------------------
    if (this.screenFlash > 0) {
      const f = this.screenFlash;
      ctx.save();
      ctx.globalAlpha = f;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }
  },

  /**
   * Reset all state (used between runs / retries so a stale vignette doesn't
   * bleed into the next life).
   */
  reset() {
    this.vignette = 0;
    this.screenFlash = 0;
  },
};
