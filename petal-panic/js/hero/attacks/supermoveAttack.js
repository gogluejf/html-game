import { BaseAttack } from './baseAttack.js';
import { SUPERMOVE_DUR, SUPERMOVE_BURST_FRAC, SUPERMOVE_SPEED, SUPERMOVE_RESIDUAL } from '../../consts.js';

const GROUND_FRICTION = 0.85;

export class SupermoveAttack extends BaseAttack {
  constructor(hero) {
    super(hero, { id: 'supermove', multiHit: true, plow: true, invincible: true, sheet: () => 'supermove', active: h => !h._supermoveEnded && h.supermoveAnimPlaying });
  }

  // A stopped dash still launches forward. Body collision must not scale
  // the authored lethal vector down to zero (or tilt it with falling speed).
  knockback() {
    const tiers = super.knockback();
    return { ...tiers, knockbackBig: { ...tiers.knockbackBig,
      x: tiers.knockbackBig.x * this.direction, dirMode: 'fixed' } };
  }

  updateSupermove(dt, input) {
    const h = this.hero;
    if (!h.supermoveActive && h.supermoveMeter < h.SUPERMOVE_MAX) {
      h.supermoveMeter = Math.min(h.SUPERMOVE_MAX, h.supermoveMeter + h.SUPERMOVE_CHARGE_RATE * dt);
    }

    if (input.super && h.supermoveMeter >= h.SUPERMOVE_MAX && !h.supermoveActive) {
      h.triggerSupermove();
    }

    if (h.supermoveActive) {
      const dir = h.facing;
      h._supermoveElapsed += dt;
      const f = Math.min(1, h._supermoveElapsed / SUPERMOVE_DUR); // 0→1 across the whole supermove
      h.vx = dir * (SUPERMOVE_SPEED + (SUPERMOVE_RESIDUAL - SUPERMOVE_SPEED) * f);
      if (h.supermovePhase === 'burst') {
        h.vy = 0;
        h.supermoveTimer -= dt;
        if (h.supermoveTimer <= 0) {
          h.supermovePhase = 'decel';
          h.supermoveTimer = h.decelDur;
        }
      } else {
        h.supermoveTimer -= dt;
        if (h.supermoveTimer <= 0) h._velocityPhaseDone();
      }
    }
  }

  triggerSupermove() {
    const h = this.hero;
    if (h.hitStunned) return;
    h.attackMoves.supermove.begin();
    h._supermoveEnded = false; // re-arm the animation-end latch for this move
    h.supermoveMeter = 0;
    h.supermoveActive = true;
    h.burstDur = SUPERMOVE_DUR * SUPERMOVE_BURST_FRAC;
    h.decelDur = SUPERMOVE_DUR - h.burstDur;
    h.decelFrac = h.decelDur / SUPERMOVE_DUR; // speed scale at handoff
    h.supermovePhase = 'burst';
    h.supermoveTimer = h.burstDur;
    h._supermoveElapsed = 0; // total elapsed since trigger (drives the velocity ramp)

    {
      const d = h.spriteAnimData;
      console.log(`[sm] START pos=(${h.x.toFixed(0)},${h.y.toFixed(0)}) facing=${h.facing}` +
        ` | anim='${h._spriteAnim}' frame ${h.spriteFrameIndex}/${d?.frames.length ?? '?'} (player done=${!!h._player?.isDone})` +
        ` | plow+invincible ON for the WHOLE move (burst ${h.burstDur.toFixed(2)}s + decel ${h.decelDur.toFixed(2)}s)`);
    }
    if (h.anims.supermove) {
      h._prevAnim = h.anim;
      h.anim = h.anims.supermove;
      h.anim.reset();
    }
  }

  endSupermove() {
    const h = this.hero;
    const d = h.spriteAnimData;
    console.log(`[sm] SUPERMOVE END pos=(${h.x.toFixed(0)},${h.y.toFixed(0)})` +
      ` | anim='${h._spriteAnim}' frame ${h.spriteFrameIndex}/${d?.frames.length ?? '?'} (player done=${!!h._player?.isDone})` +
      ` | plow+invincible OFF — the move is over`);
    h.attackMoves.supermove.end();

    if (h._prevAnim) {
      h.anim = h._prevAnim;
      h._prevAnim = null;
    }
  }

  _velocityPhaseDone() {
    const h = this.hero;
    h.supermoveActive = false;
    h.supermovePhase = null;
    h.supermoveTimer = 0;
    h.vx = h.facing * SUPERMOVE_RESIDUAL;
    console.log(`[sm] velocity phase done (0.6s ramp finished) — move CONTINUES until the animation ends; plow+invincible stay ON`);
  }
}
