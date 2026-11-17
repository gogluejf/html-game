import { BaseAttack } from './baseAttack.js';

const GROUND_FRICTION = 0.85;

export class MeleeAttack extends BaseAttack {
  constructor(hero) {
    super(hero, { id: 'melee', multiHit: true, sheet: h => h._meleeSheet ?? (h._meleeAirborne ? 'air_melee' : 'melee'), active: h => h.meleeActive });
  }

  tryMelee() {
    const h = this.hero;
    if (h.meleeCooldown > 0 || h.meleeActive || h.specialMeleeActive) return;
    h.meleeFrame = 0;
    h.meleeActive = true;
    h._meleeAirborne = !h.grounded;
    h._meleeSheet = h._meleeAirborne ? 'air_melee' : (Math.abs(h.vx) > 20 && h.sprite?.anims?.run_melee ? 'run_melee' : 'melee');
    h.attackMoves.melee.begin();
    h.meleeCooldown = h.MELEE_TOTAL_FRAMES * h.MELEE_FRAME_DURATION;
    h._meleeAnimProgress(0);
  }

  updateMelee(dt, input) {
    const h = this.hero;
    if (h.meleeCooldown > 0) h.meleeCooldown -= dt;
    if (!h.meleeActive) return;
    const f = Math.floor(h.meleeFrame);
    const inRecovery = h.spriteAnimData ? this.inRecovery() : f >= h.MELEE_TOTAL_FRAMES - 1;
    if (inRecovery && h._meleeCancelRequested(input)) {
      h.endNormalMelee();
      h.pendingMelee = null;
      h._prevMeleeJumpHeld = !!(input && input.jump);
      return;
    }
    h.meleeFrame += dt / h.MELEE_FRAME_DURATION;
    if (h._connectProtectFrames > 0) {
      h._connectProtectFrames = Math.max(0, h._connectProtectFrames - 1);
    }
    if (h.meleeFrame >= h.MELEE_TOTAL_FRAMES) {
      h.attackMoves.melee.end();
      h.meleeActive = false;
      h.meleeFrame = 0;
      h._meleeAirborne = false;
      h._meleeHitTargets.clear(); // swing over — next swing re-arms freely
      h.meleeCooldown = 0;
      h.executePendingMelee();
    } else {
      h._meleeAnimProgress(h.meleeFrame / h.MELEE_TOTAL_FRAMES);
    }
    h._prevMeleeJumpHeld = !!(input && input.jump);
  }

  endNormalMelee() {
    const h = this.hero;
    h.attackMoves.melee.end();
    h.meleeActive = false;
    h.meleeFrame = 0;
    h._meleeAirborne = false;
    h.meleeCooldown = 0;
    h._meleeHitTargets.clear(); // swing over — next swing re-arms freely
    h._flushPendingCrouch();
  }
}
