import { BaseAttack } from './baseAttack.js';

import { UNIT_PX_X } from '../../world/macros.js';
import { Debug } from '../../debug/debug.js';

const GROUND_FRICTION = 0.85;

export class SweepAttack extends BaseAttack {
  constructor(hero) {
    super(hero, { id: 'specialMelee', multiHit: false, plow: true, sheet: () => 'super_melee', active: h => h.specialMeleeActive });
  }

  startSpecialMelee() {
    const h = this.hero;
    if (h.specialMeleeActive || h.meleeActive) return;
    const cfg = h.heroDef.specialMelee;
    if (h.crouching) h.exitCrouch();
    h.attackMoves.specialMelee.begin();
    h.specialMeleeActive = true;
    h.specialMeleeFrame = 0;
    h.specialMeleeDir = h.facing * cfg.direction;
    h._meleeAnimProgress(0);
    h.specialMeleePhase = h._spriteAnim === 'super_melee' ? h._specialMeleePhaseAt(0) ?? 'windup' : 'windup';
  }

  updateSpecialMelee(dt, input) {
    const h = this.hero;
    if (!h.specialMeleeActive) return;
    const cfg = h.heroDef.specialMelee;
    const total = h.specialMeleeTotalFrames;

    const f = Math.floor(h.specialMeleeFrame);

    if (f >= total) {
      h.endSpecialMelee();
      h.executePendingMelee();
      h._prevMeleeJumpHeld = !!(input && input.jump);
      return;
    }

    const derived = h._specialMeleePhaseAt(f);
    const phase = (h._spriteAnim === 'super_melee' && derived != null) ? derived : (h.specialMeleePhase ?? 'active');
    Debug.logEvent(
      `[melee] super_melee f=${f}/${(h.spriteAnimData?.frames.length ?? '?') - 1} phase=${phase} @(${Math.round(h.x)},${Math.round(h.y)})`
    );
    h.specialMeleePhase = phase;

    if (phase === 'recovery' && h._meleeCancelRequested(input)) {
      h.endSpecialMelee();
      h.pendingMelee = null;
      h._prevMeleeJumpHeld = !!input.jump;
      return;
    }

    h.specialMeleeFrame += dt / (h.specialMeleeDuration / total);

    if (h._connectProtectFrames > 0) {
      h._connectProtectFrames = Math.max(0, h._connectProtectFrames - 1);
    }

    if (phase === 'recovery') {
      h.vx *= GROUND_FRICTION;
      if (Math.abs(h.vx) < 1) h.vx = 0;
    } else {
      h.vx = h.specialMeleeDir * cfg.travelSpeed * UNIT_PX_X; // X-units/s → px/s
    }

    h._meleeAnimProgress(f / (total - 1));

    h._prevMeleeJumpHeld = !!(input && input.jump);
  }

  endSpecialMelee() {
    const h = this.hero;
    h.attackMoves.specialMelee.end();
    h.specialMeleeActive = false;
    h.specialMeleePhase = null;
    h.specialMeleeFrame = 0;
    h._connectProtectFrames = 0;
    h._specialHitTargets.clear(); // sweep over — next sweep re-arms freely
    h._flushPendingCrouch();
  }
}
