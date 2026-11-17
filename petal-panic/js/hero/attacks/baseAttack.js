// Shared attack contact lifecycle. Movement stays in each move implementation.
import { MELEE_IMPACTS } from '../../combat/meleeImpact.js';
import { unpinAll } from '../../combat/pin.js';

export const hasHitBox = frame => (frame?.boxes ?? []).some(b => b.label === 'hit');

export class BaseAttack {
  constructor(hero, config) {
    this.hero = hero;
    this.config = { plow: false, impact: MELEE_IMPACTS[config.id], ...config };
    this.running = false;
    this.windows = new Map();
    this.pinned = new Set();
  }

  begin() {
    for (const other of Object.values(this.hero.attackMoves)) {
      if (other !== this && other.running) other.end();
    }
    this.windows.clear();
    this.running = true;
    this.direction = this.hero.facing === -1 ? -1 : 1;
    const sheet = this.config.sheet(this.hero);
    if (this.hero.sprite?.anims?.[sheet]) {
      this.hero.setAnim(sheet);
      this.hero.setProgress(0);
    }
    if (this.config.plow) this.hero.plow = true;
    if (this.config.invincible) this.hero.setInvincible(this.config.id);
  }

  end() {
    if (!this.running) return;
    this.running = false;
    const activeFlag = { melee: 'meleeActive', specialMelee: 'specialMeleeActive', supermove: 'supermoveActive' }[this.config.id];
    this.hero[activeFlag] = false;
    if (this.config.id === 'supermove') this.hero._supermoveEnded = true;
    unpinAll({ enemies: [...this.pinned].filter(t => typeof t.destroy !== 'function'),
      barrels: [...this.pinned].filter(t => typeof t.destroy === 'function') });
    this.pinned.clear();
    this.windows.clear();
    if (this.config.invincible) this.hero.clearInvincible(this.config.id);
    this.hero.plow = Object.values(this.hero.attackMoves).some(a => a.running && a.config.plow);
  }

  inRecovery() {
    const h = this.hero;
    const frames = h.spriteAnimData?.frames;
    if (!frames || h._spriteAnim !== this.config.sheet(h)) return false;
    let last = -1;
    frames.forEach((f, i) => { if (hasHitBox(f)) last = i; });
    return last >= 0 && h.spriteFrameIndex > last;
  }

  isLastHit() {
    const h = this.hero;
    const frames = h.spriteAnimData?.frames ?? [];
    return !frames.slice(h.spriteFrameIndex + 1).some(hasHitBox);
  }

  knockback() { return this.hero._attackKnockback(this.config.id); }

  hitbox() {
    const h = this.hero, c = this.config;
    if (!this.running || !c.active(h)) return null;
    const box = h._sheetAttackBox(c.sheet(h));
    if (!box) return null;
    const key = c.multiHit ? h.spriteFrameIndex : 'swing';
    if (!this.windows.has(key)) this.windows.set(key, new Set());
    const lastHit = !c.multiHit || this.isLastHit();
    return { ...h._sheetBoxToWorld(box), ...this.knockback(),
      attack: this, hitTargets: this.windows.get(key), multiHit: c.multiHit,
      lastHit, finisher: false, impact: c.impact, hitstop: c.impact.chipHitstop,
      _source: 'sheet', _traceFrame: h.spriteFrameIndex };
  }
}
