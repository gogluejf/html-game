// Floating text (VFX) — small pooled "value label" popups for powerup pickups
// and checkpoint triggers. Pure visual: no collision layer, no allocation after init.
class FloatText {
  constructor() { this.alive = false; }
  spawn(x, y, text, color) {
    this.x = x; this.y = y; this.text = text; this.color = color;
    this.life = 1.0; this.maxLife = 1.0; this.alive = true;
  }
  update(dt) {
    if (!this.alive) return;
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    this.y -= 30 * dt; // drift upward while fading
  }
  draw(ctx) {
    if (!this.alive) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
    ctx.fillStyle = this.color;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}
const FLOAT_TEXT_POOL_SIZE = 16;
export const floatTexts = Array.from({ length: FLOAT_TEXT_POOL_SIZE }, () => new FloatText());
/** Spawn a floating label at (x, y). Returns null when the pool is exhausted. */
export function spawnFloatText(x, y, text, color) {
  for (const t of floatTexts) {
    if (t.alive) continue;
    t.spawn(x, y, text, color);
    return t;
  }
  return null;
}
